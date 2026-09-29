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
use verdin_api::features::{
    AUDIT, FeatureHost, FeatureState, FeatureStates, GRAPHQL, HISTORY, OPENAPI, RELEASES, REVIEW,
    USERS, WEBHOOKS,
};
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
    /// The delivery queue; the `webhooks` feature switches it on and off.
    pub webhooks: verdin_api::Webhooks,
    /// Content history; the `history` feature switches recording on and off.
    pub history: verdin_api::History,
    /// Content locales, loaded when serving starts.
    pub locales: verdin_content::locales::Locales,
    /// `[email]`, for end users' confirmations and password resets.
    pub mailer: verdin_email::Mailer,
    /// Anonymous reads cache (`[api].cache_ttl_secs`), emptied on every change.
    pub cache: verdin_api::cache::ResponseCache,
    /// Installed plugins (`[plugins].path`), loaded when serving starts.
    pub plugins: verdin_plugins::Plugins,
    /// Audit logs (`[audit]`); the `audit` feature switches recording.
    pub audit: verdin_api::audit::Audit,
    /// Releases; the scheduler runs while serving.
    pub releases: verdin_api::releases::Releases,
    pub comments: verdin_api::comments::Comments,
    pub deploys: verdin_api::deploy::Deploys,
    /// `[cdn]`: purges on public changes.
    pub cdn: Option<verdin_api::cdn::Cdn>,
    /// `[ai]`: used when the `ai` feature is on.
    pub ai: Option<verdin_api::ai::Ai>,
    /// Redirects, menus and forms.
    pub site: verdin_api::site::Site,
    /// The daily digest of unseen changes (`[digest]`), sent while serving.
    pub digest: verdin_api::digest::Digest,
    /// Review workflows; the `review` feature switches stages and the publish gate.
    pub review: verdin_api::review::Review,
    /// Realtime events (admin always; the content API with the `realtime` feature).
    pub realtime: verdin_api::realtime::Realtime,
    /// `[metrics]`: kept across rebuilds.
    pub metrics: Option<crate::metrics::Metrics>,
    /// `[search]`: the full-text index, kept across rebuilds.
    pub search: Option<verdin_search::Search>,
}

impl AppContext {
    /// Where browsers reach the server (`[server].public_url`).
    pub fn origin(&self) -> String {
        let server = &self.config.server;
        let origin = server
            .public_url
            .clone()
            .unwrap_or_else(|| format!("http://localhost:{}", server.port));
        origin.trim_end_matches('/').to_owned()
    }

    /// Absolute URL of the content API, for links in emails and OAuth callbacks.
    pub fn api_url(&self) -> String {
        format!("{}{}", self.origin(), self.config.api.prefix)
    }
}

/// `VERDIN_SSO_<ID>_SECRET` of the configured SSO providers (read on every rebuild, so a
/// provider added in the panel picks up its secret after a restart with it set).
fn sso_secrets(states: &FeatureStates) -> std::collections::HashMap<String, String> {
    let settings = verdin_api::sso::SsoSettings::parse(states.settings(verdin_api::features::SSO))
        .unwrap_or_default();
    settings
        .providers
        .iter()
        .filter_map(|provider| {
            let secret = std::env::var(verdin_api::sso::secret_variable(&provider.id)).ok()?;
            Some((provider.id.clone(), secret)).filter(|(_, secret)| !secret.is_empty())
        })
        .collect()
}

