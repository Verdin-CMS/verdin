//! WASM plugins (Extism). A plugin is a directory with `plugin.toml` and a module; it can
//! hook into document writes (before: change or refuse the data; after: react), serve
//! routes under `/api/plugins/{name}/…`, run scheduled jobs and add widgets and custom
//! fields to the admin. Modules are sandboxed: they reach content, their key-value storage
//! and HTTP hosts only through host functions allowed by their manifest's capabilities.
//!
//! Host functions (Extism namespace `extism:host/user`, JSON in and out):
//! `verdin_log({ level, message })`, `verdin_content({ op, uid, … })`,
//! `verdin_kv_get(key)`, `verdin_kv_set({ key, value })`, `verdin_config()`.

pub mod manifest;

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use extism::{PTR, UserData};
use serde::Serialize;
use serde_json::{Value, json};
use verdin_content::DocumentService;
use verdin_content::events::{
    BoxFuture, DocumentEvent, DocumentHook, DocumentListener, EventKind, HookContext,
};
use verdin_db::{ColumnKind as K, Database, SqlValue as V};
use verdin_migrate::system::PLUGIN_KV;

pub use manifest::Manifest;

const MAX_LOG_LINES: usize = 200;

#[derive(Debug, thiserror::Error)]
pub enum PluginError {
    #[error("invalid plugin: {0}")]
    Manifest(String),
    #[error("could not load the plugin: {0}")]
    Load(String),
    #[error("no such plugin or function")]
    NotFound,
    #[error("the plugin is disabled")]
    Disabled,
    #[error("the plugin failed: {0}")]
    Call(String),
}

/// What plugins ask the platform to do with content (their capabilities are already
/// checked). Implemented by the API layer.
pub trait PluginHost: Send + Sync {
    /// `{ op: findMany | findOne | create | update | delete | publish | unpublish, uid,
    /// documentId?, query?, data?, status?, locale? }`.
    fn content<'a>(&'a self, request: &'a Value) -> BoxFuture<'a, Result<Value, String>>;
}

#[derive(Debug, Clone, Serialize)]
pub struct LogLine {
    pub at: String,
    pub level: String,
    pub message: String,
}

/// State a plugin's host functions see.
struct Shared {
    name: String,
    capabilities: manifest::Capabilities,
    db: Database,
    host: Arc<RwLock<Option<Arc<dyn PluginHost>>>>,
    runtime: tokio::runtime::Handle,
    settings: RwLock<Value>,
    logs: Mutex<VecDeque<LogLine>>,
}

impl Shared {
    fn log(&self, level: &str, message: &str) {
        match level {
            "error" => tracing::error!(plugin = %self.name, "{message}"),
            "warn" => tracing::warn!(plugin = %self.name, "{message}"),
            _ => tracing::info!(plugin = %self.name, "{message}"),
        }
        let mut logs = self.logs.lock().expect("plugin logs");
        if logs.len() >= MAX_LOG_LINES {
            logs.pop_front();
        }
        let at = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default();
        logs.push_back(LogLine {
            at,
            level: level.into(),
            message: message.chars().take(2000).collect(),
        });
    }

    fn content(&self, request: Value) -> Value {
        let op = request["op"].as_str().unwrap_or_default();
        let uid = request["uid"].as_str().unwrap_or_default();
        let allowed = match op {
            "findMany" | "findOne" => self.capabilities.can_read(uid),
            "create" | "update" | "delete" | "publish" | "unpublish" => {
                self.capabilities.can_write(uid)
            }
            _ => return json!({ "error": format!("unknown operation `{op}`") }),
        };
        if !allowed {
            return json!({ "error": format!("`{op}` on `{uid}` is not in the plugin's capabilities") });
        }
        let Some(host) = self.host.read().expect("plugin host").clone() else {
            return json!({ "error": "content is not available yet" });
        };
        match self.runtime.block_on(host.content(&request)) {
            Ok(value) => value,
            Err(error) => json!({ "error": error }),
        }
    }

    fn kv_get(&self, key: &str) -> Value {
        if !self.capabilities.kv {
            return Value::Null;
        }
        let rows = self.runtime.block_on(self.db.queries().fetch_all(
            &format!(
                "SELECT value FROM {PLUGIN_KV} WHERE plugin = ? AND {} = ?",
                key_column(&self.db)
            ),
            &[V::Text(self.name.clone()), V::Text(key.into())],
            &[K::Json],
        ));
        match rows {
            Ok(rows) => match rows.into_iter().next().and_then(|row| row.into_iter().next()) {
                Some(V::Json(value)) => value,
                _ => Value::Null,
            },
            Err(error) => {
                self.log("error", &format!("kv read failed: {error}"));
                Value::Null
            }
        }
    }

