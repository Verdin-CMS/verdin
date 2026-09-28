//! Strapi v5 query options: relation counts and `hasPublishedVersion`.

use axum::http::{Method, StatusCode};
use serde_json::json;
use verdin_schema::{Schema, Source};

use crate::common::App;

fn schema() -> Schema {
    Schema::parse(&[
        Source::content_type(
            "article",
            json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                    "displayName": "Article", "options": { "draftAndPublish": true },
                    "attributes": {
                        "title": { "type": "string" },
                        "tags": { "type": "relation", "relation": "manyToMany", "target": "api::tag.tag" },
                        "author": { "type": "relation", "relation": "manyToOne", "target": "api::tag.tag" }
                    } })
            .to_string(),
        ),
        Source::content_type(
            "tag",
            json!({ "kind": "collectionType", "singularName": "tag", "pluralName": "tags",
                    "displayName": "Tag", "attributes": { "label": { "type": "string" } } })
            .to_string(),
        ),
    ])
    .unwrap()
}

#[tokio::test]
async fn counts_relations_and_filters_by_published_version() {
    let app = App::new(schema()).await;
    let mut tags = Vec::new();
    for label in ["a", "b", "c"] {
        let (_, tag) = app.post("/api/tags", json!({ "label": label })).await;
        tags.push(tag["data"]["documentId"].as_str().unwrap().to_owned());
    }
    let (_, published) = app.post("/api/articles", json!({ "title": "Live", "tags": tags })).await;
    let live = published["data"]["documentId"].as_str().unwrap().to_owned();
    app.call(
        Method::POST,
        "/api/articles?status=draft",
        Some(json!({ "data": { "title": "Idea" } })),
    )
    .await;

    let (status, body) = app.get("/api/articles?populate[tags][count]=true").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"][0]["tags"], json!({ "count": 3 }));
    let (_, filtered) = app
        .get("/api/articles?populate[tags][count]=true&populate[tags][filters][label][$ne]=a")
        .await;
    assert_eq!(filtered["data"][0]["tags"]["count"], 2);
    let (status, _) = app.get("/api/articles?populate[author][count]=true").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "to-one relations have no count");

    let titles = |body: &serde_json::Value| -> Vec<String> {
        body["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|doc| doc["title"].as_str().unwrap().to_owned())
            .collect()
    };
    let (_, with) = app.get("/api/articles?status=draft&hasPublishedVersion=true").await;
    assert_eq!(titles(&with), ["Live"]);
    assert_eq!(with["data"][0]["documentId"], live.as_str());
    let (_, without) = app.get("/api/articles?status=draft&hasPublishedVersion=false").await;
    assert_eq!(titles(&without), ["Idea"]);
    assert_eq!(without["meta"]["pagination"]["total"], 1);
    let (status, _) = app.get("/api/tags?hasPublishedVersion=true").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    app.done().await;
}
