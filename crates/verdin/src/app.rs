//! Assembling and serving the application; the development-mode schema editor.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Weak};

use anyhow::{Context, Result, bail};
use arc_swap::ArcSwap;
use axum::Router;
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tower::ServiceExt;
use verdin_api::features::{FeatureHost, FeatureState, FeatureStates, GRAPHQL, OPENAPI};
use verdin_api::{ApiError, BoxFuture, SchemaChange, SchemaEditor};
use verdin_auth::AuthService;
use verdin_db::Database;
use verdin_migrate::{ApplyOptions, MigrateError, Renames, Risk, Status};
use verdin_schema::{Schema, SchemaErrors, Source};

use crate::config::Config;
use crate::server::{self, AppState};
use crate::{admin_ui, uploads};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Production,
    Development,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Production => "production",
            Mode::Development => "development",
        }
    }
}

/// Everything the routers are built from, except the schema.
pub struct AppContext {
    pub config: Config,
    pub root: PathBuf,
    pub db: Database,
    pub auth: AuthService,
    pub mode: Mode,
    pub upload: verdin_upload::UploadService,
}

impl AppContext {
    fn schema_dir(&self) -> PathBuf {
        self.root.join(&self.config.schema.path)
    }
}

/// Validates settings that routers rely on.
pub fn check_config(config: &Config) -> Result<()> {
    let (api, admin) = (&config.api, &config.admin);
    for (name, path) in [("[api].prefix", &api.prefix), ("[admin].path", &admin.path)] {
        if !path.starts_with('/') || path.len() < 2 || path.ends_with('/') {
            bail!("{name} must look like `/api` (got `{path}`)");
        }
    }
    if api.default_page_size == 0 || api.default_page_size > api.max_page_size {
        bail!("[api].default_page_size must be between 1 and max_page_size");
    }
    Ok(())
}

/// Health, content API, admin API and admin panel for one schema.
pub fn build_app(
    context: &AppContext,
    schema: Schema,
    editor: Option<Arc<dyn SchemaEditor>>,
    features: Option<Arc<dyn FeatureHost>>,
    states: &FeatureStates,
) -> Router {
    let (api, admin) = (&context.config.api, &context.config.admin);
    let registry = verdin_content::Registry::new(schema);
    let registry_for_graphql = registry.clone();
    let limits = verdin_query::Limits {
        default_page_size: api.default_page_size,
        max_page_size: api.max_page_size,
        ..Default::default()
    };
    let output = verdin_content::OutputOptions { decimal_as_string: api.decimal_as_string };
    let http = verdin_api::HttpLimits {
        body_limit: context.config.server.body_limit,
        request_timeout: context.config.server.request_timeout(),
    };
    let content_api = verdin_api::router(
        context.db.clone(),
        registry.clone(),
        context.auth.clone(),
        verdin_api::ApiConfig {
            limits,
            output,
            http,
            openapi: states.enabled(OPENAPI),
            openapi_public: states
                .settings(OPENAPI)
                .get("public")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
        },
        &api.prefix,
        Some(context.upload.clone()),
    );
    let admin_api = verdin_api::admin_router(
        context.db.clone(),
        registry,
        context.auth.clone(),
        verdin_api::AdminConfig {
            path: admin.path.clone(),
            secure_cookies: admin.secure_cookies.unwrap_or(context.mode == Mode::Production),
            limits,
            output,
            mode: context.mode.as_str(),
            auth_rate_limit: admin.auth_rate_limit,
            schema_editor: editor,
            http,
            features,
            upload: Some(context.upload.clone()),
        },
    );
    let graphql = states
        .enabled(GRAPHQL)
        .then(|| graphql_router(context, &registry_for_graphql, limits, output, states));
    let mut app = server::router(
        AppState { db: context.db.clone() },
        &[(api.prefix.clone(), content_api), (format!("{}/api", admin.path), admin_api)],
    );
    if let Some(graphql) = graphql {
        app = app.merge(graphql);
    }
    if let Some(dir) = context.upload.storage().local_dir() {
        app = app.nest_service("/uploads", uploads::service(dir.to_owned()));
    }
    let assets_dir = admin.assets_dir.as_ref().map(|dir| context.root.join(dir));
    if let Some(assets) = admin_ui::Assets::resolve(assets_dir.as_deref()) {
        let media: Vec<String> = context.upload.storage().public_origin().into_iter().collect();
        app = app.merge(admin_ui::router(
            assets,
            &admin.path,
            context.mode.as_str(),
            &api.prefix,
            &media,
        ));
    }
    app
}

