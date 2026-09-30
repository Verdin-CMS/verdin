//! WASM plugins (Extism). A plugin is a directory with `plugin.toml` and a module; it can
//! hook into document writes (before: change or refuse the data; after: react), serve
//! routes under `/api/plugins/{name}/…`, run scheduled jobs and a startup function, and add
//! widgets and custom fields to the admin. Modules are sandboxed: they reach content, their
//! key-value storage and HTTP hosts only through host functions allowed by their manifest's
//! capabilities.
//!
//! Host functions (Extism namespace `extism:host/user`, JSON in and out):
//! `verdin_log({ level, message })`, `verdin_content({ op, uid, … })`,
//! `verdin_kv_get(key)`, `verdin_kv_set({ key, value })`, `verdin_config()`,
//! `verdin_public_permissions({ op: get | set, permissions? })`.
//!
//! Calls on a plugin take turns on its instance. `after*` hooks fired by a write a plugin
//! makes through `verdin_content` are queued and run once that plugin call has returned
//! (and released its instance), so a route, job, GraphQL resolver, startup function or
//! hook can write types its own plugin (or another one) listens to. Hooks fired that way
//! nest at most [`MAX_HOOK_DEPTH`] deep, so a hook writing the type it listens to stops.

pub mod manifest;

use std::cell::RefCell;
use std::collections::VecDeque;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

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

/// How many levels of `after*` hooks writes made by plugins may fire: a hook's writes fire
/// hooks one level deeper, and those past this depth are skipped (with a warning in the
/// plugin's log), so a hook writing the type it listens to does not loop forever.
pub const MAX_HOOK_DEPTH: u32 = 4;

/// How long past a call's time limit its caller still waits (building the instance, a
/// host function winding down) before giving up on it.
const CALL_GRACE: Duration = Duration::from_secs(10);

/// An `after*` hook fired by a write made from inside a plugin call, run once that call
/// has returned.
struct PendingHook {
    plugin: Arc<Plugin>,
    function: String,
    input: Value,
}

/// The hooks a plugin call's writes fired, and how deep that call is in a chain of hooks
/// (0 for routes, jobs, resolvers and startup functions).
#[derive(Clone)]
struct Deferred {
    hooks: Arc<Mutex<Vec<PendingHook>>>,
    depth: u32,
}

impl Deferred {
    fn new(depth: u32) -> Self {
        Self { hooks: Arc::default(), depth }
    }

    fn push(&self, hook: PendingHook) {
        self.hooks.lock().expect("deferred hooks").push(hook);
    }

    fn take(&self) -> Vec<PendingHook> {
        std::mem::take(&mut *self.hooks.lock().expect("deferred hooks"))
    }
}

tokio::task_local! {
    /// Set while a host function of a plugin call runs a write: the document listener
    /// queues plugin hooks here instead of calling them (the caller holds an instance).
    static DEFERRED: Deferred;
}

thread_local! {
    /// The plugin call running on this thread (host functions run on the caller's thread):
    /// where its writes' hooks go and when its time is up.
    static CURRENT: RefCell<Option<(Deferred, Instant)>> = const { RefCell::new(None) };
}

/// Marks this thread as running a plugin call until dropped.
struct CurrentCall(Option<(Deferred, Instant)>);

impl CurrentCall {
    fn enter(deferred: &Deferred, deadline: Instant) -> Self {
        Self(CURRENT.with(|current| current.replace(Some((deferred.clone(), deadline)))))
    }
}

impl Drop for CurrentCall {
    fn drop(&mut self) {
        CURRENT.with(|current| *current.borrow_mut() = self.0.take());
    }
}

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

    /// The public role's content API permissions: `{ op: get }` or `{ op: set, permissions:
    /// [{ subject, action }] }`, both answered with `{ permissions: [...] }`.
    fn public_permissions<'a>(
        &'a self,
        _request: &'a Value,
    ) -> BoxFuture<'a, Result<Value, String>> {
        Box::pin(async { Err("public permissions are not available".to_owned()) })
    }
}

/// Why a plugin's `[startup]` function runs; sent as `{ reason }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StartupReason {
    /// The server started with the plugin on.
    Start,
    /// The plugin was switched on (here or on another instance).
    Enabled,
    /// Its settings were saved while it was on.
    Settings,
}

/// What a plugin call was for, as the metrics label it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CallKind {
    Hook,
    Route,
    Job,
    Startup,
    Graphql,
}

