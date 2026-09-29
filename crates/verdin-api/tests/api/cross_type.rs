//! Queries only reach the related types the caller may read.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

use crate::common::{App, As};

fn schema() -> Schema {
    let ct = |name: &str, plural: &str, attributes: Value| {
        Source::content_type(
            name,
            json!({ "kind": "collectionType", "singularName": name, "pluralName": plural,
                    "displayName": name, "attributes": attributes })
            .to_string(),
        )
    };
    Schema::parse(&[
        ct("article", "articles", json!({
            "title": { "type": "string" },
            "author": { "type": "relation", "relation": "manyToOne", "target": "author" },
            "body": { "type": "dynamiczone", "components": ["shared.quote"] },
            "about": { "type": "relation", "relation": "morphToOne" }
        })),
        ct("author", "authors", json!({ "name": { "type": "string" }, "email": { "type": "string" } })),
        Source::component("shared", "quote", json!({
            "displayName": "Quote",
            "attributes": { "by": { "type": "relation", "relation": "oneWay", "target": "author" } }
        }).to_string()),
    ])
    .unwrap()
}

#[tokio::test]
async fn populate_filters_and_sort_follow_permissions() {
    let app = App::new(schema()).await;
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    let admin = body["data"]["accessToken"].as_str().unwrap().to_owned();
    let (_, author) =
        app.post("/api/authors", json!({ "name": "Grace", "email": "grace@secret.test" })).await;
    let author = author["data"]["documentId"].as_str().unwrap().to_owned();
    app.post(
        "/api/articles",
        json!({ "title": "Hello", "author": author,
                "body": [{ "__component": "shared.quote", "by": author }],
                "about": { "__type": "api::author", "documentId": author } }),
    )
    .await;
    let grant = |subjects: &[&str]| {
        let permissions: Vec<Value> = subjects
            .iter()
            .map(|subject| json!({ "subject": subject, "action": "find" }))
            .collect();
        let (app, admin) = (&app, admin.clone());
        async move {
            let (status, body) = app
                .call_as(
                    Method::PUT,
                    "/admin/api/public-permissions",
                    Some(json!({ "permissions": permissions })),
                    As::Bearer(&admin),
                )
                .await;
            assert_eq!(status, StatusCode::OK, "{body}");
        }
    };
    let public = |uri: &'static str| {
        let app = &app;
        async move { app.call_as(Method::GET, uri, None, As::Anonymous).await }
    };

    // Articles only: authors stay out of reach.
    grant(&["api::article"]).await;
    for uri in [
        "/api/articles?populate=author",
        "/api/articles?filters[author][email][$startsWith]=grace",
        "/api/articles?sort=author.email",
    ] {
        let (status, body) = public(uri).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}: {body}");
    }
    let (status, all) = public("/api/articles?populate=*").await;
    assert_eq!(status, StatusCode::OK, "{all}");
    let article = &all["data"][0];
    assert!(article.get("author").is_none(), "left out of `*`: {article}");
    assert_eq!(article["about"], Value::Null, "polymorphic links to authors are left out");
    assert_eq!(article["body"][0]["by"], Value::Null, "relations in components too: {article}");
    assert!(!all.to_string().contains("grace@secret.test"));

    // With authors readable, they are populated.
    grant(&["api::article", "api::author"]).await;
    let (status, all) = public("/api/articles?populate=*").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(all["data"][0]["author"]["name"], "Grace", "{all}");
    assert_eq!(all["data"][0]["about"]["name"], "Grace");
    let (status, _) = public("/api/articles?filters[author][email][$startsWith]=grace").await;
    assert_eq!(status, StatusCode::OK);

    // Admins: related types by their roles, with the fields they may see.
    let (_, role) = app
        .call_as(
            Method::POST,
            "/admin/api/roles",
            Some(json!({ "code": "writer", "name": "Writer", "permissions": [
                { "action": "content.read", "subject": "api::article" }
            ] })),
            As::Bearer(&admin),
        )
        .await;
    let role_id = role["data"]["id"].clone();
    app.call_as(
        Method::POST,
        "/admin/api/users",
        Some(json!({ "email": "bob@example.com", "password": "correct horse 1", "roles": [role_id] })),
        As::Bearer(&admin),
    )
    .await;
    let (_, login) = app
        .call_as(
            Method::POST,
            "/admin/api/auth/login",
            Some(json!({ "email": "bob@example.com", "password": "correct horse 1" })),
            As::Anonymous,
        )
        .await;
    let bob = login["data"]["accessToken"].as_str().unwrap().to_owned();
    let (status, _) = app
        .call_as(
            Method::GET,
            "/admin/api/content/api::article?populate=author",
            None,
            As::Bearer(&bob),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    app.call_as(
        Method::PUT,
        &format!("/admin/api/roles/{role_id}"),
        Some(json!({ "permissions": [
            { "action": "content.read", "subject": "api::article" },
            { "action": "content.read", "subject": "api::author", "fields": ["name"] }
        ] })),
        As::Bearer(&admin),
    )
    .await;
    let (status, list) = app
        .call_as(
            Method::GET,
            "/admin/api/content/api::article?populate=author",
            None,
            As::Bearer(&bob),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["data"][0]["author"]["name"], "Grace");
    assert!(list["data"][0]["author"].get("email").is_none(), "field restrictions apply: {list}");
    app.done().await;
}