/// Brings the database to the schema: `--migrate` / development mode apply safe steps.
pub async fn ensure_migrated(db: &Database, schema: &Schema, migrate: bool) -> Result<()> {
    let desired = verdin_migrate::derive_model(schema);
    match verdin_migrate::status(db, &desired, &Renames::default()).await? {
        Status::UpToDate => Ok(()),
        Status::Pending(_) if migrate => {
            let report =
                verdin_migrate::apply(db, &desired, &Renames::default(), ApplyOptions::default())
                    .await
                    .context("applying safe migrations (run `verdin migrate plan` for details)")?;
            tracing::info!(steps = report.applied_steps, "applied migrations");
            Ok(())
        }
        Status::Pending(plan) => bail!(
            "the database is {} step(s) behind the schema; run `verdin migrate plan` to review \
             and `verdin migrate apply`, or start with --migrate to apply safe steps",
            plan.steps.len()
        ),
        Status::Interrupted { .. } => {
            bail!(
                "a migration was interrupted; run `verdin migrate plan` and `verdin migrate apply`"
            )
        }
    }
}

/// Serves until Ctrl+C / SIGTERM. The app is rebuilt in place when features are switched
/// and, in development mode, when the content-type builder changes the schema.
pub async fn serve(
    context: AppContext,
    schema: Schema,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<()> {
    let context = Arc::new(context);
    let states = load_features(&context.db).await.context("reading feature switches")?;
    let host = AppHost::new(context.clone(), schema, states);
    // Keeps the watcher alive while serving.
    let _watcher = match &host.editor {
        Some(editor) => match watch_schema(editor.clone()) {
            Ok(watcher) => Some(watcher),
            Err(error) => {
                tracing::warn!(%error, "not watching the schema directory");
                None
            }
        },
        None => None,
    };
    let app = Router::new().fallback_service(tower::service_fn(move |request| {
        let router = Router::clone(&host.current.load());
        async move { router.oneshot(request).await }
    }));

    let address = format!("{}:{}", context.config.server.host, context.config.server.port);
    let listener =
        TcpListener::bind(&address).await.with_context(|| format!("binding {address}"))?;
    tracing::info!(%address, mode = context.mode.as_str(), version = env!("CARGO_PKG_VERSION"), "verdin listening");
    // Client addresses feed the admin auth rate limiter.
    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>())
        .with_graceful_shutdown(shutdown)
        .await?;
    context.db.close().await;
    tracing::info!("verdin stopped");
    Ok(())
}

/// `/graphql`, when the `graphql` feature is on. A schema that cannot be built (it should
/// not happen: the content schema is validated) disables the endpoint with an error log.
fn graphql_router(
    context: &AppContext,
    registry: &verdin_content::Registry,
    limits: verdin_query::Limits,
    output: verdin_content::OutputOptions,
    states: &FeatureStates,
) -> Router {
    let settings = states.settings(GRAPHQL);
    let flag =
        |key: &str, default: bool| settings.get(key).and_then(Value::as_bool).unwrap_or(default);
    let number = |key: &str, default: usize| {
        settings.get(key).and_then(Value::as_u64).map_or(default, |value| value as usize)
    };
    let defaults = verdin_graphql::Options::default();
    let options = verdin_graphql::Options {
        max_depth: number("maxDepth", defaults.max_depth),
        max_complexity: number("maxComplexity", defaults.max_complexity),
        introspection: flag("introspection", defaults.introspection),
        playground: flag("playground", context.mode == Mode::Development),
    };
    let service =
        verdin_content::DocumentService::new(context.db.clone(), registry.clone(), output);
    match verdin_graphql::schema(service, limits, &options) {
        Ok(schema) => verdin_graphql::router(schema, context.auth.clone(), options, "/graphql"),
        Err(error) => {
            tracing::error!(%error, "could not build the GraphQL schema; /graphql is off");
            Router::new()
        }
    }
}

const FEATURES_KEY: &str = "features";

/// `key` is reserved in MySQL/MariaDB.
fn key_column(db: &Database) -> &'static str {
    if db.flavor().is_mysql_family() { "`key`" } else { "\"key\"" }
}

