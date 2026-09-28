//! `_q`: ranked by the search index, or `$containsi` on the text fields without one.

use axum::http::StatusCode;
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

use crate::common::App;

fn schema() -> Schema {
    Schema::parse(&[Source::content_type(
        "article",
        json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                "displayName": "Article", "options": { "draftAndPublish": true },
                "attributes": {
                    "title": { "type": "string" },
                    "summary": { "type": "text" },
                    "secret": { "type": "string", "private": true },
                    "content": { "type": "blocks" }
                } })
        .to_string(),
    )])
    .unwrap()
}

fn titles(body: &Value) -> Vec<&str> {
    body["data"].as_array().unwrap().iter().map(|a| a["title"].as_str().unwrap()).collect()
}

async fn seed(app: &App) {
    for (title, summary, secret) in [
        ("Rust ownership", "Borrowing and lifetimes", "rust"),
        ("Café in Madrid", "Where to drink coffee", "x"),
        ("Cooking with rust", "Cast iron care: a rust guide", "y"),
        ("Gardening", "Nothing to see", "rust"),
    ] {
        let (status, body) = app
            .post(
                "/api/articles",
                json!({ "title": title, "summary": summary, "secret": secret,
                        "content": [{ "type": "paragraph", "children": [{ "type": "text", "text": format!("{title} notes") }] }] }),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
    }
}

#[tokio::test]
async fn containsi_without_an_index() {
    let app = App::new(schema()).await;
    seed(&app).await;
    let (status, body) = app.get("/api/articles?_q=RUST&sort=title").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        titles(&body),
        ["Cooking with rust", "Rust ownership"],
        "private fields are not searched"
    );
    let (_, body) = app.get("/api/articles?_q=coffee&filters[title][$startsWith]=Caf").await;
    assert_eq!(titles(&body), ["Café in Madrid"]);
    let (status, _) = app.get(&format!("/api/articles?_q={}", "a".repeat(201))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    app.done().await;
}

#[tokio::test]
async fn ranked_with_the_index() {
    let dir = tempfile::tempdir().unwrap();
    let app = App::with_search(schema(), dir.path()).await;
    seed(&app).await;
    let search = app.search.clone().unwrap();
    search.flush().await;

    let (status, body) = app.get("/api/articles?_q=rust").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(titles(&body), ["Rust ownership", "Cooking with rust"], "title matches first");
    assert_eq!(body["meta"]["pagination"]["total"], 2);
    let (_, body) = app.get("/api/articles?_q=cafe").await;
    assert_eq!(titles(&body), ["Café in Madrid"], "accents are ignored");
    let (_, body) = app.get("/api/articles?_q=cook").await;
    assert_eq!(titles(&body), ["Cooking with rust"], "the last word is a prefix");
    let (_, body) = app.get("/api/articles?_q=cast%20guide").await;
    assert_eq!(titles(&body), ["Cooking with rust"], "every word must match");
    let (_, body) = app.get("/api/articles?_q=gardening%20notes").await;
    assert_eq!(titles(&body), ["Gardening"], "blocks are indexed");
    let (_, body) =
        app.get("/api/articles?_q=rust&pagination[pageSize]=1&pagination[page]=2").await;
    assert_eq!(titles(&body), ["Cooking with rust"]);
    assert_eq!(body["meta"]["pagination"]["pageCount"], 2);
    let (_, body) = app.get("/api/articles?_q=rust&sort=title:asc").await;
    assert_eq!(titles(&body), ["Cooking with rust", "Rust ownership"], "an explicit sort wins");
    let (_, body) = app.get("/api/articles?_q=rust&filters[title][$contains]=Cook").await;
    assert_eq!(titles(&body), ["Cooking with rust"], "filters narrow the hits");

    // Changes are indexed; deleted documents disappear.
    let (_, list) = app.get("/api/articles?_q=ownership").await;
    let id = list["data"][0]["documentId"].as_str().unwrap().to_owned();
    app.put(&format!("/api/articles/{id}"), json!({ "title": "Memory safety" })).await;
    search.flush().await;
    let (_, body) = app.get("/api/articles?_q=memory").await;
    assert_eq!(titles(&body), ["Memory safety"]);
    let (status, _) =
        app.call(axum::http::Method::DELETE, &format!("/api/articles/{id}"), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    search.flush().await;
    let (_, body) = app.get("/api/articles?_q=memory").await;
    assert!(titles(&body).is_empty());
    app.done().await;
}
