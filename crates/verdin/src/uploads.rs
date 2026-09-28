//! Serving the local media library at `/uploads`, with image transformations
//! (`?preset=`, or signed `w`/`h`/`fit`/`format`/`q`) rendered once and cached on disk.
//!
//! Uploaded files share the admin's origin, so nothing in them may run: every response is
//! sandboxed by CSP, sniffing is off, and types a browser would not merely display are
//! served as attachments.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::Query;
use axum::http::{HeaderValue, Method, Request, Response, StatusCode, header};
use tokio::sync::Semaphore;
use tower::ServiceExt;
use tower_http::services::ServeDir;
use verdin_upload::UploadService;
use verdin_upload::transform::{self, Refusal, TransformConfig};

/// Image transformations of the local files.
#[derive(Clone)]
pub struct Transforms {
    pub config: Arc<TransformConfig>,
    /// `VERDIN_IMAGE_SECRET`: signs arbitrary parameters.
    pub secret: Option<String>,
    /// Absolute cache directory.
    pub cache_dir: PathBuf,
    /// Focal points (none in tests).
    pub upload: Option<UploadService>,
    pub max_megapixels: u32,
    /// Renders at once (CPU bound).
    pub permits: Arc<Semaphore>,
}

impl Transforms {
    pub fn new(upload: &UploadService, root: &std::path::Path) -> Option<Self> {
        let config = &upload.config().transforms;
        if !config.enabled {
            return None;
        }
        let workers = std::thread::available_parallelism().map_or(2, |n| n.get());
        Some(Self {
            config: Arc::new(config.clone()),
            secret: std::env::var("VERDIN_IMAGE_SECRET").ok().filter(|s| !s.is_empty()),
            cache_dir: root.join(&config.cache_dir),
            upload: Some(upload.clone()),
            max_megapixels: upload.config().max_image_megapixels,
            permits: Arc::new(Semaphore::new(workers)),
        })
    }

    /// A transformed rendering, or `None` when the request asks for none.
    async fn respond(
        &self,
        dir: &std::path::Path,
        method: &Method,
        uri: &axum::http::Uri,
    ) -> Option<Response<Body>> {
        if !matches!(*method, Method::GET | Method::HEAD) {
            return None;
        }
        let query: Vec<(String, String)> =
            Query::try_from_uri(uri).map(|Query(query)| query).unwrap_or_default();
        let name = uri.path().trim_start_matches('/');
        let asked = transform::requested(&self.config, self.secret.as_deref(), name, &query)?;
        let plain = |status: StatusCode, text: String| {
            let mut response = Response::new(Body::from(text));
            *response.status_mut() = status;
            response
        };
        let transform = match asked {
            Ok(transform) => transform,
            Err(Refusal::Invalid(message)) => return Some(plain(StatusCode::BAD_REQUEST, message)),
            Err(Refusal::Unsigned) => {
                return Some(plain(
                    StatusCode::FORBIDDEN,
                    "image parameters need a preset or a signature".into(),
                ));
            }
        };
        // Files sit at the root of the directory, named by their hash.
        let valid_name = !name.is_empty()
            && !name.contains(['/', '\\'])
            && !name.starts_with('.')
            && transform::transformable(name);
        let source = dir.join(name);
        if !valid_name || !tokio::fs::try_exists(&source).await.unwrap_or(false) {
            return Some(plain(StatusCode::NOT_FOUND, "Not Found".into()));
        }
        let cached = transform::cache_path(&self.cache_dir, name, &transform);
        let format = transform::output_format(name, &transform);
        let bytes = match tokio::fs::read(&cached).await {
            Ok(bytes) => bytes,
            Err(_) => {
                let focal = match &self.upload {
                    Some(upload) => upload.focal_point(transform::stem(name)).await.ok().flatten(),
                    None => None,
                };
                let _permit = self.permits.acquire().await.ok()?;
                let max = self.max_megapixels;
                let rendered = tokio::task::spawn_blocking(move || {
                    transform::render(&source, &transform, focal, max)
                })
                .await
                .ok()
                .flatten();
                let Some((bytes, _)) = rendered else {
                    return Some(plain(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "the image cannot be transformed".into(),
                    ));
                };
                if let Some(parent) = cached.parent()
                    && tokio::fs::create_dir_all(parent).await.is_ok()
                {
                    // Written aside, then renamed: readers never see half a file.
                    let partial = cached.with_extension(format!("{}.part", ulid::Ulid::generate()));
                    if tokio::fs::write(&partial, &bytes).await.is_ok() {
                        let _ = tokio::fs::rename(&partial, &cached).await;
                    }
                }
                bytes
            }
        };
        let mut response = Response::new(Body::from(bytes));
        let headers = response.headers_mut();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(format.mime()));
        // The focal point may move: cached for a day, not forever.
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=86400"));
        headers.insert(header::VARY, HeaderValue::from_static("Accept-Encoding"));
        Some(response)
    }
}

