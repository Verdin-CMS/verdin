//! Where used: the versions referencing an entry or a file.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

use crate::common::{App, As, Part};

fn schema() -> Schema {
    let ct = |name: &str, plural: &str, draft_and_publish: bool, attributes: Value| {
        Source::content_type(
            name,
            json!({ "kind": "collectionType", "singularName": name, "pluralName": plural,
                    "displayName": name, "options": { "draftAndPublish": draft_and_publish },
                    "attributes": attributes })
            .to_string(),
        )
    };
    Schema::parse(&[
        ct("category", "categories", false, json!({ "name": { "type": "string" } })),
        ct(
            "article",
            "articles",
            true,
            json!({
                "title": { "type": "string" },
                "category": { "type": "relation", "relation": "manyToOne", "target": "category" },
                "cover": { "type": "media" },
                "body": { "type": "richtext" },
                "content": { "type": "blocks" },
                "sections": { "type": "dynamiczone", "components": ["shared.seo"] }
            }),
        ),
        ct(
            "note",
            "notes",
            false,
            json!({
                "text": { "type": "string" },
                "about": { "type": "relation", "relation": "morphToOne" }
            }),
        ),
        Source::component(
            "shared",
            "seo",
            json!({
                "displayName": "SEO",
                "attributes": {
                    "image": { "type": "media" },
                    "related": { "type": "relation", "relation": "oneWay", "target": "category" },
                    "text": { "type": "blocks" }
                }
            })
            .to_string(),
        ),
    ])
    .unwrap()
}

fn png() -> Vec<u8> {
    let image = image::RgbImage::from_fn(4, 4, |x, y| image::Rgb([x as u8, y as u8, 90]));
    let mut bytes = std::io::Cursor::new(Vec::new());
    image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    bytes.into_inner()
}

#[tokio::test]
async fn entries_and_files() {
    let app = App::new(schema()).await;
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = body["data"]["accessToken"].as_str().unwrap().to_owned();
    let upload = |name: &'static str| {
        let parts = vec![Part::file("files", name, png())];
        let app = &app;
        let admin = admin.clone();
        async move {
            let response =
                app.multipart(Method::POST, "/admin/api/upload", &parts, As::Bearer(&admin)).await;
            assert_eq!(response.status, StatusCode::CREATED, "{}", response.body);
            response.body["data"][0].clone()
        }
    };
    let (cover, inline, unused) =
        (upload("a.png").await, upload("b.png").await, upload("c.png").await);
    let id = |body: &Value| body["data"]["documentId"].as_str().unwrap().to_owned();

    let (_, category) = app.post("/api/categories", json!({ "name": "Rust" })).await;
    let (_, other) = app.post("/api/categories", json!({ "name": "Other" })).await;
    let (category, other) = (id(&category), id(&other));
    let (status, article) = app
        .post(
            "/api/articles",
            json!({
                "title": "Hello", "category": category, "cover": cover["id"],
                "body": format!("see ![b]({})", inline["url"].as_str().unwrap()),
                "sections": [{ "__component": "shared.seo", "related": other, "image": inline["id"],
                               "text": [{ "type": "image", "image": { "url": cover["url"], "id": cover["id"] },
                                          "children": [{ "type": "text", "text": "" }] }] }]
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{article}");
    let article = id(&article);
    let (status, note) = app
        .post(
            "/api/notes",
            json!({ "text": "n", "about": { "__type": "api::category", "documentId": category } }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{note}");

    let usage = |uri: String| {
        let app = &app;
        let admin = admin.clone();
        async move {
            let (status, body) = app.call_as(Method::GET, &uri, None, As::Bearer(&admin)).await;
            assert_eq!(status, StatusCode::OK, "{body}");
            body["data"]
                .as_array()
                .unwrap()
                .iter()
                .map(|usage| {
                    format!(
                        "{} {} {} {}",
                        usage["uid"].as_str().unwrap(),
                        usage["status"].as_str().unwrap(),
                        usage["field"].as_str().unwrap(),
                        usage["title"].as_str().unwrap_or("-")
                    )
                })
                .collect::<Vec<_>>()
        }
    };
    assert_eq!(
        usage(format!("/admin/api/content/api::category/{category}/usage")).await,
        [
            "api::article draft category Hello",
            "api::article published category Hello",
            "api::note published about n",
        ]
    );
    assert_eq!(
        usage(format!("/admin/api/content/api::category/{other}/usage")).await,
        [
            "api::article draft sections.0.related Hello",
            "api::article published sections.0.related Hello",
        ]
    );
    let file_usage = |file: &Value| format!("/admin/api/upload/files/{}/usage", file["id"]);
    assert_eq!(
        usage(file_usage(&cover)).await,
        [
            "api::article draft cover Hello",
            "api::article draft sections.0.text Hello",
            "api::article published cover Hello",
            "api::article published sections.0.text Hello",
        ]
    );
    assert_eq!(
        usage(file_usage(&inline)).await,
        [
            "api::article draft body Hello",
            "api::article draft sections.0.image Hello",
            "api::article published body Hello",
            "api::article published sections.0.image Hello",
        ]
    );
    assert!(usage(file_usage(&unused)).await.is_empty());
    assert!(usage(format!("/admin/api/content/api::article/{article}/usage")).await.is_empty());
    let (status, _) = app
        .call_as(Method::GET, "/admin/api/upload/files/999/usage", None, As::Bearer(&admin))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.done().await;
}
