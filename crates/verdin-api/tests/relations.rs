//! Relations over HTTP: writes, populate, draft & publish visibility, filters, cleanup.
//! Runs against `VERDIN_TEST_DATABASE_URL` (in-memory SQLite by default).

mod common;

use axum::http::{Method, StatusCode};
use common::{App, error_paths};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    let ct = |name: &str, plural: &str, draft_and_publish: bool, attributes: Value| {
        Source::content_type(
            name,
            json!({
                "kind": "collectionType", "singularName": name, "pluralName": plural, "displayName": name,
                "options": { "draftAndPublish": draft_and_publish },
                "attributes": attributes
            })
            .to_string(),
        )
    };
    Schema::parse(&[
        ct("article", "articles", true, json!({
            "title": { "type": "string", "required": true },
            "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
            "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
            "author": { "type": "relation", "relation": "oneWay", "target": "author" },
            "comments": { "type": "relation", "relation": "oneToMany", "target": "comment", "inversedBy": "article" },
            "secretLink": { "type": "relation", "relation": "oneWay", "target": "author", "private": true }
        })),
        ct("category", "categories", true, json!({
            "name": { "type": "string" },
            "articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
        })),
        ct("tag", "tags", false, json!({ "label": { "type": "string" } })),
        ct("author", "authors", false, json!({ "name": { "type": "string" } })),
        ct("comment", "comments", false, json!({
            "body": { "type": "text" },
            "article": { "type": "relation", "relation": "manyToOne", "target": "article", "mappedBy": "comments" }
        })),
    ])
    .unwrap()
}

async fn create(app: &App, path: &str, data: Value) -> String {
    let (status, body) = app.post(path, data).await;
    assert_eq!(status, StatusCode::CREATED, "{path}: {body}");
    body["data"]["documentId"].as_str().unwrap().to_owned()
}

async fn data(app: &App, uri: &str) -> Value {
    let (status, body) = app.get(uri).await;
    assert_eq!(status, StatusCode::OK, "{uri}: {body}");
    body["data"].clone()
}

fn labels(value: &Value, key: &str) -> Vec<String> {
    value.as_array().unwrap().iter().map(|item| item[key].as_str().unwrap().to_owned()).collect()
}

struct Fixture {
    app: App,
    news: String,
    rust: String,
    web: String,
    db: String,
    ada: String,
}

async fn fixture() -> Fixture {
    let app = App::new(schema()).await;
    let news = create(&app, "/api/categories", json!({ "name": "News" })).await;
    let rust = create(&app, "/api/tags", json!({ "label": "rust" })).await;
    let web = create(&app, "/api/tags", json!({ "label": "web" })).await;
    let db = create(&app, "/api/tags", json!({ "label": "db" })).await;
    let ada = create(&app, "/api/authors", json!({ "name": "Ada" })).await;
    Fixture { app, news, rust, web, db, ada }
}