impl CallKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Hook => "hook",
            Self::Route => "route",
            Self::Job => "job",
            Self::Startup => "startup",
            Self::Graphql => "graphql",
        }
    }
}

/// Sees every call that reached an exported function: `(plugin, kind, function, elapsed,
/// failed)`. Functions come from the modules' exports, so the label set is bounded.
pub type CallObserver = Arc<dyn Fn(&str, CallKind, &str, Duration, bool) + Send + Sync>;

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
    observer: Arc<RwLock<Option<CallObserver>>>,
    runtime: tokio::runtime::Handle,
    settings: RwLock<Value>,
    logs: Mutex<VecDeque<LogLine>>,
}

impl Shared {
    fn observe(&self, kind: CallKind, function: &str, started: Instant, failed: bool) {
        let observer = self.observer.read().expect("plugin observer").clone();
        if let Some(observer) = observer {
            observer(&self.name, kind, function, started.elapsed(), failed);
        }
    }

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

    /// Runs a host function's async work to completion on this (blocking) thread, within
    /// the time left to the plugin call and with its writes' hooks queued for later.
    fn block_on<T, E: std::fmt::Display>(
        &self,
        future: impl Future<Output = Result<T, E>>,
    ) -> Result<T, String> {
        let Some((deferred, deadline)) = CURRENT.with(|current| current.borrow().clone()) else {
            return self.runtime.block_on(future).map_err(|error| error.to_string());
        };
        let remaining = deadline.saturating_duration_since(Instant::now());
        self.runtime.block_on(DEFERRED.scope(deferred, async move {
            match tokio::time::timeout(remaining, future).await {
                Ok(result) => result.map_err(|error| error.to_string()),
                Err(_) => Err("the plugin's time limit was reached".to_owned()),
            }
        }))
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
        match self.block_on(host.content(&request)) {
            Ok(value) => value,
            Err(error) => json!({ "error": error }),
        }
    }

    fn public_permissions(&self, request: Value) -> Value {
        if !self.capabilities.public_permissions {
            return json!({ "error": "public permissions are not in the plugin's capabilities" });
        }
        let Some(host) = self.host.read().expect("plugin host").clone() else {
            return json!({ "error": "public permissions are not available yet" });
        };
        match self.block_on(host.public_permissions(&request)) {
            Ok(value) => value,
            Err(error) => json!({ "error": error }),
        }
    }

