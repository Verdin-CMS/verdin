//! Settings → Webhooks: the admin API for webhooks and their delivery log. Everything here
//! requires `webhooks.manage`, and answers 404 while the `webhooks` feature is off.

use std::collections::BTreeMap;

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use bytes::Bytes;
use serde::Deserialize;
use serde_json::{Value, json};
use verdin_auth::actions;
use verdin_db::value::{format_datetime, truncate_millis};
use verdin_db::{ColumnKind as K, SqlValue as V};
use verdin_migrate::system::{WEBHOOK_DELIVERIES, WEBHOOKS};

use super::{AdminState, ApiResult, body, data, require};
use crate::error::ApiError;
use crate::webhooks::{Attempt, EVENTS, Webhook, Webhooks, check_url};

const MAX_HEADERS: usize = 20;
const MAX_HEADER_VALUE: usize = 2048;
const MAX_NAME: usize = 255;
const MAX_URL: usize = 2048;
/// Set by Verdin on every delivery.
const RESERVED_HEADERS: &[&str] =
    &["content-type", "content-length", "host", "transfer-encoding", "connection"];

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/webhooks", get(list).post(create))
        .route("/webhooks/{id}", get(get_one).put(update).delete(remove))
        .route("/webhooks/{id}/secret", post(rotate_secret).delete(remove_secret))
        .route("/webhooks/{id}/trigger", post(trigger))
        .route("/webhooks/{id}/deliveries", get(deliveries))
        .route("/webhooks/deliveries/{id}/retry", post(retry))
}

fn internal(error: impl std::fmt::Display) -> ApiError {
    ApiError::Internal(error.to_string())
}

fn now() -> time::OffsetDateTime {
    truncate_millis(time::OffsetDateTime::now_utc())
}

/// The webhooks service, with the caller allowed to manage it.
async fn service(state: &AdminState, headers: &HeaderMap) -> Result<Webhooks, ApiError> {
    let webhooks = state.config.webhooks.clone().ok_or(ApiError::NotFound)?;
    require(state, headers, actions::WEBHOOKS_MANAGE).await?;
    Ok(webhooks)
}

fn id(raw: &str) -> Result<i64, ApiError> {
    raw.parse().map_err(|_| ApiError::NotFound)
}

async fn find(webhooks: &Webhooks, id: i64) -> Result<Webhook, ApiError> {
    webhooks.get(id).await.map_err(internal)?.ok_or(ApiError::NotFound)
}

fn new_secret() -> String {
    format!("whsec_{}", verdin_auth::crypto::random_hex::<24>())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    name: String,
    url: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    events: Vec<String>,
    #[serde(default)]
    content_types: Vec<String>,
    #[serde(default = "yes")]
    enabled: bool,
    /// Create only: sign deliveries (the secret is returned once).
    #[serde(default = "yes")]
    signed: bool,
}

fn yes() -> bool {
    true
}

/// Checks and normalizes an input.
fn validate(state: &AdminState, webhooks: &Webhooks, mut input: Input) -> Result<Input, ApiError> {
    let bad = |message: String| Err(ApiError::BadRequest(message));
    input.name = input.name.trim().to_owned();
    input.url = input.url.trim().to_owned();
    if input.name.is_empty() || input.name.chars().count() > MAX_NAME {
        return bad(format!("name must have 1 to {MAX_NAME} characters"));
    }
    if input.url.len() > MAX_URL {
        return bad(format!("url must have at most {MAX_URL} characters"));
    }
    if let Err(message) = check_url(&input.url, webhooks.options().allow_private_networks) {
        return bad(format!("url: {message}"));
    }
    if input.events.is_empty() {
        return bad("choose at least one event".into());
    }
    input.events.sort_by_key(|event| EVENTS.iter().position(|known| known == event));
    input.events.dedup();
    if let Some(unknown) = input.events.iter().find(|event| !EVENTS.contains(&event.as_str())) {
        return bad(format!("unknown event `{unknown}`"));
    }
    input.content_types.sort();
    input.content_types.dedup();
    let registry = state.service.registry();
    if let Some(unknown) = input.content_types.iter().find(|uid| registry.get(uid).is_err()) {
        return bad(format!("unknown content type `{unknown}`"));
    }
    if input.headers.len() > MAX_HEADERS {
        return bad(format!("at most {MAX_HEADERS} headers"));
    }
    let mut headers = BTreeMap::new();
    for (name, value) in std::mem::take(&mut input.headers) {
        let name = name.trim().to_ascii_lowercase();
        if HeaderName::from_bytes(name.as_bytes()).is_err() {
            return bad(format!("invalid header name `{name}`"));
        }
        if RESERVED_HEADERS.contains(&name.as_str()) || name.starts_with("x-verdin-") {
            return bad(format!("the `{name}` header is set by Verdin"));
        }
        if value.len() > MAX_HEADER_VALUE || HeaderValue::from_str(&value).is_err() {
            return bad(format!("invalid value for the `{name}` header"));
        }
        headers.insert(name, value);
    }
    input.headers = headers;
    Ok(input)
}

