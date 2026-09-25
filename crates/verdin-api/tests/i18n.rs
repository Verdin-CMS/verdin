//! Content internationalization: locales, one version per locale, shared fields, and
//! relations between localized types.

mod common;

use axum::http::{Method, StatusCode};
use common::{App, As};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    let localized = json!({ "i18n": { "localized": true } });
    Schema::parse(&[
        Source::content_type(
            "article",
            json!({ "kind": "collectionType", "singularName": "article", "pluralName": "articles",
                    "displayName": "Article", "options": { "draftAndPublish": true },
                    "pluginOptions": localized,
                    "attributes": {
                        "title": { "type": "string", "required": true },
                        "slug": { "type": "uid", "targetField": "title" },
                        "price": { "type": "integer", "pluginOptions": { "i18n": { "localized": false } } },
                        "tags": { "type": "relation", "relation": "manyWay", "target": "tag" },
                        "category": { "type": "relation", "relation": "oneWay", "target": "category" }
                    } })
            .to_string(),
        ),
        Source::content_type(
            "tag",
            json!({ "kind": "collectionType", "singularName": "tag", "pluralName": "tags",
                    "displayName": "Tag", "pluginOptions": localized,
                    "attributes": { "label": { "type": "string" } } })
            .to_string(),
        ),
        Source::content_type(
            "category",
            json!({ "kind": "collectionType", "singularName": "category", "pluralName": "categories",
                    "displayName": "Category", "attributes": { "name": { "type": "string" } } })
            .to_string(),
        ),
    ])
    .unwrap()
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

fn titles(body: &Value) -> Vec<&str> {
    body["data"].as_array().unwrap().iter().map(|doc| doc["title"].as_str().unwrap()).collect()
}

