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
/// (it needs inline event handlers), so scripts are same-origin only. `media` lists extra
/// origins images, video and PDF previews may load from (a remote media library);
/// `frames` the sites the side-by-side preview may show.
fn csp(media: &[String], frames: &[String]) -> String {
    let extra: String = media.iter().map(|origin| format!(" {origin}")).collect();
    let frames: String = frames.iter().map(|origin| format!(" {origin}")).collect();
    format!(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
         img-src 'self' data: blob:{extra}; media-src 'self' blob:{extra}; font-src 'self' data:; \
         connect-src 'self'; frame-src 'self'{extra}{frames}; frame-ancestors 'none'; base-uri 'self'; \
         form-action 'self'; object-src 'none'"
    )
}

/// The admin panel's branding, with its files read (see `[admin.branding]`).
#[derive(Debug, Clone, Default)]
pub struct Branding {
    pub title: Option<String>,
    pub accent: Option<String>,
    pub translations: serde_json::Value,
    pub logo: Option<(Vec<u8>, &'static str)>,
    pub favicon: Option<(Vec<u8>, &'static str)>,
}

impl Branding {
    /// Reads the files of `[admin.branding]` (paths relative to `root`); what cannot be
    /// used is logged and left out.
    pub fn load(config: &crate::config::BrandingConfig, root: &Path) -> Self {
        let file = |path: &Option<PathBuf>, what: &str| {
            let path = path.as_ref()?;
            let full = root.join(path);
            let type_ = mime(&full.to_string_lossy());
            if !type_.starts_with("image/") {
                tracing::warn!(path = %full.display(), "the admin {what} must be an image; ignored");
                return None;
            }
            match std::fs::read(&full) {
                Ok(bytes) => Some((bytes, type_)),
                Err(error) => {
                    tracing::warn!(path = %full.display(), %error, "cannot read the admin {what}; ignored");
                    None
                }
            }
        };
        let accent = config.accent.clone().filter(|color| {
            let valid = color.len() == 7
                && color.starts_with('#')
                && color[1..].chars().all(|c| c.is_ascii_hexdigit());
            if !valid {
                tracing::warn!(%color, "[admin.branding].accent must be #rrggbb; ignored");
            }
            valid
        });
        Self {
            title: config.title.clone().filter(|title| !title.trim().is_empty()),
            accent,
            translations: serde_json::to_value(&config.translations).unwrap_or_default(),
            logo: file(&config.logo, "logo"),
            favicon: file(&config.favicon, "favicon"),
        }
    }
}

/// What the admin panel is served with besides its files.
pub struct UiOptions<'a> {
    pub path: &'a str,
    pub mode: &'a str,
    pub api_prefix: &'a str,
    pub media_origins: &'a [String],
    pub frame_origins: &'a [String],
    pub branding: Branding,
}

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
    csp: Arc<HeaderValue>,
    branding: Arc<Branding>,
}

/// Routes for `{path}` and everything below it except the admin API, which is nested
/// separately and matches first.
pub fn router(assets: Assets, options: UiOptions<'_>) -> Router {
    let UiOptions { path, mode, api_prefix, media_origins, frame_origins, branding } = options;
    let file_url = |file: &Option<(Vec<u8>, &str)>, name: &str| {
        file.as_ref().map(|_| format!("{path}/_branding/{name}"))
    };
    let config = json!({
        "apiBase": format!("{path}/api"),
        "contentApiBase": api_prefix,
        "mode": mode,
        "branding": {
            "title": branding.title,
            "accent": branding.accent,
            "logoUrl": file_url(&branding.logo, "logo"),
            "faviconUrl": file_url(&branding.favicon, "favicon"),
            "translations": branding.translations,
        },
    })
    .to_string();
    let csp =
        HeaderValue::from_str(&csp(media_origins, frame_origins)).expect("origins are header-safe");
    let state = UiState {
        assets,
        base: format!("{path}/"),
        config: Arc::new(config),
        csp: Arc::new(csp),
        branding: Arc::new(branding),
    };
    let target = format!("{path}/");
    Router::new()
        .route(&format!("{path}/_branding/{{name}}"), get(branding_file))
        .route(&format!("{path}/"), get(serve))
        .route(&format!("{path}/{{*file}}"), get(serve))
        .with_state(state)
        .route(path, get(move || async move { axum::response::Redirect::permanent(&target) }))
}

async fn branding_file(
    State(state): State<UiState>,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> Response {
    let file = match name.as_str() {
        "logo" => state.branding.logo.as_ref(),
        "favicon" => state.branding.favicon.as_ref(),
        _ => None,
    };
    let Some((bytes, type_)) = file else { return StatusCode::NOT_FOUND.into_response() };
    let mut response = (StatusCode::OK, bytes.clone()).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(type_));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=300"));
    // SVG logos must not run scripts.
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; sandbox"),
    );
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    response
}

