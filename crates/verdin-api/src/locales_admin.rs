//! Settings → Internationalization: the content locales. Any admin may list them;
//! changes need `locales.manage`. Deleting a locale deletes the entries written in it.

use axum::Router;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use bytes::Bytes;
use serde::Deserialize;
use serde_json::json;
use verdin_auth::actions;
use verdin_content::locales::{LocaleSet, valid_code};
use verdin_db::value::truncate_millis;
use verdin_db::{DbError, SqlValue as V};
use verdin_migrate::system::LOCALES;

use super::{AdminState, ApiResult, body, data, principal, require};
use crate::error::ApiError;

const MAX_NAME: usize = 255;

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/i18n/locales", get(list).post(create))
        .route("/i18n/locales/{code}", axum::routing::put(update).delete(remove))
}

fn internal(error: impl std::fmt::Display) -> ApiError {
    ApiError::Internal(error.to_string())
}

fn locales_json(set: &LocaleSet) -> serde_json::Value {
    json!(
        set.locales
            .iter()
            .map(|locale| json!({
                "code": locale.code,
                "name": locale.name,
                "isDefault": locale.code == set.default,
            }))
            .collect::<Vec<_>>()
    )
}

/// Reloads the shared locales after a change.
async fn reload(state: &AdminState) -> Result<LocaleSet, ApiError> {
    let set = crate::i18n::load_locales(state.service.db()).await.map_err(internal)?;
    state.service.locales().set(set.clone());
    Ok(set)
}

async fn list(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    principal(&state, &headers).await?;
    Ok(data(locales_json(&state.service.locales().get())))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NewLocale {
    code: String,
    name: String,
    #[serde(default)]
    is_default: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocaleChange {
    name: Option<String>,
    #[serde(default)]
    is_default: bool,
}

fn check_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(ApiError::BadRequest(format!("name must have 1 to {MAX_NAME} characters")));
    }
    Ok(name.to_owned())
}

async fn make_default(state: &AdminState, code: &str) -> Result<(), DbError> {
    let mut tx = state.service.db().begin().await?;
    tx.execute(&format!("UPDATE {LOCALES} SET is_default = ?"), &[V::Bool(false)]).await?;
    tx.execute(
        &format!("UPDATE {LOCALES} SET is_default = ? WHERE code = ?"),
        &[V::Bool(true), V::Text(code.into())],
    )
    .await?;
    tx.commit().await
}

async fn create(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    require(&state, &headers, actions::LOCALES_MANAGE).await?;
    let input: NewLocale = body(&bytes)?;
    let code = input.code.trim().to_owned();
    if !valid_code(&code) {
        return Err(ApiError::BadRequest(format!(
            "`{code}` is not a locale code (like `fr`, `pt-BR` or `zh-Hans`)"
        )));
    }
    let name = check_name(&input.name)?;
    if state.service.locales().contains(&code) {
        return Err(ApiError::Conflict(format!("the locale `{code}` already exists")));
    }
    let now = truncate_millis(time::OffsetDateTime::now_utc());
    state
        .service
        .db()
        .queries()
        .execute(
            &format!(
                "INSERT INTO {LOCALES} (code, name, is_default, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?)"
            ),
            &[
                V::Text(code.clone()),
                V::Text(name),
                V::Bool(false),
                V::DateTime(now),
                V::DateTime(now),
            ],
        )
        .await
        .map_err(internal)?;
    if input.is_default {
        make_default(&state, &code).await.map_err(internal)?;
    }
    let set = reload(&state).await?;
    Ok((StatusCode::CREATED, axum::Json(json!({ "data": locales_json(&set) }))).into_response())
}

async fn update(
    State(state): State<AdminState>,
    Path(code): Path<String>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::LOCALES_MANAGE).await?;
    if !state.service.locales().contains(&code) {
        return Err(ApiError::NotFound);
    }
    let input: LocaleChange = body(&bytes)?;
    if let Some(name) = &input.name {
        let name = check_name(name)?;
        state
            .service
            .db()
            .queries()
            .execute(
                &format!("UPDATE {LOCALES} SET name = ?, updated_at = ? WHERE code = ?"),
                &[
                    V::Text(name),
                    V::DateTime(truncate_millis(time::OffsetDateTime::now_utc())),
                    V::Text(code.clone()),
                ],
            )
            .await
            .map_err(internal)?;
    }
    if input.is_default {
        make_default(&state, &code).await.map_err(internal)?;
    }
    Ok(data(locales_json(&reload(&state).await?)))
}

async fn remove(
    State(state): State<AdminState>,
    Path(code): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::LOCALES_MANAGE).await?;
    let set = state.service.locales().get();
    if !set.locales.iter().any(|locale| locale.code == code) {
        return Err(ApiError::NotFound);
    }
    if set.default == code {
        return Err(ApiError::BadRequest("the default locale cannot be deleted".into()));
    }
    let registry = state.service.registry();
    let mut tx = state.service.db().begin().await.map_err(internal)?;
    for model in registry.types().filter(|model| model.content_type.localized) {
        let table = state.service.db().flavor().quote(model.table());
        tx.execute(&format!("DELETE FROM {table} WHERE locale = ?"), &[V::Text(code.clone())])
            .await
            .map_err(internal)?;
    }
    tx.execute(&format!("DELETE FROM {LOCALES} WHERE code = ?"), &[V::Text(code.clone())])
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(data(locales_json(&reload(&state).await?)))
}
