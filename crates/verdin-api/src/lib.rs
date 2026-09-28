//! Content API (REST, Strapi v5 compatible), its OpenAPI description, and the admin API
//! (docs/architecture.md §12–§14).

mod admin;
pub mod ai;
pub mod audit;
pub mod cache;
pub mod cdn;
pub mod comments;
pub mod deploy;
pub mod digest;
mod docs;
pub mod end_users;
mod error;
pub mod features;
mod handlers;
pub mod history;
pub mod i18n;
mod limiter;
pub mod mcp;
mod openapi;
pub mod plugins;
pub mod preview;
pub mod realtime;
mod realtime_routes;
pub mod releases;
pub mod review;
pub mod sso;
pub mod stega;
mod upload;
pub mod webhooks;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::routing::{get, post};
use verdin_auth::AuthService;
use verdin_content::{DocumentService, OutputOptions, Registry};
use verdin_db::Database;
use verdin_query::Limits;
use verdin_schema::ContentTypeKind;

pub use admin::{AdminConfig, BoxFuture, SchemaChange, SchemaEditor};
pub use error::ApiError;
pub use history::History;
pub use webhooks::{WebhookOptions, Webhooks};

#[derive(Debug, Clone, Copy)]
pub struct ApiConfig {
    pub limits: Limits,
    pub output: OutputOptions,
    pub http: HttpLimits,
    /// Serve `/_openapi.json` (the `openapi` feature).
    pub openapi: bool,
    /// The document is readable without a token, and the interactive reference is served
    /// at `/docs`. Otherwise only API tokens read the document.
    pub openapi_public: bool,
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            limits: Limits::default(),
            output: OutputOptions::default(),
            http: HttpLimits::default(),
            openapi: true,
            openapi_public: false,
        }
    }
}

/// Body size and time limits of regular API requests (uploads have their own).
#[derive(Debug, Clone, Copy)]
pub struct HttpLimits {
    pub body_limit: usize,
    pub request_timeout: Duration,
}

impl Default for HttpLimits {
    fn default() -> Self {
        Self { body_limit: 1024 * 1024, request_timeout: Duration::from_secs(30) }
    }
}

impl HttpLimits {
    fn apply<S: Clone + Send + Sync + 'static>(self, router: Router<S>) -> Router<S> {
        router.layer(tower_http::limit::RequestBodyLimitLayer::new(self.body_limit)).layer(
            tower_http::timeout::TimeoutLayer::with_status_code(
                axum::http::StatusCode::REQUEST_TIMEOUT,
                self.request_timeout,
            ),
        )
    }
}

/// How a URL segment maps to a content type.
#[derive(Debug, Clone)]
struct Route {
    uid: String,
    single: bool,
}

#[derive(Clone)]
pub(crate) struct ApiState {
    service: DocumentService,
    auth: AuthService,
    routes: Arc<HashMap<String, Route>>,
    config: ApiConfig,
    openapi: Arc<serde_json::Value>,
    upload: Option<verdin_upload::UploadService>,
}

/// The listener every Document Service serving admins' data should carry ("seen" marks).
pub fn engagement_listener(db: Database) -> Arc<dyn verdin_content::events::DocumentListener> {
    Arc::new(admin::engagement::EngagementListener::new(db))
}

/// Listeners every Document Service carries besides "seen" marks (webhooks, history).
pub type Listeners = Vec<Arc<dyn verdin_content::events::DocumentListener>>;

/// A Document Service with the platform's listeners: every API writing content should
/// use one.
pub fn document_service(
    db: Database,
    registry: Registry,
    output: OutputOptions,
    listeners: &Listeners,
    locales: &verdin_content::locales::Locales,
    plugins: Option<&verdin_plugins::Plugins>,
    review: Option<&review::Review>,
) -> DocumentService {
    let mut service = listeners.iter().fold(
        DocumentService::new(db.clone(), registry, output)
            .with_locales(locales.clone())
            .with_listener(engagement_listener(db)),
        |service, listener| service.with_listener(listener.clone()),
    );
    // Review stages first: a refused publication does not reach plugins.
    if let Some(review) = review {
        service = service.with_listener(review.listener()).with_hook(review.hook());
    }
    match plugins {
        Some(plugins) => service.with_hook(Arc::new(plugins.clone())),
        None => service,
    }
}

/// What the content API is built with besides its configuration.
#[derive(Clone, Default)]
pub struct ContentServices {
    pub upload: Option<verdin_upload::UploadService>,
    /// Webhooks, history…: see [`document_service`].
    pub listeners: Listeners,
    pub locales: verdin_content::locales::Locales,
    /// End users' routes (the `users` feature).
    pub users: Option<end_users::Users>,
    pub traffic: cache::TrafficConfig,
    /// Anonymous reads cache; its listener must be among `listeners` (and the media
    /// library's) so that changes empty it.
    pub cache: Option<cache::ResponseCache>,
    /// Plugins: before-write hooks, routes under `/plugins/{name}` and their content host
    /// (their after-write hooks must be among `listeners`).
    pub plugins: Option<verdin_plugins::Plugins>,
    /// Review workflows: stages of new entries, and the publish stage.
    pub review: Option<review::Review>,
    /// `GET /_events` (the `realtime` feature).
    pub realtime: Option<realtime::Realtime>,
    /// The admin panel's URL (`https://cms.example.com/admin`), for visual editing's
    /// source maps; `None` turns them off.
    pub admin_url: Option<String>,
}