pub async fn load_features(db: &Database) -> Result<FeatureStates> {
    let rows = db
        .queries()
        .fetch_all(
            &format!("SELECT value FROM vd_settings WHERE {} = ?", key_column(db)),
            &[verdin_db::SqlValue::Text(FEATURES_KEY.into())],
            &[verdin_db::ColumnKind::Json],
        )
        .await?;
    Ok(match rows.into_iter().next().and_then(|row| row.into_iter().next()) {
        Some(verdin_db::SqlValue::Json(value)) => serde_json::from_value(value).unwrap_or_default(),
        _ => FeatureStates::default(),
    })
}

async fn save_features(db: &Database, states: &FeatureStates) -> Result<(), ApiError> {
    use verdin_db::SqlValue as V;
    let internal = |error: verdin_db::DbError| ApiError::Internal(error.to_string());
    let key = key_column(db);
    let mut tx = db.begin().await.map_err(internal)?;
    tx.execute(
        &format!("DELETE FROM vd_settings WHERE {key} = ?"),
        &[V::Text(FEATURES_KEY.into())],
    )
    .await
    .map_err(internal)?;
    let value =
        serde_json::to_value(states).map_err(|error| ApiError::Internal(error.to_string()))?;
    tx.execute(
        &format!("INSERT INTO vd_settings ({key}, value, updated_at) VALUES (?, ?, ?)"),
        &[
            V::Text(FEATURES_KEY.into()),
            V::Json(value),
            V::DateTime(verdin_db::value::truncate_millis(time::OffsetDateTime::now_utc())),
        ],
    )
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)
}

/// The running app and what it is built from; rebuilds swap it without dropping requests.
pub struct AppHost {
    this: Weak<AppHost>,
    context: Arc<AppContext>,
    current: ArcSwap<Router>,
    schema: std::sync::Mutex<Schema>,
    features: ArcSwap<FeatureStates>,
    /// Present in development mode.
    editor: Option<Arc<DevSchemaEditor>>,
    /// One feature change at a time.
    lock: tokio::sync::Mutex<()>,
}

impl AppHost {
    fn new(context: Arc<AppContext>, schema: Schema, states: FeatureStates) -> Arc<Self> {
        let host = Arc::new_cyclic(|this: &Weak<AppHost>| AppHost {
            this: this.clone(),
            editor: (context.mode == Mode::Development).then(|| {
                Arc::new(DevSchemaEditor {
                    host: this.clone(),
                    context: context.clone(),
                    lock: tokio::sync::Mutex::new(()),
                })
            }),
            context,
            current: ArcSwap::from_pointee(Router::new()),
            schema: std::sync::Mutex::new(schema),
            features: ArcSwap::from_pointee(states),
            lock: tokio::sync::Mutex::new(()),
        });
        host.rebuild();
        host
    }

    fn rebuild(&self) {
        let schema = self.schema.lock().expect("schema lock").clone();
        let editor = self.editor.clone().map(|editor| editor as Arc<dyn SchemaEditor>);
        let features = self.this.upgrade().map(|host| host as Arc<dyn FeatureHost>);
        let states = self.features.load();
        self.current.store(Arc::new(build_app(&self.context, schema, editor, features, &states)));
    }

    fn set_schema(&self, schema: Schema) {
        *self.schema.lock().expect("schema lock") = schema;
        self.rebuild();
    }
}

impl FeatureHost for AppHost {
    fn states(&self) -> FeatureStates {
        FeatureStates::clone(&self.features.load())
    }

    fn update(&self, id: String, state: FeatureState) -> BoxFuture<'_, Result<(), ApiError>> {
        Box::pin(async move {
            let _guard = self.lock.lock().await;
            let mut states = self.states();
            states.0.insert(id.clone(), state);
            save_features(&self.context.db, &states).await?;
            self.features.store(Arc::new(states));
            self.rebuild();
            tracing::info!(feature = %id, "feature switched; app reloaded");
            Ok(())
        })
    }
}

