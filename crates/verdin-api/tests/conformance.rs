//! Content API conformance suite: the same HTTP requests against every database engine
//! (`VERDIN_TEST_DATABASE_URL`, in-memory SQLite by default).

use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use verdin_api::ApiConfig;
use verdin_content::Registry;
use verdin_migrate::{ApplyOptions, Renames, Risk};
use verdin_schema::{Schema, Source};
use verdin_testkit::TestDb;

fn schema() -> Schema {
    let ct = |name: &str, value: Value| Source::content_type(name, value.to_string());
    Schema::parse(&[
        ct(
            "article",
            json!({
                "kind": "collectionType", "singularName": "article", "pluralName": "articles", "displayName": "Article",
                "options": { "draftAndPublish": true },
                "attributes": {
                    "title": { "type": "string", "required": true, "maxLength": 100 },
                    "slug": { "type": "uid", "targetField": "title" },
                    "body": { "type": "richtext" },
                    "views": { "type": "integer", "min": 0 },
                    "big": { "type": "biginteger" },
                    "rating": { "type": "float" },
                    "price": { "type": "decimal", "precision": 8, "scale": 2 },
                    "featured": { "type": "boolean", "default": false },
                    "stage": { "type": "enumeration", "enum": ["idea", "draft", "final"] },
                    "publishOn": { "type": "date" },
                    "startsAt": { "type": "time" },
                    "happenedAt": { "type": "datetime" },
                    "extra": { "type": "json" },
                    "contact": { "type": "email" },
                    "internalNote": { "type": "text", "private": true },
                    "seo": { "type": "component", "component": "shared.seo" },
                    "links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 3 },
                    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
                }
            }),
        ),
        ct(
            "tag",
            json!({
                "kind": "collectionType", "singularName": "tag", "pluralName": "tags", "displayName": "Tag",
                "attributes": { "label": { "type": "string", "required": true, "unique": true } }
            }),
        ),
        ct(
            "homepage",
            json!({
                "kind": "singleType", "singularName": "homepage", "pluralName": "homepages", "displayName": "Homepage",
                "options": { "draftAndPublish": true },
                "attributes": { "headline": { "type": "string", "required": true } }
            }),
        ),
        Source::component("shared", "seo", json!({ "displayName": "SEO", "attributes": {
            "metaTitle": { "type": "string", "required": true, "maxLength": 60 },
            "noIndex": { "type": "boolean", "default": false }
        }}).to_string()),
        Source::component("shared", "link", json!({ "displayName": "Link", "attributes": {
            "label": { "type": "string" }, "url": { "type": "string", "required": true }
        }}).to_string()),
        Source::component("blocks", "hero", json!({ "displayName": "Hero", "attributes": {
            "title": { "type": "string", "required": true }, "seo": { "type": "component", "component": "shared.seo" }
        }}).to_string()),
        Source::component("blocks", "quote", json!({ "displayName": "Quote", "attributes": {
            "text": { "type": "text" }, "meta": { "type": "json" }
        }}).to_string()),
    ])
    .unwrap()
}

struct App {
    router: Router,
    test: TestDb,
}

impl App {
    async fn new() -> Self {
        Self::with_config(ApiConfig { open_access: true, ..ApiConfig::default() }).await
    }

    async fn with_config(config: ApiConfig) -> Self {
        let test = TestDb::new().await;
        let schema = schema();
        let model = verdin_migrate::derive_model(&schema);
        verdin_migrate::apply(
            &test.db,
            &model,
            &Renames::default(),
            ApplyOptions { allow: Risk::Safe },
        )
        .await
        .unwrap();
        let router = Router::new().nest(
            "/api",
            verdin_api::router(test.db.clone(), Registry::new(schema), config, "/api"),
        );
        Self { router, test }
    }

