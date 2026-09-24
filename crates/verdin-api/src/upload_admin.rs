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
    let uploads = upload_layers(Router::new().route("/upload", post(upload)), service);
    Router::new()
        .route("/upload/files", get(list_files))
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
