//! Visual editing: source maps in text for authenticated reads that ask for them.

use axum::http::{Method, StatusCode};
use serde_json::json;
use verdin_schema::{Schema, Source};

use crate::common::{App, As};

#[tokio::test]
async fn source_maps_on_request() {
    let schema = Schema::parse(&[Source::content_type(
        "article",
        json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                "displayName": "Article", "attributes": { "title": { "type": "string" } } })
        .to_string(),
    )])
    .unwrap();
    let app = App::new(schema).await;
    let (_, created) = app.post("/api/articles", json!({ "title": "Hello" })).await;
    let id = created["data"]["documentId"].as_str().unwrap().to_owned();

    let marked = app
        .request(
            Method::GET,
            "/api/articles",
            None,
            As::Bearer(&app.token),
            &[("x-verdin-stega", "true")],
        )
        .await;
    assert_eq!(marked.status, StatusCode::OK);
    let title = marked.body["data"][0]["title"].as_str().unwrap();
    assert!(title.starts_with("Hello") && title.len() > 5);
    assert_eq!(verdin_api::stega::strip(title), "Hello");
    assert_eq!(
        verdin_api::stega::decode(title)[0]["href"],
        format!("https://cms.test/admin/content/api::article/{id}?field=title")
    );
    assert_eq!(marked.headers["cache-control"], "private, no-store");

    let plain = app.request(Method::GET, "/api/articles", None, As::Bearer(&app.token), &[]).await;
    assert_eq!(plain.body["data"][0]["title"], "Hello");
    let anonymous = app
        .request(Method::GET, "/api/articles", None, As::Anonymous, &[("x-verdin-stega", "true")])
        .await;
    assert_ne!(anonymous.status, StatusCode::OK, "no public access in this schema");

    let script =
        app.request(Method::GET, "/admin/api/visual-editing.js", None, As::Anonymous, &[]).await;
    assert_eq!(script.status, StatusCode::OK);
    assert!(script.headers["content-type"].to_str().unwrap().starts_with("text/javascript"));
    app.done().await;
}