    async fn call(&self, method: Method, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
            .unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value =
            if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap() };
        (status, value)
    }

    async fn get(&self, uri: &str) -> (StatusCode, Value) {
        self.call(Method::GET, uri, None).await
    }

    async fn post(&self, uri: &str, data: Value) -> (StatusCode, Value) {
        self.call(Method::POST, uri, Some(json!({ "data": data }))).await
    }

    async fn put(&self, uri: &str, data: Value) -> (StatusCode, Value) {
        self.call(Method::PUT, uri, Some(json!({ "data": data }))).await
    }

    /// Creates a published article and returns its documentId.
    async fn article(&self, data: Value) -> String {
        let (status, body) = self.post("/api/articles", data).await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        body["data"]["documentId"].as_str().unwrap().to_owned()
    }

    async fn titles(&self, query: &str) -> Vec<String> {
        let (status, body) = self.get(&format!("/api/articles?{query}")).await;
        assert_eq!(status, StatusCode::OK, "{query}: {body}");
        body["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|doc| doc["title"].as_str().unwrap().to_owned())
            .collect()
    }

    async fn done(self) {
        self.test.drop().await;
    }
}

fn error_paths(body: &Value) -> Vec<Value> {
    body["error"]["details"]["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|error| error["path"].clone())
        .collect()
}

#[tokio::test]
async fn crud_roundtrip() {
    let app = App::new().await;

    let (status, body) = app.post("/api/articles", json!({ "title": "Hello", "views": 3 })).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let document = &body["data"];
    let id = document["documentId"].as_str().unwrap().to_owned();
    assert_eq!(id.len(), 26);
    assert_eq!(document["title"], "Hello");
    assert_eq!(document["views"], 3);
    assert_eq!(document["featured"], false, "default applied");
    assert!(document["publishedAt"].is_string());
    let keys: Vec<&str> = document.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(keys.first(), Some(&"id"));
    assert_eq!(keys[1], "documentId");
    assert_eq!(&keys[keys.len() - 3..], ["createdAt", "updatedAt", "publishedAt"]);
    assert!(!keys.contains(&"internalNote"), "private fields are never returned");
    assert!(!keys.contains(&"seo"), "components need populate");

    let (status, body) = app.get(&format!("/api/articles/{id}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["title"], "Hello");
    assert_eq!(body["meta"], json!({}));

    let (status, body) = app.put(&format!("/api/articles/{id}"), json!({ "views": 4 })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["views"], 4);
    assert_eq!(body["data"]["title"], "Hello", "partial update keeps other fields");

    let (status, body) = app.get("/api/articles").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert_eq!(
        body["meta"]["pagination"],
        json!({ "page": 1, "pageSize": 25, "pageCount": 1, "total": 1 })
    );

    let (status, body) = app.call(Method::DELETE, &format!("/api/articles/{id}"), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let (status, body) = app.get(&format!("/api/articles/{id}")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["name"], "NotFoundError");
    assert_eq!(
        app.call(Method::DELETE, &format!("/api/articles/{id}"), None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(app.get("/api/nothing").await.0, StatusCode::NOT_FOUND);

    app.done().await;
}

#[tokio::test]
async fn validates_input() {
    let app = App::new().await;

    let (status, body) =
        app.call(Method::POST, "/api/articles", Some(json!({ "title": "x" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["message"], "Missing \"data\" payload in the request body");

    let (status, body) = app
        .post(
            "/api/articles",
            json!({
                "title": "x".repeat(101), "views": -1, "stage": "wip", "unknown": 1, "featured": "yes",
                "publishOn": "24/09/2026", "contact": "nope", "slug": "has space", "price": 1234567.5
            }),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["name"], "ValidationError");
    let mut paths = error_paths(&body);
    paths.sort_by_key(|path| path.to_string());
    assert_eq!(
        paths,
        [
            json!(["contact"]),
            json!(["featured"]),
            json!(["price"]),
            json!(["publishOn"]),
            json!(["slug"]),
            json!(["stage"]),
            json!(["title"]),
            json!(["unknown"]),
            json!(["views"])
        ]
    );

    // Required fields are enforced when publishing (the default), not on drafts.
    let (status, body) = app.post("/api/articles", json!({ "views": 1 })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_paths(&body), [json!(["title"])]);
    assert_eq!(
        app.get("/api/articles?status=draft").await.1["data"],
        json!([]),
        "failed publish rolls back"
    );

    let (status, body) = app.post("/api/articles?status=draft", json!({ "views": 1 })).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert!(body["data"]["publishedAt"].is_null());

    // Nested components validate paths and required fields inside them.
    let (status, body) = app
        .post("/api/articles", json!({ "title": "t", "seo": { "metaTitle": "" }, "blocks": [{ "__component": "blocks.hero" }, { "__component": "nope" }] }))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_paths(&body), [json!(["blocks", 1])]);
    let (status, body) = app
        .post("/api/articles", json!({ "title": "t", "seo": { "metaTitle": "" }, "blocks": [{ "__component": "blocks.hero" }] }))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_paths(&body), [json!(["seo", "metaTitle"]), json!(["blocks", 0, "title"])]);
    let (status, _) = app.post("/api/articles", json!({ "title": "t", "links": [{ "url": "a" }, { "url": "b" }, { "url": "c" }, { "url": "d" }] })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "max 3 links");

    app.done().await;
}

#[tokio::test]
async fn draft_and_publish() {
    let app = App::new().await;

    let (status, body) = app.post("/api/articles?status=draft", json!({ "title": "Draft" })).await;
    assert_eq!(status, StatusCode::CREATED);
    let id = body["data"]["documentId"].as_str().unwrap().to_owned();
    assert!(app.titles("").await.is_empty(), "drafts are not published");
    assert_eq!(app.titles("status=draft").await, ["Draft"]);
    assert_eq!(app.get(&format!("/api/articles/{id}")).await.0, StatusCode::NOT_FOUND);

    let (status, body) =
        app.call(Method::POST, &format!("/api/articles/{id}/actions/publish"), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["data"]["publishedAt"].is_string());
    assert_eq!(app.titles("").await, ["Draft"]);

    // Editing only the draft leaves the published version untouched.
    let (status, _) =
        app.put(&format!("/api/articles/{id}?status=draft"), json!({ "title": "Edited" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(app.titles("").await, ["Draft"]);
    assert_eq!(app.titles("status=draft").await, ["Edited"]);

    let (status, body) =
        app.call(Method::POST, &format!("/api/articles/{id}/actions/discard-draft"), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(app.titles("status=draft").await, ["Draft"]);

    // PUT without status publishes.
    app.put(&format!("/api/articles/{id}"), json!({ "title": "Live" })).await;
    assert_eq!(app.titles("").await, ["Live"]);

    let (status, _) =
        app.call(Method::POST, &format!("/api/articles/{id}/actions/unpublish"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(app.titles("").await.is_empty());
    assert_eq!(app.titles("status=draft").await, ["Live"]);

    let (status, body) =
        app.call(Method::POST, &format!("/api/articles/{id}/actions/discard-draft"), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(
        app.call(Method::POST, &format!("/api/articles/{id}/actions/archive"), None).await.0,
        StatusCode::NOT_FOUND
    );

    // Deleting removes every version.
    app.call(Method::DELETE, &format!("/api/articles/{id}"), None).await;
    assert!(app.titles("status=draft").await.is_empty());

    app.done().await;
}

async fn seed(app: &App) {
    for (title, views, stage, day, featured, price) in [
        ("Rust in production", Some(120), "final", "2026-01-10", true, "19.99"),
        ("rust for beginners", Some(15), "draft", "2026-03-05", false, "5.50"),
        ("Postgres tips", Some(40), "final", "2026-06-20", false, "12.00"),
        ("MySQL 100% explained", None, "idea", "2026-09-01", true, "0.10"),
    ] {
        let mut data = json!({ "title": title, "stage": stage, "publishOn": day, "featured": featured, "price": price.parse::<f64>().unwrap() });
        if let Some(views) = views {
            data["views"] = json!(views);
        }
        app.article(data).await;
    }
}

#[tokio::test]
async fn filters() {
    let app = App::new().await;
    seed(&app).await;
    let sorted = |mut titles: Vec<String>| {
        titles.sort();
        titles
    };

    assert_eq!(app.titles("filters[title][$eq]=Postgres%20tips").await, ["Postgres tips"]);
    assert!(
        app.titles("filters[title][$eq]=postgres%20tips").await.is_empty(),
        "$eq is case-sensitive everywhere"
    );
    assert_eq!(app.titles("filters[title][$eqi]=postgres%20TIPS").await, ["Postgres tips"]);
    assert_eq!(
        sorted(app.titles("filters[title][$containsi]=RUST").await),
        ["Rust in production", "rust for beginners"]
    );
    assert_eq!(app.titles("filters[title][$contains]=Rust").await, ["Rust in production"]);
    assert_eq!(
        app.titles("filters[title][$notContainsi]=rust&sort=title").await,
        ["MySQL 100% explained", "Postgres tips"]
    );
    assert_eq!(app.titles("filters[title][$startsWith]=rust").await, ["rust for beginners"]);
    assert_eq!(
        sorted(app.titles("filters[title][$startsWithi]=rust").await),
        ["Rust in production", "rust for beginners"]
    );
    assert_eq!(app.titles("filters[title][$endsWith]=tips").await, ["Postgres tips"]);
    assert_eq!(
        app.titles("filters[title][$contains]=100%25").await,
        ["MySQL 100% explained"],
        "LIKE wildcards are escaped"
    );
    assert!(app.titles("filters[title][$contains]=_").await.is_empty());

    assert_eq!(
        app.titles("filters[views][$gt]=20&sort=views").await,
        ["Postgres tips", "Rust in production"]
    );
    assert_eq!(app.titles("filters[views][$lte]=15").await, ["rust for beginners"]);
    assert_eq!(app.titles("filters[views][$null]=true").await, ["MySQL 100% explained"]);
    assert_eq!(app.titles("filters[views][$notNull]=true").await.len(), 3);
    assert_eq!(
        app.titles("filters[views][$between][0]=10&filters[views][$between][1]=50&sort=views")
            .await,
        ["rust for beginners", "Postgres tips"]
    );
    assert_eq!(
        app.titles("filters[views][$in][0]=15&filters[views][$in][1]=40&sort=views").await,
        ["rust for beginners", "Postgres tips"]
    );
    assert_eq!(
        app.titles("filters[stage][$notIn][0]=final&filters[stage][$notIn][1]=idea").await,
        ["rust for beginners"]
    );
    assert_eq!(
        sorted(app.titles("filters[featured]=true").await),
        ["MySQL 100% explained", "Rust in production"]
    );
    assert_eq!(app.titles("filters[price][$lt]=1").await, ["MySQL 100% explained"]);
    assert_eq!(
        app.titles("filters[publishOn][$gte]=2026-06-01&sort=publishOn").await,
        ["Postgres tips", "MySQL 100% explained"]
    );
    assert_eq!(app.titles("filters[publishOn][$lt]=2026-02-01").await, ["Rust in production"]);
    assert_eq!(app.titles("filters[createdAt][$lt]=2000-01-01").await.len(), 0);

    assert_eq!(
        sorted(app.titles("filters[$or][0][stage]=idea&filters[$or][1][views][$gte]=100").await),
        ["MySQL 100% explained", "Rust in production"]
    );
    assert_eq!(
        app.titles("filters[$not][stage][$eq]=final&filters[featured]=false").await,
        ["rust for beginners"]
    );
    assert_eq!(
        app.titles("filters[$and][0][stage]=final&filters[$and][1][featured]=false").await,
        ["Postgres tips"]
    );

    let (status, body) = app.get("/api/articles?filters[views][$eq]=many").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["name"], "ValidationError");
    assert_eq!(
        app.get("/api/articles?filters[internalNote][$eq]=x").await.0,
        StatusCode::BAD_REQUEST
    );

    app.done().await;
}

#[tokio::test]
async fn sort_and_paginate() {
    let app = App::new().await;
    seed(&app).await;

    assert_eq!(
        app.titles("sort=views:desc").await,
        ["Rust in production", "Postgres tips", "rust for beginners", "MySQL 100% explained"],
        "NULLs sort last"
    );
    assert_eq!(app.titles("sort=views:asc").await.last().unwrap(), "MySQL 100% explained");
    assert_eq!(
        app.titles("sort[0]=featured:desc&sort[1]=views:desc").await.first().unwrap(),
        "Rust in production"
    );

    let (_, body) =
        app.get("/api/articles?sort=views:desc&pagination[page]=2&pagination[pageSize]=3").await;
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert_eq!(
        body["meta"]["pagination"],
        json!({ "page": 2, "pageSize": 3, "pageCount": 2, "total": 4 })
    );

    let (_, body) =
        app.get("/api/articles?sort=views:desc&pagination[start]=1&pagination[limit]=2").await;
    let titles: Vec<_> =
        body["data"].as_array().unwrap().iter().map(|doc| doc["title"].clone()).collect();
    assert_eq!(titles, [json!("Postgres tips"), json!("rust for beginners")]);
    assert_eq!(body["meta"]["pagination"], json!({ "start": 1, "limit": 2, "total": 4 }));

    let (_, body) = app.get("/api/articles?pagination[withCount]=false").await;
    assert_eq!(body["meta"]["pagination"], json!({ "page": 1, "pageSize": 25 }));

    app.done().await;
}

#[tokio::test]
async fn fields_types_and_populate() {
    let app = App::new().await;
    let id = app
        .article(json!({
            "title": "Typed", "big": "9007199254740993", "rating": 4.5, "price": "12.345",
            "publishOn": "2026-09-24", "startsAt": "10:30", "happenedAt": "2026-09-24T12:00:00.123456+02:00",
            "extra": { "nested": [1, true, null] }, "contact": "a@b.co", "internalNote": "secret",
            "seo": { "metaTitle": "SEO title" },
            "links": [{ "label": "One", "url": "/1" }, { "id": 7, "url": "/7" }],
            "blocks": [
                { "__component": "blocks.hero", "title": "Hero", "seo": { "metaTitle": "Inner" } },
                { "__component": "blocks.quote", "text": "Quote", "meta": { "id": "not-a-component" } }
            ]
        }))
        .await;

    let (_, body) = app.get(&format!("/api/articles/{id}")).await;
    let doc = &body["data"];
    assert_eq!(doc["big"], "9007199254740993", "bigintegers are strings");
    assert_eq!(doc["rating"], 4.5);
    assert_eq!(doc["price"], 12.35, "decimals are rounded to their scale");
    assert_eq!(doc["publishOn"], "2026-09-24");
    assert_eq!(doc["startsAt"], "10:30:00.000");
    assert_eq!(doc["happenedAt"], "2026-09-24T10:00:00.123Z");
    assert_eq!(doc["extra"], json!({ "nested": [1, true, null] }));
    assert!(doc.get("internalNote").is_none());

    let (_, body) = app.get(&format!("/api/articles/{id}?fields=title,createdAt")).await;
    let keys: Vec<&str> = body["data"].as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(keys, ["id", "documentId", "title", "createdAt"]);

    let (_, body) = app.get(&format!("/api/articles/{id}?fields[0]=title&populate=*")).await;
    let doc = &body["data"];
    assert_eq!(
        doc["seo"],
        json!({ "id": 1, "metaTitle": "SEO title", "noIndex": false }),
        "component defaults apply"
    );
    assert_eq!(
        doc["links"],
        json!([{ "id": 8, "label": "One", "url": "/1" }, { "id": 7, "url": "/7" }])
    );
    assert_eq!(doc["blocks"][0]["__component"], "blocks.hero");
    assert_eq!(doc["blocks"][0]["seo"]["metaTitle"], "Inner");
    assert!(doc["blocks"][0]["seo"]["id"].is_number(), "nested components get ids");
    assert_eq!(
        doc["blocks"][1]["meta"],
        json!({ "id": "not-a-component" }),
        "json values are left alone"
    );

    let (_, body) = app.get(&format!("/api/articles/{id}?populate[0]=seo")).await;
    assert!(body["data"].get("seo").is_some() && body["data"].get("blocks").is_none());

    app.done().await;
}

#[tokio::test]
async fn unique_values() {
    let app = App::new().await;
    app.article(json!({ "title": "A", "slug": "same" })).await;

    let (status, body) = app.post("/api/articles", json!({ "title": "B", "slug": "same" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(
        body["error"]["details"]["errors"][0],
        json!({ "path": ["slug"], "message": "This attribute must be unique", "name": "ValidationError" })
    );

    // Types without draft & publish.
    let (status, body) = app.post("/api/tags", json!({ "label": "rust" })).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert!(body["data"]["publishedAt"].is_string());
    let (status, body) = app.post("/api/tags", json!({ "label": "rust" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_paths(&body), [json!(["label"])]);
    let (status, _) = app.post("/api/tags?status=draft", json!({})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "without draft & publish, required always applies");

    app.done().await;
}

#[tokio::test]
async fn single_types() {
    let app = App::new().await;
    assert_eq!(app.get("/api/homepage").await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        app.post("/api/homepage", json!({ "headline": "x" })).await.0,
        StatusCode::METHOD_NOT_ALLOWED
    );

    let (status, body) = app.put("/api/homepage", json!({ "headline": "Welcome" })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = body["data"]["documentId"].clone();
    let (status, body) = app.put("/api/homepage", json!({ "headline": "Hello" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["documentId"], id, "same document");

    let (_, body) = app.get("/api/homepage").await;
    assert_eq!(body["data"]["headline"], "Hello");
    assert_eq!(app.call(Method::DELETE, "/api/homepage", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(app.get("/api/homepage").await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        app.get(&format!("/api/homepage/{}", id.as_str().unwrap())).await.0,
        StatusCode::NOT_FOUND
    );

    app.done().await;
}

#[tokio::test]
async fn closed_by_default() {
    let app = App::with_config(ApiConfig::default()).await;
    let (status, body) = app.get("/api/articles").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body["error"],
        json!({ "status": 403, "name": "ForbiddenError", "message": "Forbidden", "details": {} })
    );
    assert_eq!(app.post("/api/articles", json!({ "title": "x" })).await.0, StatusCode::FORBIDDEN);
    assert_eq!(app.get("/api/_openapi.json").await.0, StatusCode::FORBIDDEN);
    app.done().await;
}

#[tokio::test]
async fn openapi_document() {
    let app = App::new().await;
    let (status, body) = app.get("/api/_openapi.json").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["openapi"], "3.1.0");
    let paths = body["paths"].as_object().unwrap();
    for path in [
        "/api/articles",
        "/api/articles/{documentId}",
        "/api/articles/{documentId}/actions/{action}",
        "/api/tags",
        "/api/homepage",
    ] {
        assert!(paths.contains_key(path), "{path}");
    }
    assert!(
        !paths.contains_key("/api/tags/{documentId}/actions/{action}"),
        "tags have no draft & publish"
    );
    let article = &body["components"]["schemas"]["Article"]["properties"];
    assert!(article.get("internalNote").is_none());
    assert_eq!(article["big"]["type"], json!(["string", "null"]));
    assert!(
        body["components"]["schemas"]["ArticleInput"]["properties"].get("internalNote").is_some()
    );
    assert!(body["components"]["schemas"]["SharedSeoComponent"].is_object());
    app.done().await;
}