    fn kv_set(&self, key: &str, value: &Value) {
        if !self.capabilities.kv || key.is_empty() || key.len() > 255 {
            return;
        }
        let db = &self.db;
        let result = self.runtime.block_on(async {
            let mut tx = db.begin().await?;
            tx.execute(
                &format!("DELETE FROM {PLUGIN_KV} WHERE plugin = ? AND {} = ?", key_column(db)),
                &[V::Text(self.name.clone()), V::Text(key.into())],
            )
            .await?;
            if !value.is_null() {
                tx.execute(
                    &format!(
                        "INSERT INTO {PLUGIN_KV} (plugin, {}, value, updated_at) VALUES (?, ?, ?, ?)",
                        key_column(db)
                    ),
                    &[
                        V::Text(self.name.clone()),
                        V::Text(key.into()),
                        V::Json(value.clone()),
                        V::DateTime(verdin_db::value::truncate_millis(time::OffsetDateTime::now_utc())),
                    ],
                )
                .await?;
            }
            tx.commit().await
        });
        if let Err(error) = result {
            self.log("error", &format!("kv write failed: {error}"));
        }
    }
}

/// `key` is reserved in MySQL/MariaDB.
fn key_column(db: &Database) -> &'static str {
    if db.flavor().is_mysql_family() { "`key`" } else { "\"key\"" }
}

type Data = UserData<Arc<Shared>>;

fn shared(data: &Data) -> Result<Arc<Shared>, extism::Error> {
    Ok(data.get()?.lock().map_err(|_| extism::Error::msg("poisoned plugin state"))?.clone())
}

extism::host_fn!(verdin_log(data: Arc<Shared>; input: String) {
    let shared = shared(&data)?;
    let value: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
    shared.log(value["level"].as_str().unwrap_or("info"), value["message"].as_str().unwrap_or(&input));
    Ok(())
});

extism::host_fn!(verdin_content(data: Arc<Shared>; input: String) -> String {
    let shared = shared(&data)?;
    let request: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
    Ok(shared.content(request).to_string())
});

extism::host_fn!(verdin_kv_get(data: Arc<Shared>; key: String) -> String {
    Ok(shared(&data)?.kv_get(&key).to_string())
});

extism::host_fn!(verdin_kv_set(data: Arc<Shared>; input: String) {
    let shared = shared(&data)?;
    let value: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
    if let Some(key) = value["key"].as_str() {
        shared.kv_set(key, &value["value"]);
    }
    Ok(())
});

extism::host_fn!(verdin_config(data: Arc<Shared>;) -> String {
    Ok(shared(&data)?.settings.read().expect("plugin settings").to_string())
});

/// One installed plugin.
pub struct Plugin {
    pub manifest: Manifest,
    pub dir: PathBuf,
    shared: Arc<Shared>,
    /// Built on first use; dropped after a failed call (a trap leaves it unusable).
    instance: Mutex<Option<extism::Plugin>>,
    enabled: AtomicBool,
}

impl Plugin {
    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn settings(&self) -> Value {
        self.shared.settings.read().expect("plugin settings").clone()
    }

    pub fn logs(&self) -> Vec<LogLine> {
        self.shared.logs.lock().expect("plugin logs").iter().cloned().collect()
    }

    fn build(&self) -> Result<extism::Plugin, PluginError> {
        let manifest = &self.manifest;
        let wasm = extism::Manifest::new([extism::Wasm::file(self.dir.join(&manifest.wasm))])
            .with_timeout(Duration::from_millis(manifest.limits.timeout_ms))
            .with_memory_max(manifest.limits.memory_mb.saturating_mul(16))
            .with_allowed_hosts(manifest.capabilities.http.clone().into_iter());
        let data = UserData::new(self.shared.clone());
        extism::PluginBuilder::new(wasm)
            .with_wasi(manifest.wasi)
            .with_function("verdin_log", [PTR], [], data.clone(), verdin_log)
            .with_function("verdin_content", [PTR], [PTR], data.clone(), verdin_content)
            .with_function("verdin_kv_get", [PTR], [PTR], data.clone(), verdin_kv_get)
            .with_function("verdin_kv_set", [PTR], [], data.clone(), verdin_kv_set)
            .with_function("verdin_config", [], [PTR], data, verdin_config)
            .build()
            .map_err(|error| PluginError::Load(error.to_string()))
    }

    /// Calls an exported function with JSON in and out (blocking; run off the async threads).
    fn call_blocking(&self, function: &str, input: &str) -> Result<String, PluginError> {
        let mut guard = self.instance.lock().expect("plugin instance");
        if guard.is_none() {
            *guard = Some(self.build()?);
        }
        let instance = guard.as_mut().expect("just built");
        if !instance.function_exists(function) {
            return Err(PluginError::NotFound);
        }
        match instance.call::<&str, String>(function, input) {
            Ok(output) => Ok(output),
            Err(error) => {
                *guard = None;
                let message = error.to_string();
                self.shared.log("error", &format!("{function}: {message}"));
                Err(PluginError::Call(message))
            }
        }
    }
}

