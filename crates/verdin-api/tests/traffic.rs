//! Content API traffic controls: ETags, the anonymous reads cache and rate limits.

mod common;

use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::{App, As};
use serde_json::json;
use verdin_api::cache::TrafficConfig;
use verdin_auth::ContentAction;
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

async fn open(app: &App) {
    app.auth.set_public_grants(&[("api::article".into(), ContentAction::Find)]).await.unwrap();
}

#[tokio::test]
async fn etags_and_cache() {
    let app = App::with_traffic(
        schema(),
        TrafficConfig {
            cache_ttl: Duration::from_secs(60),
            cache_entries: 10,
            ..Default::default()
        },
    )
    .await;
    open(&app).await;
    app.post("/api/articles", json!({ "title": "One" })).await;

    let first = app.request(Method::GET, "/api/articles", None, As::Anonymous, &[]).await;
    assert_eq!(first.status, StatusCode::OK);
    assert_eq!(first.headers["x-cache"], "MISS");
    let tag = first.headers["etag"].to_str().unwrap().to_owned();
    assert!(tag.starts_with("W/\""));
    let second = app.request(Method::GET, "/api/articles", None, As::Anonymous, &[]).await;
    assert_eq!(second.headers["x-cache"], "HIT");
    assert_eq!(second.body, first.body);
    let unchanged = app
        .request(Method::GET, "/api/articles", None, As::Anonymous, &[("if-none-match", &tag)])
        .await;
    assert_eq!(unchanged.status, StatusCode::NOT_MODIFIED);

    // Token requests are never served from the shared cache, but get ETags too.
    let token = app.request(Method::GET, "/api/articles", None, As::Bearer(&app.token), &[]).await;
    assert!(token.headers.get("x-cache").is_none());
    assert_eq!(token.headers["etag"], tag.as_str(), "same data, same tag");

    // A write empties the cache.
    app.post("/api/articles", json!({ "title": "Two" })).await;
    assert!(app.cache.is_empty());
    let fresh = app
        .request(Method::GET, "/api/articles", None, As::Anonymous, &[("if-none-match", &tag)])
        .await;
    assert_eq!(fresh.status, StatusCode::OK);
    assert_eq!(fresh.headers["x-cache"], "MISS");
    assert_eq!(fresh.body["data"].as_array().unwrap().len(), 2);
    app.done().await;
}

#[tokio::test]
async fn rate_limits() {
    let app = App::with_traffic(
        schema(),
        TrafficConfig { public_per_minute: 3, token_per_minute: 5, ..Default::default() },
    )
    .await;
    open(&app).await;
    for _ in 0..3 {
        assert_eq!(
            app.call_as(Method::GET, "/api/articles", None, As::Anonymous).await.0,
            StatusCode::OK
        );
    }
    let limited = app.request(Method::GET, "/api/articles", None, As::Anonymous, &[]).await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.headers["retry-after"], "60");
    // Tokens have their own budget.
    for _ in 0..5 {
        assert_eq!(app.call(Method::GET, "/api/articles", None).await.0, StatusCode::OK);
    }
    assert_eq!(app.call(Method::GET, "/api/articles", None).await.0, StatusCode::TOO_MANY_REQUESTS);
    app.done().await;
}