/// A webhook with its latest delivery, for lists.
async fn with_last_delivery(webhooks: &Webhooks, hook: &Webhook) -> Result<Value, ApiError> {
    let mut value = hook.to_json();
    let rows = page(webhooks, hook.id, 1, 1).await?;
    value["lastDelivery"] = rows.into_iter().next().unwrap_or(Value::Null);
    Ok(value)
}

async fn list(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    let webhooks = service(&state, &headers).await?;
    let hooks = webhooks.list().await.map_err(internal)?;
    let mut items = Vec::with_capacity(hooks.len());
    for hook in hooks.iter() {
        items.push(with_last_delivery(&webhooks, hook).await?);
    }
    Ok(axum::Json(json!({ "data": items, "meta": { "events": EVENTS } })).into_response())
}

async fn get_one(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    let webhooks = service(&state, &headers).await?;
    let hook = find(&webhooks, id(&raw)?).await?;
    Ok(data(with_last_delivery(&webhooks, &hook).await?))
}

async fn create(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    let webhooks = service(&state, &headers).await?;
    let input = validate(&state, &webhooks, body(&bytes)?)?;
    let secret = input.signed.then(new_secret);
    let at = now();
    let id = state
        .service
        .db()
        .queries()
        .insert_returning_id(
            &format!(
                "INSERT INTO {WEBHOOKS} (name, url, headers, events, content_types, secret, \
                 enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ),
            &[
                V::Text(input.name),
                V::Text(input.url),
                V::Json(json!(input.headers)),
                V::Json(json!(input.events)),
                V::Json(json!(input.content_types)),
                secret.clone().map_or(V::Null(K::Text), V::Text),
                V::Bool(input.enabled),
                V::DateTime(at),
                V::DateTime(at),
            ],
        )
        .await
        .map_err(internal)?;
    webhooks.invalidate();
    let mut value = find(&webhooks, id).await?.to_json();
    value["secret"] = json!(secret);
    Ok((StatusCode::CREATED, axum::Json(json!({ "data": value }))).into_response())
}

async fn update(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let webhooks = service(&state, &headers).await?;
    let hook = find(&webhooks, id(&raw)?).await?;
    let input = validate(&state, &webhooks, body(&bytes)?)?;
    state
        .service
        .db()
        .queries()
        .execute(
            &format!(
                "UPDATE {WEBHOOKS} SET name = ?, url = ?, headers = ?, events = ?, \
                 content_types = ?, enabled = ?, updated_at = ? WHERE id = ?"
            ),
            &[
                V::Text(input.name),
                V::Text(input.url),
                V::Json(json!(input.headers)),
                V::Json(json!(input.events)),
                V::Json(json!(input.content_types)),
                V::Bool(input.enabled),
                V::DateTime(now()),
                V::BigInt(hook.id),
            ],
        )
        .await
        .map_err(internal)?;
    webhooks.invalidate();
    Ok(data(find(&webhooks, hook.id).await?.to_json()))
}

async fn remove(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    let webhooks = service(&state, &headers).await?;
    let hook = find(&webhooks, id(&raw)?).await?;
    let mut tx = state.service.db().begin().await.map_err(internal)?;
    for sql in [
        format!("DELETE FROM {WEBHOOK_DELIVERIES} WHERE webhook_id = ?"),
        format!("DELETE FROM {WEBHOOKS} WHERE id = ?"),
    ] {
        tx.execute(&sql, &[V::BigInt(hook.id)]).await.map_err(internal)?;
    }
    tx.commit().await.map_err(internal)?;
    webhooks.invalidate();
    Ok(data(hook.to_json()))
}

async fn set_secret(
    state: &AdminState,
    webhooks: &Webhooks,
    id: i64,
    secret: Option<&str>,
) -> Result<(), ApiError> {
    state
        .service
        .db()
        .queries()
        .execute(
            &format!("UPDATE {WEBHOOKS} SET secret = ?, updated_at = ? WHERE id = ?"),
            &[
                secret.map_or(V::Null(K::Text), |secret| V::Text(secret.into())),
                V::DateTime(now()),
                V::BigInt(id),
            ],
        )
        .await
        .map_err(internal)?;
    webhooks.invalidate();
    Ok(())
}

/// `POST /webhooks/{id}/secret`: a new signing secret, returned this once.
async fn rotate_secret(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    let webhooks = service(&state, &headers).await?;
    let hook = find(&webhooks, id(&raw)?).await?;
    let secret = new_secret();
    set_secret(&state, &webhooks, hook.id, Some(&secret)).await?;
    Ok(data(json!({ "secret": secret })))
}

/// `DELETE /webhooks/{id}/secret`: deliveries are no longer signed.
async fn remove_secret(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    let webhooks = service(&state, &headers).await?;
    let hook = find(&webhooks, id(&raw)?).await?;
    set_secret(&state, &webhooks, hook.id, None).await?;
    Ok(data(find(&webhooks, hook.id).await?.to_json()))
}

fn attempt_json(delivery_id: i64, attempt: &Attempt) -> Value {
    json!({
        "deliveryId": delivery_id,
        "ok": attempt.succeeded(),
        "statusCode": attempt.status,
        "body": attempt.body,
        "error": attempt.error,
        "durationMs": attempt.duration_ms,
    })
}

/// `POST /webhooks/{id}/trigger`: sends a test event now (even to a disabled webhook).
async fn trigger(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    let webhooks = service(&state, &headers).await?;
    let hook = find(&webhooks, id(&raw)?).await?;
    let (delivery_id, attempt) = webhooks.trigger(&hook).await.map_err(internal)?;
    Ok(data(attempt_json(delivery_id, &attempt)))
}

/// `POST /webhooks/deliveries/{id}/retry`: sends a logged delivery again now.
async fn retry(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    let webhooks = service(&state, &headers).await?;
    let delivery_id = id(&raw)?;
    let attempt =
        webhooks.redeliver(delivery_id).await.map_err(internal)?.ok_or(ApiError::NotFound)?;
    Ok(data(attempt_json(delivery_id, &attempt)))
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct PageQuery {
    page: Option<u64>,
    page_size: Option<u64>,
}

async fn page(
    webhooks: &Webhooks,
    webhook_id: i64,
    page: u64,
    size: u64,
) -> Result<Vec<Value>, ApiError> {
    let rows = webhooks
        .database()
        .queries()
        .fetch_all(
            &format!(
                "SELECT id, event, payload, status, attempts, next_attempt_at, response_status, \
                 response_body, error, duration_ms, created_at, updated_at FROM {WEBHOOK_DELIVERIES} \
                 WHERE webhook_id = ? ORDER BY id DESC LIMIT {size} OFFSET {}",
                (page - 1) * size
            ),
            &[V::BigInt(webhook_id)],
            &[
                K::BigInt,
                K::Text,
                K::Json,
                K::Text,
                K::Int,
                K::DateTime,
                K::Int,
                K::Text,
                K::Text,
                K::Int,
                K::DateTime,
                K::DateTime,
            ],
        )
        .await
        .map_err(internal)?;
    let datetime = |value: V| match value {
        V::DateTime(at) => json!(format_datetime(at)),
        _ => Value::Null,
    };
    Ok(rows
        .into_iter()
        .map(|row| {
            let mut row = row.into_iter();
            let mut next = || row.next().unwrap_or(V::Null(K::Text));
            json!({
                "id": next().as_i64(),
                "event": next().into_text(),
                "payload": match next() { V::Json(value) => value, _ => Value::Null },
                "status": next().into_text(),
                "attempts": next().as_i64(),
                "nextAttemptAt": datetime(next()),
                "responseStatus": next().as_i64(),
                "responseBody": next().into_text(),
                "error": next().into_text(),
                "durationMs": next().as_i64(),
                "createdAt": datetime(next()),
                "updatedAt": datetime(next()),
            })
        })
        .collect())
}

/// `GET /webhooks/{id}/deliveries?page=&pageSize=`: the log, newest first.
async fn deliveries(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    Query(query): Query<PageQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let webhooks = service(&state, &headers).await?;
    let hook = find(&webhooks, id(&raw)?).await?;
    let page_number = query.page.unwrap_or(1).max(1);
    let size = query.page_size.unwrap_or(25).clamp(1, 100);
    let total = state
        .service
        .db()
        .queries()
        .fetch_all(
            &format!("SELECT COUNT(*) FROM {WEBHOOK_DELIVERIES} WHERE webhook_id = ?"),
            &[V::BigInt(hook.id)],
            &[K::BigInt],
        )
        .await
        .map_err(internal)?
        .into_iter()
        .next()
        .and_then(|row| row.into_iter().next())
        .and_then(|value| value.as_i64())
        .unwrap_or_default();
    let items = page(&webhooks, hook.id, page_number, size).await?;
    Ok(axum::Json(json!({
        "data": items,
        "meta": { "pagination": {
            "page": page_number,
            "pageSize": size,
            "total": total,
            "pageCount": (total as u64).div_ceil(size),
        } },
    }))
    .into_response())
}
