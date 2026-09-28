//! `password` attributes: hashed on write, never returned, filtered or sorted.

use axum::http::StatusCode;
use serde_json::json;
use verdin_schema::{Schema, Source};

use crate::common::App;

fn schema() -> Schema {
    Schema::parse(&[Source::content_type(
        "member",
        json!({ "kind": "collectionType", "singularName": "member", "pluralName": "members",
                "displayName": "Member",
                "attributes": {
                    "name": { "type": "string" },
                    "pin": { "type": "password", "minLength": 4 }
                } })
        .to_string(),
    )])
    .unwrap()
}

async fn stored_pin(app: &App, document_id: &str) -> String {
    app.test
        .db
        .queries()
        .fetch_all(
            "SELECT pin FROM members WHERE document_id = ?",
            &[verdin_db::SqlValue::Text(document_id.into())],
            &[verdin_db::ColumnKind::Text],
        )
        .await
        .unwrap()[0][0]
        .clone()
        .into_text()
        .unwrap()
}

#[tokio::test]
async fn passwords_are_hashed_and_hidden() {
    let app = App::new(schema()).await;
    let (status, _) = app.post("/api/members", json!({ "name": "Ada", "pin": "123" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "minLength applies to the clear text");

    let (status, created) = app.post("/api/members", json!({ "name": "Ada", "pin": "1234" })).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert!(created["data"].get("pin").is_none(), "{created}");
    let id = created["data"]["documentId"].as_str().unwrap().to_owned();
    let first = stored_pin(&app, &id).await;
    assert!(first.starts_with("$argon2id$"), "{first}");

    // Updates without the field keep the hash; with it, hash the new value.
    app.put(&format!("/api/members/{id}"), json!({ "name": "Ada L." })).await;
    assert_eq!(stored_pin(&app, &id).await, first);
    app.put(&format!("/api/members/{id}"), json!({ "pin": "$argon2id$v=19$m=1,t=1,p=1$x$y" }))
        .await;
    let second = stored_pin(&app, &id).await;
    assert_ne!(second, "$argon2id$v=19$m=1,t=1,p=1$x$y", "clients cannot set a hash");
    assert!(second.starts_with("$argon2id$"));

    let (_, listed) = app.get("/api/members?fields[0]=pin").await;
    assert!(listed["data"][0].get("pin").is_none(), "{listed}");
    for query in ["filters[pin][$eq]=1234", "sort=pin"] {
        let (status, _) = app.get(&format!("/api/members?{query}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{query}");
    }
    app.done().await;
}
