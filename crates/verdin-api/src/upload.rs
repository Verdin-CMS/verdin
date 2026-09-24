//! Media library over HTTP: multipart parsing shared by both APIs, and the content API's
//! Strapi-compatible upload routes (`/api/upload…`, subject `plugin::upload`).

use std::time::Duration;

use axum::Json;
use axum::Router;
use axum::extract::{DefaultBodyLimit, Multipart, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Deserialize;
use serde_json::{Value, json};
use tempfile::NamedTempFile;
use tokio::io::AsyncWriteExt;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;
use verdin_auth::{AuthError, ContentAction, UPLOAD_SUBJECT};
use verdin_upload::{FileInfo, FileQuery, FileSort, IncomingFile, UploadService};

use crate::ApiState;
use crate::error::ApiError;
use crate::handlers::bearer;

/// Room for multipart framing and `fileInfo` on top of the files themselves.
const MULTIPART_OVERHEAD: u64 = 1024 * 1024;
/// Files per request.
const MAX_FILES: usize = 20;
/// Uploads may take a while on slow links.
pub(crate) const UPLOAD_TIMEOUT: Duration = Duration::from_secs(60 * 60);

/// Body limit and timeout for upload routes (they skip the API's regular limits).
pub(crate) fn upload_layers<S: Clone + Send + Sync + 'static>(
    router: Router<S>,
    service: Option<&UploadService>,
) -> Router<S> {
    let max = service.map_or(0, |service| service.config().max_file_size);
    let limit =
        usize::try_from(max.saturating_mul(MAX_FILES as u64).saturating_add(MULTIPART_OVERHEAD))
            .unwrap_or(usize::MAX);
    router
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(limit))
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, UPLOAD_TIMEOUT))
}

/// Files of a multipart request, streamed to temporary files, with their `fileInfo`.
pub(crate) struct Uploads {
    /// Kept alive until the upload is stored.
    pub files: Vec<(IncomingFile, NamedTempFile)>,
    pub infos: Vec<FileInfo>,
}

impl Uploads {
    /// The `fileInfo` of the file at `index`: its own entry, or the only one given.
    pub fn info(&self, index: usize) -> FileInfo {
        match self.infos.len() {
            0 => FileInfo::default(),
            1 => self.infos[0].clone(),
            _ => self.infos.get(index).cloned().unwrap_or_default(),
        }
    }
}

/// Reads `files` parts (any number) and `fileInfo` (a JSON object, or an array aligned
/// with the files). A `folder` part sets the folder of every file.
pub(crate) async fn read_multipart(
    mut multipart: Multipart,
    service: &UploadService,
) -> Result<Uploads, ApiError> {
    let max = service.config().max_file_size;
    let mut files = Vec::new();
    let mut infos: Vec<FileInfo> = Vec::new();
    let mut folder: Option<Option<i64>> = None;
    let bad = |error: axum::extract::multipart::MultipartError| {
        ApiError::BadRequest(format!("invalid multipart body: {}", error.body_text()))
    };
    while let Some(mut field) = multipart.next_field().await.map_err(bad)? {
        let name = field.name().unwrap_or_default().to_owned();
        if let Some(file_name) = field.file_name().map(str::to_owned) {
            if name != "files" && !name.starts_with("files") {
                continue;
            }
            if files.len() >= MAX_FILES {
                return Err(ApiError::BadRequest(format!("at most {MAX_FILES} files per request")));
            }
            let temp =
                NamedTempFile::new().map_err(|error| ApiError::Internal(error.to_string()))?;
            let mut out = tokio::fs::File::from_std(
                temp.reopen().map_err(|error| ApiError::Internal(error.to_string()))?,
            );
            let mut size: u64 = 0;
            while let Some(chunk) = field.chunk().await.map_err(bad)? {
                size += chunk.len() as u64;
                if size > max {
                    return Err(ApiError::PayloadTooLarge(format!(
                        "`{file_name}` exceeds the {} MB limit",
                        max / 1_000_000
                    )));
                }
                out.write_all(&chunk)
                    .await
                    .map_err(|error| ApiError::Internal(error.to_string()))?;
            }
            out.flush().await.map_err(|error| ApiError::Internal(error.to_string()))?;
            let incoming = IncomingFile { path: temp.path().to_owned(), name: file_name, size };
            files.push((incoming, temp));
            continue;
        }
        let text = field.text().await.map_err(bad)?;
        match name.as_str() {
            "fileInfo" => {
                let value: Value = serde_json::from_str(&text)
                    .map_err(|error| ApiError::BadRequest(format!("invalid fileInfo: {error}")))?;
                let list = match value {
                    Value::Array(items) => items,
                    other => vec![other],
                };
                for item in list {
                    infos.push(serde_json::from_value(item).map_err(|error| {
                        ApiError::BadRequest(format!("invalid fileInfo: {error}"))
                    })?);
                }
            }
            "folder" => {
                folder = Some(match text.trim() {
                    "" | "null" | "root" => None,
                    id => Some(
                        id.parse().map_err(|_| ApiError::BadRequest("invalid folder".into()))?,
                    ),
                });
            }
            _ => {}
        }
    }
    if let Some(folder) = folder {
        if infos.is_empty() {
            infos.push(FileInfo::default());
        }
        for info in &mut infos {
            info.folder.get_or_insert(folder);
        }
    }
    Ok(Uploads { files, infos })
}

