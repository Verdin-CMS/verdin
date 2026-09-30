//! Content locales stored in `vd_locales` (the first start adds English as the default),
//! and `GET /api/i18n/locales`, as Strapi's i18n plugin serves it.

use axum::Json;
use axum::Router;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use verdin_auth::{AuthError, ContentAction, LOCALES_SUBJECT};
use verdin_content::locales::{Locale, LocaleSet};
use verdin_db::value::{format_datetime, truncate_millis};
use verdin_db::{ColumnKind as K, Database, DbError, SqlValue as V};
use verdin_migrate::system::LOCALES;

use crate::ApiState;
use crate::error::ApiError;
use crate::handlers::bearer;

pub(crate) fn content_routes() -> Router<ApiState> {
    Router::new().route("/i18n/locales", get(list_locales))
}

/// `GET /i18n/locales`: every locale, as a plain array like Strapi's (no `data`
/// envelope). Needs `find` on `plugin::i18n.locale`, which the public role and end-user
/// roles are granted like any content API action.
async fn list_locales(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let actor = state.auth.content_actor(bearer(&headers)?).await.map_err(|error| match error {
        AuthError::Unauthorized => ApiError::Unauthorized,
        other => ApiError::from(other),
    })?;
    if !actor.allows(LOCALES_SUBJECT, ContentAction::Find) {
        return Err(ApiError::Forbidden);
    }
    let rows = state
        .service
        .db()
        .queries()
        .fetch_all(
            &format!(
                "SELECT id, code, name, is_default, created_at, updated_at FROM {LOCALES} \
                 ORDER BY id"
            ),
            &[],
            &[K::BigInt, K::Text, K::Text, K::Bool, K::DateTime, K::DateTime],
        )
        .await
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let date = |value: Option<V>| match value {
        Some(V::DateTime(value)) => Value::String(format_datetime(value)),
        _ => Value::Null,
    };
    let locales: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            let mut row = row.into_iter();
            let id = row.next().and_then(|value| value.as_i64()).unwrap_or_default();
            let code = row.next().and_then(V::into_text).unwrap_or_default();
            let name = row.next().and_then(V::into_text).unwrap_or_default();
            let is_default = matches!(row.next(), Some(V::Bool(true)));
            let (created, updated) = (date(row.next()), date(row.next()));
            json!({
                "id": id,
                "documentId": locale_document_id(&code),
                "name": name,
                "code": code,
                "createdAt": created,
                "updatedAt": updated,
                "publishedAt": created,
                "isDefault": is_default,
                "locale": null,
            })
        })
        .collect();
    Ok(Json(Value::Array(locales)).into_response())
}

/// A stable `documentId` for a locale (Strapi stores locales as documents; Verdin keys
/// them by code): 24 lowercase letters and digits derived from the code.
fn locale_document_id(code: &str) -> String {
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    Sha256::digest(format!("verdin:i18n-locale:{code}").as_bytes())
        .iter()
        .take(24)
        .map(|byte| char::from(ALPHABET[usize::from(*byte) % ALPHABET.len()]))
        .collect()
}

/// The stored locales, adding the default English one when there is none.
pub async fn load_locales(db: &Database) -> Result<LocaleSet, DbError> {
    let rows = db
        .queries()
        .fetch_all(
            &format!("SELECT code, name, is_default FROM {LOCALES} ORDER BY id"),
            &[],
            &[K::Text, K::Text, K::Bool],
        )
        .await?;
    if rows.is_empty() {
        let set = LocaleSet::default();
        let now = truncate_millis(time::OffsetDateTime::now_utc());
        for locale in &set.locales {
            db.queries()
                .execute(
                    &format!(
                        "INSERT INTO {LOCALES} (code, name, is_default, created_at, updated_at) \
                         VALUES (?, ?, ?, ?, ?)"
                    ),
                    &[
                        V::Text(locale.code.clone()),
                        V::Text(locale.name.clone()),
                        V::Bool(locale.code == set.default),
                        V::DateTime(now),
                        V::DateTime(now),
                    ],
                )
                .await?;
        }
        return Ok(set);
    }
    let mut set = LocaleSet { locales: Vec::new(), default: String::new() };
    for row in rows {
        let mut row = row.into_iter();
        let code = row.next().and_then(V::into_text).unwrap_or_default();
        let name = row.next().and_then(V::into_text).unwrap_or_default();
        if matches!(row.next(), Some(V::Bool(true))) {
            set.default = code.clone();
        }
        set.locales.push(Locale { code, name });
    }
    if set.default.is_empty() {
        set.default = set.locales[0].code.clone();
    }
    Ok(set)
}
