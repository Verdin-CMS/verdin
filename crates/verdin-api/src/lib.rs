//! Content API (REST, Strapi v5 compatible) and its OpenAPI description
//! (docs/architecture.md §12).

mod error;
mod handlers;
mod openapi;

use std::collections::HashMap;
use std::sync::Arc;

use axum::Router;
use axum::routing::{get, post};
use verdin_content::{DocumentService, OutputOptions, Registry};
use verdin_db::Database;
use verdin_query::Limits;
use verdin_schema::ContentTypeKind;

pub use error::ApiError;

#[derive(Debug, Clone, Copy, Default)]
pub struct ApiConfig {
    pub limits: Limits,
    pub output: OutputOptions,
    /// Temporary switch until permissions land (M4): without it every content API request
    /// is rejected with 403.
    pub open_access: bool,
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
    routes: Arc<HashMap<String, Route>>,
    config: ApiConfig,
    openapi: Arc<serde_json::Value>,
}

/// Routes to be nested under the API prefix (e.g. `/api`).
pub fn router(db: Database, registry: Registry, config: ApiConfig, prefix: &str) -> Router {
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
