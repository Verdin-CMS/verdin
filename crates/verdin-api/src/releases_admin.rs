//! Releases (`releases.manage`): group entries to publish or unpublish together, now or at a
//! scheduled date. Adding an entry also needs `content.publish` on its type.

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use serde::Deserialize;
use time::OffsetDateTime;
use verdin_auth::{Grant, actions};
use verdin_query::temporal::parse_datetime;

use super::{AdminState, ApiResult, body, content_grant, data, ensure_owner, require};
use crate::error::ApiError;
use crate::releases::Releases;

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/releases", get(list).post(create))
        .route("/releases/{id}", get(get_one).put(update).delete(remove))
        .route("/releases/{id}/actions", post(add_action))
        .route("/releases/{id}/actions/{action_id}", delete(remove_action))
        .route("/releases/{id}/publish", post(publish))
        .route("/content/{uid}/{document_id}/releases", get(for_entry))
}

fn internal(error: impl std::fmt::Display) -> ApiError {
    ApiError::Internal(error.to_string())
}

fn service(state: &AdminState) -> Result<&Releases, ApiError> {
    state.config.releases.as_ref().ok_or(ApiError::NotFound)
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ListQuery {
    status: Option<String>,
}

async fn list(
    State(state): State<AdminState>,
    Query(query): Query<ListQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let releases = service(&state)?;
    require(&state, &headers, actions::RELEASES_MANAGE).await?;
    Ok(data(releases.list(query.status.as_deref()).await.map_err(internal)?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseBody {
    name: String,
    #[serde(default)]
    scheduled_at: Option<String>,
}

impl ReleaseBody {
    fn validated(&self) -> Result<(String, Option<OffsetDateTime>), ApiError> {
        let name = self.name.trim();
        if name.is_empty() || name.chars().count() > 255 {
            return Err(ApiError::BadRequest("name must have 1 to 255 characters".into()));
        }
        let scheduled_at = match self.scheduled_at.as_deref().filter(|at| !at.is_empty()) {
            None => None,
            Some(at) => Some(
                parse_datetime(at)
                    .ok_or_else(|| ApiError::BadRequest(format!("invalid scheduledAt: {at}")))?,
            ),
        };
        Ok((name.to_owned(), scheduled_at))
    }
}

async fn create(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    let releases = service(&state)?;
    let principal = require(&state, &headers, actions::RELEASES_MANAGE).await?;
    let (name, scheduled_at) = body::<ReleaseBody>(&bytes)?.validated()?;
    let id =
        releases.create(&name, scheduled_at, Some(principal.user.id)).await.map_err(internal)?;
    let release = releases.get(id).await.map_err(internal)?;
    Ok((StatusCode::CREATED, data(release)).into_response())
}

async fn get_one(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let releases = service(&state)?;
    require(&state, &headers, actions::RELEASES_MANAGE).await?;
    Ok(data(releases.get(id).await.map_err(internal)?.ok_or(ApiError::NotFound)?))
}

async fn pending(releases: &Releases, id: i64) -> Result<(), ApiError> {
    let release = releases.get(id).await.map_err(internal)?.ok_or(ApiError::NotFound)?;
    if release.status == "pending" {
        Ok(())
    } else {
        Err(ApiError::Conflict(format!("the release is {}", release.status)))
    }
}

async fn update(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let releases = service(&state)?;
    require(&state, &headers, actions::RELEASES_MANAGE).await?;
    let (name, scheduled_at) = body::<ReleaseBody>(&bytes)?.validated()?;
    pending(releases, id).await?;
    releases.update(id, &name, scheduled_at).await.map_err(internal)?;
    Ok(data(releases.get(id).await.map_err(internal)?))
}

async fn remove(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let releases = service(&state)?;
    require(&state, &headers, actions::RELEASES_MANAGE).await?;
    if !releases.delete(id).await.map_err(internal)? {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionBody {
    uid: String,
    document_id: String,
    #[serde(default)]
    locale: Option<String>,
    action: String,
}

async fn add_action(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let releases = service(&state)?;
    require(&state, &headers, actions::RELEASES_MANAGE).await?;
    let action: ActionBody = body(&bytes)?;
    if !matches!(action.action.as_str(), "publish" | "unpublish") {
        return Err(ApiError::BadRequest("action must be publish or unpublish".into()));
    }
    let (principal, grant) =
        content_grant(&state, &headers, &action.uid, actions::CONTENT_PUBLISH).await?;
    let model = state.service.registry().get(&action.uid)?;
    if !model.draft_and_publish() {
        return Err(ApiError::BadRequest(format!("{} has no draft and publish", action.uid)));
    }
    let locale = if model.content_type.localized {
        let service = state.service.in_locale(action.locale.clone().filter(|l| !l.is_empty()));
        // Resolves (and checks) the locale; the document must exist in it.
        service.created_by(&action.uid, &action.document_id).await?;
        action.locale.clone().filter(|l| !l.is_empty()).unwrap_or_default()
    } else {
        state.service.created_by(&action.uid, &action.document_id).await?;
        String::new()
    };
    if grant == Grant::Own {
        ensure_owner(&state, &action.uid, &action.document_id, &principal, grant).await?;
    }
    pending(releases, id).await?;
    releases
        .add_action(id, &action.uid, &action.document_id, &locale, &action.action)
        .await
        .map_err(internal)?;
    Ok(data(releases.get(id).await.map_err(internal)?))
}

async fn remove_action(
    State(state): State<AdminState>,
    Path((id, action_id)): Path<(i64, i64)>,
    headers: HeaderMap,
) -> ApiResult {
    let releases = service(&state)?;
    require(&state, &headers, actions::RELEASES_MANAGE).await?;
    pending(releases, id).await?;
    if !releases.remove_action(id, action_id).await.map_err(internal)? {
        return Err(ApiError::NotFound);
    }
    Ok(data(releases.get(id).await.map_err(internal)?))
}

async fn publish(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let releases = service(&state)?;
    let principal = require(&state, &headers, actions::RELEASES_MANAGE).await?;
    pending(releases, id).await?;
    let release = releases.run(id, Some(principal.user.id)).await.map_err(internal)?;
    Ok(data(release.ok_or(ApiError::NotFound)?))
}

async fn for_entry(
    State(state): State<AdminState>,
    Path((uid, document_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> ApiResult {
    let releases = service(&state)?;
    let (principal, grant) = content_grant(&state, &headers, &uid, actions::CONTENT_READ).await?;
    ensure_owner(&state, &uid, &document_id, &principal, grant).await?;
    if !principal.permissions.allows(actions::RELEASES_MANAGE) {
        return Ok(data(Vec::<()>::new()));
    }
    Ok(data(releases.for_entry(&uid, &document_id).await.map_err(internal)?))
}
