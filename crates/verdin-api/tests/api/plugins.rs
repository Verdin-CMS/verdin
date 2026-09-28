//! Plugins through the APIs: switching, hooks on REST writes, routes with the real content
//! host, capabilities and admin extensions.


use axum::http::{Method, StatusCode};
use crate::common::{App, As};
use serde_json::{Value, json};
use verdin_auth::ContentAction;
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    let ct = |name: &str, plural: &str, attributes: Value| {
        Source::content_type(
            name,
            json!({ "kind": "collectionType", "singularName": name, "pluralName": plural, "displayName": name,
                    "attributes": attributes })
            .to_string(),
        )
    };
    Schema::parse(&[
        ct(
            "article",
            "articles",
            json!({ "title": { "type": "string" }, "slug": { "type": "string" } }),
        ),
        ct("tag", "tags", json!({ "label": { "type": "string" } })),
    ])
    .unwrap()
}

fn install(dir: &std::path::Path) {
    let plugin = dir.join("sample");
    std::fs::create_dir_all(plugin.join("admin")).unwrap();
    std::fs::copy(
        concat!(env!("CARGO_MANIFEST_DIR"), "/../verdin-plugins/tests/fixtures/sample.wasm"),
        plugin.join("plugin.wasm"),
    )
    .unwrap();
    std::fs::write(
        plugin.join("admin/index.js"),
        "customElements.define('sample-color', class extends HTMLElement {});",
    )
    .unwrap();
    std::fs::write(
        plugin.join("plugin.toml"),
        r#"
name = "sample"
version = "0.1.0"
description = "Slugs and greetings"
[capabilities]
read = ["api::article"]
kv = true
[[hooks]]
on = "beforeCreate"
uid = "api::article"
function = "before_write"
[[hooks]]
on = "afterCreate"
uid = "api::article"
function = "after_write"
[routes]
function = "handle"
[admin]
script = "index.js"
[[admin.fields]]
id = "color"
title = "Color"
element = "sample-color"
type = "string"
[[settings]]
key = "greeting"
label = "Greeting"
required = true
max = 40
[[settings]]
key = "shout"
label = "Shout"
type = "boolean"
default = false
"#,
    )
    .unwrap();
}

async fn admin(app: &App) -> String {
    let body =
        json!({ "email": "ada@example.com", "password": "correct horse 1", "firstname": "Ada" });
    let (_, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    body["data"]["accessToken"].as_str().unwrap().to_owned()
}

#[tokio::test(flavor = "multi_thread")]
async fn plugins_hook_route_and_extend() {
    let dir = tempfile::tempdir().unwrap();
    install(dir.path());
    let app = App::with_plugins(schema(), dir.path()).await;
    let admin = admin(&app).await;

    // Installed but off.
    let (status, list) =
        app.call_as(Method::GET, "/admin/api/plugins", None, As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["data"]["plugins"][0]["name"], "sample");
    assert_eq!(list["data"]["plugins"][0]["enabled"], false);
    let (_, created) = app.post("/api/articles", json!({ "title": "Before" })).await;
    assert!(created["data"]["slug"].is_null());
    assert_eq!(
        app.call(Method::GET, "/api/plugins/sample/hello", None).await.0,
        StatusCode::NOT_FOUND
    );

    // Settings follow the plugin's form.
    assert_eq!(list["data"]["plugins"][0]["settingsForm"][0]["key"], "greeting");
    for bad in [json!({}), json!({ "greeting": 3 }), json!({ "greeting": "x", "other": 1 })] {
        let (status, _) = app
            .call_as(
                Method::PUT,
                "/admin/api/plugins/sample",
                Some(json!({ "enabled": true, "settings": bad })),
                As::Bearer(&admin),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
    }
    let (status, switched) = app
        .call_as(
            Method::PUT,
            "/admin/api/plugins/sample",
            Some(json!({ "enabled": true, "settings": { "greeting": "Verdin" } })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{switched}");
    assert_eq!(switched["data"]["settings"], json!({ "greeting": "Verdin", "shout": false }));

    // Before hooks change or refuse REST writes; after hooks run.
    let (status, created) = app.post("/api/articles", json!({ "title": "Hello Plugins" })).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["data"]["slug"], "hello-plugins");
    let (status, refused) = app.post("/api/articles", json!({ "title": "forbidden" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(refused["error"]["message"], "this title is not allowed");

    // Routes, with the caller and the plugin's settings and storage.
    let (status, hello) =
        app.call_as(Method::GET, "/api/plugins/sample/hello", None, As::Anonymous).await;
    assert_eq!(status, StatusCode::OK, "{hello}");
    assert_eq!(hello["message"], "hello Verdin");
    assert_eq!(hello["last"], created["data"]["documentId"]);
    assert_eq!(hello["actor"], json!({ "kind": "public" }));
    let (_, hello) = app.call(Method::GET, "/api/plugins/sample/hello", None).await;
    assert_eq!(hello["actor"]["kind"], "token");

    // Content through the host: reading articles is granted, writing tags is not.
    let (_, titles) = app.call(Method::GET, "/api/plugins/sample/titles", None).await;
    assert_eq!(titles["titles"], json!(["Before", "Hello Plugins"]));
    let (status, write) = app.call(Method::GET, "/api/plugins/sample/write", None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(write["error"].as_str().unwrap().contains("capabilities"));
    assert_eq!(
        app.call(Method::GET, "/api/plugins/sample/panic", None).await.0,
        StatusCode::BAD_GATEWAY
    );
    assert_eq!(
        app.call(Method::GET, "/api/plugins/sample/nope", None).await.0,
        StatusCode::NOT_FOUND
    );

    // The panel's extensions, and the plugin's log.
    let (_, extensions) =
        app.call_as(Method::GET, "/admin/api/plugins/extensions", None, As::Bearer(&admin)).await;
    assert_eq!(extensions["data"][0]["script"], "/admin/plugins/sample/index.js");
    assert_eq!(extensions["data"][0]["fields"][0]["element"], "sample-color");
    let (_, logs) =
        app.call_as(Method::GET, "/admin/api/plugins/sample/logs", None, As::Bearer(&admin)).await;
    assert!(
        logs["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|line| line["message"].as_str().unwrap().starts_with("afterCreate"))
    );
    assert_eq!(
        app.call_as(Method::GET, "/admin/api/plugins", None, As::Anonymous).await.0,
        StatusCode::UNAUTHORIZED
    );

    // Public grants do not matter to plugin routes; they answer for themselves.
    app.auth.set_public_grants(&[("api::article".into(), ContentAction::Find)]).await.unwrap();
    app.done().await;
}
