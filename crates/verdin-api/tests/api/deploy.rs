//! Deploy targets, the "Deploy" button and providers' status callbacks.

use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Bytes;
use axum::http::{Method, StatusCode};
use axum::routing::post;
use serde_json::{Value, json};
use verdin_schema::Schema;

use crate::common::{App, As};

const PASSWORD: &str = "correct horse 1";

/// A build hook that records calls and answers `status`.
async fn hook() -> (String, Arc<Mutex<Vec<Value>>>, Arc<AtomicU16>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/build", listener.local_addr().unwrap());
    let calls: Arc<Mutex<Vec<Value>>> = Arc::default();
    let status = Arc::new(AtomicU16::new(201));
    let (seen, answer) = (calls.clone(), status.clone());
    let app = Router::new().route(
        "/build",
        post(move |body: Bytes| {
            let (seen, answer) = (seen.clone(), answer.clone());
            async move {
                seen.lock().unwrap().push(serde_json::from_slice(&body).unwrap_or(Value::Null));
                StatusCode::from_u16(answer.load(Ordering::SeqCst)).unwrap()
            }
        }),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, calls, status)
}

#[tokio::test]
async fn deploy_targets_and_callbacks() {
    let app = App::new(Schema::default()).await;
    let body = json!({ "email": "ada@example.com", "password": PASSWORD, "firstname": "Ada" });
    let (_, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = body["data"]["accessToken"].as_str().unwrap().to_owned();
    let call = |method: Method, uri: String, body: Option<Value>, who: String| {
        let app = &app;
        async move { app.call_as(method, &uri, body, As::Bearer(&who)).await }
    };
    let (url, calls, status) = hook().await;

    let (code, target) = call(
        Method::POST,
        "/admin/api/deploy/targets".into(),
        Some(json!({ "name": "Production", "url": url })),
        admin.clone(),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{target}");
    assert_eq!(target["data"]["host"], "127.0.0.1");
    assert!(target["data"].get("url").is_none(), "the hook URL stays secret");
    let callback = target["data"]["callbackPath"].as_str().unwrap().to_owned();
    assert!(callback.starts_with("http://localhost:1337/admin/api/deploy/callback/"), "{callback}");
    let id = target["data"]["id"].as_i64().unwrap();

    // Editors deploy (built-in), without managing targets.
    let (_, roles) = call(Method::GET, "/admin/api/roles".into(), None, admin.clone()).await;
    let editor = roles["data"].as_array().unwrap().iter().find(|r| r["code"] == "editor").unwrap()
        ["id"]
        .clone();
    call(
        Method::POST,
        "/admin/api/users".into(),
        Some(json!({ "email": "ed@example.com", "password": PASSWORD, "roles": [editor] })),
        admin.clone(),
    )
    .await;
    let (_, login) = app
        .call_as(
            Method::POST,
            "/admin/api/auth/login",
            Some(json!({ "email": "ed@example.com", "password": PASSWORD })),
            As::Anonymous,
        )
        .await;
    let ed = login["data"]["accessToken"].as_str().unwrap().to_owned();
    let (_, listed) = call(Method::GET, "/admin/api/deploy/targets".into(), None, ed.clone()).await;
    assert!(listed["data"][0].get("callbackPath").is_none(), "{listed}");
    assert_eq!(listed["meta"]["pagination"]["total"], 1);
    let (code, _) =
        call(Method::DELETE, format!("/admin/api/deploy/targets/{id}"), None, ed.clone()).await;
    assert_eq!(code, StatusCode::FORBIDDEN);

    let (code, deployment) =
        call(Method::POST, format!("/admin/api/deploy/targets/{id}/trigger"), None, ed.clone())
            .await;
    assert_eq!(code, StatusCode::CREATED, "{deployment}");
    assert_eq!(deployment["data"]["status"], "triggered");
    assert_eq!(calls.lock().unwrap()[0]["triggeredBy"], "ed@example.com");
    let (code, _) =
        call(Method::POST, format!("/admin/api/deploy/targets/{id}/trigger"), None, ed.clone())
            .await;
    assert_eq!(code, StatusCode::TOO_MANY_REQUESTS, "one deploy at a time");

    // Netlify-style notification.
    let path = callback.trim_start_matches("http://localhost:1337");
    let (code, _) = app
        .call_as(
            Method::POST,
            path,
            Some(json!({ "state": "ready", "deploy_ssl_url": "https://site.example" })),
            As::Anonymous,
        )
        .await;
    assert_eq!(code, StatusCode::NO_CONTENT);
    let (code, _) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/deploy/callback/{id}/wrong"),
            Some(json!({ "state": "ready" })),
            As::Anonymous,
        )
        .await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    let (_, history) =
        call(Method::GET, format!("/admin/api/deploy/deployments?targetId={id}"), None, ed.clone())
            .await;
    assert_eq!(history["data"][0]["status"], "ready", "{history}");
    assert_eq!(history["data"][0]["url"], "https://site.example");
    assert_eq!(
        history["meta"]["pagination"],
        json!({ "page": 1, "pageSize": 25, "total": 1, "pageCount": 1 })
    );
    let (_, limited) = call(
        Method::GET,
        format!("/admin/api/deploy/deployments?targetId={id}&limit=1&page=2"),
        None,
        ed.clone(),
    )
    .await;
    assert_eq!(limited["data"], json!([]), "`limit` is `pageSize`");
    assert_eq!(limited["meta"]["pagination"]["pageSize"], 1);

    // A hook that refuses is recorded as failed.
    status.store(500, Ordering::SeqCst);
    let (code, target) = call(
        Method::POST,
        "/admin/api/deploy/targets".into(),
        Some(json!({ "name": "Staging", "url": url })),
        admin.clone(),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED);
    let staging = target["data"]["id"].as_i64().unwrap();
    let (_, failed) = call(
        Method::POST,
        format!("/admin/api/deploy/targets/{staging}/trigger"),
        None,
        admin.clone(),
    )
    .await;
    assert_eq!(failed["data"]["status"], "failed");
    assert_eq!(failed["data"]["httpStatus"], 500);
    let (code, _) = call(
        Method::POST,
        "/admin/api/deploy/targets".into(),
        Some(json!({ "name": "Bad", "url": "ftp://x" })),
        admin.clone(),
    )
    .await;
    assert_eq!(code, StatusCode::BAD_REQUEST);
    app.done().await;
}

#[tokio::test]
async fn reads_carry_cache_tags() {
    let schema = Schema::parse(&[verdin_schema::Source::content_type(
        "article",
        json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                "displayName": "Article", "attributes": { "title": { "type": "string" } } })
        .to_string(),
    )])
    .unwrap();
    let app = App::new(schema).await;
    let (_, created) = app.post("/api/articles", json!({ "title": "Hi" })).await;
    let id = created["data"]["documentId"].as_str().unwrap().to_owned();
    for uri in ["/api/articles".to_owned(), format!("/api/articles/{id}")] {
        let response = app.request(Method::GET, &uri, None, As::Bearer(&app.token), &[]).await;
        assert_eq!(response.headers["cache-tag"], "vd,vd-article", "{uri}");
        assert_eq!(response.headers["surrogate-key"], "vd vd-article");
    }
    let missing =
        app.request(Method::GET, "/api/articles/nope", None, As::Bearer(&app.token), &[]).await;
    assert!(missing.headers.get("cache-tag").is_none(), "errors are not tagged");
    app.done().await;
}
