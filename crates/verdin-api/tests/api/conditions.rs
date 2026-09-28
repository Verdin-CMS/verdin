//! Strapi's conditional fields: a hidden field is not required.

use axum::http::StatusCode;
use serde_json::json;
use verdin_schema::{Schema, Source};

use crate::common::App;

#[tokio::test]
async fn hidden_fields_are_not_required() {
    let schema = Schema::parse(&[Source::content_type(
        "post",
        json!({ "kind": "collectionType", "singularName": "post", "pluralName": "posts",
                "displayName": "Post",
                "attributes": {
                    "kind": { "type": "enumeration", "enum": ["text", "video"], "required": true },
                    "url": { "type": "string", "required": true,
                             "conditions": { "visible": { "==": [{ "var": "kind" }, "video"] } } }
                } })
        .to_string(),
    )])
    .unwrap();
    let app = App::new(schema).await;
    let (status, body) = app.post("/api/posts", json!({ "kind": "text" })).await;
    assert_eq!(status, StatusCode::CREATED, "url is hidden for text posts: {body}");
    let (status, body) = app.post("/api/posts", json!({ "kind": "video" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(body.to_string().contains("url is a required field"), "{body}");
    let (status, _) =
        app.post("/api/posts", json!({ "kind": "video", "url": "https://v.example" })).await;
    assert_eq!(status, StatusCode::CREATED);
    app.done().await;
}