/// `verdin dev`: reloads when schema files change on disk (editors, `git pull`…). Safe
/// migrations apply; anything riskier is logged and the running app stays as it was.
fn watch_schema(editor: Arc<DevSchemaEditor>) -> Result<notify::RecommendedWatcher> {
    use notify::{RecursiveMode, Watcher};
    let dir = editor.context.schema_dir();
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel::<()>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event
            && !event.kind.is_access()
            && event.paths.iter().any(|path| path.extension().is_some_and(|ext| ext == "json"))
        {
            let _ = sender.send(());
        }
    })?;
    watcher.watch(&dir, RecursiveMode::Recursive)?;
    tokio::spawn(async move {
        while receiver.recv().await.is_some() {
            // Let bursts of writes (editors, checkouts) settle.
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            while receiver.try_recv().is_ok() {}
            editor.reload_from_disk().await;
        }
    });
    tracing::info!(dir = %dir.display(), "watching schema files");
    Ok(watcher)
}

/// Edits schema files, migrates and hot-swaps the app (`verdin dev` only).
struct DevSchemaEditor {
    host: Weak<AppHost>,
    context: Arc<AppContext>,
    /// One edit at a time.
    lock: tokio::sync::Mutex<()>,
}

/// A schema file to write (`Some`) or delete (`None`).
type FileChange = (PathBuf, Option<String>);

struct Candidate {
    schema: Schema,
    files: Vec<FileChange>,
    renames: Renames,
    allow: Risk,
}