/// `fileInfo` from a JSON (non-multipart) body or a multipart form without files.
pub(crate) fn parse_info(bytes: &[u8]) -> Result<FileInfo, ApiError> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|error| ApiError::BadRequest(format!("invalid request body: {error}")))?;
    let value = value.get("fileInfo").cloned().unwrap_or(value);
    serde_json::from_value(value)
        .map_err(|error| ApiError::BadRequest(format!("invalid fileInfo: {error}")))
}

// ------------------------------------------------------------- content API

pub(crate) fn content_routes(service: Option<&UploadService>) -> Router<ApiState> {
    let routes = Router::new()
        .route("/upload", post(content_upload))
        .route("/upload/files", get(content_files))
        .route("/upload/files/{id}", get(content_file).delete(content_delete));
    upload_layers(routes, service)
}

fn service(state: &ApiState) -> Result<&UploadService, ApiError> {
    state.upload.as_ref().ok_or(ApiError::NotFound)
}

async fn allow(
    state: &ApiState,
    headers: &HeaderMap,
    action: ContentAction,
) -> Result<(), ApiError> {
    let actor = state.auth.content_actor(bearer(headers)?).await.map_err(|error| match error {
        AuthError::Unauthorized => ApiError::Unauthorized,
        other => ApiError::from(other),
    })?;
    if actor.allows(UPLOAD_SUBJECT, action) { Ok(()) } else { Err(ApiError::Forbidden) }
}

#[derive(Deserialize)]
struct UploadQuery {
    id: Option<i64>,
}

/// `POST /upload` (multipart `files` + `fileInfo`): uploads; `POST /upload?id=…` with a
/// `fileInfo` updates that file's metadata (Strapi v5 behaviour).
async fn content_upload(
    State(state): State<ApiState>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Result<Response, ApiError> {
    let service = service(&state)?;
    if let Some(id) = query.id {
        allow(&state, &headers, ContentAction::Update).await?;
        let uploads = read_multipart(multipart, service).await?;
        let file = service.update(id, uploads.info(0), None).await?;
        return Ok(Json(file.to_json()).into_response());
    }
    allow(&state, &headers, ContentAction::Create).await?;
    let uploads = read_multipart(multipart, service).await?;
    if uploads.files.is_empty() {
        return Err(ApiError::BadRequest("no files were sent (use the `files` field)".into()));
    }
    let mut created = Vec::new();
    for (index, (file, _temp)) in uploads.files.iter().enumerate() {
        let incoming =
            IncomingFile { path: file.path.clone(), name: file.name.clone(), size: file.size };
        created.push(service.upload(incoming, uploads.info(index), None).await?.to_json());
    }
    Ok((StatusCode::CREATED, Json(Value::Array(created))).into_response())
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ContentFilesQuery {
    #[serde(rename = "pagination[page]")]
    page: Option<u64>,
    #[serde(rename = "pagination[pageSize]")]
    page_size: Option<u64>,
    sort: Option<String>,
    #[serde(rename = "filters[name][$containsi]")]
    name: Option<String>,
}

/// `GET /upload/files`: a plain array, like Strapi.
async fn content_files(
    State(state): State<ApiState>,
    Query(query): Query<ContentFilesQuery>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    allow(&state, &headers, ContentAction::Find).await?;
    let sort = match query.sort.as_deref() {
        None | Some("createdAt:desc") => FileSort::CreatedAtDesc,
        Some("createdAt:asc" | "createdAt") => FileSort::CreatedAtAsc,
        Some("name:asc" | "name") => FileSort::NameAsc,
        Some("name:desc") => FileSort::NameDesc,
        Some("updatedAt:desc") => FileSort::UpdatedAtDesc,
        Some(other) => return Err(ApiError::BadRequest(format!("cannot sort files by `{other}`"))),
    };
    let list = service(&state)?
        .list(&FileQuery {
            search: query.name,
            sort,
            page: query.page.unwrap_or(1),
            page_size: query.page_size.unwrap_or(state.config.limits.default_page_size),
            ..Default::default()
        })
        .await?;
    Ok(Json(json!(list.files.iter().map(|file| file.to_json()).collect::<Vec<_>>()))
        .into_response())
}

async fn content_file(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    allow(&state, &headers, ContentAction::FindOne).await?;
    let file = service(&state)?.find(id).await?.ok_or(ApiError::NotFound)?;
    Ok(Json(file.to_json()).into_response())
}

async fn content_delete(
    State(state): State<ApiState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    allow(&state, &headers, ContentAction::Delete).await?;
    let file = service(&state)?.delete(id).await?;
    Ok(Json(file.to_json()).into_response())
}