async fn serve(State(state): State<UiState>, uri: Uri) -> Response {
    let relative = uri.path().strip_prefix(state.base.as_str()).unwrap_or_default();
    let is_asset = relative.rsplit('/').next().is_some_and(|name| name.contains('.'));
    if !relative.is_empty() && relative != "index.html" && is_asset {
        return match state.assets.read(relative) {
            Some(bytes) => file_response(relative, bytes, &state.csp),
            None => StatusCode::NOT_FOUND.into_response(),
        };
    }
    let Some(index) = state.assets.read("index.html") else {
        return (StatusCode::NOT_FOUND, "admin panel not built").into_response();
    };
    let mut html = String::from_utf8_lossy(&index).replacen(
        "<base href=\"/\">",
        &format!("<base href=\"{}\">", state.base),
        1,
    );
    if let Some(title) = &state.branding.title {
        html = html.replacen(
            "<title>Verdin</title>",
            &format!("<title>{}</title>", escape_attribute(title)),
            1,
        );
    }
    if let Some((_, type_)) = &state.branding.favicon {
        html = html.replacen(
            "<link rel=\"icon\" type=\"image/x-icon\" href=\"favicon.ico\">",
            &format!("<link rel=\"icon\" type=\"{type_}\" href=\"_branding/favicon\">"),
            1,
        );
    }
    let html = html.replacen(
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
    security_headers(headers, &state.csp);
    response
}

fn file_response(path: &str, bytes: Vec<u8>, csp: &HeaderValue) -> Response {
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
    security_headers(headers, csp);
    response
}

fn security_headers(headers: &mut axum::http::HeaderMap, csp: &HeaderValue) {
    headers.insert(header::CONTENT_SECURITY_POLICY, csp.clone());
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
        let media = vec!["https://media.example.com".to_owned()];
        std::fs::write(dir.path().join("logo.svg"), "<svg/>").unwrap();
        let frames = vec!["https://site.example".to_owned()];
        let branding = Branding::load(
            &crate::config::BrandingConfig {
                title: Some("ACME <CMS>".into()),
                logo: Some("logo.svg".into()),
                accent: Some("#ff6600".into()),
                ..Default::default()
            },
            dir.path(),
        );
        let app = router(
            Assets::Dir(dir.path().to_path_buf()),
            UiOptions {
                path: "/admin",
                mode: "development",
                api_prefix: "/content",
                media_origins: &media,
                frame_origins: &frames,
                branding,
            },
        );

        let (status, headers, body) = get(&app, "/admin/content/api::article").await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("<base href=\"/admin/\">"), "{body}");
        assert!(body.contains("name=\"verdin-config\""), "{body}");
        assert!(body.contains("&quot;apiBase&quot;:&quot;/admin/api&quot;"), "{body}");
        assert!(body.contains("&quot;contentApiBase&quot;:&quot;/content&quot;"), "{body}");
        let csp = headers[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
        assert!(csp.contains("frame-ancestors 'none'"), "{csp}");
        assert!(csp.contains("img-src 'self' data: blob: https://media.example.com;"), "{csp}");
        assert!(csp.contains("media-src 'self' blob: https://media.example.com;"), "{csp}");
        assert!(
            csp.contains("frame-src 'self' https://media.example.com https://site.example;"),
            "{csp}"
        );
        assert!(body.contains("&quot;accent&quot;:&quot;#ff6600&quot;"), "{body}");
        assert!(body.contains("&quot;logoUrl&quot;:&quot;/admin/_branding/logo&quot;"), "{body}");
        let (status, headers, logo) = get(&app, "/admin/_branding/logo").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(logo, "<svg/>");
        assert_eq!(headers[header::CONTENT_TYPE], "image/svg+xml");
        assert!(headers[header::CONTENT_SECURITY_POLICY].to_str().unwrap().contains("sandbox"));
        assert_eq!(get(&app, "/admin/_branding/favicon").await.0, StatusCode::NOT_FOUND);

        let (status, headers, body) = get(&app, "/admin/main-ABC123.js").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "console.log(1)");
        assert!(headers[header::CACHE_CONTROL].to_str().unwrap().contains("immutable"));

        assert_eq!(get(&app, "/admin/missing.js").await.0, StatusCode::NOT_FOUND);
        assert_eq!(get(&app, "/admin/../secret.txt").await.0, StatusCode::NOT_FOUND);
        assert_eq!(get(&app, "/admin").await.0, StatusCode::PERMANENT_REDIRECT);
    }
}
