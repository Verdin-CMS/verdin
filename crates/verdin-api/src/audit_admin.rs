//! Settings → Audit logs (`audit.read`): the recorded actions, newest first, filterable by
//! action, actor, subject and date.

use axum::Router;
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::get;
use serde::Deserialize;
use serde_json::{Value, json};
use verdin_auth::actions;
use verdin_db::value::format_datetime;
use verdin_db::{ColumnKind as K, SqlValue as V};
use verdin_migrate::system::{ADMIN_USERS, AUDIT_LOGS};
use verdin_query::temporal::parse_datetime;

use super::{AdminState, ApiResult, require};
use crate::error::ApiError;

pub(super) fn routes() -> Router<AdminState> {
    Router::new().route("/audit-logs", get(list))
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Filters {
    page: Option<u64>,
    page_size: Option<u64>,
    /// An action, or a prefix ending with `*` (`entry.*`).
    action: Option<String>,
    actor: Option<i64>,
    subject: Option<String>,
    from: Option<String>,
    to: Option<String>,
}

async fn list(
    State(state): State<AdminState>,
    Query(filters): Query<Filters>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::AUDIT_READ).await?;
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<V> = Vec::new();
    if let Some(action) = filters.action.as_deref().filter(|a| !a.is_empty()) {
        match action.strip_suffix('*') {
            Some(prefix) => {
                conditions.push("a.action LIKE ?".into());
                params.push(V::Text(format!("{}%", prefix.replace(['%', '_'], ""))));
            }
            None => {
                conditions.push("a.action = ?".into());
                params.push(V::Text(action.into()));
            }
        }
    }
    if let Some(actor) = filters.actor {
        conditions.push("a.actor_id = ?".into());
        params.push(V::BigInt(actor));
    }
    if let Some(subject) = filters.subject.as_deref().filter(|s| !s.is_empty()) {
        conditions.push("a.subject = ?".into());
        params.push(V::Text(subject.into()));
    }
    for (value, upper) in [(&filters.from, false), (&filters.to, true)] {
        if let Some(value) = value.as_deref().filter(|v| !v.is_empty()) {
            let at = parse_datetime(value).ok_or_else(|| {
                ApiError::BadRequest(format!("`{value}` is not an ISO 8601 date"))
            })?;
            // A plain date as the upper bound includes that whole day.
            let (operator, at) = match (upper, value.contains('T')) {
                (false, _) => (">=", at),
                (true, true) => ("<=", at),
                (true, false) => ("<", at + time::Duration::days(1)),
            };
            conditions.push(format!("a.at {operator} ?"));
            params.push(V::DateTime(at));
        }
    }
    let filter = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };
    let page = filters.page.unwrap_or(1).max(1);
    let size = filters.page_size.unwrap_or(50).clamp(1, 200);
    let db = state.service.db();
    let internal = |error: verdin_db::DbError| ApiError::Internal(error.to_string());
    let rows = db
        .queries()
        .fetch_all(
            &format!(
                "SELECT a.id, a.at, a.actor_kind, a.actor_id, a.action, a.subject, a.subject_id, a.details, a.ip, \
                 u.email, u.firstname, u.lastname FROM {AUDIT_LOGS} a LEFT JOIN {ADMIN_USERS} u ON u.id = a.actor_id\
                 {filter} ORDER BY a.id DESC LIMIT {size} OFFSET {}",
                (page - 1) * size
            ),
            &params,
            &[K::BigInt, K::DateTime, K::Text, K::BigInt, K::Text, K::Text, K::Text, K::Json, K::Text, K::Text, K::Text, K::Text],
        )
        .await
        .map_err(internal)?;
    let total = db
        .queries()
        .fetch_all(&format!("SELECT COUNT(*) FROM {AUDIT_LOGS} a{filter}"), &params, &[K::BigInt])
        .await
        .map_err(internal)?
        .first()
        .and_then(|row| row[0].as_i64())
        .unwrap_or_default();
    let entries: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            let mut row = row.into_iter();
            let mut next = || row.next().unwrap_or(V::Null(K::Text));
            let id = next().as_i64();
            let at = match next() {
                V::DateTime(at) => Some(format_datetime(at)),
                _ => None,
            };
            let actor_kind = next().into_text();
            let actor_id = next().as_i64();
            let action = next().into_text();
            let subject = next().into_text();
            let subject_id = next().into_text();
            let details = match next() {
                V::Json(value) => value,
                _ => json!({}),
            };
            let ip = next().into_text();
            let email = next().into_text();
            let name = [next().into_text(), next().into_text()]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ");
            json!({
                "id": id, "at": at, "action": action, "subject": subject, "subjectId": subject_id,
                "details": details, "ip": ip,
                "actor": { "kind": actor_kind, "id": actor_id, "email": email,
                           "name": (!name.is_empty()).then_some(name) },
            })
        })
        .collect();
    Ok(axum::Json(json!({
        "data": entries,
        "meta": { "pagination": {
            "page": page, "pageSize": size, "total": total,
            "pageCount": (total as u64).div_ceil(size),
        } },
    }))
    .into_response())
}
