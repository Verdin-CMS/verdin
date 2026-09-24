//! Serving the local media library at `/uploads`.
//!
//! Uploaded files share the admin's origin, so nothing in them may run: every response is
//! sandboxed by CSP, sniffing is off, and types a browser would not merely display are
//! served as attachments.

use std::path::PathBuf;

use axum::body::Body;
use axum::http::{HeaderValue, Request, Response, header};
use tower::ServiceExt;
use tower_http::services::ServeDir;

const SANDBOX: &str = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";

pub fn service(
    dir: PathBuf,
) -> impl tower::Service<
    Request<Body>,
    Response = Response<Body>,
    Error = std::convert::Infallible,
    Future = impl Send,
> + Clone
+ Send
+ 'static {
    let files = ServeDir::new(dir).append_index_html_on_directories(false);
    tower::service_fn(move |request: Request<Body>| {
        let files = files.clone();
        async move {
            let response = files.oneshot(request).await.expect("ServeDir is infallible");
            let (mut parts, body) = response.into_parts();
            let headers = &mut parts.headers;
            headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
            headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(SANDBOX));
            if parts.status.is_success() {
                let mime = headers
                    .get(header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or_default()
                    .split(';')
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .to_owned();
                if !verdin_upload::is_inline_safe(&mime) {
                    headers.insert(
                        header::CONTENT_DISPOSITION,
                        HeaderValue::from_static("attachment"),
                    );
                }
                // Names carry a random hash: their content never changes.
                headers.insert(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("public, max-age=31536000, immutable"),
                );
            }
            Ok(Response::from_parts(parts, Body::new(body)))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn get(dir: &std::path::Path, uri: &str) -> Response<Body> {
        let request = Request::builder().uri(uri).body(Body::empty()).unwrap();
        service(dir.to_owned()).oneshot(request).await.unwrap()
    }

    #[tokio::test]
    async fn serves_files_without_letting_them_run() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("page.html"), "<script>alert(1)</script>").unwrap();
        std::fs::write(dir.path().join("photo.png"), [0x89, b'P', b'N', b'G']).unwrap();

        let page = get(dir.path(), "/page.html").await;
        assert_eq!(page.status(), 200);
        assert_eq!(page.headers()[header::CONTENT_DISPOSITION], "attachment");
        assert!(
            page.headers()[header::CONTENT_SECURITY_POLICY]
                .to_str()
                .unwrap()
                .starts_with("sandbox")
        );
        assert_eq!(page.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");

        let photo = get(dir.path(), "/photo.png").await;
        assert!(photo.headers().get(header::CONTENT_DISPOSITION).is_none(), "images show inline");
        assert_eq!(get(dir.path(), "/../secret").await.status(), 404);
        assert_eq!(get(dir.path(), "/").await.status(), 404, "no directory listings");
    }
}
