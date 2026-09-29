use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{Value, json};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::trace::TraceLayer;
use verdin_db::Database;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
}

/// Health endpoints plus the given routers nested at their paths, behind shared layers.
pub fn router(state: AppState, nested: &[(String, Router)]) -> Router {
    let mut router =
        Router::new().route("/_health", get(health)).route("/_ready", get(ready)).with_state(state);
    for (path, nested_router) in nested {
        router = router.nest(path, nested_router.clone());
    }
    router
        // Layers run bottom-up on requests: the request id is set before tracing sees it.
        // Body limits and timeouts are applied by the API routers (uploads have their own).
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(TraceLayer::new_for_http().make_span_with(|request: &Request| {
            let request_id = request
                .headers()
                .get("x-request-id")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            tracing::info_span!("request", method = %request.method(), uri = %loggable_uri(request.uri()), request_id)
        }))
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
}

/// CORS for the content API and GraphQL (`[api].cors_origins`); `None` without origins.
pub fn cors(origins: &[String]) -> Result<Option<CorsLayer>, String> {
    use axum::http::{HeaderValue, Method, header};
    if origins.is_empty() {
        return Ok(None);
    }
    let allow = if origins.iter().any(|origin| origin == "*") {
        if origins.len() > 1 {
            return Err("`*` cannot be combined with other origins".into());
        }
        AllowOrigin::any()
    } else {
        let mut list = Vec::with_capacity(origins.len());
        for origin in origins {
            let valid = (origin.starts_with("https://") || origin.starts_with("http://"))
                && !origin.ends_with('/')
                && origin
                    .split_once("://")
                    .is_some_and(|(_, rest)| !rest.is_empty() && !rest.contains('/'));
            let value = HeaderValue::from_str(origin).ok().filter(|_| valid).ok_or_else(|| {
                format!("`{origin}` is not an origin (scheme://host[:port], no path)")
            })?;
            list.push(value);
        }
        AllowOrigin::list(list)
    };
    Ok(Some(
        CorsLayer::new()
            .allow_origin(allow)
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
            .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::IF_NONE_MATCH])
            .expose_headers([header::ETAG])
            .max_age(std::time::Duration::from_secs(3600)),
    ))
}

/// The URI with the values of secret-looking query parameters (tokens, codes…) hidden.
fn loggable_uri(uri: &axum::http::Uri) -> String {
    // Deploy callbacks carry their secret in the path.
    let path = match uri.path().split_once("/deploy/callback/") {
        Some((before, rest)) => {
            let id = rest.split('/').next().unwrap_or_default();
            format!("{before}/deploy/callback/{id}/[hidden]")
        }
        None => uri.path().to_owned(),
    };
    let Some(query) = uri.query() else { return path };
    const SECRET: &[&str] =
        &["token", "secret", "code", "state", "password", "key", "signature", "jwt", "ticket"];
    let parts: Vec<String> = query
        .split('&')
        .map(|pair| match pair.split_once('=') {
            Some((name, _))
                if SECRET.iter().any(|word| name.to_ascii_lowercase().contains(word)) =>
            {
                format!("{name}=[hidden]")
            }
            _ => pair.to_owned(),
        })
        .collect();
    format!("{path}?{}", parts.join("&"))
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

    #[test]
    fn hides_secrets_in_logged_uris() {
        let uri = |text: &str| loggable_uri(&text.parse().unwrap());
        assert_eq!(
            uri("/api/connect/github/callback?code=abc&state=xyz&page=2"),
            "/api/connect/github/callback?code=[hidden]&state=[hidden]&page=2"
        );
        assert_eq!(
            uri("/admin/api/deploy/callback/3/s3cr3t"),
            "/admin/api/deploy/callback/3/[hidden]"
        );
        assert_eq!(uri("/api/articles?sort=title"), "/api/articles?sort=title");
    }

    #[tokio::test]
    async fn cors_allows_listed_origins() {
        assert!(cors(&[]).unwrap().is_none());
        for bad in ["www.example.com", "https://www.example.com/", "https://x.dev/path"] {
            assert!(cors(&[bad.into()]).is_err(), "{bad}");
        }
        assert!(cors(&["*".into(), "https://a.dev".into()]).is_err());
        let layer = cors(&["https://www.example.com".into()]).unwrap().unwrap();
        let app = Router::new().route("/articles", get(|| async { "ok" })).layer(layer);
        let preflight = |origin: &str| {
            Request::builder()
                .method("OPTIONS")
                .uri("/articles")
                .header("origin", origin)
                .header("access-control-request-method", "GET")
                .header("access-control-request-headers", "authorization")
                .body(Body::empty())
                .unwrap()
        };
        let allowed = app.clone().oneshot(preflight("https://www.example.com")).await.unwrap();
        assert_eq!(allowed.headers()["access-control-allow-origin"], "https://www.example.com");
        let refused = app.oneshot(preflight("https://evil.example")).await.unwrap();
        assert!(refused.headers().get("access-control-allow-origin").is_none());
    }

    async fn app() -> (Router, Database) {
        let db = Database::connect("sqlite::memory:", &ConnectOptions::default()).await.unwrap();
        (router(AppState { db: db.clone() }, &[]), db)
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
