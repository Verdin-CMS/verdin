//! Realtime events over SSE, filtered by what the subscriber may read, and presence.

use std::time::Duration;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use verdin_auth::ContentAction;
use verdin_schema::{Schema, Source};

use crate::common::{App, As};

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

/// An open SSE stream; `next` returns the next event's `(name, data)`.
pub(crate) struct Stream(Body);

impl Stream {
    pub(crate) async fn open(app: &App, uri: &str, bearer: Option<&str>) -> (StatusCode, Stream) {
        let mut request = Request::get(uri);
        if let Some(bearer) = bearer {
            request = request.header("authorization", format!("Bearer {bearer}"));
        }
        let response =
            app.router.clone().oneshot(request.body(Body::empty()).unwrap()).await.unwrap();
        (response.status(), Stream(response.into_body()))
    }

    pub(crate) async fn next(&mut self) -> Option<(String, Value)> {
        let mut text = String::new();
        loop {
            let frame = tokio::time::timeout(Duration::from_millis(500), self.0.frame())
                .await
                .ok()??
                .ok()?;
            let Ok(data) = frame.into_data() else { continue };
            text.push_str(&String::from_utf8_lossy(&data));
            while let Some(end) = text.find("\n\n") {
                let block: String = text.drain(..end + 2).collect();
                let name =
                    block.lines().find_map(|line| line.strip_prefix("event: ")).map(str::to_owned);
                let data =
                    block.lines().find_map(|line| line.strip_prefix("data: ")).map(str::to_owned);
                if let (Some(name), Some(data)) = (name, data) {
                    return Some((name, serde_json::from_str(&data).unwrap_or(Value::Null)));
                }
            }
        }
    }

    /// Event names until the stream goes quiet.
    async fn drain(&mut self) -> Vec<String> {
        let mut names = Vec::new();
        while let Some((name, _)) = self.next().await {
            names.push(name);
        }
        names
    }
}

#[tokio::test]
async fn content_events_follow_permissions() {
    let app = App::new(schema()).await;
    app.auth.set_public_grants(&[("api::article".into(), ContentAction::Find)]).await.unwrap();

    let (status, mut public) = Stream::open(&app, "/api/_events", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = app.token.clone();
    let (_, mut full) = Stream::open(&app, "/api/_events?types=api::article", Some(&token)).await;
    assert_eq!(public.next().await.unwrap().0, "ready");
    assert_eq!(full.next().await.unwrap().0, "ready");

    // A draft (only full access reads drafts), then a publication (everyone).
    let (_, draft) = app
        .call(
            Method::POST,
            "/api/articles?status=draft",
            Some(json!({ "data": { "title": "Hi" } })),
        )
        .await;
    let id = draft["data"]["documentId"].as_str().unwrap().to_owned();
    app.call(Method::POST, &format!("/api/articles/{id}/actions/publish"), None).await;

    assert_eq!(full.drain().await, ["entry.create", "entry.publish"]);
    let (name, data) = public.next().await.unwrap();
    assert_eq!(name, "entry.publish", "the draft event is not public");
    assert_eq!(data["uid"], "api::article");
    assert_eq!(data["documentId"], id.as_str());
    assert!(public.drain().await.is_empty());

    let (status, _) = Stream::open(&app, "/api/_events", Some("vd_not-a-token")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.done().await;
}

#[tokio::test]
async fn presence_and_soft_locks() {
    let app = App::new(schema()).await;
    let register =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, body) = app
        .call_as(
            Method::POST,
            "/admin/api/auth/register-first-admin",
            Some(register),
            As::Anonymous,
        )
        .await;
    let ada = body["data"]["accessToken"].as_str().unwrap().to_owned();
    let (_, roles) = app.call_as(Method::GET, "/admin/api/roles", None, As::Bearer(&ada)).await;
    let editor = roles["data"].as_array().unwrap().iter().find(|r| r["code"] == "editor").unwrap()
        ["id"]
        .clone();
    let user = json!({ "email": "bob@example.com", "password": "correct horse 1", "firstname": "Bob", "roles": [editor] });
    app.call_as(Method::POST, "/admin/api/users", Some(user), As::Bearer(&ada)).await;
    let login = json!({ "email": "bob@example.com", "password": "correct horse 1" });
    let (_, body) =
        app.call_as(Method::POST, "/admin/api/auth/login", Some(login), As::Anonymous).await;
    let bob = body["data"]["accessToken"].as_str().unwrap().to_owned();

    let (_, mut stream) = Stream::open(&app, "/admin/api/events", Some(&bob)).await;
    assert_eq!(stream.next().await.unwrap().0, "ready");
    let beat =
        |editing: bool| json!({ "uid": "api::article", "documentId": "doc1", "editing": editing });
    let (status, _) =
        app.call_as(Method::POST, "/admin/api/presence", Some(beat(true)), As::Bearer(&ada)).await;
    assert_eq!(status, StatusCode::OK);
    let (_, viewers) =
        app.call_as(Method::POST, "/admin/api/presence", Some(beat(true)), As::Bearer(&bob)).await;
    let viewers = viewers["data"].as_array().unwrap().clone();
    assert_eq!(viewers.len(), 2);
    let ada_seen = viewers.iter().find(|viewer| viewer["name"] == "Ada").unwrap();
    assert_eq!(ada_seen["holdsLock"], true, "the first editor holds the lock");

    let (name, data) = stream.next().await.unwrap();
    assert_eq!(name, "presence");
    assert_eq!(data["documentId"], "doc1");

    // Ada leaves: Bob holds the lock.
    let leave = json!({ "uid": "api::article", "documentId": "doc1", "leave": true });
    app.call_as(Method::POST, "/admin/api/presence", Some(leave), As::Bearer(&ada)).await;
    let (_, now) = app
        .call_as(
            Method::GET,
            "/admin/api/presence?uid=api::article&documentId=doc1",
            None,
            As::Bearer(&bob),
        )
        .await;
    assert_eq!(
        now["data"],
        json!([{ "userId": now["data"][0]["userId"], "name": "Bob", "editing": true, "holdsLock": true }])
    );
    let (status, _) = app
        .call_as(
            Method::POST,
            "/admin/api/presence",
            Some(json!({ "uid": "api::nope", "documentId": "x" })),
            As::Bearer(&bob),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.done().await;
}
