//! Serves the admin panel (Angular build) under `[admin].path`.
//!
//! Files come from the binary (`embed-admin` feature) or from `[admin].assets_dir`.
//! Unknown paths without an extension fall back to `index.html` (client-side routing).
//! `index.html` gets its `<base href>` rewritten and the runtime configuration as a
//! `<meta name="verdin-config">` tag, so no inline script is needed under the strict CSP.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::json;

/// Content-Security-Policy of the admin panel. Angular's critical-CSS inlining is off
/// (it needs inline event handlers), so scripts are same-origin only.
const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
                   img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; \
                   frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

#[cfg(feature = "embed-admin")]
#[derive(rust_embed::RustEmbed)]
#[folder = "../../admin/dist/admin/browser"]
struct Embedded;

#[derive(Debug, Clone)]
pub enum Assets {
    #[cfg(feature = "embed-admin")]
    Embedded,
    Dir(PathBuf),
}

impl Assets {
    /// `[admin].assets_dir` wins; otherwise the embedded build, if compiled in.
    pub fn resolve(assets_dir: Option<&Path>) -> Option<Self> {
        if let Some(dir) = assets_dir {
            return Some(Assets::Dir(dir.to_path_buf()));
        }
        #[cfg(feature = "embed-admin")]
        {
            Some(Assets::Embedded)
        }
        #[cfg(not(feature = "embed-admin"))]
        {
            None
        }
    }

    fn read(&self, path: &str) -> Option<Vec<u8>> {
        if path.split('/').any(|segment| segment == ".." || segment.starts_with('.')) {
            return None;
        }
        match self {
            #[cfg(feature = "embed-admin")]
            Assets::Embedded => Embedded::get(path).map(|file| file.data.into_owned()),
            Assets::Dir(dir) => std::fs::read(dir.join(path)).ok(),
        }
    }
}

#[derive(Clone)]
struct UiState {
    assets: Assets,
    base: String,
    config: Arc<String>,
}

/// Routes for `{path}` and everything below it except the admin API, which is nested
/// separately and matches first.
pub fn router(assets: Assets, path: &str, mode: &str) -> Router {
    let config =
        json!({ "apiBase": format!("{path}/api"), "contentApiBase": "/api", "mode": mode })
            .to_string();
    let state = UiState { assets, base: format!("{path}/"), config: Arc::new(config) };
    let target = format!("{path}/");
    Router::new()
        .route(&format!("{path}/"), get(serve))
        .route(&format!("{path}/{{*file}}"), get(serve))
        .with_state(state)
        .route(path, get(move || async move { axum::response::Redirect::permanent(&target) }))
}

async fn serve(State(state): State<UiState>, uri: Uri) -> Response {
    let relative = uri.path().strip_prefix(state.base.as_str()).unwrap_or_default();
    let is_asset = relative.rsplit('/').next().is_some_and(|name| name.contains('.'));
    if !relative.is_empty() && relative != "index.html" && is_asset {
        return match state.assets.read(relative) {
            Some(bytes) => file_response(relative, bytes),
            None => StatusCode::NOT_FOUND.into_response(),
        };
    }
    let Some(index) = state.assets.read("index.html") else {
        return (StatusCode::NOT_FOUND, "admin panel not built").into_response();
    };
    let html = String::from_utf8_lossy(&index)
        .replacen("<base href=\"/\">", &format!("<base href=\"{}\">", state.base), 1)
        .replacen(
            "</head>",
            &format!(
                "<meta name=\"verdin-config\" content=\"{}\"></head>",
                escape_attribute(&state.config)
            ),
            1,
        );
    let mut response = (StatusCode::OK, html).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    security_headers(headers);
    response
}

fn file_response(path: &str, bytes: Vec<u8>) -> Response {
    let mut response = Response::new(Body::from(bytes));
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime(path)));
    // Angular fingerprints bundle names (`main-ABC123.js`), so they never change.
    let fingerprinted = path
        .rsplit('/')
        .next()
        .is_some_and(|name| name.matches('-').count() >= 1 && name.split('.').count() >= 2);
    let cache = if fingerprinted { "public, max-age=31536000, immutable" } else { "no-cache" };
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    security_headers(headers);
    response
}

fn security_headers(headers: &mut axum::http::HeaderMap) {
    headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
}

fn escape_attribute(value: &str) -> String {
    value.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    async fn get(app: &Router, uri: &str) -> (StatusCode, axum::http::HeaderMap, String) {
        let response = app
            .clone()
            .oneshot(axum::http::Request::get(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        (status, headers, String::from_utf8_lossy(&body).into_owned())
    }

    #[tokio::test]
    async fn serves_spa_with_config_and_headers() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("index.html"),
            "<html><head><base href=\"/\"></head><body></body></html>",
        )
        .unwrap();
        std::fs::write(dir.path().join("main-ABC123.js"), "console.log(1)").unwrap();
        let app = router(Assets::Dir(dir.path().to_path_buf()), "/admin", "development");

        let (status, headers, body) = get(&app, "/admin/content/api::article").await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("<base href=\"/admin/\">"), "{body}");
        assert!(body.contains("name=\"verdin-config\""), "{body}");
        assert!(body.contains("&quot;apiBase&quot;:&quot;/admin/api&quot;"), "{body}");
        assert!(
            headers[header::CONTENT_SECURITY_POLICY]
                .to_str()
                .unwrap()
                .contains("frame-ancestors 'none'")
        );

        let (status, headers, body) = get(&app, "/admin/main-ABC123.js").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "console.log(1)");
        assert!(headers[header::CACHE_CONTROL].to_str().unwrap().contains("immutable"));

        assert_eq!(get(&app, "/admin/missing.js").await.0, StatusCode::NOT_FOUND);
        assert_eq!(get(&app, "/admin/../secret.txt").await.0, StatusCode::NOT_FOUND);
        assert_eq!(get(&app, "/admin").await.0, StatusCode::PERMANENT_REDIRECT);
    }
}