#[tokio::test]
async fn writes_and_populates_relations() {
    let f = fixture().await;
    let app = &f.app;
    let id = create(
        app,
        "/api/articles",
        json!({ "title": "Hello", "category": f.news, "tags": [f.web, f.rust], "author": { "documentId": f.ada } }),
    )
    .await;

    let plain = data(app, &format!("/api/articles/{id}")).await;
    assert!(plain.get("category").is_none(), "relations need populate");

    let doc = data(app, &format!("/api/articles/{id}?populate=*")).await;
    assert_eq!(doc["category"]["name"], "News");
    assert_eq!(doc["category"]["documentId"], f.news.as_str());
    assert_eq!(labels(&doc["tags"], "label"), ["web", "rust"], "link order is kept");
    assert_eq!(doc["author"]["name"], "Ada");
    assert_eq!(doc["comments"], json!([]));
    assert!(doc.get("secretLink").is_none(), "private relations are never populated");

    // Lists populate in batches.
    create(app, "/api/articles", json!({ "title": "Second", "tags": [f.db] })).await;
    let list = data(app, "/api/articles?populate[tags][fields][0]=label&sort=title").await;
    assert_eq!(labels(&list[0]["tags"], "label"), ["web", "rust"]);
    assert_eq!(labels(&list[1]["tags"], "label"), ["db"]);
    let keys: Vec<&str> =
        list[1]["tags"][0].as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(keys, ["id", "documentId", "label"]);

    // Inverse side: readable and filterable, not writable.
    let category = data(app, &format!("/api/categories/{}?populate=articles", f.news)).await;
    assert_eq!(labels(&category["articles"], "title"), ["Hello"]);
    let (status, body) =
        app.put(&format!("/api/categories/{}", f.news), json!({ "articles": [id] })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"]["message"].as_str().unwrap().contains("inverse side"), "{body}");

    // Missing targets are validation errors.
    let (status, body) = app.put(&format!("/api/articles/{id}"), json!({ "tags": ["nope"] })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_paths(&body), [json!(["tags"])]);
    let (status, _) =
        app.put(&format!("/api/articles/{id}"), json!({ "category": [f.news, f.news] })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "to-one relations take one document");

    f.app.done().await;
}

#[tokio::test]
async fn connect_disconnect_and_positions() {
    let f = fixture().await;
    let app = &f.app;
    let id = create(app, "/api/articles", json!({ "title": "T", "tags": [f.rust, f.web] })).await;
    let tags = |doc: Value| labels(&doc["tags"], "label");

    let update = json!({ "tags": { "connect": [{ "documentId": f.db, "position": { "before": f.web } }], "disconnect": [f.rust] } });
    assert_eq!(app.put(&format!("/api/articles/{id}"), update).await.0, StatusCode::OK);
    assert_eq!(tags(data(app, &format!("/api/articles/{id}?populate=tags")).await), ["db", "web"]);

    let update =
        json!({ "tags": { "connect": [{ "documentId": f.rust, "position": { "start": true } }] } });
    app.put(&format!("/api/articles/{id}"), update).await;
    assert_eq!(
        tags(data(app, &format!("/api/articles/{id}?populate=tags")).await),
        ["rust", "db", "web"]
    );

    app.put(&format!("/api/articles/{id}"), json!({ "tags": { "set": [f.web] } })).await;
    assert_eq!(tags(data(app, &format!("/api/articles/{id}?populate=tags")).await), ["web"]);

    // Sorting a populated relation overrides link order.
    app.put(&format!("/api/articles/{id}"), json!({ "tags": [f.web, f.db, f.rust] })).await;
    assert_eq!(
        tags(data(app, &format!("/api/articles/{id}?populate[tags][sort]=label:asc")).await),
        ["db", "rust", "web"]
    );
    assert_eq!(
        tags(
            data(app, &format!("/api/articles/{id}?populate[tags][filters][label][$ne]=db")).await
        ),
        ["web", "rust"]
    );

    // Connecting a to-one relation replaces it; null clears it.
    app.put(&format!("/api/articles/{id}"), json!({ "author": { "connect": [f.ada] } })).await;
    assert_eq!(
        data(app, &format!("/api/articles/{id}?populate=author")).await["author"]["name"],
        "Ada"
    );
    app.put(&format!("/api/articles/{id}"), json!({ "author": null })).await;
    assert!(data(app, &format!("/api/articles/{id}?populate=author")).await["author"].is_null());

    let (status, _) = app
        .put(&format!("/api/articles/{id}"), json!({ "tags": { "connect": [{ "documentId": f.db, "position": { "after": "zzz" } }] } }))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    f.app.done().await;
}

#[tokio::test]
async fn versions_see_matching_versions() {
    let f = fixture().await;
    let app = &f.app;
    let (_, body) = app.post("/api/categories?status=draft", json!({ "name": "Hidden" })).await;
    let hidden = body["data"]["documentId"].as_str().unwrap().to_owned();

    let id = create(app, "/api/articles", json!({ "title": "A", "category": hidden })).await;
    let published = data(app, &format!("/api/articles/{id}?populate=category")).await;
    assert!(published["category"].is_null(), "a published article only sees published categories");
    let draft = data(app, &format!("/api/articles/{id}?status=draft&populate=category")).await;
    assert_eq!(draft["category"]["name"], "Hidden");

    app.call(Method::POST, &format!("/api/categories/{hidden}/actions/publish"), None).await;
    let published = data(app, &format!("/api/articles/{id}?populate=category")).await;
    assert_eq!(published["category"]["name"], "Hidden", "no link rewrite needed on publish");

    // Draft-only relation edits leave the published links alone until publish.
    app.put(&format!("/api/articles/{id}?status=draft"), json!({ "category": f.news })).await;
    assert_eq!(
        data(app, &format!("/api/articles/{id}?populate=category")).await["category"]["name"],
        "Hidden"
    );
    assert_eq!(
        data(app, &format!("/api/articles/{id}?status=draft&populate=category")).await["category"]
            ["name"],
        "News"
    );

    app.call(Method::POST, &format!("/api/articles/{id}/actions/discard-draft"), None).await;
    assert_eq!(
        data(app, &format!("/api/articles/{id}?status=draft&populate=category")).await["category"]
            ["name"],
        "Hidden"
    );

    app.call(Method::POST, &format!("/api/articles/{id}/actions/publish"), None).await;
    let category = data(app, &format!("/api/categories/{hidden}?populate=articles")).await;
    assert_eq!(labels(&category["articles"], "title"), ["A"]);
    app.call(Method::POST, &format!("/api/articles/{id}/actions/unpublish"), None).await;
    let category = data(app, &format!("/api/categories/{hidden}?populate=articles")).await;
    assert_eq!(
        category["articles"],
        json!([]),
        "unpublished articles disappear from the inverse side"
    );

    f.app.done().await;
}

#[tokio::test]
async fn one_to_many_targets_have_one_owner() {
    let f = fixture().await;
    let app = &f.app;
    let comment = create(app, "/api/comments", json!({ "body": "First!" })).await;
    let first =
        create(app, "/api/articles", json!({ "title": "First", "comments": [comment] })).await;
    let second =
        create(app, "/api/articles", json!({ "title": "Second", "comments": [comment] })).await;

    for status in ["published", "draft"] {
        let first =
            data(app, &format!("/api/articles/{first}?status={status}&populate=comments")).await;
        assert_eq!(
            first["comments"],
            json!([]),
            "{status}: the comment moved to the second article"
        );
        let second =
            data(app, &format!("/api/articles/{second}?status={status}&populate=comments")).await;
        assert_eq!(labels(&second["comments"], "body"), ["First!"]);
    }
    let comment = data(app, &format!("/api/comments/{comment}?populate=article")).await;
    assert_eq!(comment["article"]["title"], "Second");

    f.app.done().await;
}

#[tokio::test]
async fn filters_on_relations() {
    let f = fixture().await;
    let app = &f.app;
    let tech = create(app, "/api/categories", json!({ "name": "Tech" })).await;
    create(app, "/api/articles", json!({ "title": "A", "category": f.news, "tags": [f.rust] }))
        .await;
    create(
        app,
        "/api/articles",
        json!({ "title": "B", "category": tech, "tags": [f.rust, f.web] }),
    )
    .await;
    create(app, "/api/articles", json!({ "title": "C" })).await;
    let titles = |value: Value| labels(&value, "title");

    assert_eq!(titles(data(app, "/api/articles?filters[category][name][$eq]=News").await), ["A"]);
    assert_eq!(titles(data(app, "/api/articles?filters[tags][label][$eq]=web").await), ["B"]);
    assert_eq!(
        titles(data(app, "/api/articles?filters[tags][label][$eq]=rust&sort=title").await),
        ["A", "B"],
        "no duplicates"
    );
    assert_eq!(titles(data(app, "/api/articles?filters[category][$null]=true").await), ["C"]);
    assert_eq!(
        titles(data(app, "/api/articles?filters[category][$notNull]=true&sort=title").await),
        ["A", "B"]
    );
    assert_eq!(
        titles(
            data(app, &format!("/api/articles?filters[category][documentId][$eq]={tech}")).await
        ),
        ["B"]
    );
    assert_eq!(
        titles(data(app, "/api/articles?filters[$or][0][category][name]=News&filters[$or][1][tags][label]=web&sort=title").await),
        ["A", "B"]
    );

    let names = |value: Value| labels(&value, "name");
    assert_eq!(
        names(data(app, "/api/categories?filters[articles][title][$eq]=B").await),
        ["Tech"],
        "inverse side"
    );
    assert_eq!(
        names(data(app, "/api/categories?filters[articles][tags][label][$eq]=web").await),
        ["Tech"],
        "nested"
    );

    // Nested populate through the inverse side and back.
    let category = data(
        app,
        &format!("/api/categories/{tech}?populate[articles][populate][tags][fields][0]=label"),
    )
    .await;
    assert_eq!(labels(&category["articles"][0]["tags"], "label"), ["rust", "web"]);

    f.app.done().await;
}

#[tokio::test]
async fn deleting_documents_removes_links() {
    let f = fixture().await;
    let app = &f.app;
    let id = create(
        app,
        "/api/articles",
        json!({ "title": "A", "tags": [f.rust, f.web], "category": f.news }),
    )
    .await;

    assert_eq!(
        app.call(Method::DELETE, &format!("/api/tags/{}", f.rust), None).await.0,
        StatusCode::NO_CONTENT
    );
    let doc = data(app, &format!("/api/articles/{id}?status=draft&populate=tags")).await;
    assert_eq!(labels(&doc["tags"], "label"), ["web"]);

    assert_eq!(
        app.call(Method::DELETE, &format!("/api/articles/{id}"), None).await.0,
        StatusCode::NO_CONTENT
    );
    let category = data(app, &format!("/api/categories/{}?populate=articles", f.news)).await;
    assert_eq!(category["articles"], json!([]));
    assert_eq!(f.app.test.count("articles_tags_lnk").await, 0, "links cascade with their rows");
    assert_eq!(f.app.test.count("articles_category_lnk").await, 0);

    f.app.done().await;
}
