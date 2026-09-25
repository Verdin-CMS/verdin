//! The sample plugin (`tests/fixtures/sample`) through the runtime: hooks, routes,
//! capabilities, storage, jobs, failures and limits.

use std::sync::Arc;

use serde_json::{Value, json};
use verdin_content::events::{BoxFuture, DocumentHook, HookAction, HookContext};
use verdin_migrate::{ApplyOptions, Renames, Risk};
use verdin_plugins::{PluginError, PluginHost, Plugins};
use verdin_testkit::TestDb;

struct FakeHost;

impl PluginHost for FakeHost {
    fn content<'a>(&'a self, request: &'a Value) -> BoxFuture<'a, Result<Value, String>> {
        Box::pin(async move {
            match request["op"].as_str() {
                Some("findMany") => {
                    Ok(json!({ "documents": [{ "title": "A" }, { "title": "B" }] }))
                }
                _ => Ok(json!({ "echo": request })),
            }
        })
    }
}

fn install(dir: &std::path::Path, capabilities: &str) {
    let plugin = dir.join("sample");
    std::fs::create_dir_all(&plugin).unwrap();
    std::fs::copy(
        concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/sample.wasm"),
        plugin.join("plugin.wasm"),
    )
    .unwrap();
    std::fs::write(
        plugin.join("plugin.toml"),
        format!(
            r#"
name = "sample"
version = "0.1.0"
[capabilities]
{capabilities}
[limits]
timeout_ms = 500
[[hooks]]
on = "beforeCreate"
uid = "api::article"
function = "before_write"
[[hooks]]
on = "afterCreate"
function = "after_write"
[routes]
function = "handle"
[[jobs]]
schedule = "0 0 1 1 *"
function = "tick"
"#
        ),
    )
    .unwrap();
}

async fn setup(capabilities: &str) -> (TestDb, Plugins, tempfile::TempDir) {
    let test = TestDb::new().await;
    let model = verdin_migrate::derive_model(&verdin_schema::Schema::default());
    verdin_migrate::apply(
        &test.db,
        &model,
        &Renames::default(),
        ApplyOptions { allow: Risk::Safe },
    )
    .await
    .unwrap();
    let dir = tempfile::tempdir().unwrap();
    install(dir.path(), capabilities);
    let plugins = Plugins::load(dir.path(), test.db.clone());
    assert!(plugins.errors().is_empty(), "{:?}", plugins.errors());
    plugins.set_host(Arc::new(FakeHost));
    (test, plugins, dir)
}

fn context<'a>(data: &'a Value) -> HookContext<'a> {
    HookContext {
        action: HookAction::Create,
        uid: "api::article",
        document_id: None,
        locale: None,
        data: Some(data),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn hooks_routes_and_storage() {
    let (test, plugins, _dir) = setup(
        r#"read = ["api::article"]
kv = true"#,
    )
    .await;

    // Disabled plugins do nothing.
    let data = json!({ "title": "Hello World" });
    assert_eq!(plugins.before(context(&data)).await.unwrap(), None);
    assert!(matches!(
        plugins.handle("sample", &json!({ "path": "/hello" })).await,
        Err(PluginError::Disabled)
    ));

    plugins.apply(&json!({ "sample": { "enabled": true, "settings": { "greeting": "tests" } } }));
    let changed = plugins.before(context(&data)).await.unwrap().unwrap();
    assert_eq!(changed, json!({ "title": "Hello World", "slug": "hello-world" }));
    let refused = plugins.before(context(&json!({ "title": "forbidden" }))).await;
    assert_eq!(refused, Err("this title is not allowed".into()));
    let other = HookContext { uid: "api::page", ..context(&data) };
    assert_eq!(plugins.before(other).await.unwrap(), None, "only api::article is hooked");

    // After hooks and storage.
    plugins
        .call("sample", "after_write", &json!({ "event": "afterCreate", "documentId": "doc-1" }))
        .await
        .unwrap();
    plugins.call("sample", "tick", &json!({})).await.unwrap();
    plugins.call("sample", "tick", &json!({})).await.unwrap();
    let hello = plugins
        .handle("sample", &json!({ "path": "/hello", "actor": { "kind": "public" } }))
        .await
        .unwrap();
    assert_eq!(hello["status"], 200);
    assert_eq!(hello["body"]["message"], "hello tests");
    assert_eq!(hello["body"]["last"], "doc-1");
    assert_eq!(hello["body"]["ticks"], 2);
    assert_eq!(plugins.get("sample").unwrap().logs().last().unwrap().message, "afterCreate doc-1");

    // Capabilities: reading articles is allowed, writing tags is not.
    let titles = plugins.handle("sample", &json!({ "path": "/titles" })).await.unwrap();
    assert_eq!(titles["body"]["titles"], json!(["A", "B"]));
    let write = plugins.handle("sample", &json!({ "path": "/write" })).await.unwrap();
    assert_eq!(write["status"], 403);
    assert!(write["body"]["error"].as_str().unwrap().contains("capabilities"));

    // A trap or a timeout fails the call; the plugin keeps working.
    assert!(matches!(
        plugins.handle("sample", &json!({ "path": "/panic" })).await,
        Err(PluginError::Call(_))
    ));
    let started = std::time::Instant::now();
    assert!(matches!(
        plugins.handle("sample", &json!({ "path": "/loop" })).await,
        Err(PluginError::Call(_))
    ));
    assert!(started.elapsed() < std::time::Duration::from_secs(5), "timed out after the limit");
    assert_eq!(
        plugins.handle("sample", &json!({ "path": "/hello" })).await.unwrap()["status"],
        200
    );
    assert!(matches!(
        plugins.call("sample", "missing", &json!({})).await,
        Err(PluginError::NotFound)
    ));
    test.drop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn storage_needs_its_capability() {
    let (test, plugins, _dir) = setup(r#"read = []"#).await;
    plugins.apply(&json!({ "sample": { "enabled": true } }));
    plugins.call("sample", "tick", &json!({})).await.unwrap();
    let hello = plugins.handle("sample", &json!({ "path": "/hello" })).await.unwrap();
    assert_eq!(hello["body"]["ticks"], Value::Null, "kv writes are ignored without `kv`");
    assert_eq!(hello["body"]["message"], "hello world");
    let titles = plugins.handle("sample", &json!({ "path": "/titles" })).await.unwrap();
    assert_eq!(titles["status"], 403);
    test.drop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn invalid_plugins_are_reported() {
    let test = TestDb::new().await;
    let dir = tempfile::tempdir().unwrap();
    let bad = dir.path().join("bad");
    std::fs::create_dir_all(&bad).unwrap();
    std::fs::write(bad.join("plugin.toml"), "name = \"Bad Name\"\nversion = \"1\"\n").unwrap();
    let missing = dir.path().join("missing");
    std::fs::create_dir_all(&missing).unwrap();
    std::fs::write(missing.join("plugin.toml"), "name = \"missing\"\nversion = \"1\"\n").unwrap();
    let plugins = Plugins::load(dir.path(), test.db.clone());
    assert!(plugins.list().is_empty());
    let errors: Vec<&String> = plugins.errors().iter().map(|(_, error)| error).collect();
    assert_eq!(errors.len(), 2, "{errors:?}");
    assert!(errors.iter().any(|error| error.contains("lowercase")));
    assert!(errors.iter().any(|error| error.contains("plugin.wasm is missing")));
    test.drop().await;
}