    fn kv_get(&self, key: &str) -> Value {
        if !self.capabilities.kv {
            return Value::Null;
        }
        let rows = self.block_on(self.db.queries().fetch_all(
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
        let result = self.block_on(async {
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

extism::host_fn!(verdin_public_permissions(data: Arc<Shared>; input: String) -> String {
    let shared = shared(&data)?;
    let request: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
    Ok(shared.public_permissions(request).to_string())
});

extism::host_fn!(verdin_config(data: Arc<Shared>;) -> String {
    Ok(shared(&data)?.settings.read().expect("plugin settings").to_string())
});

/// One installed plugin.
pub struct Plugin {
    pub manifest: Manifest,
    pub dir: PathBuf,
    shared: Arc<Shared>,
    /// Built on first use; dropped after a failed call (a trap leaves it unusable). Calls
    /// take turns on it; waiting for it is async and bounded (see [`call`]).
    instance: Arc<tokio::sync::Mutex<Option<extism::Plugin>>>,
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

    fn build(&self, timeout_ms: u64) -> Result<extism::Plugin, PluginError> {
        let manifest = &self.manifest;
        let wasm = extism::Manifest::new([extism::Wasm::file(self.dir.join(&manifest.wasm))])
            .with_timeout(Duration::from_millis(timeout_ms))
            .with_memory_max(manifest.limits.memory_mb.saturating_mul(16))
            .with_allowed_hosts(manifest.capabilities.http.clone().into_iter());
        let data = UserData::new(self.shared.clone());
        extism::PluginBuilder::new(wasm)
            .with_wasi(manifest.wasi)
            .with_function("verdin_log", [PTR], [], data.clone(), verdin_log)
            .with_function("verdin_content", [PTR], [PTR], data.clone(), verdin_content)
            .with_function("verdin_kv_get", [PTR], [PTR], data.clone(), verdin_kv_get)
            .with_function("verdin_kv_set", [PTR], [], data.clone(), verdin_kv_set)
            .with_function(
                "verdin_public_permissions",
                [PTR],
                [PTR],
                data.clone(),
                verdin_public_permissions,
            )
            .with_function("verdin_config", [], [PTR], data, verdin_config)
            .build()
            .map_err(|error| PluginError::Load(error.to_string()))
    }

    /// Calls an exported function with JSON in and out on the instance `guard` holds
    /// (blocking; run off the async threads). Released when this returns.
    fn call_blocking(
        &self,
        mut guard: tokio::sync::OwnedMutexGuard<Option<extism::Plugin>>,
        function: &str,
        input: &str,
        deferred: &Deferred,
    ) -> Result<String, PluginError> {
        if guard.is_none() {
            *guard = Some(self.build(self.manifest.limits.timeout_ms)?);
        }
        let instance = guard.as_mut().expect("just built");
        if !instance.function_exists(function) {
            return Err(PluginError::NotFound);
        }
        let deadline = Instant::now() + Duration::from_millis(self.manifest.limits.timeout_ms);
        let _current = CurrentCall::enter(deferred, deadline);
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

    /// Runs the `[startup]` function on an instance of its own, with its own (longer) time
    /// limit, so the plugin's hooks and routes go on meanwhile.
    fn startup_blocking(&self, input: &str, deferred: &Deferred) -> Result<String, PluginError> {
        let startup = self.manifest.startup.as_ref().ok_or(PluginError::NotFound)?;
        let mut instance = self.build(startup.timeout_ms)?;
        if !instance.function_exists(&startup.function) {
            self.shared.log("error", &format!("startup: `{}` is not exported", startup.function));
            return Err(PluginError::NotFound);
        }
        let deadline = Instant::now() + Duration::from_millis(startup.timeout_ms);
        let _current = CurrentCall::enter(deferred, deadline);
        instance.call::<&str, String>(&startup.function, input).map_err(|error| {
            let message = error.to_string();
            self.shared.log("error", &format!("{}: {message}", startup.function));
            PluginError::Call(message)
        })
    }
}

struct Inner {
    plugins: Vec<Arc<Plugin>>,
    /// Directories that could not be loaded.
    errors: Vec<(PathBuf, String)>,
    host: Arc<RwLock<Option<Arc<dyn PluginHost>>>>,
    observer: Arc<RwLock<Option<CallObserver>>>,
    /// Whether this instance runs startup functions (the one that runs the jobs).
    run_startup: AtomicBool,
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
                observer: Arc::default(),
                run_startup: AtomicBool::new(true),
            }),
        }
    }
}

impl Plugins {
    /// Loads every `<dir>/<plugin>/plugin.toml`; plugins start disabled (see
    /// [`Plugins::apply`]). Must run inside a Tokio runtime.
    pub fn load(dir: &Path, db: Database) -> Self {
        let host: Arc<RwLock<Option<Arc<dyn PluginHost>>>> = Arc::default();
        let observer: Arc<RwLock<Option<CallObserver>>> = Arc::default();
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
                        observer: observer.clone(),
                        runtime: tokio::runtime::Handle::current(),
                        settings: RwLock::new(json!({})),
                        logs: Mutex::default(),
                    });
                    plugins.push(Arc::new(Plugin {
                        manifest,
                        dir: path,
                        shared,
                        instance: Arc::default(),
                        enabled: AtomicBool::new(false),
                    }));
                }
                Err(error) => errors.push((path, error.to_string())),
            }
        }
        for (path, error) in &errors {
            tracing::warn!(plugin = %path.display(), %error, "plugin not loaded");
        }
        Self {
            inner: Arc::new(Inner {
                plugins,
                errors,
                host,
                observer,
                run_startup: AtomicBool::new(true),
            }),
        }
    }

    /// Gives plugins access to content (again after each rebuild of the app).
    pub fn set_host(&self, host: Arc<dyn PluginHost>) {
        *self.inner.host.write().expect("plugin host") = Some(host);
    }

    /// Reports every call's duration (the Prometheus metrics).
    pub fn set_observer(&self, observer: CallObserver) {
        *self.inner.observer.write().expect("plugin observer") = Some(observer);
    }

    /// With several instances, only the one that runs the scheduled jobs runs startup
    /// functions: they act on the shared database, so once is enough (on by default).
    pub fn set_run_startup(&self, run: bool) {
        self.inner.run_startup.store(run, Ordering::Relaxed);
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
    /// Returns the plugins with a `[startup]` function that were switched on or whose
    /// settings changed while on, for [`Plugins::spawn_startup`].
    pub fn apply(&self, states: &Value) -> Vec<(String, StartupReason)> {
        let mut started = Vec::new();
        for plugin in &self.inner.plugins {
            let state = &states[&plugin.manifest.name];
            let enabled = state["enabled"].as_bool().unwrap_or(false);
            let was_enabled = plugin.enabled.swap(enabled, Ordering::Relaxed);
            let stored = state
                .get("settings")
                .filter(|value| value.is_object())
                .cloned()
                .unwrap_or_else(|| json!({}));
            let settings = plugin.manifest.effective_settings(&stored);
            let previous = std::mem::replace(
                &mut *plugin.shared.settings.write().expect("plugin settings"),
                settings.clone(),
            );
            if !enabled || plugin.manifest.startup.is_none() {
                continue;
            }
            if !was_enabled {
                started.push((plugin.manifest.name.clone(), StartupReason::Enabled));
            } else if previous != settings {
                started.push((plugin.manifest.name.clone(), StartupReason::Settings));
            }
        }
        started
    }

    /// Runs the `[startup]` function of an enabled plugin with `{ reason }`. A function
    /// that fails, or answers `{ error }`, is logged in the plugin's log.
    pub async fn startup(&self, name: &str, reason: StartupReason) -> Result<(), PluginError> {
        let plugin = self.get(name).ok_or(PluginError::NotFound)?.clone();
        if !plugin.enabled() {
            return Err(PluginError::Disabled);
        }
        let input = json!({ "reason": reason }).to_string();
        let worker = plugin.clone();
        let started = Instant::now();
        let deferred = Deferred::new(0);
        let queue = deferred.clone();
        let limit =
            Duration::from_millis(plugin.manifest.startup.as_ref().map_or(0, |s| s.timeout_ms));
        let task = tokio::task::spawn_blocking(move || worker.startup_blocking(&input, &queue));
        let result = bounded(&plugin, "startup", task, limit)
            .await
            .and_then(|output| parse_output(&output))
            .and_then(|output| match output.get("error").and_then(Value::as_str) {
                Some(error) => {
                    plugin.shared.log("error", &format!("startup: {error}"));
                    Err(PluginError::Call(error.to_owned()))
                }
                None => Ok(()),
            });
        if !matches!(result, Err(PluginError::NotFound)) {
            let function = plugin.manifest.startup.as_ref().map_or("", |s| s.function.as_str());
            plugin.shared.observe(CallKind::Startup, function, started, result.is_err());
        }
        run_deferred(deferred).await;
        result?;
        tracing::info!(plugin = %name, ?reason, "plugin started");
        Ok(())
    }

    /// Runs startup functions one after the other in the background (failures are logged).
    pub fn spawn_startup(
        &self,
        started: Vec<(String, StartupReason)>,
    ) -> Option<tokio::task::JoinHandle<()>> {
        if started.is_empty() || !self.inner.run_startup.load(Ordering::Relaxed) {
            return None;
        }
        let plugins = self.clone();
        Some(tokio::spawn(async move {
            for (name, reason) in started {
                if let Err(error) = plugins.startup(&name, reason).await {
                    tracing::warn!(plugin = %name, ?reason, %error, "startup failed");
                }
            }
        }))
    }

    /// Calls `function` of an enabled plugin (`kind` labels it in the metrics).
    pub async fn call(
        &self,
        kind: CallKind,
        name: &str,
        function: &str,
        input: &Value,
    ) -> Result<Value, PluginError> {
        let plugin = self.get(name).ok_or(PluginError::NotFound)?.clone();
        if !plugin.enabled() {
            return Err(PluginError::Disabled);
        }
        call(plugin, kind, function.to_owned(), input.clone(), 0).await
    }

    /// Serves a route of a plugin: `{ method, path, query, headers, body, actor }` →
    /// `{ status, headers?, body }`.
    pub async fn handle(&self, name: &str, request: &Value) -> Result<Value, PluginError> {
        let plugin = self.get(name).ok_or(PluginError::NotFound)?;
        let function =
            plugin.manifest.routes.as_ref().ok_or(PluginError::NotFound)?.function.clone();
        self.call(CallKind::Route, name, &function, request).await
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
                            if let Err(error) = call(plugin.clone(), CallKind::Job, function.clone(), input, 0).await {
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

/// Calls `function` on the plugin's instance, then runs the `after*` hooks its writes
/// fired (one level deeper than `depth`, the call's own place in a chain of hooks).
fn call(
    plugin: Arc<Plugin>,
    kind: CallKind,
    function: String,
    input: Value,
    depth: u32,
) -> BoxFuture<'static, Result<Value, PluginError>> {
    Box::pin(async move {
        let started = Instant::now();
        let limit = Duration::from_millis(plugin.manifest.limits.timeout_ms);
        let deferred = Deferred::new(depth);
        let result = async {
            // Waiting for the instance is bounded too: at most as long as one other call may
            // keep it.
            let guard =
                tokio::time::timeout(limit + CALL_GRACE, plugin.instance.clone().lock_owned())
                    .await
                    .map_err(|_| {
                        let message = "busy: another call kept the plugin past its time limit";
                        plugin.shared.log("error", &format!("{function}: {message}"));
                        PluginError::Call(message.to_owned())
                    })?;
            let (worker, name, queue, input) =
                (plugin.clone(), function.clone(), deferred.clone(), input.to_string());
            let task = tokio::task::spawn_blocking(move || {
                worker.call_blocking(guard, &name, &input, &queue)
            });
            bounded(&plugin, &function, task, limit).await.and_then(|output| parse_output(&output))
        }
        .await;
        // Unknown functions are not recorded: they would make labels out of any name.
        if !matches!(result, Err(PluginError::NotFound)) {
            plugin.shared.observe(kind, &function, started, result.is_err());
        }
        run_deferred(deferred).await;
        result
    })
}

/// Waits for a blocking plugin call, at most `limit` plus a grace period: the Wasm time
/// limit stops the module, and host functions stop at the limit, so this only gives up on
/// a call stuck elsewhere (it keeps the instance until it ends, callers are freed).
async fn bounded(
    plugin: &Plugin,
    function: &str,
    task: tokio::task::JoinHandle<Result<String, PluginError>>,
    limit: Duration,
) -> Result<String, PluginError> {
    match tokio::time::timeout(limit + CALL_GRACE, task).await {
        Ok(joined) => joined.map_err(|error| PluginError::Call(error.to_string()))?,
        Err(_) => {
            let message = "the call did not end after its time limit";
            plugin.shared.log("error", &format!("{function}: {message}"));
            Err(PluginError::Call(message.to_owned()))
        }
    }
}

/// Runs the hooks a call's writes fired, in order, each one level deeper.
async fn run_deferred(deferred: Deferred) {
    for PendingHook { plugin, function, input } in deferred.take() {
        if deferred.depth >= MAX_HOOK_DEPTH {
            plugin.shared.log(
                "warn",
                &format!(
                    "{function} skipped for {} {} {}: hooks fired by plugin writes nest at most \
                     {MAX_HOOK_DEPTH} deep (does a hook write the type it listens to?)",
                    input["event"].as_str().unwrap_or_default(),
                    input["uid"].as_str().unwrap_or_default(),
                    input["documentId"].as_str().unwrap_or_default(),
                ),
            );
            continue;
        }
        let name = plugin.manifest.name.clone();
        if let Err(error) = call(plugin, CallKind::Hook, function, input, deferred.depth + 1).await
        {
            tracing::warn!(plugin = %name, %error, "after hook failed");
        }
    }
}

fn parse_output(output: &str) -> Result<Value, PluginError> {
    if output.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(output)
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
                match call(plugin.clone(), CallKind::Hook, function, input, 1).await {
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
            // A write made from inside a plugin call: its hooks run once that call returns
            // (the caller may hold the very instance they need).
            let deferred = DEFERRED.try_with(Deferred::clone).ok();
            for (plugin, function) in hooks {
                let input = json!({
                    "event": name,
                    "uid": event.uid,
                    "documentId": event.document_id,
                    "locale": event.locale,
                });
                if let Some(deferred) = &deferred {
                    deferred.push(PendingHook { plugin, function, input });
                } else if let Err(error) =
                    call(plugin.clone(), CallKind::Hook, function, input, 1).await
                {
                    tracing::warn!(plugin = %plugin.manifest.name, %error, "after hook failed");
                }
            }
        })
    }
}
