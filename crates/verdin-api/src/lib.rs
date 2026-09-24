//! Content API (REST, Strapi v5 compatible), its OpenAPI description, and the admin API
//! (docs/architecture.md §12–§14).

mod admin;
mod error;
mod handlers;
mod limiter;
mod openapi;

use std::collections::HashMap;
use std::sync::Arc;

use axum::Router;
use axum::routing::{get, post};
use verdin_auth::AuthService;
use verdin_content::{DocumentService, OutputOptions, Registry};
use verdin_db::Database;
use verdin_query::Limits;
use verdin_schema::ContentTypeKind;

pub use admin::{AdminConfig, BoxFuture, SchemaChange, SchemaEditor};
pub use error::ApiError;

#[derive(Debug, Clone, Copy, Default)]
pub struct ApiConfig {
    pub limits: Limits,
    pub output: OutputOptions,
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
}

/// Content API routes, to be nested under the API prefix (e.g. `/api`).
pub fn router(
    db: Database,
    registry: Registry,
    auth: AuthService,
    config: ApiConfig,
    prefix: &str,
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
        service: DocumentService::new(db, registry, config.output),
        auth,
        routes: Arc::new(routes),
        config,
        openapi: Arc::new(openapi),
    };

    Router::new()
        .route("/_openapi.json", get(handlers::openapi))
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
        .fallback(handlers::not_found)
        .with_state(state)
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