/// Content API routes, to be nested under the API prefix (e.g. `/api`).
pub fn router(
    db: Database,
    registry: Registry,
    auth: AuthService,
    config: ApiConfig,
    prefix: &str,
    services: ContentServices,
) -> Router {
    let ContentServices {
        upload,
        listeners,
        locales,
        users,
        traffic,
        cache,
        plugins,
        review,
        realtime,
        admin_url,
    } = services;
    let auth_for_events = auth.clone();
    let (listeners, locales) = (&listeners, &locales);
    let routes = registry
        .types()
        .map(|model| {
            let content_type = &model.content_type;
            let single = content_type.kind == ContentTypeKind::SingleType;
            let name = if single { &content_type.singular_name } else { &content_type.plural_name };
            (name.clone(), Route { uid: content_type.uid.clone(), single })
        })
        .collect();
    let registry_schema = registry.schema.clone();
    let stega_routes: HashMap<String, String> = registry
        .types()
        .map(|model| {
            let content_type = &model.content_type;
            let single = content_type.kind == ContentTypeKind::SingleType;
            let name = if single { &content_type.singular_name } else { &content_type.plural_name };
            (name.clone(), content_type.uid.clone())
        })
        .collect();
    let tag_names: HashMap<String, String> = registry
        .types()
        .map(|model| {
            let content_type = &model.content_type;
            let single = content_type.kind == ContentTypeKind::SingleType;
            let name = if single { &content_type.singular_name } else { &content_type.plural_name };
            (name.clone(), content_type.singular_name.clone())
        })
        .collect();
    let openapi = openapi::document(&registry, prefix);
    let auth_for_plugins = auth.clone();
    let state = ApiState {
        service: document_service(
            db,
            registry,
            config.output,
            listeners,
            locales,
            plugins.as_ref(),
            review.as_ref(),
        ),
        auth,
        routes: Arc::new(routes),
        config,
        openapi: Arc::new(openapi),
        upload,
    };
    if let Some(plugins) = &plugins {
        plugins.set_host(plugins::content_host(&state.service, config.limits));
    }

    let uploads = upload::content_routes(state.upload.as_ref());
    let mut regular = Router::new();
    if config.openapi {
        regular = regular.route("/_openapi.json", get(handlers::openapi));
        if config.openapi_public {
            regular = regular.merge(docs::routes(prefix));
        }
    }
    let regular = regular
        .route(
            "/{name}",
            get(handlers::root_get)
                .post(handlers::root_post)
                .put(handlers::root_put)
                .delete(handlers::root_delete),
        )
        .route(
            "/{name}/{document_id}",
            get(handlers::document_get)
                .put(handlers::document_put)
                .delete(handlers::document_delete),
        )
        .route("/{name}/{document_id}/actions/{action}", post(handlers::document_action))
        .layer(axum::middleware::from_fn_with_state(Arc::new(tag_names), cdn::tag_responses))
        .layer(axum::middleware::from_fn_with_state(
            Arc::new(StegaState { schema: registry_schema, routes: stega_routes, admin_url }),
            mark_text,
        ));
    let router =
        config.http.apply(regular).merge(uploads).fallback(handlers::not_found).with_state(state);
    let router = match users {
        Some(users) => router.merge(config.http.apply(end_users::routes(users))),
        None => router,
    };
    let router = match plugins {
        Some(plugins) => {
            router.merge(config.http.apply(plugins::routes(plugins, auth_for_plugins)))
        }
        None => router,
    };
    let router = router.layer(axum::middleware::from_fn_with_state(
        cache::Traffic::new(traffic, cache),
        cache::middleware,
    ));
    // Streams: no request timeout, no cache.
    match realtime {
        Some(realtime) => router.merge(realtime_routes::content(realtime, auth_for_events)),
        None => router,
    }
}

/// Admin API routes, to be nested under `{admin.path}/api` (e.g. `/admin/api`).
pub fn admin_router(
    db: Database,
    registry: Registry,
    auth: AuthService,
    config: AdminConfig,
) -> Router {
    admin::router(db, registry, auth, config)
}

struct StegaState {
    schema: Arc<verdin_schema::Schema>,
    /// Route name → content type uid.
    routes: HashMap<String, String>,
    admin_url: Option<String>,
}

/// Visual editing: authenticated reads that ask for it get source maps in their text.
async fn mark_text(
    axum::extract::State(state): axum::extract::State<Arc<StegaState>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let headers = request.headers();
    let asked = headers
        .get(stega::HEADER)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| matches!(value, "true" | "1"));
    let authenticated = headers.contains_key(axum::http::header::AUTHORIZATION)
        || headers.contains_key("x-verdin-preview");
    let uid = request
        .uri()
        .path()
        .trim_start_matches('/')
        .split('/')
        .next()
        .and_then(|name| state.routes.get(name))
        .cloned();
    let reading = request.method() == axum::http::Method::GET;
    let response = next.run(request).await;
    let (Some(admin), Some(uid), true, true, true) =
        (&state.admin_url, uid, asked, authenticated, reading)
    else {
        return response;
    };
    if !response.status().is_success() {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, usize::MAX).await else {
        return axum::response::IntoResponse::into_response(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        );
    };
    let Ok(mut json) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return axum::response::Response::from_parts(parts, axum::body::Body::from(bytes));
    };
    if let Some(data) = json.get_mut("data") {
        stega::mark_response(&state.schema, &uid, data, admin.trim_end_matches('/'));
    }
    parts.headers.remove(axum::http::header::CONTENT_LENGTH);
    parts.headers.insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("private, no-store"),
    );
    axum::response::Response::from_parts(parts, axum::body::Body::from(json.to_string()))
}
