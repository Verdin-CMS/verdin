//! The daily digest: admins who opted in get their unseen changes by email.

mod common;

use axum::http::Method;
use common::{App, As};
use serde_json::json;
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

#[tokio::test]
async fn emails_admins_who_opted_in() {
    let app = App::new(schema()).await;
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, registered) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = registered["data"]["accessToken"].as_str().unwrap().to_owned();

    app.post("/api/articles", json!({ "title": "One" })).await;
    app.post("/api/articles", json!({ "title": "Two" })).await;
    assert_eq!(app.digest.send_all().await.unwrap(), 0, "not asked for");

    app.call_as(
        Method::PUT,
        "/admin/api/users/me/preferences",
        Some(json!({ "digest": "daily" })),
        As::Bearer(&admin),
    )
    .await;
    assert_eq!(app.digest.send_all().await.unwrap(), 1);
    let emails = app.emails.lock().unwrap().clone();
    let email = emails.last().unwrap();
    assert_eq!(email.to, "ada@example.com");
    assert_eq!(email.subject, "2 changes waiting for you in Verdin");
    assert!(email.text.contains("- Article: 2"), "{}", email.text);
    assert!(email.text.contains("https://cms.test/admin/"));

    // Nothing unseen, nothing sent.
    let (_, list) =
        app.call_as(Method::GET, "/admin/api/content/api::article", None, As::Bearer(&admin)).await;
    for entry in list["data"].as_array().unwrap() {
        let document_id = entry["documentId"].as_str().unwrap();
        app.call_as(
            Method::PUT,
            &format!("/admin/api/engagement/api::article/{document_id}/view"),
            None,
            As::Bearer(&admin),
        )
        .await;
    }
    assert_eq!(app.digest.send_all().await.unwrap(), 0);

    // One run per day, whichever instance takes it first.
    let day = time::macros::date!(2026 - 09 - 28);
    assert!(app.digest.claim(day).await.unwrap());
    assert!(!app.digest.claim(day).await.unwrap(), "already taken");
    assert!(app.digest.claim(day.next_day().unwrap()).await.unwrap());
    app.done().await;
}
