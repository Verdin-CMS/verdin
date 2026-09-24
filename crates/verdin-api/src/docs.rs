//! Interactive API reference (Scalar) at `{prefix}/docs`, over the OpenAPI document.
//! The Scalar bundle is embedded: no CDN, fonts or telemetry, and a strict CSP that
//! allows only the page's own inline bootstrap script, by hash.

use axum::Router;
use axum::http::{HeaderValue, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use base64::Engine;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::ApiState;

pub(crate) fn routes(prefix: &str) -> Router<ApiState> {
    let script = format!("{prefix}/docs/scalar.js");
    let config = json!({
        "url": format!("{prefix}/_openapi.json"),
        "withDefaultFonts": false,
        "agent": { "disabled": true },
        "mcp": { "disabled": true },
        "showDeveloperTools": "never",
        "telemetry": false,
        "metaData": { "title": "Verdin API" },
        "defaultOpenAllTags": false,
    });
    let html = scalar_api_reference::scalar_html(&config, Some(&script))
        .replace("<title>Scalar API Reference</title>", "<title>Verdin API</title>");
    let csp = HeaderValue::from_str(&csp(&html)).expect("CSP is a valid header");
    let page = move || {
        let (html, csp) = (html.clone(), csp.clone());
        async move {
            let mut response = Html(html).into_response();
            secure(&mut response, csp);
            response
        }
    };
    Router::new().route("/docs", get(page)).route("/docs/scalar.js", get(bundle))
}

async fn bundle() -> Response {
    match scalar_api_reference::get_asset("scalar.js") {
        Some(bytes) => {
            let mut response = bytes.into_response();
            let headers = response.headers_mut();
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/javascript"));
            headers
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=86400"));
            headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
            response
        }
        None => axum::http::StatusCode::NOT_FOUND.into_response(),
    }
}

fn secure(response: &mut Response, csp: HeaderValue) {
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_SECURITY_POLICY, csp);
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
}

/// Allows the page's inline scripts by their hashes, and nothing else inline.
fn csp(html: &str) -> String {
    let mut hashes = String::new();
    let mut rest = html;
    while let Some(start) = rest.find("<script>") {
        let body = &rest[start + "<script>".len()..];
        let Some(end) = body.find("</script>") else { break };
        let digest = Sha256::digest(&body.as_bytes()[..end]);
        let encoded = base64::engine::general_purpose::STANDARD.encode(digest);
        hashes.push_str(&format!(" 'sha256-{encoded}'"));
        rest = &body[end..];
    }
    format!(
        "default-src 'none'; script-src 'self'{hashes}; style-src 'self' 'unsafe-inline'; \
         img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; \
         worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_inline_scripts_only() {
        let html = "<script src=\"/a.js\"></script><script>go()</script>";
        let policy = csp(html);
        let expected = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(b"go()"));
        assert!(policy.contains(&format!("script-src 'self' 'sha256-{expected}';")), "{policy}");
        assert!(!policy.contains("unsafe-eval"));
    }
}
