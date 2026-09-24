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
use verdin_api::{ApiError, BoxFuture, SchemaChange, SchemaEditor};
use verdin_auth::AuthService;
use verdin_db::Database;
use verdin_migrate::{ApplyOptions, MigrateError, Renames, Risk, Status};
use verdin_schema::{Schema, SchemaErrors, Source};

use crate::admin_ui;
use crate::config::Config;
use crate::server::{self, AppState};

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
) -> Router {
    let (api, admin) = (&context.config.api, &context.config.admin);
    let registry = verdin_content::Registry::new(schema);
    let limits = verdin_query::Limits {
        default_page_size: api.default_page_size,
        max_page_size: api.max_page_size,
        ..Default::default()
    };
    let output = verdin_content::OutputOptions { decimal_as_string: api.decimal_as_string };
    let content_api = verdin_api::router(
        context.db.clone(),
        registry.clone(),
        context.auth.clone(),
        verdin_api::ApiConfig { limits, output },
        &api.prefix,
    );
    let admin_api = verdin_api::admin_router(
        context.db.clone(),
        registry,
        context.auth.clone(),
        verdin_api::AdminConfig {
            path: admin.path.clone(),
            secure_cookies: admin.secure_cookies,
            limits,
            output,
            mode: context.mode.as_str(),
            auth_rate_limit: admin.auth_rate_limit,
            schema_editor: editor,
        },
    );
    let mut app = server::router(
        AppState { db: context.db.clone() },
        &context.config.server,
        &[(api.prefix.clone(), content_api), (format!("{}/api", admin.path), admin_api)],
    );
    let assets_dir = admin.assets_dir.as_ref().map(|dir| context.root.join(dir));
    if let Some(assets) = admin_ui::Assets::resolve(assets_dir.as_deref()) {
        app = app.merge(admin_ui::router(assets, &admin.path, context.mode.as_str()));
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

/// Serves until Ctrl+C / SIGTERM. In development mode the app is rebuilt in place when
/// the content-type builder changes the schema.
pub async fn serve(
    context: AppContext,
    schema: Schema,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<()> {
    let context = Arc::new(context);
    let app = match context.mode {
        Mode::Production => build_app(&context, schema, None),
        Mode::Development => {
            let current = Arc::new(ArcSwap::from_pointee(Router::new()));
            let editor = Arc::new_cyclic(|this| DevSchemaEditor {
                this: this.clone(),
                context: context.clone(),
                current: current.clone(),
                lock: tokio::sync::Mutex::new(()),
            });
            current.store(Arc::new(build_app(&context, schema, Some(editor))));
            Router::new().fallback_service(tower::service_fn(move |request| {
                let router = Router::clone(&current.load());
                async move { router.oneshot(request).await }
            }))
        }
    };

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

/// Edits schema files, migrates and hot-swaps the app (`verdin dev` only).
struct DevSchemaEditor {
    this: Weak<DevSchemaEditor>,
    context: Arc<AppContext>,
    current: Arc<ArcSwap<Router>>,
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
        let editor: Arc<dyn SchemaEditor> = self.this.upgrade().expect("editor outlives its app");
        self.current.store(Arc::new(build_app(&self.context, candidate.schema, Some(editor))));
        tracing::info!(
            steps = report.applied_steps,
            files = candidate.files.len(),
            "schema updated and app reloaded"
        );
        Ok(json!({ "appliedSteps": report.applied_steps, "files": candidate.files.len() }))
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