struct Inner {
    plugins: Vec<Arc<Plugin>>,
    /// Directories that could not be loaded.
    errors: Vec<(PathBuf, String)>,
    host: Arc<RwLock<Option<Arc<dyn PluginHost>>>>,
}

#[derive(Clone)]
pub struct Plugins {
    inner: Arc<Inner>,
}

impl Default for Plugins {
    fn default() -> Self {
        Self {
            inner: Arc::new(Inner {
                plugins: Vec::new(),
                errors: Vec::new(),
                host: Arc::default(),
            }),
        }
    }
}

impl Plugins {
    /// Loads every `<dir>/<plugin>/plugin.toml`; plugins start disabled (see
    /// [`Plugins::apply`]). Must run inside a Tokio runtime.
    pub fn load(dir: &Path, db: Database) -> Self {
        let host: Arc<RwLock<Option<Arc<dyn PluginHost>>>> = Arc::default();
        let mut plugins: Vec<Arc<Plugin>> = Vec::new();
        let mut errors = Vec::new();
        let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
            .map(|entries| {
                entries.filter_map(|entry| entry.ok().map(|entry| entry.path())).collect()
            })
            .unwrap_or_default();
        entries.sort();
        for path in entries.into_iter().filter(|path| path.join("plugin.toml").is_file()) {
            match Manifest::load(&path) {
                Ok(manifest)
                    if plugins.iter().any(|plugin| plugin.manifest.name == manifest.name) =>
                {
                    errors.push((path, format!("another plugin is named `{}`", manifest.name)));
                }
                Ok(manifest) if !path.join(&manifest.wasm).is_file() => {
                    errors.push((path, format!("{} is missing", manifest.wasm)));
                }
                Ok(manifest) => {
                    let shared = Arc::new(Shared {
                        name: manifest.name.clone(),
                        capabilities: manifest.capabilities.clone(),
                        db: db.clone(),
                        host: host.clone(),
                        runtime: tokio::runtime::Handle::current(),
                        settings: RwLock::new(json!({})),
                        logs: Mutex::default(),
                    });
                    plugins.push(Arc::new(Plugin {
                        manifest,
                        dir: path,
                        shared,
                        instance: Mutex::new(None),
                        enabled: AtomicBool::new(false),
                    }));
                }
                Err(error) => errors.push((path, error.to_string())),
            }
        }
        for (path, error) in &errors {
            tracing::warn!(plugin = %path.display(), %error, "plugin not loaded");
        }
        Self { inner: Arc::new(Inner { plugins, errors, host }) }
    }

    /// Gives plugins access to content (again after each rebuild of the app).
    pub fn set_host(&self, host: Arc<dyn PluginHost>) {
        *self.inner.host.write().expect("plugin host") = Some(host);
    }

    pub fn list(&self) -> &[Arc<Plugin>] {
        &self.inner.plugins
    }

    pub fn errors(&self) -> &[(PathBuf, String)] {
        &self.inner.errors
    }

    pub fn get(&self, name: &str) -> Option<&Arc<Plugin>> {
        self.inner.plugins.iter().find(|plugin| plugin.manifest.name == name)
    }

    /// Switches and settings, `{ name: { enabled, settings } }` (unknown names ignored).
    pub fn apply(&self, states: &Value) {
        for plugin in &self.inner.plugins {
            let state = &states[&plugin.manifest.name];
            plugin.enabled.store(state["enabled"].as_bool().unwrap_or(false), Ordering::Relaxed);
            let stored = state
                .get("settings")
                .filter(|value| value.is_object())
                .cloned()
                .unwrap_or_else(|| json!({}));
            *plugin.shared.settings.write().expect("plugin settings") =
                plugin.manifest.effective_settings(&stored);
        }
    }

    /// Calls `function` of an enabled plugin.
    pub async fn call(
        &self,
        name: &str,
        function: &str,
        input: &Value,
    ) -> Result<Value, PluginError> {
        let plugin = self.get(name).ok_or(PluginError::NotFound)?.clone();
        if !plugin.enabled() {
            return Err(PluginError::Disabled);
        }
        call(plugin, function.to_owned(), input).await
    }

    /// Serves a route of a plugin: `{ method, path, query, headers, body, actor }` →
    /// `{ status, headers?, body }`.
    pub async fn handle(&self, name: &str, request: &Value) -> Result<Value, PluginError> {
        let plugin = self.get(name).ok_or(PluginError::NotFound)?;
        let function =
            plugin.manifest.routes.as_ref().ok_or(PluginError::NotFound)?.function.clone();
        self.call(name, &function, request).await
    }

