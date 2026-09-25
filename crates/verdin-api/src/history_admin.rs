//! The content history admin API: a document's versions, one version, and restoring it
//! as the current draft. Reading needs `content.read` on the document and restoring
//! `content.update` (with "own" and field restrictions applied). It answers 404 while
//! the `history` feature is off.

use std::collections::HashMap;

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use verdin_auth::actions;
use verdin_content::WriteOptions;
use verdin_db::value::format_datetime;
use verdin_db::{ColumnKind as K, SqlValue as V};
use verdin_migrate::system::{ADMIN_USERS, HISTORY_VERSIONS};

use super::{AdminState, ApiResult, content_grant, data, ensure_owner};
use crate::error::ApiError;
use crate::history::History;

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/history/{uid}/{document_id}", get(versions))
        .route("/history/versions/{id}", get(version))
        .route("/history/versions/{id}/restore", post(restore))
}

fn internal(error: impl std::fmt::Display) -> ApiError {
    ApiError::Internal(error.to_string())
}

fn service(state: &AdminState) -> Result<&History, ApiError> {
    state.config.history.as_ref().ok_or(ApiError::NotFound)
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct PageQuery {
    page: Option<u64>,
    page_size: Option<u64>,
    locale: Option<String>,
}

struct Row {
    id: i64,
    uid: String,
    document_id: String,
    locale: String,
    event: String,
    status: String,
    data: Option<Value>,
    created_by: Option<i64>,
    created_at: Option<time::OffsetDateTime>,
}

const COLUMNS: &str =
    "id, content_type, document_id, locale, event, status, created_by, created_at";
const KINDS: [K; 8] =
    [K::BigInt, K::Text, K::Text, K::Text, K::Text, K::Text, K::BigInt, K::DateTime];

fn decode(row: Vec<V>, with_data: bool) -> Row {
    let mut row = row.into_iter();
    let mut next = || row.next().unwrap_or(V::Null(K::Text));
    let mut decoded = Row {
        id: next().as_i64().unwrap_or_default(),
        uid: next().into_text().unwrap_or_default(),
        document_id: next().into_text().unwrap_or_default(),
        locale: next().into_text().unwrap_or_default(),
        event: next().into_text().unwrap_or_default(),
        status: next().into_text().unwrap_or_default(),
        created_by: next().as_i64(),
        created_at: match next() {
            V::DateTime(at) => Some(at),
            _ => None,
        },
        data: None,
    };
    if with_data {
        decoded.data = match next() {
            V::Json(value) => Some(value),
            _ => None,
        };
    }
    decoded
}

/// `{ id, firstname, lastname, email }` of the given admins.
async fn authors(history: &History, ids: &[i64]) -> Result<HashMap<i64, Value>, ApiError> {
    let mut ids: Vec<i64> = ids.to_vec();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = history
        .database()
        .queries()
        .fetch_all(
            &format!(
                "SELECT id, firstname, lastname, email FROM {ADMIN_USERS} WHERE id IN ({})",
                vec!["?"; ids.len()].join(", ")
            ),
            &ids.iter().map(|id| V::BigInt(*id)).collect::<Vec<_>>(),
            &[K::BigInt, K::Text, K::Text, K::Text],
        )
        .await
        .map_err(internal)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let mut row = row.into_iter();
            let mut next = || row.next().unwrap_or(V::Null(K::Text));
            let id = next().as_i64().unwrap_or_default();
            let user = json!({
                "id": id,
                "firstname": next().into_text(),
                "lastname": next().into_text(),
                "email": next().into_text(),
            });
            (id, user)
        })
        .collect())
}

fn summary(row: &Row, authors: &HashMap<i64, Value>) -> Value {
    json!({
        "id": row.id,
        "uid": row.uid,
        "documentId": row.document_id,
        "locale": (!row.locale.is_empty()).then_some(&row.locale),
        "event": row.event,
        "status": row.status,
        "createdAt": row.created_at.map(format_datetime),
        "createdBy": row.created_by.and_then(|id| authors.get(&id).cloned()),
    })
}

