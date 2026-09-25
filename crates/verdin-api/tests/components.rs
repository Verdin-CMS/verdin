//! Blocks rich text, and relations and media inside components and dynamic zones.

mod common;

use axum::http::{Method, StatusCode};
use common::{App, As, Part};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    Schema::parse(&[
        Source::content_type(
            "article",
            json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles", "displayName": "Article",
                    "options": { "draftAndPublish": true },
                    "attributes": {
                        "title": { "type": "string" },
                        "body": { "type": "blocks" },
                        "byline": { "type": "component", "component": "shared.byline" },
                        "sections": { "type": "dynamiczone", "components": ["blocks.gallery", "shared.byline"] }
                    } })
            .to_string(),
        ),
        Source::content_type(
            "person",
            json!({ "kind": "collectionType", "singularName": "person", "pluralName": "people", "displayName": "Person",
                    "options": { "draftAndPublish": true }, "attributes": { "name": { "type": "string" } } })
            .to_string(),
        ),
        Source::component(
            "shared",
            "byline",
            json!({ "displayName": "Byline", "attributes": {
                "author": { "type": "relation", "relation": "oneWay", "target": "person" },
                "reviewers": { "type": "relation", "relation": "manyWay", "target": "person" },
                "photo": { "type": "media", "allowedTypes": ["images"] }
            } })
            .to_string(),
        ),
        Source::component(
            "blocks",
            "gallery",
            json!({ "displayName": "Gallery", "attributes": { "images": { "type": "media", "multiple": true } } })
                .to_string(),
        ),
    ])
    .unwrap()
}

fn png() -> Vec<u8> {
    let image = image::RgbImage::from_pixel(4, 4, image::Rgb([10, 20, 30]));
    let mut bytes = std::io::Cursor::new(Vec::new());
    image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    bytes.into_inner()
}

async fn upload(app: &App, name: &str, bytes: Vec<u8>) -> i64 {
    let response = app
        .multipart(
            Method::POST,
            "/api/upload",
            &[Part::file("files", name, bytes)],
            As::Bearer(&app.token),
        )
        .await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.body);
    response.body[0]["id"].as_i64().unwrap()
}

async fn person(app: &App, name: &str, publish: bool) -> String {
    let url = if publish { "/api/people" } else { "/api/people?status=draft" };
    let (status, body) = app.post(url, json!({ "name": name })).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["data"]["documentId"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn blocks_are_validated_and_returned() {
    let app = App::new(schema()).await;
    let body = json!([
        { "type": "heading", "level": 1, "children": [{ "type": "text", "text": "Hello" }] },
        { "type": "paragraph", "children": [
            { "type": "text", "text": "Bold", "bold": true },
            { "type": "link", "url": "https://verdin.dev", "children": [{ "type": "text", "text": "link" }] }
        ] }
    ]);
    let (status, created) =
        app.post("/api/articles", json!({ "title": "Blocks", "body": body })).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["data"]["body"], body, "returned without populate, like Strapi");

    let unsafe_link = json!([{ "type": "paragraph", "children": [
        { "type": "link", "url": "javascript:alert(1)", "children": [{ "type": "text", "text": "x" }] } ] }]);
    let (status, response) = app.post("/api/articles", json!({ "body": unsafe_link })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        response["error"]["details"]["errors"][0]["path"],
        json!(["body", 0, "children", 0, "url"])
    );
    assert_eq!(
        app.post("/api/articles", json!({ "body": { "type": "paragraph" } })).await.0,
        StatusCode::BAD_REQUEST
    );
    app.done().await;
}

#[tokio::test]
async fn references_inside_components() {
    let app = App::new(schema()).await;
    let ada = person(&app, "Ada", true).await;
    let grace = person(&app, "Grace", true).await;
    let draft_only = person(&app, "Draft only", false).await;
    let photo = upload(&app, "photo.png", png()).await;
    let notes = upload(&app, "notes.txt", b"hello".to_vec()).await;

    let data = json!({
        "title": "With refs",
        "byline": { "author": ada, "reviewers": [{ "documentId": grace }, draft_only], "photo": { "id": photo } },
        "sections": [
            { "__component": "blocks.gallery", "images": [photo, notes] },
            { "__component": "shared.byline", "author": grace }
        ]
    });
    let (status, body) = app.post("/api/articles?populate=*", data).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let byline = &body["data"]["byline"];
    assert_eq!(byline["author"]["name"], "Ada");
    let reviewers: Vec<&Value> =
        byline["reviewers"].as_array().unwrap().iter().map(|r| &r["name"]).collect();
    assert_eq!(reviewers, ["Grace"], "the draft-only person has no published version");
    assert_eq!(byline["photo"]["name"], "photo.png");
    let images: Vec<&Value> = body["data"]["sections"][0]["images"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| &f["name"])
        .collect();
    assert_eq!(images, ["photo.png", "notes.txt"]);
    assert_eq!(body["data"]["sections"][1]["author"]["name"], "Grace");
    let document_id = body["data"]["documentId"].as_str().unwrap().to_owned();

    // Drafts resolve drafts.
    let (_, body) =
        app.get(&format!("/api/articles/{document_id}?status=draft&populate=byline")).await;
    assert_eq!(body["data"]["byline"]["reviewers"].as_array().unwrap().len(), 2);

    // Existence and allowed types are checked on write.
    let missing = json!({ "byline": { "author": "nope000000000000000000000" } });
    let (status, body) = app.post("/api/articles", missing).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        body["error"]["message"].as_str().unwrap().contains("related documents do not exist"),
        "{body}"
    );
    let wrong_type = json!({ "byline": { "photo": notes } });
    let (status, body) = app.post("/api/articles", wrong_type).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"]["message"].as_str().unwrap().contains("only images"), "{body}");
    assert_eq!(
        app.post("/api/articles", json!({ "byline": { "author": [ada, grace] } })).await.0,
        StatusCode::BAD_REQUEST
    );

    // A deleted target resolves to nothing.
    app.call(Method::DELETE, &format!("/api/people/{ada}"), None).await;
    let (_, body) = app.get(&format!("/api/articles/{document_id}?populate=byline")).await;
    assert!(body["data"]["byline"]["author"].is_null());
    app.done().await;
}
