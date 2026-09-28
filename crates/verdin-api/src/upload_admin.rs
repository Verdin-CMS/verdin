//! Admin media library routes (`/admin/api/upload/…`): files, folders and permissions
//! (`media.read|create|update|delete`, optionally limited to the user's own files).

use axum::Json;
use axum::Router;
use axum::extract::{Multipart, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use bytes::Bytes;
use serde::Deserialize;
use serde_json::{Value, json};
use verdin_auth::{AdminPrincipal, Grant, actions};
use verdin_schema::MediaType;
use verdin_upload::{FileQuery, FileRecord, FileSort, IncomingFile, UploadService};

use super::{AdminState, ApiResult, data, principal};
use crate::error::ApiError;
use crate::upload::{parse_info, read_multipart, upload_layers};

pub(super) fn routes(service: Option<&UploadService>) -> Router<AdminState> {
    let uploads = upload_layers(
        Router::new()
            .route("/upload", post(upload))
            .route("/upload/files/{id}/replace", post(replace_file))
            .route("/upload/from-url", post(from_url)),
        service,
    );
    Router::new()
        .route("/upload/files", get(list_files))
        .route("/upload/files/{id}/usage", get(file_usage))
        .route("/upload/files/{id}", get(get_file).put(update_file).delete(delete_file))
        .route("/upload/folders", get(list_folders).post(create_folder))
        .route("/upload/folders/all", get(all_folders))
        .route("/upload/folders/{id}", get(get_folder).put(update_folder).delete(delete_folder))
        .merge(uploads)
}

fn service(state: &AdminState) -> Result<&UploadService, ApiError> {
    state.config.upload.as_ref().ok_or(ApiError::NotFound)
}

async fn media(
    state: &AdminState,
    headers: &HeaderMap,
    action: &str,
) -> Result<(AdminPrincipal, Grant), ApiError> {
    let principal = principal(state, headers).await?;
    match principal.permissions.media(action) {
        Grant::None => Err(ApiError::Forbidden),
        grant => Ok((principal, grant)),
    }
}

/// `Own` grants only cover files the user uploaded.
fn ensure_own(file: &FileRecord, principal: &AdminPrincipal, grant: Grant) -> Result<(), ApiError> {
    if grant == Grant::Own && file.created_by != Some(principal.user.id) {
        return Err(ApiError::Forbidden);
    }
    Ok(())
}

/// Admin file JSON: the content shape plus folder and author.
fn file_json(file: &FileRecord) -> Value {
    let mut value = file.to_json();
    value["folder"] = json!(file.folder_id);
    value["folderPath"] = json!(file.folder_path);
    value["createdBy"] = json!(file.created_by);
    value
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct ListQuery {
    page: Option<u64>,
    page_size: Option<u64>,
    sort: Option<FileSort>,
    search: Option<String>,
    /// `root` (default), a folder id, or `all`.
    folder: Option<String>,
    /// Comma-separated: images, videos, audios, files.
    types: Option<String>,
}

async fn list_files(
    State(state): State<AdminState>,
    Query(query): Query<ListQuery>,
    headers: HeaderMap,
) -> ApiResult {
    media(&state, &headers, actions::MEDIA_READ).await?;
    let folder = match query.folder.as_deref() {
        None | Some("root") | Some("") => Some(None),
        Some("all") => None,
        Some(id) => {
            Some(Some(id.parse().map_err(|_| ApiError::BadRequest("invalid folder".into()))?))
        }
    };
    let types = query
        .types
        .as_deref()
        .unwrap_or_default()
        .split(',')
        .filter(|ty| !ty.is_empty())
        .map(|ty| {
            MediaType::parse(ty).ok_or_else(|| ApiError::BadRequest(format!("unknown type `{ty}`")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(state.config.limits.default_page_size).clamp(1, 100);
    let list = service(&state)?
        .list(&FileQuery {
            folder,
            search: query.search,
            types,
            ids: None,
            sort: query.sort.unwrap_or_default(),
            page,
            page_size,
        })
        .await?;
    let page_count = list.total.div_ceil(page_size);
    Ok(Json(json!({
        "data": list.files.iter().map(file_json).collect::<Vec<_>>(),
        "meta": { "pagination": { "page": page, "pageSize": page_size, "pageCount": page_count, "total": list.total } },
    }))
    .into_response())
}

async fn get_file(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    media(&state, &headers, actions::MEDIA_READ).await?;
    let file = service(&state)?.find(id).await?.ok_or(ApiError::NotFound)?;
    Ok(data(file_json(&file)))
}

/// Where a file is used: the entry versions showing it.
async fn file_usage(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let (principal, grant) = media(&state, &headers, actions::MEDIA_READ).await?;
    let file = service(&state)?.find(id).await?.ok_or(ApiError::NotFound)?;
    ensure_own(&file, &principal, grant)?;
    let usages = state.service.file_usage(id).await?;
    Ok(super::usage_response(&principal, usages))
}

/// `POST /upload` (multipart `files`, optional `fileInfo` and `folder`).
async fn upload(
    State(state): State<AdminState>,
    headers: HeaderMap,
    multipart: Multipart,
) -> ApiResult {
    let (principal, _) = media(&state, &headers, actions::MEDIA_CREATE).await?;
    let service = service(&state)?;
    let uploads = read_multipart(multipart, service).await?;
    if uploads.files.is_empty() {
        return Err(ApiError::BadRequest("no files were sent (use the `files` field)".into()));
    }
    let mut created = Vec::new();
    for (index, (file, _temp)) in uploads.files.iter().enumerate() {
        let incoming =
            IncomingFile { path: file.path.clone(), name: file.name.clone(), size: file.size };
        let record = service.upload(incoming, uploads.info(index), Some(principal.user.id)).await?;
        created.push(file_json(&record));
    }
    Ok((StatusCode::CREATED, Json(json!({ "data": created }))).into_response())
}

/// `POST /upload/files/{id}/replace`: new content for a file, keeping its id and links.
async fn replace_file(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    multipart: Multipart,
) -> ApiResult {
    let (principal, grant) = media(&state, &headers, actions::MEDIA_UPDATE).await?;
    let service = service(&state)?;
    let current = service.find(id).await?.ok_or(ApiError::NotFound)?;
    ensure_own(&current, &principal, grant)?;
    let uploads = read_multipart(multipart, service).await?;
    let Some((file, _temp)) = uploads.files.first() else {
        return Err(ApiError::BadRequest("send the new file in the `files` field".into()));
    };
    let incoming =
        IncomingFile { path: file.path.clone(), name: file.name.clone(), size: file.size };
    let replaced = service.replace(id, incoming, None, Some(principal.user.id)).await?;
    Ok(data(file_json(&replaced)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct FromUrl {
    url: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    folder: Option<i64>,
    #[serde(default)]
    alternative_text: Option<String>,
}

/// `POST /upload/from-url`: downloads a public file into the library (at most
/// `max_file_size`, three redirects, public addresses only unless configured).
async fn from_url(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    let (principal, _) = media(&state, &headers, actions::MEDIA_CREATE).await?;
    let service = service(&state)?;
    let input: FromUrl = super::body(&bytes)?;
    let allow_private = state.config.allow_private_urls;
    crate::webhooks::check_url(&input.url, allow_private).map_err(ApiError::BadRequest)?;
    let mut client = reqwest::Client::builder()
        .user_agent(concat!("Verdin/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(60))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 3 {
                attempt.error("too many redirects")
            } else if let Err(error) =
                crate::webhooks::check_url(attempt.url().as_str(), allow_private)
            {
                attempt.error(error)
            } else {
                attempt.follow()
            }
        }));
    if !allow_private {
        client = client.dns_resolver(std::sync::Arc::new(crate::webhooks::PublicResolver));
    }
    let client = client.build().map_err(|error| ApiError::Internal(error.to_string()))?;
    let failed = |error: reqwest::Error| {
        ApiError::BadRequest(format!("could not download the file: {error}"))
    };
    let mut response =
        client.get(&input.url).send().await.map_err(failed)?.error_for_status().map_err(failed)?;
    let max = service.config().max_file_size;
    if response.content_length().is_some_and(|length| length > max) {
        return Err(ApiError::BadRequest(format!(
            "the file is larger than {} MB",
            max / 1_000_000
        )));
    }
    let name = input.name.clone().unwrap_or_else(|| {
        response
            .url()
            .path_segments()
            .and_then(|mut segments| segments.next_back().map(str::to_owned))
            .filter(|segment| !segment.is_empty())
            .map(|segment| percent_decode(&segment))
            .unwrap_or_else(|| "download".into())
    });
    let temp =
        tempfile::NamedTempFile::new().map_err(|error| ApiError::Internal(error.to_string()))?;
    let mut out = tokio::fs::File::create(temp.path())
        .await
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let mut size: u64 = 0;
    while let Some(chunk) = response.chunk().await.map_err(failed)? {
        size += chunk.len() as u64;
        if size > max {
            return Err(ApiError::BadRequest(format!(
                "the file is larger than {} MB",
                max / 1_000_000
            )));
        }
        tokio::io::AsyncWriteExt::write_all(&mut out, &chunk)
            .await
            .map_err(|error| ApiError::Internal(error.to_string()))?;
    }
    tokio::io::AsyncWriteExt::flush(&mut out)
        .await
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let incoming = IncomingFile { path: temp.path().to_owned(), name: name.clone(), size };
    let info = verdin_upload::FileInfo {
        name: Some(name),
        alternative_text: input.alternative_text.map(Some),
        folder: input.folder.map(Some),
        ..Default::default()
    };
    let record = service.upload(incoming, info, Some(principal.user.id)).await?;
    Ok((StatusCode::CREATED, Json(json!({ "data": file_json(&record) }))).into_response())
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && bytes[index + 1].is_ascii_hexdigit()
            && bytes[index + 2].is_ascii_hexdigit()
            && let Ok(byte) = u8::from_str_radix(&text[index + 1..index + 3], 16)
        {
            out.push(byte);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

async fn update_file(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let (principal, grant) = media(&state, &headers, actions::MEDIA_UPDATE).await?;
    let service = service(&state)?;
    let file = service.find(id).await?.ok_or(ApiError::NotFound)?;
    ensure_own(&file, &principal, grant)?;
    let info = parse_info(&bytes)?;
    Ok(data(file_json(&service.update(id, info, Some(principal.user.id)).await?)))
}

async fn delete_file(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let (principal, grant) = media(&state, &headers, actions::MEDIA_DELETE).await?;
    let service = service(&state)?;
    let file = service.find(id).await?.ok_or(ApiError::NotFound)?;
    ensure_own(&file, &principal, grant)?;
    service.delete(id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

// --------------------------------------------------------------- folders

#[derive(Deserialize, Default)]
#[serde(default)]
struct FoldersQuery {
    /// `root` (default) or a folder id.
    parent: Option<String>,
}

fn parent_id(value: Option<&str>) -> Result<Option<i64>, ApiError> {
    match value {
        None | Some("") | Some("root") => Ok(None),
        Some(id) => id.parse().map(Some).map_err(|_| ApiError::BadRequest("invalid parent".into())),
    }
}

async fn list_folders(
    State(state): State<AdminState>,
    Query(query): Query<FoldersQuery>,
    headers: HeaderMap,
) -> ApiResult {
    media(&state, &headers, actions::MEDIA_READ).await?;
    Ok(data(service(&state)?.folders(parent_id(query.parent.as_deref())?).await?))
}

async fn all_folders(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    media(&state, &headers, actions::MEDIA_READ).await?;
    Ok(data(service(&state)?.all_folders().await?))
}

async fn get_folder(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    media(&state, &headers, actions::MEDIA_READ).await?;
    Ok(data(service(&state)?.folder(id).await.map_err(|_| ApiError::NotFound)?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewFolder {
    name: String,
    parent: Option<i64>,
}

async fn create_folder(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let (principal, _) = media(&state, &headers, actions::MEDIA_CREATE).await?;
    let input: NewFolder = super::body(&bytes)?;
    let folder =
        service(&state)?.create_folder(&input.name, input.parent, Some(principal.user.id)).await?;
    Ok((StatusCode::CREATED, Json(json!({ "data": folder }))).into_response())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FolderUpdate {
    name: Option<String>,
    /// Absent keeps the parent, `null` moves to the root.
    #[serde(default, deserialize_with = "super::double_option")]
    parent: Option<Option<i64>>,
}

/// Renaming or moving folders needs unrestricted `media.update` (they hold others' files).
async fn update_folder(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let (_, grant) = media(&state, &headers, actions::MEDIA_UPDATE).await?;
    if grant != Grant::All {
        return Err(ApiError::Forbidden);
    }
    let input: FolderUpdate = super::body(&bytes)?;
    Ok(data(service(&state)?.update_folder(id, input.name.as_deref(), input.parent).await?))
}

async fn delete_folder(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let (_, grant) = media(&state, &headers, actions::MEDIA_DELETE).await?;
    if grant != Grant::All {
        return Err(ApiError::Forbidden);
    }
    service(&state)?.delete_folder(id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
