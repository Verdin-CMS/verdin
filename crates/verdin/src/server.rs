use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{Value, json};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use verdin_db::Database;

use crate::config::ServerConfig;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
}

pub fn router(state: AppState, config: &ServerConfig) -> Router {
    Router::new()
        .route("/_health", get(health))
        .route("/_ready", get(ready))
        .with_state(state)
        // Layers run bottom-up on requests: the request id is set before tracing sees it.
        .layer(RequestBodyLimitLayer::new(config.body_limit))
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, config.request_timeout()))
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(TraceLayer::new_for_http().make_span_with(|request: &Request| {
            let request_id = request
                .headers()
                .get("x-request-id")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            tracing::info_span!("request", method = %request.method(), uri = %request.uri(), request_id)
        }))
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
}

/// Liveness: the process is up and serving HTTP.
async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

/// Readiness: the database answers. Pending-migration checks join in M1.
async fn ready(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match state.db.ping().await {
        Ok(()) => (
            StatusCode::OK,
            Json(json!({ "status": "ready", "database": state.db.flavor().as_str() })),
        ),
        Err(error) => {
            tracing::warn!(%error, "readiness check failed");
            (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "status": "unavailable" })))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    use verdin_db::ConnectOptions;

    async fn app() -> (Router, Database) {
        let db = Database::connect("sqlite::memory:", &ConnectOptions::default()).await.unwrap();
        (router(AppState { db: db.clone() }, &ServerConfig::default()), db)
    }

    async fn get_json(app: Router, uri: &str) -> (StatusCode, Option<String>, Value) {
        let response = app.oneshot(Request::get(uri).body(Body::empty()).unwrap()).await.unwrap();
        let status = response.status();
        let request_id =
            response.headers().get("x-request-id").map(|value| value.to_str().unwrap().to_owned());
        let body = response.into_body().collect().await.unwrap().to_bytes();
        (status, request_id, serde_json::from_slice(&body).unwrap())
    }

    #[tokio::test]
    async fn health_is_ok_and_has_request_id() {
        let (app, _db) = app().await;
        let (status, request_id, body) = get_json(app, "/_health").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({ "status": "ok" }));
        assert!(request_id.is_some_and(|id| !id.is_empty()));
    }

    #[tokio::test]
    async fn ready_reports_database() {
        let (app, _db) = app().await;
        let (status, _, body) = get_json(app, "/_ready").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({ "status": "ready", "database": "sqlite" }));
    }

    #[tokio::test]
    async fn ready_fails_when_database_is_closed() {
        let (app, db) = app().await;
        db.close().await;
        let (status, _, body) = get_json(app, "/_ready").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body, json!({ "status": "unavailable" }));
    }

    #[tokio::test]
    async fn keeps_incoming_request_id() {
        let (app, _db) = app().await;
        let request =
            Request::get("/_health").header("x-request-id", "abc-123").body(Body::empty()).unwrap();
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.headers()["x-request-id"], "abc-123");
    }
}
