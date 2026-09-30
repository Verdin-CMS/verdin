//! Content internationalization: locales, one version per locale, shared fields, and
//! relations between localized types.

use crate::common::{App, As};
use axum::http::{Method, StatusCode};
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

#[tokio::test]
async fn permissions_per_locale() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    app.call_as(
        Method::POST,
        "/admin/api/i18n/locales",
        Some(json!({ "code": "fr", "name": "Français" })),
        As::Bearer(&admin),
    )
    .await;
    let role = json!({
        "code": "french-editor", "name": "French editor",
        "permissions": [
            { "action": "content.read", "subject": "api::article", "locales": ["fr"] },
            { "action": "content.create", "subject": "api::article", "locales": ["fr"] },
            { "action": "content.update", "subject": "api::article", "locales": ["fr"] }
        ]
    });
    let (status, role) =
        app.call_as(Method::POST, "/admin/api/roles", Some(role), As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::CREATED, "{role}");
    let bad = json!({ "code": "x", "name": "X", "permissions": [{ "action": "users.manage", "locales": ["fr"] }] });
    assert_eq!(
        app.call_as(Method::POST, "/admin/api/roles", Some(bad), As::Bearer(&admin)).await.0,
        StatusCode::BAD_REQUEST,
        "settings take no locales"
    );
    let body = json!({ "email": "fr@example.com", "password": "correct horse 1", "roles": [role["data"]["id"]] });
    app.call_as(Method::POST, "/admin/api/users", Some(body), As::Bearer(&admin)).await;
    let login = json!({ "email": "fr@example.com", "password": "correct horse 1" });
    let (_, session) =
        app.call_as(Method::POST, "/admin/api/auth/login", Some(login), As::Anonymous).await;
    let editor = session["data"]["accessToken"].as_str().unwrap().to_owned();

    let content = "/admin/api/content/api::article";
    let entry = json!({ "data": { "title": "Bonjour", "slug": "bonjour", "price": 1 } });
    let (status, created) = app
        .call_as(
            Method::POST,
            &format!("{content}?locale=fr"),
            Some(entry.clone()),
            As::Bearer(&editor),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id = created["data"]["documentId"].as_str().unwrap().to_owned();
    assert_eq!(
        app.call_as(Method::POST, content, Some(entry), As::Bearer(&editor)).await.0,
        StatusCode::FORBIDDEN,
        "the default locale (en) is not granted"
    );
    assert_eq!(
        app.call_as(Method::GET, &format!("{content}?locale=fr"), None, As::Bearer(&editor))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        app.call_as(Method::GET, &format!("{content}?locale=en"), None, As::Bearer(&editor))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let update = json!({ "data": { "title": "Hello" } });
    assert_eq!(
        app.call_as(
            Method::PUT,
            &format!("{content}/{id}?locale=en"),
            Some(update),
            As::Bearer(&editor)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (_, me) = app.call_as(Method::GET, "/admin/api/auth/me", None, As::Bearer(&editor)).await;
    assert_eq!(
        me["data"]["permissions"]["permissions"][0]["locales"],
        json!(["fr"]),
        "the admin panel sees them"
    );
    app.done().await;
}

async fn add_locale(app: &App, admin: &str, code: &str, name: &str) {
    let (status, body) = app
        .call_as(
            Method::POST,
            "/admin/api/i18n/locales",
            Some(json!({ "code": code, "name": name })),
            As::Bearer(admin),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

/// `localizations`: the other locale versions of a document, populated as in Strapi v5.
#[tokio::test]
async fn localizations_are_populatable() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    add_locale(&app, &admin, "fr", "Français").await;
    add_locale(&app, &admin, "de", "Deutsch").await;
    let (_, category) = app.post("/api/categories", json!({ "name": "News" })).await;
    let category = category["data"]["documentId"].as_str().unwrap().to_owned();
    let (status, created) =
        app.post("/api/articles", json!({ "title": "Hello", "slug": "hello", "price": 10 })).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id = created["data"]["documentId"].as_str().unwrap().to_owned();
    let url = format!("/api/articles/{id}");
    let french = json!({ "data": { "title": "Bonjour", "slug": "bonjour", "category": category } });
    let (status, body) = app.call(Method::PUT, &format!("{url}?locale=fr"), Some(french)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // A German draft only: not among the published localizations.
    let german = json!({ "data": { "title": "Hallo", "slug": "hallo" } });
    let (status, body) =
        app.call(Method::PUT, &format!("{url}?locale=de&status=draft"), Some(german)).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (_, plain) = app.get(&url).await;
    assert!(plain["data"].get("localizations").is_none(), "only when populated: {plain}");

    let locales = |body: &Value| -> Vec<String> {
        body["data"]["localizations"]
            .as_array()
            .unwrap_or_else(|| panic!("{body}"))
            .iter()
            .map(|doc| format!("{}:{}", doc["locale"].as_str().unwrap(), doc["title"]))
            .collect()
    };
    let (status, body) = app.get(&format!("{url}?populate=localizations")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(locales(&body), ["fr:\"Bonjour\""]);
    let french = &body["data"]["localizations"][0];
    assert_eq!(french["documentId"], id.as_str());
    assert_eq!(french["price"], 10, "shared fields");
    assert!(french.get("publishedAt").is_some());
    assert_eq!(locales(&app.get(&format!("{url}?populate=*")).await.1), ["fr:\"Bonjour\""]);
    assert_eq!(
        locales(&app.get(&format!("{url}?locale=fr&populate=localizations")).await.1),
        ["en:\"Hello\""]
    );
    assert_eq!(
        locales(&app.get(&format!("{url}?status=draft&populate[localizations]=true")).await.1),
        ["de:\"Hallo\"", "fr:\"Bonjour\""]
    );

    // Lists, and the options of a populated relation.
    let (_, list) = app.get("/api/articles?populate[0]=localizations").await;
    assert_eq!(list["data"][0]["localizations"][0]["title"], "Bonjour", "{list}");
    let (_, body) = app.get(&format!("{url}?populate[localizations][fields][0]=title")).await;
    let keys: Vec<&String> = body["data"]["localizations"][0].as_object().unwrap().keys().collect();
    assert_eq!(keys, ["id", "documentId", "title", "locale"]);
    let (_, body) = app.get(&format!("{url}?populate[localizations][count]=true")).await;
    assert_eq!(body["data"]["localizations"], json!({ "count": 1 }));
    let (_, body) =
        app.get(&format!("{url}?populate[localizations][filters][title][$eq]=Nope")).await;
    assert_eq!(body["data"]["localizations"], json!([]));
    let (_, body) = app.get(&format!("{url}?populate[localizations][populate][0]=category")).await;
    assert_eq!(body["data"]["localizations"][0]["category"]["name"], "News", "{body}");

    // Types that are not localized have none.
    let (status, _) = app.get("/api/categories?populate=localizations").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (_, body) = app.get("/api/categories?populate=*").await;
    assert!(body["data"][0].get("localizations").is_none(), "{body}");

    // The admin panel reads locale versions one at a time.
    let (status, body) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/content/api::article/{id}?populate=*"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["data"].get("localizations").is_none(), "{body}");
    app.done().await;
}

/// `GET /api/i18n/locales`: Strapi's shape, and its `find` permission on
/// `plugin::i18n.locale`.
#[tokio::test]
async fn locales_are_listed_like_strapi() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    add_locale(&app, &admin, "fr", "Français").await;

    let (status, body) = app.get("/api/i18n/locales").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let locales = body.as_array().unwrap_or_else(|| panic!("a plain array: {body}"));
    assert_eq!(locales.len(), 2);
    let english = &locales[0];
    let keys: Vec<&String> = english.as_object().unwrap().keys().collect();
    assert_eq!(
        keys,
        [
            "id",
            "documentId",
            "name",
            "code",
            "createdAt",
            "updatedAt",
            "publishedAt",
            "isDefault",
            "locale"
        ]
    );
    assert_eq!(english["code"], "en");
    assert_eq!(english["name"], "English");
    assert_eq!(english["isDefault"], true);
    assert_eq!(english["locale"], Value::Null);
    assert_eq!(english["publishedAt"], english["createdAt"]);
    assert!(english["id"].is_i64());
    let document_id = english["documentId"].as_str().unwrap();
    assert_eq!(document_id.len(), 24);
    assert!(document_id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
    assert_eq!(locales[1]["code"], "fr");
    assert_eq!(locales[1]["isDefault"], false);
    assert_ne!(locales[1]["documentId"], english["documentId"]);
    let (_, again) = app.get("/api/i18n/locales").await;
    assert_eq!(again[0]["documentId"], document_id, "stable");

    // Closed to the public until `find` is granted, like in Strapi.
    let anonymous = || app.call_as(Method::GET, "/api/i18n/locales", None, As::Anonymous);
    assert_eq!(anonymous().await.0, StatusCode::FORBIDDEN);
    let grants = json!({ "permissions": [{ "subject": "plugin::i18n.locale", "action": "find" }] });
    let (status, body) = app
        .call_as(Method::PUT, "/admin/api/public-permissions", Some(grants), As::Bearer(&admin))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = anonymous().await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body.as_array().unwrap().len(), 2);
    for action in ["findOne", "create"] {
        let bad =
            json!({ "permissions": [{ "subject": "plugin::i18n.locale", "action": action }] });
        let (status, _) = app
            .call_as(Method::PUT, "/admin/api/public-permissions", Some(bad), As::Bearer(&admin))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{action}");
    }
    // The OpenAPI document describes it.
    let (_, openapi) = app.get("/api/_openapi.json").await;
    assert!(openapi["paths"]["/api/i18n/locales"]["get"].is_object(), "{}", openapi["paths"]);
    let article = &openapi["components"]["schemas"]["Article"]["properties"];
    assert_eq!(article["localizations"]["items"]["$ref"], "#/components/schemas/Article");
    app.done().await;
}