    fn hooked<'a>(
        &'a self,
        event: &'a str,
        uid: &'a str,
    ) -> impl Iterator<Item = (&'a Arc<Plugin>, &'a str)> + 'a {
        self.inner.plugins.iter().filter(|plugin| plugin.enabled()).flat_map(move |plugin| {
            plugin
                .manifest
                .hooks
                .iter()
                .filter(move |hook| hook.on == event && (hook.uid == "*" || hook.uid == uid))
                .map(move |hook| (plugin, hook.function.as_str()))
        })
    }

    /// Runs the scheduled jobs of enabled plugins until the task is aborted.
    pub fn spawn_jobs(&self) -> Vec<tokio::task::JoinHandle<()>> {
        let parser = croner::parser::CronParser::builder()
            .seconds(croner::parser::Seconds::Optional)
            .build();
        let mut handles = Vec::new();
        for plugin in &self.inner.plugins {
            for job in &plugin.manifest.jobs {
                let Ok(cron) = parser.parse(&job.schedule) else { continue };
                let (plugin, function) = (plugin.clone(), job.function.clone());
                handles.push(tokio::spawn(async move {
                    loop {
                        let now = chrono::Utc::now();
                        let Ok(next) = cron.find_next_occurrence(&now, false) else { break };
                        let wait = (next - now).to_std().unwrap_or(Duration::from_secs(1));
                        tokio::time::sleep(wait).await;
                        if plugin.enabled() {
                            let input = json!({ "scheduledAt": next.to_rfc3339() });
                            if let Err(error) = call(plugin.clone(), function.clone(), &input).await {
                                tracing::warn!(plugin = %plugin.manifest.name, %function, %error, "job failed");
                            }
                        }
                    }
                }));
            }
        }
        handles
    }
}

async fn call(plugin: Arc<Plugin>, function: String, input: &Value) -> Result<Value, PluginError> {
    let input = input.to_string();
    let output = tokio::task::spawn_blocking(move || plugin.call_blocking(&function, &input))
        .await
        .map_err(|error| PluginError::Call(error.to_string()))??;
    if output.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&output)
        .map_err(|error| PluginError::Call(format!("invalid JSON output: {error}")))
}

impl DocumentHook for Plugins {
    fn is_plugin(&self) -> bool {
        true
    }

    fn before<'a>(
        &'a self,
        context: HookContext<'a>,
    ) -> BoxFuture<'a, Result<Option<Value>, String>> {
        Box::pin(async move {
            let event = context.action.before();
            let mut data = context.data.cloned();
            let mut replaced = false;
            let hooks: Vec<(Arc<Plugin>, String)> = self
                .hooked(event, context.uid)
                .map(|(plugin, function)| (plugin.clone(), function.to_owned()))
                .collect();
            for (plugin, function) in hooks {
                let input = json!({
                    "event": event,
                    "uid": context.uid,
                    "documentId": context.document_id,
                    "locale": context.locale,
                    "data": data,
                });
                match call(plugin.clone(), function, &input).await {
                    Ok(output) => {
                        if let Some(error) = output.get("error").and_then(Value::as_str) {
                            return Err(error.to_owned());
                        }
                        if let Some(value) = output.get("data").filter(|value| value.is_object()) {
                            data = Some(value.clone());
                            replaced = true;
                        }
                    }
                    // A broken plugin must not block editors: logged, the write goes on.
                    Err(error) => {
                        tracing::warn!(plugin = %plugin.manifest.name, %error, "before hook failed")
                    }
                }
            }
            Ok(data.filter(|_| replaced))
        })
    }
}

impl DocumentListener for Plugins {
    fn notify<'a>(&'a self, event: &'a DocumentEvent, _: &'a DocumentService) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let name = match event.kind {
                EventKind::Created => "afterCreate",
                EventKind::Updated => "afterUpdate",
                EventKind::Published => "afterPublish",
                EventKind::Unpublished => "afterUnpublish",
                EventKind::DraftDiscarded => "afterDiscardDraft",
                EventKind::Deleted => "afterDelete",
            };
            let hooks: Vec<(Arc<Plugin>, String)> = self
                .hooked(name, &event.uid)
                .map(|(plugin, function)| (plugin.clone(), function.to_owned()))
                .collect();
            for (plugin, function) in hooks {
                let input = json!({
                    "event": name,
                    "uid": event.uid,
                    "documentId": event.document_id,
                    "locale": event.locale,
                });
                if let Err(error) = call(plugin.clone(), function, &input).await {
                    tracing::warn!(plugin = %plugin.manifest.name, %error, "after hook failed");
                }
            }
        })
    }
}
