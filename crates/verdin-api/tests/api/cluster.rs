//! Two instances on one database: the shared event bus carries realtime events, presence,
//! media changes and cache invalidation from one to the other.

use std::time::Duration;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use verdin_auth::ContentAction;
use verdin_schema::{Schema, Source};

use crate::common::{App, As, Part};
use crate::realtime::Stream;

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

/// The next event called `name`, waiting up to five seconds.
async fn wait_for(stream: &mut Stream, name: &str) -> Value {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        if let Some((event, data)) = stream.next().await
            && event == name
        {
            return data;
        }
    }
    panic!("no {name} event");
}

#[tokio::test]
async fn events_reach_the_other_instance() {
    let (a, b) = App::pair(schema()).await;
    a.auth.set_public_grants(&[("api::article".into(), ContentAction::Find)]).await.unwrap();

    // B caches an anonymous read.
    let read = || b.request(Method::GET, "/api/articles", None, As::Anonymous, &[]);
    assert_eq!(read().await.headers["x-cache"], "MISS");
    assert_eq!(read().await.headers["x-cache"], "HIT");
    let token = b.token.clone();
    let (status, mut stream) = Stream::open(&b, "/api/_events", Some(&token)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stream.next().await.unwrap().0, "ready");

    // A writes: B's subscriber hears it, and B's cache no longer has the old answer.
    let (_, draft) =
        a.call(Method::POST, "/api/articles", Some(json!({ "data": { "title": "Hi" } }))).await;
    let id = draft["data"]["documentId"].as_str().unwrap().to_owned();
    a.call(Method::POST, &format!("/api/articles/{id}/actions/publish"), None).await;
    let data = wait_for(&mut stream, "entry.publish").await;
    assert_eq!(data["uid"], "api::article");
    assert_eq!(data["documentId"], id.as_str());
    let fresh = read().await;
    assert_eq!(fresh.headers["x-cache"], "MISS", "emptied by A's write");
    assert_eq!(fresh.body["data"][0]["documentId"], id.as_str());

    // Media changes travel too.
    let register =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, body) = a
        .call_as(
            Method::POST,
            "/admin/api/auth/register-first-admin",
            Some(register),
            As::Anonymous,
        )
        .await;
    let ada = body["data"]["accessToken"].as_str().unwrap().to_owned();
    let upload = a
        .multipart(
            Method::POST,
            "/admin/api/upload",
            &[Part::file("files", "notes.txt", b"hello".to_vec())],
            As::Bearer(&ada),
        )
        .await;
    assert_eq!(upload.status, StatusCode::CREATED, "{}", upload.body);
    let data = wait_for(&mut stream, "media.create").await;
    assert_eq!(data["fileId"], upload.body["data"][0]["id"]);

    // Presence converges: Ada edits through A, B sees her holding the lock.
    let beat = json!({ "uid": "api::article", "documentId": id, "editing": true });
    let (status, _) =
        a.call_as(Method::POST, "/admin/api/presence", Some(beat), As::Bearer(&ada)).await;
    assert_eq!(status, StatusCode::OK);
    let uri = format!("/admin/api/presence?uid=api::article&documentId={id}");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let viewers = loop {
        let (_, body) = b.call_as(Method::GET, &uri, None, As::Bearer(&ada)).await;
        if body["data"].as_array().is_some_and(|viewers| !viewers.is_empty()) {
            break body["data"].clone();
        }
        assert!(tokio::time::Instant::now() < deadline, "B never saw Ada");
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert_eq!(viewers[0]["name"], "Ada");
    assert_eq!(viewers[0]["holdsLock"], true);

    // Leaving through A clears B too.
    let leave = json!({ "uid": "api::article", "documentId": id, "leave": true });
    a.call_as(Method::POST, "/admin/api/presence", Some(leave), As::Bearer(&ada)).await;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let (_, body) = b.call_as(Method::GET, &uri, None, As::Bearer(&ada)).await;
        if body["data"] == json!([]) {
            break;
        }
        assert!(tokio::time::Instant::now() < deadline, "B still shows Ada");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    // The second instance shares the first one's database: it goes first.
    b.done().await;
    a.done().await;
}

#[tokio::test]
async fn a_single_instance_publishes_nothing() {
    let app = App::new(schema()).await;
    app.call(Method::POST, "/api/articles", Some(json!({ "data": { "title": "Hi" } }))).await;
    assert!(!app.realtime.bus().is_shared());
    assert_eq!(app.test.count("vd_cluster_events").await, 0);
    app.done().await;
}

#[tokio::test]
async fn search_indexes_follow_the_other_instance() {
    let (dir_a, dir_b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, b) = App::pair_with_search(schema(), (dir_a.path(), dir_b.path())).await;
    let (_, created) = a
        .call(Method::POST, "/api/articles", Some(json!({ "data": { "title": "Rust notes" } })))
        .await;
    let id = created["data"]["documentId"].as_str().unwrap().to_owned();

    // B re-reads the entry A wrote and indexes it.
    let search = b.search.clone().unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        search.flush().await;
        let (_, body) = b.call(Method::GET, "/api/articles?_q=rust&status=draft", None).await;
        if body["data"][0]["documentId"] == id.as_str() {
            break;
        }
        assert!(tokio::time::Instant::now() < deadline, "B's index never got it: {body}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    b.done().await;
    a.done().await;
}