/// The webhooks service configured for `mode`.
pub fn webhooks(config: &Config, db: Database, mode: Mode) -> verdin_api::Webhooks {
    let settings = &config.webhooks;
    verdin_api::Webhooks::new(
        db,
        verdin_api::WebhookOptions {
            allow_private_networks: settings
                .allow_private_networks
                .unwrap_or(mode == Mode::Development),
            timeout: std::time::Duration::from_secs(settings.timeout_secs.max(1)),
            retention: std::time::Duration::from_secs(settings.retention_days.max(1) * 86_400),
            ..Default::default()
        },
    )
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
    context.realtime.set_draft_types(
        schema
            .content_types
            .values()
            .filter(|content_type| content_type.draft_and_publish)
            .map(|content_type| content_type.uid.clone()),
    );
    let (api, admin) = (&context.config.api, &context.config.admin);
    let registry = verdin_content::Registry::new(schema);
    let registry_for_graphql = registry.clone();
    let registry_for_mcp = registry.clone();
    let registry_for_sitemap = registry.clone();
    let limits = verdin_query::Limits {
        default_page_size: api.default_page_size,
        max_page_size: api.max_page_size,
        ..Default::default()
    };
    let output = verdin_content::OutputOptions { decimal_as_string: api.decimal_as_string };
    let mut listeners: verdin_api::Listeners = vec![
        context.webhooks.listener(),
        context.history.listener(),
        context.cache.listener(),
        Arc::new(context.plugins.clone()),
        context.audit.listener(),
        context.realtime.listener(),
        context.comments.listener(),
    ];
    if let Some(cdn) = &context.cdn {
        listeners.push(cdn.listener());
    }
    if let Some(search) = &context.search {
        listeners.push(search.listener());
        // Rebuilt in the background when the schema changed.
        search.start(
            verdin_content::DocumentService::new(context.db.clone(), registry.clone(), output)
                .with_locales(context.locales.clone()),
        );
    }
    // The `seo` feature: sitemap patterns (checked against this schema).
    let seo = states.enabled(verdin_api::features::SEO).then(|| {
        let service =
            verdin_content::DocumentService::new(context.db.clone(), registry.clone(), output)
                .with_locales(context.locales.clone());
        verdin_api::site::SeoSettings::parse(states.settings(verdin_api::features::SEO), &service)
            .unwrap_or_else(|error| {
                tracing::warn!(
                    ?error,
                    "the SEO settings do not fit the schema; the sitemap is empty"
                );
                Default::default()
            })
    });
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
        verdin_api::ContentServices {
            site: Some(verdin_api::SiteServices {
                site: context.site.clone(),
                seo: seo.clone(),
                redirects: states.enabled(verdin_api::features::REDIRECTS),
                menus: states.enabled(verdin_api::features::MENUS),
                forms: states.enabled(verdin_api::features::FORMS),
                mailer: Some(context.mailer.clone()),
                admin_url: Some(format!(
                    "{}{}",
                    context.origin().trim_end_matches('/'),
                    admin.path
                )),
                ip_key: context.auth.derived_key("form-ip"),
            }),
            admin_url: Some(format!("{}{}", context.origin().trim_end_matches('/'), admin.path)),
            upload: Some(context.upload.clone()),
            listeners: listeners.clone(),
            locales: context.locales.clone(),
            traffic: verdin_api::cache::TrafficConfig {
                public_per_minute: api.public_rate_limit,
                token_per_minute: api.token_rate_limit,
                cache_ttl: std::time::Duration::from_secs(api.cache_ttl_secs),
                cache_entries: api.cache_entries,
            },
            cache: Some(context.cache.clone()),
            plugins: Some(context.plugins.clone()),
            review: states.enabled(REVIEW).then(|| context.review.clone()),
            realtime: states
                .enabled(verdin_api::features::REALTIME)
                .then(|| context.realtime.clone()),
            users: states.enabled(USERS).then(|| {
                let raw = states.settings(USERS);
                let settings = if raw.is_null() {
                    Default::default()
                } else {
                    serde_json::from_value(raw.clone()).unwrap_or_else(|error| {
                        tracing::warn!(%error, "invalid end user settings; using the defaults");
                        Default::default()
                    })
                };
                verdin_api::end_users::Users::new(
                    context.auth.clone(),
                    settings,
                    context.mailer.clone(),
                    context.api_url(),
                    context.api_url().starts_with("https://"),
                )
            }),
        },
    );
    let admin_api = verdin_api::admin_router(
        context.db.clone(),
        registry,
        context.auth.clone(),
        verdin_api::AdminConfig {
            // Outgoing requests follow the webhooks' rule (private networks in `dev`).
            allow_private_urls: context
                .config
                .webhooks
                .allow_private_networks
                .unwrap_or(context.mode == Mode::Development),
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
            webhooks: states.enabled(WEBHOOKS).then(|| context.webhooks.clone()),
            history: states.enabled(HISTORY).then(|| context.history.clone()),
            listeners: listeners.clone(),
            locales: context.locales.clone(),
            mailer: Some(context.mailer.clone()),
            plugins: Some(context.plugins.clone()),
            audit: Some(context.audit.clone()),
            releases: states.enabled(RELEASES).then(|| context.releases.clone()),
            comments: states
                .enabled(verdin_api::features::COMMENTS)
                .then(|| context.comments.clone()),
            deploys: Some(context.deploys.clone()),
            cdn: context.cdn.clone(),
            site: Some(context.site.clone()),
            ai: states.enabled(verdin_api::features::AI).then(|| context.ai.clone()).flatten(),
            review: states.enabled(REVIEW).then(|| context.review.clone()),
            realtime: Some(context.realtime.clone()),
            digest: Some(context.digest.clone()),
            public_url: context.origin(),
            sso_secrets: sso_secrets(states),
        },
    );
    let mut graphql = states.enabled(GRAPHQL).then(|| {
        graphql_router(context, &registry_for_graphql, limits, output, states, &listeners)
    });
    // Validated at startup.
    let mut content_api = content_api;
    if let Ok(Some(cors)) = server::cors(&api.cors_origins) {
        content_api = content_api.layer(cors.clone());
        graphql = graphql.map(|router| router.layer(cors));
    }
    let mut app = server::router(
        AppState { db: context.db.clone() },
        &[(api.prefix.clone(), content_api), (format!("{}/api", admin.path), admin_api)],
    );
    if let Some(graphql) = graphql {
        app = app.merge(graphql);
    }
    if states.enabled(verdin_api::features::MCP) {
        let service = verdin_api::document_service(
            context.db.clone(),
            registry_for_mcp,
            output,
            &listeners,
            &context.locales,
            Some(&context.plugins),
            states.enabled(REVIEW).then_some(&context.review),
        );
        let origins = states.settings(verdin_api::features::MCP)["allowedOrigins"]
            .as_array()
            .map(|origins| origins.iter().filter_map(|o| o.as_str().map(str::to_owned)).collect())
            .unwrap_or_default();
        app = app.merge(verdin_api::mcp::router(
            service,
            context.auth.clone(),
            limits,
            "/mcp",
            origins,
        ));
    }
    if let Some(dir) = context.upload.storage().local_dir() {
        let transforms = uploads::Transforms::new(&context.upload, &context.root);
        app = app.nest_service("/uploads", uploads::service(dir.to_owned(), transforms));
    }
    if let Some(seo) = seo.filter(|seo| !seo.base_url.is_empty()) {
        let service =
            verdin_content::DocumentService::new(context.db.clone(), registry_for_sitemap, output)
                .with_locales(context.locales.clone());
        app = app.merge(verdin_api::sitemap_router(service, seo));
    }
    app = app.merge(plugin_assets(&admin.path, context.plugins.clone()));
    let assets_dir = admin.assets_dir.as_ref().map(|dir| context.root.join(dir));
    if let Some(assets) = admin_ui::Assets::resolve(assets_dir.as_deref()) {
        let media: Vec<String> = context.upload.storage().public_origin().into_iter().collect();
        let frames = preview_origins(states);
        app = app.merge(admin_ui::router(
            assets,
            admin_ui::UiOptions {
                path: &admin.path,
                mode: context.mode.as_str(),
                api_prefix: &api.prefix,
                media_origins: &media,
                frame_origins: &frames,
                branding: admin_ui::Branding::load(&admin.branding, &context.root),
            },
        ));
    }
    if let Some(metrics) = &context.metrics {
        app = app
            .merge(
                Router::new()
                    .route("/_metrics", axum::routing::get(crate::metrics::scrape))
                    .with_state(metrics.clone()),
            )
            .layer(axum::middleware::from_fn_with_state(
                metrics.clone(),
                crate::metrics::middleware,
            ));
    }
    // Outermost: every layer and handler sees the client behind trusted proxies.
    let proxies = verdin_api::client::TrustedProxies::parse(&context.config.server.trusted_proxies)
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "ignoring [server].trusted_proxies");
            Default::default()
        });
    app.layer(axum::middleware::from_fn_with_state(proxies, verdin_api::client::middleware))
}

