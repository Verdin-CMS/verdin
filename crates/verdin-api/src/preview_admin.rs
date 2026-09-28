//! `GET /content/{uid}/{documentId}/preview[?locale=]`: the preview link of a draft, from
//! the `preview` feature's URL template for its type, with a fresh preview token.

use axum::Router;
use axum::extract::{Path, RawQuery, State};
use axum::http::HeaderMap;
use axum::routing::get;
use serde_json::json;
use verdin_auth::actions;
use verdin_auth::preview::PreviewGrant;
use verdin_db::value::format_datetime;

use super::{
    AdminState, ApiResult, admin_query, content_grant, data, ensure_owner, feature_host, localized,
};
use crate::error::ApiError;
use crate::features::PREVIEW;
use crate::preview::{PreviewSettings, fill};

pub(super) fn routes() -> Router<AdminState> {
    Router::new().route("/content/{uid}/{document_id}/preview", get(preview))
}

async fn preview(
    State(state): State<AdminState>,
    Path((uid, document_id)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
) -> ApiResult {
    let states = feature_host(&state)?.states();
    if !states.enabled(PREVIEW) {
        return Err(ApiError::NotFound);
    }
    let state = localized(state, raw.as_deref())?;
    let (principal, grant) = content_grant(&state, &headers, &uid, actions::CONTENT_READ).await?;
    ensure_owner(&state, &uid, &document_id, &principal, grant).await?;
    let settings = PreviewSettings::parse(states.settings(PREVIEW))?;
    let template = settings.urls.get(&uid).ok_or(ApiError::NotFound)?;
    let query = admin_query(&state, &uid, None, &principal, grant)?;
    let document =
        state.service.find_one(&uid, &document_id, &query).await?.ok_or(ApiError::NotFound)?;
    let (token, expires) = state.auth.preview_token(
        &PreviewGrant { uid: uid.clone(), document_id: document_id.clone() },
        settings.ttl(),
    );
    let url = fill(template, &document, &[("documentId", &document_id), ("uid", &uid)], &token);
    Ok(data(json!({ "url": url, "token": token, "expiresAt": format_datetime(expires) })))
}
