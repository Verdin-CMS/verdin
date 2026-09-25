//! Webhooks: subscriptions, signed deliveries, retries, the delivery log and media events.

mod common;

use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::routing::post;
use bytes::Bytes;
use common::{App, As, Part};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    let ct = |name: &str, plural: &str| {
        Source::content_type(
            name,
            json!({ "kind": "collectionType", "singularName": name, "pluralName": plural, "displayName": name,
                    "options": { "draftAndPublish": true },
                    "attributes": { "title": { "type": "string" } } })
            .to_string(),
        )
    };
    Schema::parse(&[ct("article", "articles"), ct("page", "pages")]).unwrap()
}

const PASSWORD: &str = "correct horse 1";

async fn register(app: &App) -> String {
    let body = json!({ "email": "ada@example.com", "password": PASSWORD, "firstname": "Ada" });
    let (status, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["data"]["accessToken"].as_str().unwrap().to_owned()
}

/// A local HTTP endpoint that records what it receives.
#[derive(Clone)]
struct Receiver {
    url: String,
    requests: Arc<Mutex<Vec<(HeaderMap, Bytes)>>>,
    status: Arc<AtomicU16>,
}

impl Receiver {
    async fn start() -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let receiver = Receiver {
            url: format!("http://{}/hook", listener.local_addr().unwrap()),
            requests: Arc::default(),
            status: Arc::new(AtomicU16::new(200)),
        };
        let state = receiver.clone();
        let app = Router::new().route(
            "/hook",
            post(move |headers: HeaderMap, body: Bytes| {
                let state = state.clone();
                async move {
                    state.requests.lock().unwrap().push((headers, body));
                    let status = StatusCode::from_u16(state.status.load(Ordering::SeqCst)).unwrap();
                    (status, "received")
                }
            }),
        );
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        receiver
    }

    fn take(&self) -> Vec<(HeaderMap, Bytes, Value)> {
        std::mem::take(&mut *self.requests.lock().unwrap())
            .into_iter()
            .map(|(headers, body)| {
                let json = serde_json::from_slice(&body).unwrap();
                (headers, body, json)
            })
            .collect()
    }
}

