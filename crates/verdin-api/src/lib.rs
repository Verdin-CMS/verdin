//! Content API (REST, Strapi v5 compatible), its OpenAPI description, and the admin API
//! (docs/architecture.md §12–§14).

mod admin;
mod docs;
mod error;
pub mod features;
mod handlers;
mod limiter;
mod openapi;
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

/// A Document Service with the platform's listeners ("seen" marks, webhooks): every API
/// writing content should use one.
pub fn document_service(
    db: Database,
    registry: Registry,
    output: OutputOptions,
    webhooks: Option<&Webhooks>,
) -> DocumentService {
    let service =
        DocumentService::new(db.clone(), registry, output).with_listener(engagement_listener(db));
    match webhooks {
        Some(webhooks) => service.with_listener(webhooks.listener()),
        None => service,
    }
}

/// Content API routes, to be nested under the API prefix (e.g. `/api`).
pub fn router(
    db: Database,
    registry: Registry,
    auth: AuthService,
    config: ApiConfig,
    prefix: &str,
    upload: Option<verdin_upload::UploadService>,
    webhooks: Option<&Webhooks>,
) -> Router {
    let routes = registry
        .types()
        .map(|model| {
            let content_type = &model.content_type;
            let single = content_type.kind == ContentTypeKind::SingleType;
            let name = if single { &content_type.singular_name } else { &content_type.plural_name };
            (name.clone(), Route { uid: content_type.uid.clone(), single })
        })
        .collect();
    let openapi = openapi::document(&registry, prefix);
    let state = ApiState {
        service: document_service(db, registry, config.output, webhooks),
        auth,
        routes: Arc::new(routes),
        config,
        openapi: Arc::new(openapi),
        upload,
    };

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
        .route("/{name}/{document_id}/actions/{action}", post(handlers::document_action));
    config.http.apply(regular).merge(uploads).fallback(handlers::not_found).with_state(state)
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