/// Drops the cached renderings of a file when it changes (focal point, replaced bytes).
pub fn cache_cleaner(cache_dir: PathBuf) -> Arc<dyn verdin_content::events::FileListener> {
    Arc::new(CacheCleaner { cache_dir })
}

struct CacheCleaner {
    cache_dir: PathBuf,
}

impl verdin_content::events::FileListener for CacheCleaner {
    fn file_changed<'a>(
        &'a self,
        kind: verdin_content::events::FileEventKind,
        file: &'a verdin_content::media::FileRecord,
    ) -> verdin_content::events::BoxFuture<'a, ()> {
        Box::pin(async move {
            if kind != verdin_content::events::FileEventKind::Created
                && !file.hash.is_empty()
                && !file.hash.contains(['/', '\\', '.'])
            {
                let _ = tokio::fs::remove_dir_all(self.cache_dir.join(&file.hash)).await;
            }
        })
    }
}

const SANDBOX: &str = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";

pub fn service(
    dir: PathBuf,
    transforms: Option<Transforms>,
) -> impl tower::Service<
    Request<Body>,
    Response = Response<Body>,
    Error = std::convert::Infallible,
    Future = impl Send,
> + Clone
+ Send
+ 'static {
    let files = ServeDir::new(&dir).append_index_html_on_directories(false);
    let dir = Arc::new(dir);
    tower::service_fn(move |request: Request<Body>| {
        let files = files.clone();
        let transforms = transforms.clone();
        let dir = dir.clone();
        async move {
            let transformed = match &transforms {
                Some(transforms) => {
                    let (method, uri) = (request.method().clone(), request.uri().clone());
                    transforms.respond(&dir, &method, &uri).await
                }
                None => None,
            };
            let response = match transformed {
                Some(response) => response,
                None => {
                    files.oneshot(request).await.expect("ServeDir is infallible").map(Body::new)
                }
            };
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
                if !headers.contains_key(header::CACHE_CONTROL) {
                    headers.insert(
                        header::CACHE_CONTROL,
                        HeaderValue::from_static("public, max-age=31536000, immutable"),
                    );
                }
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
        service(dir.to_owned(), None).oneshot(request).await.unwrap()
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

    #[tokio::test]
    async fn transforms_images_and_caches_them() {
        let dir = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let image = image::RgbImage::from_fn(400, 200, |x, _| image::Rgb([x as u8, 0, 0]));
        image.save(dir.path().join("photo_1.png")).unwrap();
        std::fs::write(dir.path().join("notes.txt"), "text").unwrap();
        let mut config = TransformConfig::default();
        config.presets.insert(
            "thumb".into(),
            transform::Transform { w: Some(50), h: Some(50), ..Default::default() },
        );
        let transforms = Transforms {
            config: Arc::new(config),
            secret: Some("s3cret".into()),
            cache_dir: cache.path().to_owned(),
            upload: None,
            max_megapixels: 10,
            permits: Arc::new(Semaphore::new(1)),
        };
        let get = |uri: String| {
            let request = Request::builder().uri(uri).body(Body::empty()).unwrap();
            service(dir.path().to_owned(), Some(transforms.clone())).oneshot(request)
        };
        let body = |response: Response<Body>| async move {
            axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap()
        };

        let thumb = get("/photo_1.png?preset=thumb".into()).await.unwrap();
        assert_eq!(thumb.status(), 200);
        assert_eq!(thumb.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(thumb.headers()[header::CACHE_CONTROL], "public, max-age=86400");
        assert!(thumb.headers().get(header::CONTENT_SECURITY_POLICY).is_some());
        let bytes = body(thumb).await;
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (50, 50));
        assert_eq!(std::fs::read_dir(cache.path().join("photo_1")).unwrap().count(), 1, "cached");

        let unsigned = get("/photo_1.png?w=100&format=jpeg".into()).await.unwrap();
        assert_eq!(unsigned.status(), 403);
        let wanted = transform::Transform {
            w: Some(100),
            format: Some(transform::OutputFormat::Jpeg),
            ..Default::default()
        };
        let s = transform::sign("s3cret", "photo_1.png", &wanted);
        let signed = get(format!("/photo_1.png?w=100&format=jpeg&s={s}")).await.unwrap();
        assert_eq!(signed.status(), 200);
        assert_eq!(signed.headers()[header::CONTENT_TYPE], "image/jpeg");
        let decoded = image::load_from_memory(&body(signed).await).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (100, 50));

        assert_eq!(get("/photo_1.png?preset=nope".into()).await.unwrap().status(), 400);
        assert_eq!(get("/missing.png?preset=thumb".into()).await.unwrap().status(), 404);
        assert_eq!(get("/notes.txt?preset=thumb".into()).await.unwrap().status(), 404);
        assert_eq!(get("/../x.png?preset=thumb".into()).await.unwrap().status(), 404);
        let original = get("/photo_1.png".into()).await.unwrap();
        assert!(
            original.headers()[header::CACHE_CONTROL].to_str().unwrap().contains("immutable"),
            "originals are untouched"
        );
    }
}
