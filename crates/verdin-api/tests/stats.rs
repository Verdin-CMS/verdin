//! Chart statistics and unseen counts for the dashboard.

mod common;

use axum::http::{Method, StatusCode};
use common::{App, As};
use serde_json::json;
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    Schema::parse(&[Source::content_type(
        "article",
        json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                "displayName": "Article", "options": { "draftAndPublish": true },
                "attributes": { "title": { "type": "string" } } })
        .to_string(),
    )])
    .unwrap()
}

#[tokio::test]
async fn stats_and_unseen_counts() {
    let app = App::new(schema()).await;
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, registered) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = registered["data"]["accessToken"].as_str().unwrap().to_owned();

    app.post("/api/articles", json!({ "title": "One" })).await;
    app.post("/api/articles", json!({ "title": "Two" })).await;
    let (_, draft) = app.post("/api/articles?status=draft", json!({ "title": "Draft" })).await;

    let (status, stats) = app
        .call_as(
            Method::GET,
            "/admin/api/content/api::article/stats?days=7",
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{stats}");
    let series = stats["data"]["series"].as_array().unwrap();
    assert_eq!(series.len(), 7);
    let today = series.last().unwrap();
    assert_eq!((today["created"].as_u64(), today["published"].as_u64()), (Some(3), Some(2)));
    assert_eq!(stats["data"]["totals"], json!({ "documents": 3, "published": 2 }));
    let (_, weekly) = app
        .call_as(
            Method::GET,
            "/admin/api/content/api::article/stats?days=30&interval=week",
            None,
            As::Bearer(&admin),
        )
        .await;
    let weeks = weekly["data"]["series"].as_array().unwrap();
    assert!((5..=6).contains(&weeks.len()), "{weeks:?}");
    assert_eq!(weeks.iter().map(|week| week["created"].as_u64().unwrap()).sum::<u64>(), 3);
    assert_eq!(
        app.call_as(
            Method::GET,
            "/admin/api/content/api::article/stats?interval=year",
            None,
            As::Bearer(&admin)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );

    // Everything is new to Ada until she opens it.
    let (_, unseen) =
        app.call_as(Method::GET, "/admin/api/engagement/unseen", None, As::Bearer(&admin)).await;
    assert_eq!(unseen["data"], json!({ "api::article": 3 }));
    let id = draft["data"]["documentId"].as_str().unwrap();
    let (status, _) = app
        .call_as(
            Method::PUT,
            &format!("/admin/api/engagement/api::article/{id}/view"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert!(status.is_success(), "{status}");
    let (_, unseen) =
        app.call_as(Method::GET, "/admin/api/engagement/unseen", None, As::Bearer(&admin)).await;
    assert_eq!(unseen["data"]["api::article"], 2);
    app.done().await;
}
