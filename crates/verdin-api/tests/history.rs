//! Content history: versions recorded from every API, reading them and restoring one.

mod common;

use axum::http::{Method, StatusCode};
use common::{App, As};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    let ct = |name: &str, plural: &str, attributes: Value| {
        Source::content_type(
            name,
            json!({ "kind": "collectionType", "singularName": name, "pluralName": plural, "displayName": name,
                    "options": { "draftAndPublish": true }, "attributes": attributes })
            .to_string(),
        )
    };
    Schema::parse(&[
        ct(
            "article",
            "articles",
            json!({
                "title": { "type": "string" },
                "tags": { "type": "relation", "relation": "manyWay", "target": "tag" },
                "seo": { "type": "component", "component": "shared.seo" }
            }),
        ),
        ct("tag", "tags", json!({ "label": { "type": "string" } })),
        Source::component(
            "shared",
            "seo",
            json!({ "displayName": "Seo", "attributes": {
                "metaTitle": { "type": "string" },
                "reviewer": { "type": "relation", "relation": "oneWay", "target": "tag" }
            } })
            .to_string(),
        ),
    ])
    .unwrap()
}

const PASSWORD: &str = "correct horse 1";
const CONTENT: &str = "/admin/api/content/api::article";

async fn register(app: &App) -> String {
    let body = json!({ "email": "ada@example.com", "password": PASSWORD, "firstname": "Ada" });
    let (status, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["data"]["accessToken"].as_str().unwrap().to_owned()
}

async fn tag(app: &App, label: &str) -> String {
    let (status, body) = app.post("/api/tags", json!({ "label": label })).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["data"]["documentId"].as_str().unwrap().to_owned()
}

async fn versions(app: &App, admin: &str, document_id: &str) -> Vec<Value> {
    let (status, body) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/history/api::article/{document_id}"),
            None,
            As::Bearer(admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["data"].as_array().unwrap().clone()
}

#[tokio::test]
async fn versions_are_recorded_and_restored() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    let rust = tag(&app, "Rust").await;
    let go = tag(&app, "Go").await;

    let (status, body) = app
        .call_as(
            Method::POST,
            CONTENT,
            Some(json!({ "data": { "title": "First", "tags": [rust, go],
                                   "seo": { "metaTitle": "SEO", "reviewer": go } } })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let document_id = body["data"]["documentId"].as_str().unwrap().to_owned();
    let edit = |title: &str| json!({ "data": { "title": title, "tags": [], "seo": null } });
    app.call_as(
        Method::PUT,
        &format!("{CONTENT}/{document_id}"),
        Some(edit("Second")),
        As::Bearer(&admin),
    )
    .await;
    app.call_as(
        Method::POST,
        &format!("{CONTENT}/{document_id}/actions/publish"),
        None,
        As::Bearer(&admin),
    )
    .await;
    // The content API records versions too (no author).
    app.call(
        Method::PUT,
        &format!("/api/articles/{document_id}?status=draft"),
        Some(json!({ "data": { "title": "Third" } })),
    )
    .await;

    let list = versions(&app, &admin, &document_id).await;
    let events: Vec<&Value> = list.iter().map(|v| &v["event"]).collect();
    assert_eq!(events, ["entry.update", "entry.publish", "entry.update", "entry.create"]);
    assert_eq!(list[1]["status"], "published");
    assert_eq!(list[3]["status"], "draft");
    assert_eq!(list[3]["createdBy"]["firstname"], "Ada");
    assert!(list[0]["createdBy"].is_null());

    let first = list[3]["id"].clone();
    let (status, version) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/history/versions/{first}"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{version}");
    let snapshot = &version["data"]["data"];
    assert_eq!(snapshot["title"], "First");
    let labels: Vec<&Value> =
        snapshot["tags"].as_array().unwrap().iter().map(|t| &t["label"]).collect();
    assert_eq!(labels, ["Rust", "Go"]);
    assert_eq!(snapshot["seo"]["reviewer"]["label"], "Go");
    assert_eq!(version["data"]["unknownFields"], json!([]));

    // Go is deleted: restoring drops it (and reports it) instead of failing.
    app.call(Method::DELETE, &format!("/api/tags/{go}"), None).await;
    let (status, restored) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/history/versions/{first}/restore"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{restored}");
    let mut dropped = restored["data"]["dropped"].as_array().unwrap().clone();
    dropped.sort_by_key(|d| d["field"].as_str().unwrap().to_owned());
    assert_eq!(
        dropped,
        [json!({ "field": "seo", "count": 1 }), json!({ "field": "tags", "count": 1 })]
    );
    let (_, current) = app
        .call_as(
            Method::GET,
            &format!("{CONTENT}/{document_id}?populate=*"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(current["data"]["title"], "First");
    let labels: Vec<&Value> =
        current["data"]["tags"].as_array().unwrap().iter().map(|t| &t["label"]).collect();
    assert_eq!(labels, ["Rust"]);
    assert_eq!(current["data"]["seo"]["metaTitle"], "SEO");
    assert!(current["data"]["seo"]["reviewer"].is_null());
    assert!(current["data"]["publishedAt"].is_null(), "restored as the draft");
    assert_eq!(versions(&app, &admin, &document_id).await.len(), 5, "the restore is a version");

    // Deleting the document removes its history.
    app.call(Method::DELETE, &format!("/api/articles/{document_id}"), None).await;
    let (status, _) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/history/versions/{first}"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.done().await;
}

#[tokio::test]
async fn permissions_and_retention() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    let (_, created) = app.post("/api/articles?status=draft", json!({ "title": "v0" })).await;
    let document_id = created["data"]["documentId"].as_str().unwrap().to_owned();
    for index in 1..=12 {
        app.call(
            Method::PUT,
            &format!("/api/articles/{document_id}?status=draft"),
            Some(json!({ "data": { "title": format!("v{index}") } })),
        )
        .await;
    }
    let list = versions(&app, &admin, &document_id).await;
    assert_eq!(list.len(), 10, "the test harness keeps 10 versions");
    let (_, newest) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/history/versions/{}", list[0]["id"]),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(newest["data"]["data"]["title"], "v12");

    // Authors only see the history of their own entries.
    let (_, roles) = app.call_as(Method::GET, "/admin/api/roles", None, As::Bearer(&admin)).await;
    let author = roles["data"].as_array().unwrap().iter().find(|r| r["code"] == "author").unwrap()
        ["id"]
        .clone();
    let body = json!({ "email": "au@example.com", "password": PASSWORD, "roles": [author] });
    app.call_as(Method::POST, "/admin/api/users", Some(body), As::Bearer(&admin)).await;
    let (_, login) = app
        .call_as(
            Method::POST,
            "/admin/api/auth/login",
            Some(json!({ "email": "au@example.com", "password": PASSWORD })),
            As::Anonymous,
        )
        .await;
    let author = login["data"]["accessToken"].as_str().unwrap().to_owned();
    let (status, _) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/history/api::article/{document_id}"),
            None,
            As::Bearer(&author),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/history/versions/{}/restore", list[0]["id"]),
            None,
            As::Bearer(&author),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.done().await;
}
