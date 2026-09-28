//! Audit logs: content and admin actions are recorded and can be filtered.


use axum::http::{Method, StatusCode};
use crate::common::{App, As};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    Schema::parse(&[Source::content_type(
        "article",
        json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                "displayName": "Article", "attributes": { "title": { "type": "string" } } })
        .to_string(),
    )])
    .unwrap()
}

fn actions(body: &Value) -> Vec<String> {
    body["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["action"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn records_and_filters() {
    let app = App::new(schema()).await;
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, registered) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = registered["data"]["accessToken"].as_str().unwrap().to_owned();

    // Content through the admin and the content API; a role change; noise that is skipped.
    let (_, created) = app
        .call_as(
            Method::POST,
            "/admin/api/content/api::article",
            Some(json!({ "data": { "title": "Hi" } })),
            As::Bearer(&admin),
        )
        .await;
    let document_id = created["data"]["documentId"].as_str().unwrap().to_owned();
    app.post("/api/articles", json!({ "title": "From the API" })).await;
    let (status, _) = app
        .call_as(
            Method::POST,
            "/admin/api/roles",
            Some(json!({ "code": "reviewers", "name": "Reviewers", "permissions": [] })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    app.call_as(
        Method::PUT,
        "/admin/api/users/me/preferences",
        Some(json!({ "theme": "dark" })),
        As::Bearer(&admin),
    )
    .await;
    app.call_as(
        Method::POST,
        "/admin/api/roles",
        Some(json!({ "code": "", "name": "" })),
        As::Bearer(&admin),
    )
    .await;

    let (status, logs) =
        app.call_as(Method::GET, "/admin/api/audit-logs", None, As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::OK, "{logs}");
    assert_eq!(actions(&logs), ["POST /roles", "entry.create", "entry.create", "admin.login"]);
    let entries = logs["data"].as_array().unwrap();
    assert_eq!(entries[0]["actor"]["email"], "ada@example.com");
    assert_eq!(entries[1]["actor"]["kind"], "api", "the content API caller");
    assert_eq!(entries[2]["subjectId"], document_id.as_str());
    assert_eq!(entries[2]["actor"]["name"], "Ada");
    assert_eq!(entries[3]["actor"]["email"], "ada@example.com", "login read from the answer");

    let (_, filtered) = app
        .call_as(Method::GET, "/admin/api/audit-logs?action=entry.*", None, As::Bearer(&admin))
        .await;
    assert_eq!(actions(&filtered), ["entry.create", "entry.create"]);
    assert_eq!(filtered["meta"]["pagination"]["total"], 2);
    let (_, by_subject) = app
        .call_as(Method::GET, "/admin/api/audit-logs?subject=roles", None, As::Bearer(&admin))
        .await;
    assert_eq!(actions(&by_subject), ["POST /roles"]);
    let (status, _) = app
        .call_as(Method::GET, "/admin/api/audit-logs?from=not-a-date", None, As::Bearer(&admin))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let today = time::OffsetDateTime::now_utc().date().to_string();
    let (_, until_today) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/audit-logs?to={today}"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(until_today["meta"]["pagination"]["total"], 4, "a plain date includes its day");

    // Needs audit.read.
    assert_eq!(
        app.call_as(Method::GET, "/admin/api/audit-logs", None, As::Anonymous).await.0,
        StatusCode::UNAUTHORIZED
    );
    app.done().await;
}