async fn create_hook(app: &App, admin: &str, body: Value) -> Value {
    let (status, body) =
        app.call_as(Method::POST, "/admin/api/webhooks", Some(body), As::Bearer(admin)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["data"].clone()
}

async fn log(app: &App, admin: &str, id: &Value) -> Vec<Value> {
    let (status, body) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/webhooks/{id}/deliveries"),
            None,
            As::Bearer(admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["data"].as_array().unwrap().clone()
}

#[tokio::test]
async fn signed_deliveries_for_subscribed_events() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    let receiver = Receiver::start().await;
    let hook = create_hook(
        &app,
        &admin,
        json!({ "name": "Site rebuild", "url": receiver.url, "events": ["entry.publish", "entry.create"],
                "contentTypes": ["api::article"], "headers": { "Authorization": "Bearer abc" } }),
    )
    .await;
    let secret = hook["secret"].as_str().unwrap().to_owned();
    assert!(secret.starts_with("whsec_"));
    assert_eq!(hook["events"], json!(["entry.create", "entry.publish"]), "normalized order");
    assert_eq!(hook["headers"], json!({ "authorization": "Bearer abc" }));

    // The secret is shown once.
    let (_, listed) =
        app.call_as(Method::GET, "/admin/api/webhooks", None, As::Bearer(&admin)).await;
    assert!(listed["data"][0].get("secret").is_none());
    assert_eq!(listed["data"][0]["signed"], true);
    assert!(listed["meta"]["events"].as_array().unwrap().contains(&json!("media.delete")));

    // Created and published over the content API; pages are not subscribed.
    let (status, created) = app.post("/api/articles", json!({ "title": "Hello" })).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    app.post("/api/pages", json!({ "title": "Ignored" })).await;
    assert_eq!(app.webhooks.deliver_due().await.unwrap(), 2);

    let requests = receiver.take();
    assert_eq!(requests.len(), 2);
    let mut events = Vec::new();
    for (headers, raw, body) in &requests {
        let event = headers["x-verdin-event"].to_str().unwrap();
        events.push(event.to_owned());
        assert_eq!(body["event"], event);
        assert_eq!(body["model"], "article");
        assert_eq!(body["uid"], "api::article");
        assert_eq!(body["entry"]["title"], "Hello");
        assert_eq!(body["entry"]["documentId"], created["data"]["documentId"]);
        assert_eq!(headers["authorization"], "Bearer abc");
        assert_eq!(headers["content-type"], "application/json");
        let signature = headers["x-verdin-signature"].to_str().unwrap();
        let timestamp: i64 =
            signature.strip_prefix("t=").unwrap().split(',').next().unwrap().parse().unwrap();
        assert_eq!(signature, verdin_api::webhooks::signature(&secret, timestamp, raw));
    }
    events.sort();
    assert_eq!(events, ["entry.create", "entry.publish"]);
    let publish = requests.iter().find(|(h, ..)| h["x-verdin-event"] == "entry.publish").unwrap();
    assert!(publish.2["entry"]["publishedAt"].is_string(), "the published version");

    let entries = log(&app, &admin, &hook["id"]).await;
    assert_eq!(entries.len(), 2);
    for entry in &entries {
        assert_eq!(entry["status"], "succeeded");
        assert_eq!(entry["attempts"], 1);
        assert_eq!(entry["responseStatus"], 200);
        assert_eq!(entry["responseBody"], "received");
    }
    assert_eq!(app.webhooks.deliver_due().await.unwrap(), 0, "nothing left to send");

    // Admin edits emit too, once subscribed (the draft is sent).
    let (status, _) = app
        .call_as(
            Method::PUT,
            &format!("/admin/api/webhooks/{}", hook["id"]),
            Some(
                json!({ "name": "Site rebuild", "url": receiver.url, "events": ["entry.update"] }),
            ),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = created["data"]["documentId"].as_str().unwrap();
    let (status, body) = app
        .call_as(
            Method::PUT,
            &format!("/admin/api/content/api::article/{document_id}"),
            Some(json!({ "data": { "title": "Edited" } })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(app.webhooks.deliver_due().await.unwrap(), 1);
    let (_, _, update) = receiver.take().remove(0);
    assert_eq!(update["event"], "entry.update");
    assert_eq!(update["entry"]["title"], "Edited");
    assert!(update["entry"]["publishedAt"].is_null(), "the draft");
    app.done().await;
}

#[tokio::test]
async fn retries_then_fails_and_can_be_redelivered() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    let receiver = Receiver::start().await;
    receiver.status.store(503, Ordering::SeqCst);
    let hook = create_hook(
        &app,
        &admin,
        json!({ "name": "Flaky", "url": receiver.url, "events": ["entry.delete"], "signed": false }),
    )
    .await;
    assert!(hook["secret"].is_null());
    let (_, created) = app.post("/api/articles", json!({ "title": "Doomed" })).await;
    let document_id = created["data"]["documentId"].as_str().unwrap().to_owned();
    app.call(Method::DELETE, &format!("/api/articles/{document_id}"), None).await;

    // Three attempts (two retries in the test configuration), then failed.
    for attempt in 1..=3 {
        assert_eq!(app.webhooks.deliver_due().await.unwrap(), 1, "attempt {attempt}");
        let entries = log(&app, &admin, &hook["id"]).await;
        assert_eq!(entries[0]["attempts"], attempt);
        assert_eq!(entries[0]["responseStatus"], 503);
        assert_eq!(entries[0]["status"], if attempt < 3 { "pending" } else { "failed" });
    }
    assert_eq!(app.webhooks.deliver_due().await.unwrap(), 0);
    let requests = receiver.take();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].2["entry"], json!({ "documentId": document_id }));
    assert!(requests[0].0.get("x-verdin-signature").is_none(), "unsigned");

    // Manual redelivery once the receiver is back.
    receiver.status.store(200, Ordering::SeqCst);
    let delivery = log(&app, &admin, &hook["id"]).await[0]["id"].clone();
    let (status, body) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/webhooks/deliveries/{delivery}/retry"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["ok"], true);
    let entry = &log(&app, &admin, &hook["id"]).await[0];
    assert_eq!(entry["status"], "succeeded");
    assert_eq!(entry["attempts"], 4);

    // An unreachable URL logs the connection error.
    let (status, _) = app
        .call_as(
            Method::PUT,
            &format!("/admin/api/webhooks/{}", hook["id"]),
            Some(json!({ "name": "Gone", "url": "http://127.0.0.1:9/hook", "events": ["entry.delete"] })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/webhooks/{}/trigger", hook["id"]),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(body["data"]["ok"], false);
    assert!(body["data"]["error"].as_str().unwrap().contains("connect"), "{body}");
    app.done().await;
}

#[tokio::test]
async fn trigger_media_events_and_switches() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    let receiver = Receiver::start().await;
    let hook = create_hook(
        &app,
        &admin,
        json!({ "name": "Media", "url": receiver.url, "events": ["media.create", "media.delete", "entry.create"] }),
    )
    .await;

    let (status, body) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/webhooks/{}/trigger", hook["id"]),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["ok"], true);
    assert_eq!(body["data"]["statusCode"], 200);
    assert_eq!(receiver.take()[0].2["event"], "trigger-test");

    let response = app
        .multipart(
            Method::POST,
            "/api/upload",
            &[Part::file("files", "notes.txt", b"hello".to_vec())],
            As::Bearer(&app.token),
        )
        .await;
    assert_eq!(response.status, StatusCode::CREATED);
    let file_id = response.body[0]["id"].clone();
    app.call(Method::DELETE, &format!("/api/upload/files/{file_id}"), None).await;
    assert_eq!(app.webhooks.deliver_due().await.unwrap(), 2);
    let requests = receiver.take();
    let events: Vec<&Value> = requests.iter().map(|(_, _, body)| &body["event"]).collect();
    assert_eq!(events, ["media.create", "media.delete"]);
    assert_eq!(requests[0].2["media"]["name"], "notes.txt");

    // A disabled webhook, or the feature off, sends nothing.
    let (status, _) = app
        .call_as(
            Method::PUT,
            &format!("/admin/api/webhooks/{}", hook["id"]),
            Some(json!({ "name": "Media", "url": receiver.url, "events": ["entry.create"], "enabled": false })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    app.post("/api/articles", json!({ "title": "Quiet" })).await;
    assert_eq!(app.webhooks.deliver_due().await.unwrap(), 0);
    app.call_as(
        Method::PUT,
        &format!("/admin/api/webhooks/{}", hook["id"]),
        Some(json!({ "name": "Media", "url": receiver.url, "events": ["entry.create"] })),
        As::Bearer(&admin),
    )
    .await;
    app.webhooks.set_enabled(false);
    app.post("/api/articles", json!({ "title": "Still quiet" })).await;
    app.webhooks.set_enabled(true);
    assert_eq!(app.webhooks.deliver_due().await.unwrap(), 0);
    assert!(receiver.take().is_empty());

    // Rotating the secret; deleting removes the log with it.
    let (_, rotated) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/webhooks/{}/secret", hook["id"]),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_ne!(rotated["data"]["secret"], hook["secret"]);
    let (status, _) = app
        .call_as(
            Method::DELETE,
            &format!("/admin/api/webhooks/{}", hook["id"]),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/webhooks/{}", hook["id"]),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.done().await;
}

#[tokio::test]
async fn validation_and_permissions() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    let base =
        json!({ "name": "x", "url": "https://example.com/hook", "events": ["entry.create"] });
    let with = |patch: Value| {
        let mut body = base.clone();
        for (key, value) in patch.as_object().unwrap() {
            body[key] = value.clone();
        }
        body
    };
    for (body, message) in [
        (with(json!({ "name": " " })), "name"),
        (with(json!({ "url": "ftp://example.com" })), "http or https"),
        (with(json!({ "events": [] })), "at least one event"),
        (with(json!({ "events": ["entry.explode"] })), "unknown event"),
        (with(json!({ "contentTypes": ["api::nope"] })), "unknown content type"),
        (with(json!({ "headers": { "X-Verdin-Event": "spoof" } })), "set by Verdin"),
        (with(json!({ "headers": { "bad header": "x" } })), "invalid header name"),
        (with(json!({ "surprise": true })), "unknown field"),
    ] {
        let (status, response) =
            app.call_as(Method::POST, "/admin/api/webhooks", Some(body), As::Bearer(&admin)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{message}");
        assert!(response["error"]["message"].as_str().unwrap().contains(message), "{response}");
    }

    // Editors cannot manage webhooks; API tokens are not admin sessions.
    let (_, roles) = app.call_as(Method::GET, "/admin/api/roles", None, As::Bearer(&admin)).await;
    let editor_role =
        roles["data"].as_array().unwrap().iter().find(|r| r["code"] == "editor").unwrap()["id"]
            .clone();
    let body = json!({ "email": "ed@example.com", "password": PASSWORD, "roles": [editor_role] });
    app.call_as(Method::POST, "/admin/api/users", Some(body), As::Bearer(&admin)).await;
    let (_, login) = app
        .call_as(
            Method::POST,
            "/admin/api/auth/login",
            Some(json!({ "email": "ed@example.com", "password": PASSWORD })),
            As::Anonymous,
        )
        .await;
    let editor = login["data"]["accessToken"].as_str().unwrap().to_owned();
    let (status, _) =
        app.call_as(Method::GET, "/admin/api/webhooks", None, As::Bearer(&editor)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app.call_as(Method::GET, "/admin/api/webhooks", None, As::Anonymous).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.done().await;
}
