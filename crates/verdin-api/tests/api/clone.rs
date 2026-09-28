//! Duplicating entries from the admin.

use axum::http::{Method, StatusCode};
use serde_json::json;
use verdin_schema::{Schema, Source};

use crate::common::{App, As};

fn schema() -> Schema {
    Schema::parse(&[
        Source::content_type(
            "article",
            json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                    "displayName": "Article", "options": { "draftAndPublish": true },
                    "attributes": {
                        "title": { "type": "string" },
                        "slug": { "type": "uid", "targetField": "title" },
                        "code": { "type": "string", "unique": true },
                        "seo": { "type": "component", "component": "shared.seo" },
                        "tags": { "type": "relation", "relation": "manyToMany", "target": "api::tag.tag" },
                        "cover": { "type": "relation", "relation": "oneToOne", "target": "api::tag.tag" }
                    } })
            .to_string(),
        ),
        Source::content_type(
            "tag",
            json!({ "kind": "collectionType", "singularName": "tag", "pluralName": "tags",
                    "displayName": "Tag", "attributes": { "label": { "type": "string" } } })
            .to_string(),
        ),
        Source::component(
            "shared",
            "seo",
            json!({ "displayName": "SEO", "attributes": { "metaTitle": { "type": "string" } } })
                .to_string(),
        ),
    ])
    .unwrap()
}

#[tokio::test]
async fn clones_a_draft_without_unique_values() {
    let app = App::new(schema()).await;
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, registered) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = registered["data"]["accessToken"].as_str().unwrap().to_owned();
    let (_, tag) = app.post("/api/tags", json!({ "label": "rust" })).await;
    let tag = tag["data"]["documentId"].as_str().unwrap().to_owned();
    let (_, other) = app.post("/api/tags", json!({ "label": "cover" })).await;
    let other = other["data"]["documentId"].as_str().unwrap().to_owned();
    let (status, article) = app
        .post(
            "/api/articles",
            json!({ "title": "Hello", "slug": "hello", "code": "A-1", "seo": { "metaTitle": "Hi" },
                    "tags": [tag], "cover": other }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{article}");
    let original = article["data"]["documentId"].as_str().unwrap().to_owned();

    let (status, copy) = app
        .call_as(
            Method::POST,
            &format!("/admin/api/content/api::article/{original}/clone"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{copy}");
    assert_eq!(copy["meta"]["leftOut"], json!(["code", "cover", "slug"]));
    let copy_id = copy["data"]["documentId"].as_str().unwrap().to_owned();
    assert_ne!(copy_id, original);

    let (_, read) = app
        .get(&format!("/api/articles/{copy_id}?status=draft&populate[0]=seo&populate[1]=tags&populate[2]=cover"))
        .await;
    let data = &read["data"];
    assert_eq!(data["title"], "Hello");
    assert!(data["publishedAt"].is_null(), "a draft");
    assert_eq!(data["seo"]["metaTitle"], "Hi");
    assert_eq!(data["tags"][0]["documentId"], tag.as_str());
    assert!(data["cover"].is_null());
    assert!(data["slug"].is_null() && data["code"].is_null());

    // The original keeps its one-to-one target.
    let (_, original) = app.get(&format!("/api/articles/{original}?populate[0]=cover")).await;
    assert_eq!(original["data"]["cover"]["documentId"], other.as_str());

    let (status, _) = app
        .call_as(
            Method::POST,
            "/admin/api/content/api::article/nope/clone",
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.done().await;
}