fn schema_errors_json(errors: &SchemaErrors) -> Value {
    Value::Array(
        errors
            .0
            .iter()
            .map(|error| json!({ "file": error.file.display().to_string(), "path": error.path, "message": error.message }))
            .collect(),
    )
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

impl DevSchemaEditor {
    fn sources_json(&self) -> Value {
        let dir = self.context.schema_dir();
        let mut content_types = BTreeMap::new();
        let mut components = BTreeMap::new();
        if let Ok(entries) = std::fs::read_dir(dir.join("content-types")) {
            for path in entries.filter_map(Result::ok).map(|entry| entry.path()) {
                let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
                if let Some(stem) = name.strip_suffix(".json").filter(|stem| !stem.ends_with(".ui"))
                    && let Some(json) = read_json(&path)
                {
                    content_types.insert(stem.to_owned(), json);
                }
            }
        }
        if let Ok(categories) = std::fs::read_dir(dir.join("components")) {
            for category in categories
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.is_dir())
            {
                let category_name = category
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_owned();
                for path in std::fs::read_dir(&category)
                    .into_iter()
                    .flatten()
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                {
                    let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
                    if let Some(stem) = name.strip_suffix(".json")
                        && let Some(json) = read_json(&path)
                    {
                        components.insert(format!("{category_name}.{stem}"), json);
                    }
                }
            }
        }
        json!({ "contentTypes": content_types, "components": components })
    }

    /// The schema after `change`, or the validation errors it would cause.
    fn candidate(&self, change: SchemaChange) -> Result<Result<Candidate, Value>, ApiError> {
        let dir = self.context.schema_dir();
        let current = self.sources_json();
        let mut content_types: BTreeMap<String, Value> =
            serde_json::from_value(current["contentTypes"].clone()).unwrap_or_default();
        let mut components: BTreeMap<String, Value> =
            serde_json::from_value(current["components"].clone()).unwrap_or_default();
        let mut files = Vec::new();

        for (name, value) in change.content_types {
            if !verdin_schema::naming::is_kebab_name(&name) {
                return Err(ApiError::BadRequest(format!("invalid content type name `{name}`")));
            }
            let path = dir.join("content-types").join(format!("{name}.json"));
            match value {
                Some(value) => {
                    files.push((path, Some(pretty(&value))));
                    content_types.insert(name, value);
                }
                None => {
                    files.push((path, None));
                    content_types.remove(&name);
                }
            }
        }
        for (uid, value) in change.components {
            let valid = uid.split_once('.').filter(|(category, name)| {
                verdin_schema::naming::is_kebab_name(category)
                    && verdin_schema::naming::is_kebab_name(name)
            });
            let Some((category, name)) = valid else {
                return Err(ApiError::BadRequest(format!(
                    "invalid component uid `{uid}` (expected category.name)"
                )));
            };
            let path = dir.join("components").join(category).join(format!("{name}.json"));
            match value {
                Some(value) => {
                    files.push((path, Some(pretty(&value))));
                    components.insert(uid, value);
                }
                None => {
                    files.push((path, None));
                    components.remove(&uid);
                }
            }
        }

        let mut sources: Vec<Source> = content_types
            .iter()
            .map(|(name, value)| Source::content_type(name, pretty(value)))
            .collect();
        for (uid, value) in &components {
            let (category, name) = uid.split_once('.').expect("validated above or read from disk");
            sources.push(Source::component(category, name, pretty(value)));
        }
        let schema = match Schema::parse(&sources) {
            Ok(schema) => schema,
            Err(errors) => return Ok(Err(schema_errors_json(&errors))),
        };

        let mut renames = Renames::default();
        for spec in &change.rename_tables {
            renames.add_table(spec).map_err(|error| ApiError::BadRequest(error.to_string()))?;
        }
        for spec in &change.rename_columns {
            renames.add_column(spec).map_err(|error| ApiError::BadRequest(error.to_string()))?;
        }
        let allow = match change.allow.as_deref() {
            None | Some("safe") => Risk::Safe,
            Some("risky") => Risk::Risky,
            Some("destructive") => Risk::Destructive,
            Some(other) => {
                return Err(ApiError::BadRequest(format!("unknown risk level `{other}`")));
            }
        };
        Ok(Ok(Candidate { schema, files, renames, allow }))
    }

    async fn plan_json(&self, change: SchemaChange) -> Result<Value, ApiError> {
        let candidate = match self.candidate(change)? {
            Ok(candidate) => candidate,
            Err(errors) => return Ok(json!({ "valid": false, "errors": errors })),
        };
        let desired = verdin_migrate::derive_model(&candidate.schema);
        let status = verdin_migrate::status(&self.context.db, &desired, &candidate.renames)
            .await
            .map_err(migrate_error)?;
        let (plan, interrupted) = match status {
            Status::UpToDate => {
                return Ok(json!({ "valid": true, "steps": [], "requires": "safe", "hints": [] }));
            }
            Status::Pending(plan) => (plan, false),
            Status::Interrupted { plan, .. } => (plan, true),
        };
        Ok(json!({
            "valid": true,
            "interrupted": interrupted,
            "steps": plan.steps,
            "requires": plan.max_risk().unwrap_or(Risk::Safe),
            "hints": plan.hints,
        }))
    }

    async fn apply_json(&self, change: SchemaChange) -> Result<Value, ApiError> {
        let _guard = self.lock.lock().await;
        let candidate = match self.candidate(change)? {
            Ok(candidate) => candidate,
            Err(errors) => {
                return Err(ApiError::BadRequest(format!("the schema is invalid: {}", errors)));
            }
        };
        let desired = verdin_migrate::derive_model(&candidate.schema);
        // Migrate first: if it fails, the files and the running app stay as they were.
        let report = verdin_migrate::apply(
            &self.context.db,
            &desired,
            &candidate.renames,
            ApplyOptions { allow: candidate.allow },
        )
        .await
        .map_err(migrate_error)?;
        for (path, contents) in &candidate.files {
            write_file(path, contents.as_deref()).map_err(|error| {
                ApiError::Internal(format!("writing {}: {error}", path.display()))
            })?;
        }
        self.host.upgrade().expect("the editor lives inside its host").set_schema(candidate.schema);
        tracing::info!(
            steps = report.applied_steps,
            files = candidate.files.len(),
            "schema updated and app reloaded"
        );
        Ok(json!({ "appliedSteps": report.applied_steps, "files": candidate.files.len() }))
    }
}

impl DevSchemaEditor {
    /// Applies the schema files as they are on disk, when they changed.
    async fn reload_from_disk(&self) {
        let _guard = self.lock.lock().await;
        let schema = match Schema::load_dir(&self.context.schema_dir()) {
            Ok(schema) => schema,
            Err(errors) => {
                tracing::warn!(%errors, "schema files are invalid; keeping the running app");
                return;
            }
        };
        let Some(host) = self.host.upgrade() else { return };
        if *host.schema.lock().expect("schema lock") == schema {
            return;
        }
        let desired = verdin_migrate::derive_model(&schema);
        match verdin_migrate::apply(
            &self.context.db,
            &desired,
            &Renames::default(),
            ApplyOptions::default(),
        )
        .await
        {
            Ok(report) => {
                host.set_schema(schema);
                tracing::info!(steps = report.applied_steps, "schema files changed; app reloaded");
            }
            Err(error) => tracing::warn!(
                %error,
                "schema files changed but need a migration that is not safe; run `verdin migrate plan`"
            ),
        }
    }
}

