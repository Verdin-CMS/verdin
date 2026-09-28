//! Strapi's conditional fields (a hidden field is not required) and cross-field
//! validations.

use axum::http::{Method, StatusCode};
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

fn events(draft_and_publish: bool) -> Schema {
    Schema::parse(&[Source::content_type(
        "event",
        json!({ "kind": "collectionType", "singularName": "event", "pluralName": "events",
                "displayName": "Event",
                "options": { "draftAndPublish": draft_and_publish },
                "attributes": {
                    "start": { "type": "date", "required": true },
                    "end": { "type": "date" },
                    "seats": { "type": "integer" },
                    "sold": { "type": "integer" }
                },
                "validations": [
                    { "rule": { "or": [{ "!": { "var": "end" } },
                                       { "<=": [{ "var": "start" }, { "var": "end" }] }] },
                      "message": "must be after the start", "field": "end" },
                    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] },
                      "message": "more tickets sold than seats" }
                ] })
        .to_string(),
    )])
    .unwrap()
}

#[tokio::test]
async fn cross_field_validations() {
    let app = App::new(events(false)).await;
    let (status, body) = app
        .post("/api/events", json!({ "start": "2026-03-10", "end": "2026-03-01", "seats": 5 }))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let errors = &body["error"]["details"]["errors"];
    assert_eq!(errors[0]["path"], json!(["end"]), "{body}");
    assert_eq!(errors[0]["message"], "must be after the start", "{body}");
    assert_eq!(errors.as_array().unwrap().len(), 1, "sold (null) <= seats: {body}");

    let (status, body) =
        app.post("/api/events", json!({ "start": "2026-03-10", "seats": 5 })).await;
    assert_eq!(status, StatusCode::CREATED, "no end is fine: {body}");
    let id = body["data"]["documentId"].as_str().unwrap().to_owned();
    let (status, body) = app.put(&format!("/api/events/{id}"), json!({ "sold": 6 })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["error"]["details"]["errors"][0]["path"], json!([]), "{body}");
    assert_eq!(body["error"]["details"]["errors"][0]["message"], "more tickets sold than seats");
    let (status, _) = app.put(&format!("/api/events/{id}"), json!({ "sold": 5 })).await;
    assert_eq!(status, StatusCode::OK);
    app.done().await;

    // Drafts may be invalid; publishing checks the rules.
    let app = App::new(events(true)).await;
    let (status, body) = app
        .post("/api/events?status=draft", json!({ "start": "2026-03-10", "end": "2026-03-01" }))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["data"]["documentId"].as_str().unwrap().to_owned();
    let publish = format!("/api/events/{id}/actions/publish");
    let (status, body) = app.call(Method::POST, &publish, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(body.to_string().contains("must be after the start"), "{body}");
    app.put(&format!("/api/events/{id}?status=draft"), json!({ "end": "2026-03-12" })).await;
    let (status, body) = app.call(Method::POST, &publish, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    app.done().await;
}

#[test]
fn validations_are_checked_when_the_schema_loads() {
    let error = Schema::parse(&[Source::content_type(
        "event",
        json!({ "kind": "collectionType", "singularName": "event", "pluralName": "events",
                "displayName": "Event",
                "attributes": { "start": { "type": "date" } },
                "validations": [
                    { "rule": { "<=": [{ "var": "start" }, 1] }, "message": "x", "field": "nope" },
                    { "rule": { "lessThan": [1, 2] }, "message": "y" },
                    { "rule": true, "message": " " }
                ] })
        .to_string(),
    )])
    .unwrap_err()
    .to_string();
    assert!(error.contains("unknown attribute `nope`"), "{error}");
    assert!(error.contains("unknown JSON Logic operator `lessThan`"), "{error}");
    assert!(error.contains("must be a JSON Logic object"), "{error}");
    assert!(error.contains("must not be empty"), "{error}");
}
