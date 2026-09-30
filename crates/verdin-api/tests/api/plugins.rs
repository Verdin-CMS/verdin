//! Plugins through the APIs: switching, hooks on REST writes, routes with the real content
//! host, capabilities, the startup function and admin extensions.

use crate::common::{App, As};
use axum::http::{Method, StatusCode};
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
public_permissions = true
[startup]
function = "startup"
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
    assert_eq!(switched["data"]["startup"], json!({ "function": "startup", "timeout_ms": 30000 }));

    // Switching it on ran its startup function, which opened reading articles to the
    // public role (and only that).
    let mut public = Value::Null;
    for _ in 0..100 {
        (_, public) = app
            .call_as(Method::GET, "/admin/api/public-permissions", None, As::Bearer(&admin))
            .await;
        if public["data"].as_array().is_some_and(|list| !list.is_empty()) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert_eq!(public["data"], json!([{ "subject": "api::article", "action": "find" }]));
    let (status, _) = app.call_as(Method::GET, "/api/articles", None, As::Anonymous).await;
    assert_eq!(status, StatusCode::OK, "the public role reads articles now");
    let (_, public) = app.call(Method::GET, "/api/plugins/sample/public", None).await;
    assert_eq!(public["permissions"][0]["action"], "find");

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

#[tokio::test(flavor = "multi_thread")]
async fn failed_startup_leaves_the_plugin_on() {
    let dir = tempfile::tempdir().unwrap();
    install(dir.path());
    // Without the capability, the startup function cannot touch the public role.
    let manifest = dir.path().join("sample/plugin.toml");
    let text = std::fs::read_to_string(&manifest).unwrap();
    std::fs::write(&manifest, text.replace("public_permissions = true\n", "")).unwrap();
    let app = App::with_plugins(schema(), dir.path()).await;
    let admin = admin(&app).await;
    let (status, switched) = app
        .call_as(
            Method::PUT,
            "/admin/api/plugins/sample",
            Some(json!({ "enabled": true, "settings": { "greeting": "Verdin" } })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{switched}");

    // The failure lands in the plugin's log; the plugin stays on and keeps serving.
    let mut failure = None;
    for _ in 0..100 {
        let (_, logs) = app
            .call_as(Method::GET, "/admin/api/plugins/sample/logs", None, As::Bearer(&admin))
            .await;
        failure = logs["data"].as_array().unwrap().iter().find_map(|line| {
            let message = line["message"].as_str().unwrap();
            message.starts_with("startup:").then(|| message.to_owned())
        });
        if failure.is_some() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert!(failure.as_deref().is_some_and(|m| m.contains("capabilities")), "{failure:?}");
    let (_, public) =
        app.call_as(Method::GET, "/admin/api/public-permissions", None, As::Bearer(&admin)).await;
    assert_eq!(public["data"], json!([]), "the public role was not changed");
    let (_, list) = app.call_as(Method::GET, "/admin/api/plugins", None, As::Bearer(&admin)).await;
    assert_eq!(list["data"]["plugins"][0]["enabled"], true);
    assert_eq!(app.call(Method::GET, "/api/plugins/sample/hello", None).await.0, StatusCode::OK);
    let (status, _) = app.call(Method::GET, "/api/plugins/sample/public", None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.done().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn plugin_writes_run_its_own_after_hooks() {
    let dir = tempfile::tempdir().unwrap();
    install(dir.path());
    let manifest = dir.path().join("sample/plugin.toml");
    let text = std::fs::read_to_string(&manifest).unwrap();
    std::fs::write(
        &manifest,
        text.replace("kv = true\n", "kv = true\nwrite = [\"api::article\"]\n"),
    )
    .unwrap();
    let app = App::with_plugins(schema(), dir.path()).await;
    let admin = admin(&app).await;
    let settings = json!({ "enabled": true, "settings": { "greeting": "Verdin" } });
    let (status, _) = app
        .call_as(Method::PUT, "/admin/api/plugins/sample", Some(settings), As::Bearer(&admin))
        .await;
    assert_eq!(status, StatusCode::OK);

    // The route writes an article; the same plugin's afterCreate hook ran once it returned.
    let (status, created) = app.call(Method::GET, "/api/plugins/sample/article", None).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let (_, hello) = app.call(Method::GET, "/api/plugins/sample/hello", None).await;
    assert_eq!(hello["last"], created["documentId"]);

    // A hook writing the type it listens to stops after a few levels.
    let (status, _) = app.call(Method::GET, "/api/plugins/sample/article?echo", None).await;
    assert_eq!(status, StatusCode::CREATED);
    let (_, echoes) = app.get("/api/articles?filters%5Btitle%5D%5B%24eq%5D=echo").await;
    assert_eq!(echoes["meta"]["pagination"]["total"], 1 + verdin_plugins::MAX_HOOK_DEPTH);
    let (_, logs) =
        app.call_as(Method::GET, "/admin/api/plugins/sample/logs", None, As::Bearer(&admin)).await;
    assert!(
        logs["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|line| line["message"].as_str().unwrap().contains("nest at most"))
    );
    app.done().await;
}
