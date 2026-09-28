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

#[tokio::test]
async fn sorts_by_a_related_field() {
    let app = App::new(schema()).await;
    let mut authors = std::collections::HashMap::new();
    for label in ["zoe", "adam", "mia"] {
        let (_, tag) = app.post("/api/tags", json!({ "label": label })).await;
        authors.insert(label, tag["data"]["documentId"].as_str().unwrap().to_owned());
    }
    for (title, author) in
        [("One", Some("zoe")), ("Two", Some("adam")), ("Three", None), ("Four", Some("mia"))]
    {
        let data = match author {
            Some(author) => json!({ "title": title, "author": authors[author] }),
            None => json!({ "title": title }),
        };
        app.post("/api/articles", data).await;
    }
    let titles = |body: &serde_json::Value| -> Vec<String> {
        body["data"]
            .as_array()
            .unwrap_or_else(|| panic!("{body}"))
            .iter()
            .map(|doc| doc["title"].as_str().unwrap().to_owned())
            .collect()
    };
    let (status, asc) = app.get("/api/articles?sort=author.label:asc").await;
    assert_eq!(status, StatusCode::OK, "{asc}");
    assert_eq!(titles(&asc), ["Two", "Four", "One", "Three"], "no author last");
    let (_, desc) = app.get("/api/articles?sort[0]=author.label:desc&sort[1]=title").await;
    assert_eq!(titles(&desc), ["One", "Four", "Two", "Three"]);
    for bad in ["tags.label", "author.nope", "title.x"] {
        let (status, _) = app.get(&format!("/api/articles?sort={bad}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
    }
    app.done().await;
}