/// `GET /history/{uid}/{documentId}?page=&pageSize=`: newest first.
async fn versions(
    State(state): State<AdminState>,
    Path((uid, document_id)): Path<(String, String)>,
    Query(query): Query<PageQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let history = service(&state)?;
    let (principal, grant) = content_grant(&state, &headers, &uid, actions::CONTENT_READ).await?;
    state.service.created_by(&uid, &document_id).await?;
    ensure_owner(&state, &uid, &document_id, &principal, grant).await?;
    let page = query.page.unwrap_or(1).max(1);
    let size = query.page_size.unwrap_or(20).clamp(1, 100);
    if let Some(code) =
        query.locale.as_deref().filter(|code| !verdin_content::locales::valid_code(code))
    {
        return Err(ApiError::BadRequest(format!("invalid locale `{code}`")));
    }
    let model = state.service.registry().get(&uid)?;
    let locale = state.service.in_locale(query.locale.clone()).locale_of(model)?;
    let params = [V::Text(uid.clone()), V::Text(document_id.clone()), V::Text(locale.clone())];
    let rows = history
        .database()
        .queries()
        .fetch_all(
            &format!(
                "SELECT {COLUMNS} FROM {HISTORY_VERSIONS} WHERE content_type = ? AND document_id = ? \
                 AND locale = ? ORDER BY id DESC LIMIT {size} OFFSET {}",
                (page - 1) * size
            ),
            &params,
            &KINDS,
        )
        .await
        .map_err(internal)?;
    let total = history
        .database()
        .queries()
        .fetch_all(
            &format!(
                "SELECT COUNT(*) FROM {HISTORY_VERSIONS} WHERE content_type = ? AND document_id = ? \
                 AND locale = ?"
            ),
            &params,
            &[K::BigInt],
        )
        .await
        .map_err(internal)?
        .into_iter()
        .next()
        .and_then(|row| row.into_iter().next())
        .and_then(|value| value.as_i64())
        .unwrap_or_default();
    let rows: Vec<Row> = rows.into_iter().map(|row| decode(row, false)).collect();
    let ids: Vec<i64> = rows.iter().filter_map(|row| row.created_by).collect();
    let authors = authors(history, &ids).await?;
    Ok(axum::Json(json!({
        "data": rows.iter().map(|row| summary(row, &authors)).collect::<Vec<_>>(),
        "meta": { "pagination": {
            "page": page,
            "pageSize": size,
            "total": total,
            "pageCount": (total as u64).div_ceil(size),
        } },
    }))
    .into_response())
}

async fn load(history: &History, raw: &str) -> Result<Row, ApiError> {
    let id: i64 = raw.parse().map_err(|_| ApiError::NotFound)?;
    history
        .database()
        .queries()
        .fetch_all(
            &format!("SELECT {COLUMNS}, data FROM {HISTORY_VERSIONS} WHERE id = ?"),
            &[V::BigInt(id)],
            &[KINDS.as_slice(), &[K::Json]].concat(),
        )
        .await
        .map_err(internal)?
        .into_iter()
        .next()
        .map(|row| decode(row, true))
        .ok_or(ApiError::NotFound)
}

/// Fields every document has.
const SYSTEM: &[&str] = &["id", "documentId", "createdAt", "updatedAt", "publishedAt", "locale"];

/// Keeps only `fields` (when restricted) of a snapshot, plus the system fields.
fn restrict(data: &mut Value, fields: Option<&[String]>) {
    let (Some(fields), Some(object)) = (fields, data.as_object_mut()) else { return };
    object.retain(|key, _| SYSTEM.contains(&key.as_str()) || fields.iter().any(|f| f == key));
}

/// `GET /history/versions/{id}`: the snapshot, and which of its fields the schema no
/// longer has.
async fn version(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    let history = service(&state)?;
    let mut row = load(history, &raw).await?;
    let (principal, grant) =
        content_grant(&state, &headers, &row.uid, actions::CONTENT_READ).await?;
    state.service.created_by(&row.uid, &row.document_id).await?;
    ensure_owner(&state, &row.uid, &row.document_id, &principal, grant).await?;
    let mut snapshot = row.data.take().unwrap_or(Value::Object(Map::new()));
    let readable = principal.permissions.content_fields(actions::CONTENT_READ, &row.uid);
    restrict(&mut snapshot, readable.as_deref());
    let model = state.service.registry().get(&row.uid)?;
    let unknown: Vec<&String> = snapshot
        .as_object()
        .map(|object| {
            object
                .keys()
                .filter(|key| {
                    !SYSTEM.contains(&key.as_str())
                        && !model.content_type.attributes.contains_key(key.as_str())
                })
                .collect()
        })
        .unwrap_or_default();
    let authors = authors(history, &row.created_by.into_iter().collect::<Vec<_>>()).await?;
    let mut value = summary(&row, &authors);
    value["unknownFields"] = json!(unknown);
    value["data"] = snapshot;
    Ok(data(value))
}

/// `POST /history/versions/{id}/restore`: the version becomes the current draft (the
/// fields the caller may update; references to deleted documents and files are dropped).
async fn restore(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    let history = service(&state)?;
    let row = load(history, &raw).await?;
    let (principal, grant) =
        content_grant(&state, &headers, &row.uid, actions::CONTENT_UPDATE).await?;
    ensure_owner(&state, &row.uid, &row.document_id, &principal, grant).await?;
    let snapshot = row.data.clone().unwrap_or(Value::Object(Map::new()));
    let service = state.service.in_locale((!row.locale.is_empty()).then(|| row.locale.clone()));
    let (mut input, dropped) = service.restorable(&row.uid, &snapshot).await?;
    let writable = principal.permissions.content_fields(actions::CONTENT_UPDATE, &row.uid);
    restrict(&mut input, writable.as_deref());
    let options = WriteOptions { publish: false, actor: Some(principal.user.id) };
    service.update(&row.uid, &row.document_id, &input, options).await?;
    Ok(data(json!({
        "documentId": row.document_id,
        "restored": row.id,
        "dropped": dropped
            .iter()
            .map(|dropped| json!({ "field": dropped.field, "count": dropped.count }))
            .collect::<Vec<_>>(),
    })))
}