#[tokio::test]
async fn one_version_per_locale() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;

    let (_, locales) =
        app.call_as(Method::GET, "/admin/api/i18n/locales", None, As::Bearer(&admin)).await;
    assert_eq!(locales["data"], json!([{ "code": "en", "name": "English", "isDefault": true }]));
    let (status, body) = app
        .call_as(
            Method::POST,
            "/admin/api/i18n/locales",
            Some(json!({ "code": "fr", "name": "Français" })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    // The default locale when none is given.
    let (status, created) =
        app.post("/api/articles", json!({ "title": "Hello", "slug": "hello", "price": 10 })).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["data"]["locale"], "en");
    let document_id = created["data"]["documentId"].as_str().unwrap().to_owned();
    let url = format!("/api/articles/{document_id}");

    // Writing another locale creates its version; shared fields come along.
    let (status, french) = app
        .call(
            Method::PUT,
            &format!("{url}?locale=fr"),
            Some(json!({ "data": { "title": "Bonjour", "slug": "hello" } })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{french}");
    assert_eq!(french["data"]["locale"], "fr");
    assert_eq!(french["data"]["title"], "Bonjour");
    assert_eq!(french["data"]["price"], 10);
    assert_eq!(french["data"]["documentId"], document_id);

    assert_eq!(titles(&app.get("/api/articles").await.1), ["Hello"]);
    assert_eq!(titles(&app.get("/api/articles?locale=fr").await.1), ["Bonjour"]);
    let (status, body) = app.get("/api/articles?locale=de").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(body["error"]["message"].as_str().unwrap().contains("unknown locale"));
    assert_eq!(app.get("/api/articles?locale=fr_FR").await.0, StatusCode::BAD_REQUEST);

    // Non-localized fields are shared: a change in one locale shows in every locale.
    app.call(Method::PUT, &url, Some(json!({ "data": { "price": 20 } }))).await;
    let (_, french) = app.get(&format!("{url}?locale=fr")).await;
    assert_eq!(french["data"]["price"], 20);
    assert_eq!(french["data"]["title"], "Bonjour");

    // The admin sees which locales exist.
    let (status, versions) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/content/api::article/{document_id}/locales"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{versions}");
    assert_eq!(
        versions["data"],
        json!([
            { "locale": "en", "draft": true, "published": true },
            { "locale": "fr", "draft": true, "published": true }
        ])
    );
    // Admin edits and publication work per locale.
    let (status, _) = app
        .call_as(
            Method::PUT,
            &format!("/admin/api/content/api::article/{document_id}?locale=fr"),
            Some(json!({ "data": { "title": "Salut" } })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(app.get(&format!("{url}?locale=fr")).await.1["data"]["title"], "Bonjour");
    assert_eq!(app.get(&format!("{url}?locale=fr&status=draft")).await.1["data"]["title"], "Salut");
    assert_eq!(app.get(&url).await.1["data"]["title"], "Hello", "English untouched");

    // Deleting a locale's version keeps the others.
    let (status, _) = app.call(Method::DELETE, &format!("{url}?locale=fr"), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(app.get(&format!("{url}?locale=fr")).await.0, StatusCode::NOT_FOUND);
    assert_eq!(app.get(&url).await.0, StatusCode::OK);
    app.done().await;
}

#[tokio::test]
async fn relations_follow_the_locale() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    app.call_as(
        Method::POST,
        "/admin/api/i18n/locales",
        Some(json!({ "code": "fr", "name": "Français" })),
        As::Bearer(&admin),
    )
    .await;
    let (_, tag) = app.post("/api/tags", json!({ "label": "Rust" })).await;
    let tag_id = tag["data"]["documentId"].as_str().unwrap().to_owned();
    app.call(
        Method::PUT,
        &format!("/api/tags/{tag_id}?locale=fr"),
        Some(json!({ "data": { "label": "Rouille" } })),
    )
    .await;
    let (_, category) = app.post("/api/categories", json!({ "name": "News" })).await;
    let category_id = category["data"]["documentId"].as_str().unwrap().to_owned();

    let (_, created) = app
        .post(
            "/api/articles",
            json!({ "title": "Hello", "tags": [tag_id], "category": category_id }),
        )
        .await;
    let document_id = created["data"]["documentId"].as_str().unwrap().to_owned();
    app.call(
        Method::PUT,
        &format!("/api/articles/{document_id}?locale=fr"),
        Some(json!({ "data": { "title": "Bonjour", "tags": [tag_id], "category": category_id } })),
    )
    .await;

    let (_, english) = app.get(&format!("/api/articles/{document_id}?populate=*")).await;
    assert_eq!(english["data"]["tags"][0]["label"], "Rust");
    assert_eq!(english["data"]["category"]["name"], "News");
    let (_, french) = app.get(&format!("/api/articles/{document_id}?locale=fr&populate=*")).await;
    assert_eq!(french["data"]["tags"][0]["label"], "Rouille", "the related tag in French");
    assert_eq!(french["data"]["category"]["name"], "News", "categories are not localized");

    let filter = "filters[tags][label][$eq]";
    assert_eq!(
        titles(&app.get(&format!("/api/articles?locale=fr&{filter}=Rouille")).await.1),
        ["Bonjour"]
    );
    assert!(titles(&app.get(&format!("/api/articles?locale=fr&{filter}=Rust")).await.1).is_empty());
    // Types that are not localized ignore the locale.
    assert_eq!(app.get("/api/categories?locale=fr").await.0, StatusCode::OK);

    // Deleting a locale deletes its entries; the default one cannot go.
    let (status, _) =
        app.call_as(Method::DELETE, "/admin/api/i18n/locales/en", None, As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, body) =
        app.call_as(Method::DELETE, "/admin/api/i18n/locales/fr", None, As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(app.get("/api/articles?locale=fr").await.0, StatusCode::BAD_REQUEST);
    assert_eq!(titles(&app.get("/api/articles").await.1), ["Hello"]);

    // Making another locale the default.
    app.call_as(
        Method::POST,
        "/admin/api/i18n/locales",
        Some(json!({ "code": "es", "name": "Español", "isDefault": true })),
        As::Bearer(&admin),
    )
    .await;
    assert!(
        app.get("/api/articles").await.1["data"].as_array().unwrap().is_empty(),
        "nothing in Spanish yet"
    );
    app.done().await;
}