impl SchemaEditor for DevSchemaEditor {
    fn sources(&self) -> BoxFuture<'_, Result<Value, ApiError>> {
        Box::pin(async move { Ok(self.sources_json()) })
    }

    fn plan(&self, change: SchemaChange) -> BoxFuture<'_, Result<Value, ApiError>> {
        Box::pin(self.plan_json(change))
    }

    fn apply(&self, change: SchemaChange) -> BoxFuture<'_, Result<Value, ApiError>> {
        Box::pin(self.apply_json(change))
    }
}

fn migrate_error(error: MigrateError) -> ApiError {
    match error {
        MigrateError::NeedsApproval { .. }
        | MigrateError::PrecheckFailed { .. }
        | MigrateError::InvalidRename(_)
        | MigrateError::StepFailed { .. }
        | MigrateError::InterruptedPlanMismatch { .. } => ApiError::BadRequest(error.to_string()),
        other => ApiError::Internal(other.to_string()),
    }
}

fn pretty(value: &Value) -> String {
    let mut text = serde_json::to_string_pretty(value).expect("JSON serializes");
    text.push('\n');
    text
}

/// Writes atomically (temporary file + rename), or deletes.
fn write_file(path: &Path, contents: Option<&str>) -> std::io::Result<()> {
    match contents {
        Some(contents) => {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let temporary = path.with_extension("json.tmp");
            std::fs::write(&temporary, contents)?;
            std::fs::rename(&temporary, path)
        }
        None => match std::fs::remove_file(path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            other => other,
        },
    }
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use serde_json::json;

    use super::*;

    async fn context(root: &Path) -> Arc<AppContext> {
        let db = Database::connect("sqlite::memory:", &verdin_db::ConnectOptions::default())
            .await
            .unwrap();
        let schema = Schema::default();
        verdin_migrate::apply(
            &db,
            &verdin_migrate::derive_model(&schema),
            &Renames::default(),
            ApplyOptions::default(),
        )
        .await
        .unwrap();
        let auth = AuthService::new(
            db.clone(),
            verdin_auth::AuthConfig::new(
                "test-secret-test-secret-test-secret!",
                "test-pepper-test-pepper-test-pepper!",
            )
            .unwrap(),
        );
        auth.bootstrap().await.unwrap();
        let config = Config::default();
        let storage = verdin_upload::Storage::new(&config.upload.provider, root).unwrap();
        let upload = verdin_upload::UploadService::new(db.clone(), storage, config.upload.clone());
        Arc::new(AppContext {
            config,
            root: root.to_owned(),
            db,
            auth,
            mode: Mode::Production,
            upload,
        })
    }

    async fn status(host: &AppHost, uri: &str) -> StatusCode {
        let router = Router::clone(&host.current.load());
        router
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap()
            .status()
    }

    #[tokio::test]
    async fn features_switch_routes_live_and_persist() {
        let dir = tempfile::tempdir().unwrap();
        let context = context(dir.path()).await;
        let host = AppHost::new(context.clone(), Schema::default(), FeatureStates::default());

        // Default: the document is for API tokens only, no public reference.
        assert_eq!(status(&host, "/api/_openapi.json").await, StatusCode::FORBIDDEN);
        assert_eq!(status(&host, "/api/docs").await, StatusCode::NOT_FOUND);

        let public = FeatureState { enabled: true, settings: json!({ "public": true }) };
        host.update(OPENAPI.into(), public).await.unwrap();
        assert_eq!(status(&host, "/api/_openapi.json").await, StatusCode::OK);
        assert_eq!(status(&host, "/api/docs").await, StatusCode::OK);
        assert_eq!(status(&host, "/api/docs/scalar.js").await, StatusCode::OK);

        let off = FeatureState { enabled: false, settings: serde_json::Value::Null };
        host.update(OPENAPI.into(), off).await.unwrap();
        assert_eq!(status(&host, "/api/_openapi.json").await, StatusCode::NOT_FOUND);
        assert_eq!(status(&host, "/api/docs").await, StatusCode::NOT_FOUND);

        // Stored for the next start.
        let stored = load_features(&context.db).await.unwrap();
        assert!(!stored.enabled(OPENAPI));
        assert_eq!(stored, host.states());
    }
}