/// Origins of the preview URL templates (the side-by-side preview frames them).
fn preview_origins(states: &FeatureStates) -> Vec<String> {
    if !states.enabled(verdin_api::features::PREVIEW) {
        return Vec::new();
    }
    let mut origins: Vec<String> = states.settings(verdin_api::features::PREVIEW)["urls"]
        .as_object()
        .into_iter()
        .flat_map(|urls| urls.values())
        .filter_map(Value::as_str)
        .filter_map(origin_of)
        .collect();
    origins.sort();
    origins.dedup();
    origins
}

/// `https://site.example:8080` of `https://site.example:8080/blog/{slug}`; only http(s)
/// origins made of host characters (no placeholders) are kept.
fn origin_of(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    if scheme != "https" && scheme != "http" {
        return None;
    }
    let host = rest.split(['/', '?', '#']).next()?;
    let valid = !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'));
    valid.then(|| format!("{scheme}://{host}"))
}

/// `{admin}/plugins/{name}/…`: the `admin/` files of enabled plugins (their Web
/// Components), served from the same origin so the panel's CSP allows them.
fn plugin_assets(admin_path: &str, plugins: verdin_plugins::Plugins) -> Router {
    use axum::extract::{Path as UrlPath, Request};
    use axum::http::{HeaderValue, StatusCode, header};
    use axum::response::IntoResponse;
    let handler = move |UrlPath((name, file)): UrlPath<(String, String)>, request: Request| {
        let plugins = plugins.clone();
        async move {
            let Some(plugin) = plugins.get(&name).filter(|plugin| plugin.enabled()).cloned() else {
                return StatusCode::NOT_FOUND.into_response();
            };
            let files = tower_http::services::ServeDir::new(plugin.dir.join("admin"));
            let (mut parts, body) = request.into_parts();
            parts.uri = match format!("/{file}").parse() {
                Ok(uri) => uri,
                Err(_) => return StatusCode::NOT_FOUND.into_response(),
            };
            let request = Request::from_parts(parts, body);
            let mut response = tower::ServiceExt::oneshot(files, request)
                .await
                .expect("ServeDir is infallible")
                .into_response();
            let headers = response.headers_mut();
            headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
            response
        }
    };
    Router::new()
        .route(&format!("{admin_path}/plugins/{{name}}/{{*file}}"), axum::routing::get(handler))
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
    context
        .locales
        .set(verdin_api::i18n::load_locales(&context.db).await.context("reading content locales")?);
    context.plugins.apply(
        &verdin_api::plugins::load_states(&context.db).await.context("reading plugin switches")?,
    );
    context.review.reload().await.context("reading review workflows")?;
    context.releases.set_webhooks(context.webhooks.clone());
    context.review.set_enabled(states.enabled(REVIEW));
    let host = AppHost::new(context.clone(), schema, states);
    let deliveries = context.webhooks.spawn();
    let jobs =
        if context.config.plugins.run_jobs { context.plugins.spawn_jobs() } else { Vec::new() };
    let pruning = context.audit.spawn_pruning();
    let session_pruning = {
        let auth = context.auth.clone();
        tokio::spawn(async move {
            loop {
                if let Err(error) = auth.prune_expired().await {
                    tracing::warn!(%error, "session pruning failed");
                }
                tokio::time::sleep(std::time::Duration::from_secs(24 * 3600)).await;
            }
        })
    };
    let sync = (context.config.server.sync_interval_secs > 0).then(|| {
        host.spawn_sync(std::time::Duration::from_secs(context.config.server.sync_interval_secs))
    });
    let scheduler = context.releases.spawn();
    let digest = context.config.digest.enabled.then(|| context.digest.spawn());
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
    deliveries.abort();
    jobs.iter().for_each(tokio::task::JoinHandle::abort);
    pruning.abort();
    session_pruning.abort();
    if let Some(sync) = sync {
        sync.abort();
    }
    scheduler.abort();
    if let Some(digest) = digest {
        digest.abort();
    }
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
    listeners: &verdin_api::Listeners,
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
        disabled: settings
            .get("disabled")
            .and_then(|value| serde_json::from_value(value.clone()).ok())
            .unwrap_or_default(),
    };
    let service = verdin_api::document_service(
        context.db.clone(),
        registry.clone(),
        output,
        listeners,
        &context.locales,
        Some(&context.plugins),
        states.enabled(REVIEW).then_some(&context.review),
    );
    let extra: Vec<verdin_graphql::ExtraField> = context
        .plugins
        .list()
        .iter()
        .flat_map(|plugin| {
            plugin.manifest.graphql.iter().map(|field| {
                let (plugins, name, function) =
                    (context.plugins.clone(), plugin.manifest.name.clone(), field.function.clone());
                verdin_graphql::ExtraField {
                    name: field.name.clone(),
                    mutation: field.mutation,
                    description: field.description.clone(),
                    call: Arc::new(move |input| {
                        let (plugins, name, function) =
                            (plugins.clone(), name.clone(), function.clone());
                        Box::pin(async move {
                            plugins
                                .call(&name, &function, &input)
                                .await
                                .map_err(|error| error.to_string())
                        })
                    }),
                }
            })
        })
        .collect();
    match verdin_graphql::schema_with(service, limits, &options, &extra) {
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
        self.context.webhooks.set_enabled(states.enabled(WEBHOOKS));
        self.context.history.set_enabled(states.enabled(HISTORY));
        self.context.audit.set_enabled(states.enabled(AUDIT));
        self.context.releases.set_enabled(states.enabled(RELEASES));
        self.context.review.set_enabled(states.enabled(REVIEW));
        self.current.store(Arc::new(build_app(&self.context, schema, editor, features, &states)));
    }

    fn set_schema(&self, schema: Schema) {
        *self.schema.lock().expect("schema lock") = schema;
        self.rebuild();
    }

    /// Picks up the settings other instances changed: feature switches (the app is
    /// rebuilt when they differ), plugin switches, locales and review workflows.
    async fn sync(&self) -> Result<()> {
        let _guard = self.lock.lock().await;
        let context = &self.context;
        let states = load_features(&context.db).await?;
        context.plugins.apply(&verdin_api::plugins::load_states(&context.db).await?);
        context.locales.set(verdin_api::i18n::load_locales(&context.db).await?);
        context.review.reload().await?;
        if states != **self.features.load() {
            self.features.store(Arc::new(states));
            self.rebuild();
            tracing::info!("feature switches changed on another instance; app reloaded");
        }
        Ok(())
    }

    fn spawn_sync(self: &Arc<Self>, every: std::time::Duration) -> tokio::task::JoinHandle<()> {
        let host = Arc::downgrade(self);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(every).await;
                let Some(host) = host.upgrade() else { break };
                if let Err(error) = host.sync().await {
                    tracing::warn!(%error, "could not read settings changed by other instances");
                }
            }
        })
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
        let webhooks = webhooks(&config, db.clone(), Mode::Production);
        let history = verdin_api::History::new(db.clone(), config.history.max_versions);
        let db_for_audit = db.clone();
        let db_for_releases = db.clone();
        let auth_for_digest = auth.clone();
        let db_for_review = db.clone();
        Arc::new(AppContext {
            config,
            root: root.to_owned(),
            db,
            auth,
            mode: Mode::Production,
            upload,
            webhooks,
            history,
            locales: Default::default(),
            mailer: verdin_email::Mailer::memory().0,
            cache: verdin_api::cache::ResponseCache::new(std::time::Duration::ZERO, 1),
            plugins: Default::default(),
            audit: verdin_api::audit::Audit::new(
                db_for_audit,
                std::time::Duration::from_secs(86_400),
            ),
            comments: verdin_api::comments::Comments::new(db_for_releases.clone()),
            deploys: verdin_api::deploy::Deploys::new(db_for_releases.clone(), true),
            cdn: None,
            ai: None,
            site: verdin_api::site::Site::new(db_for_releases.clone()),
            releases: verdin_api::releases::Releases::new(db_for_releases),
            review: verdin_api::review::Review::new(db_for_review),
            realtime: verdin_api::realtime::Realtime::new(),
            metrics: None,
            search: None,
            digest: verdin_api::digest::Digest::new(
                auth_for_digest,
                verdin_email::Mailer::memory().0,
                String::new(),
                8,
            ),
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

    #[test]
    fn preview_origins_for_the_frame_policy() {
        assert_eq!(
            origin_of("https://site.example/blog/{slug}").as_deref(),
            Some("https://site.example")
        );
        assert_eq!(
            origin_of("http://localhost:3000?x=1").as_deref(),
            Some("http://localhost:3000")
        );
        assert_eq!(origin_of("https://{tenant}.example/x"), None, "placeholders in the host");
        assert_eq!(origin_of("javascript:alert(1)"), None);
        assert_eq!(origin_of("ftp://files.example/x"), None);
    }

    #[tokio::test]
    async fn instances_pick_up_each_others_switches() {
        let dir = tempfile::tempdir().unwrap();
        let context = context(dir.path()).await;
        let first = AppHost::new(context.clone(), Schema::default(), FeatureStates::default());
        let second = AppHost::new(context.clone(), Schema::default(), FeatureStates::default());

        let public = FeatureState { enabled: true, settings: json!({ "public": true }) };
        first.update(OPENAPI.into(), public).await.unwrap();
        assert_eq!(status(&second, "/api/docs").await, StatusCode::NOT_FOUND, "not yet");
        second.sync().await.unwrap();
        assert_eq!(status(&second, "/api/docs").await, StatusCode::OK);
        assert_eq!(first.states(), second.states());
    }
}
