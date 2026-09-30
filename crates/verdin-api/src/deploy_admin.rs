//! Deploys (Settings → Deployments): targets are managed with `deploy.manage` and
//! triggered with `deploy.trigger`; providers report states to the signed callback URL.

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use serde::Deserialize;
use serde_json::{Value, json};
use verdin_auth::{AdminPrincipal, actions};

use super::{AdminState, ApiResult, PageQuery, body, data, paged, principal, require};
use crate::deploy::{Deploys, Target};
use crate::error::ApiError;

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/deploy/targets", get(targets).post(create))
        .route("/deploy/targets/{id}", axum::routing::put(update).delete(remove))
        .route("/deploy/targets/{id}/trigger", post(trigger))
        .route("/deploy/deployments", get(deployments))
        .route("/deploy/callback/{id}/{secret}", post(callback))
        .route("/deploy/cdn", get(cdn_status))
        .route("/deploy/cdn/purge", post(cdn_purge))
}

fn service(state: &AdminState) -> Result<&Deploys, ApiError> {
    state.config.deploys.as_ref().ok_or(ApiError::NotFound)
}

/// Admins who may trigger or manage deploys.
async fn deployer(
    state: &AdminState,
    headers: &HeaderMap,
) -> Result<(AdminPrincipal, bool), ApiError> {
    let principal = principal(state, headers).await?;
    let manage = principal.permissions.allows(actions::DEPLOY_MANAGE);
    if manage || principal.permissions.allows(actions::DEPLOY_TRIGGER) {
        Ok((principal, manage))
    } else {
        Err(ApiError::Forbidden)
    }
}

/// Callback paths as full URLs.
fn with_urls(state: &AdminState, mut target: Target) -> Target {
    if let Some(path) = &target.callback_path {
        target.callback_path = Some(format!(
            "{}{}/api{path}",
            state.config.public_url.trim_end_matches('/'),
            state.config.path
        ));
    }
    target
}

/// `GET /deploy/targets?page=&pageSize=`: oldest first.
async fn targets(
    State(state): State<AdminState>,
    Query(query): Query<PageQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let deploys = service(&state)?;
    let (_, manage) = deployer(&state, &headers).await?;
    let (targets, total) = deploys.targets_page(manage, query.page(), query.size()).await?;
    let targets: Vec<_> = targets.into_iter().map(|target| with_urls(&state, target)).collect();
    Ok(paged(targets, query, total, json!({})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewTarget {
    name: String,
    url: String,
}

async fn create(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    let deploys = service(&state)?;
    require(&state, &headers, actions::DEPLOY_MANAGE).await?;
    let input: NewTarget = body(&bytes)?;
    let target = deploys.create_target(&input.name, &input.url).await?;
    Ok((StatusCode::CREATED, data(with_urls(&state, target))).into_response())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TargetPatch {
    name: Option<String>,
    url: Option<String>,
}

async fn update(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let deploys = service(&state)?;
    require(&state, &headers, actions::DEPLOY_MANAGE).await?;
    let input: TargetPatch = body(&bytes)?;
    let target = deploys.update_target(id, input.name.as_deref(), input.url.as_deref()).await?;
    Ok(data(with_urls(&state, target)))
}

async fn remove(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let deploys = service(&state)?;
    require(&state, &headers, actions::DEPLOY_MANAGE).await?;
    deploys.delete_target(id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn trigger(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let deploys = service(&state)?;
    let (principal, _) = deployer(&state, &headers).await?;
    let deployment = deploys.trigger(id, Some(principal.user.id), &principal.user.email).await?;
    Ok((StatusCode::CREATED, data(deployment)).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeploymentsQuery {
    target_id: Option<i64>,
    page: Option<u64>,
    page_size: Option<u64>,
    /// Deprecated alias of `pageSize` (before 0.11).
    limit: Option<u64>,
}

/// `GET /deploy/deployments?targetId=&page=&pageSize=`: newest first.
async fn deployments(
    State(state): State<AdminState>,
    Query(query): Query<DeploymentsQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let deploys = service(&state)?;
    deployer(&state, &headers).await?;
    let page = PageQuery { page: query.page, page_size: query.page_size.or(query.limit) };
    let (rows, total) = deploys.deployments(query.target_id, page.page(), page.size()).await?;
    Ok(paged(rows, page, total, json!({})))
}

/// Providers' notifications (public: the path carries the target's secret).
async fn callback(
    State(state): State<AdminState>,
    Path((id, secret)): Path<(i64, String)>,
    bytes: Bytes,
) -> ApiResult {
    let deploys = service(&state)?;
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    if deploys.report(id, &secret, &body).await? {
        Ok(StatusCode::NO_CONTENT.into_response())
    } else {
        Err(ApiError::NotFound)
    }
}

/// The CDN provider and recent purges (`deploy.manage`).
async fn cdn_status(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    require(&state, &headers, actions::DEPLOY_MANAGE).await?;
    Ok(data(match &state.config.cdn {
        Some(cdn) => serde_json::json!({ "provider": cdn.provider(), "recent": cdn.recent() }),
        None => serde_json::json!({ "provider": "none", "recent": [] }),
    }))
}

/// Purges everything Verdin served through the CDN.
async fn cdn_purge(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    require(&state, &headers, actions::DEPLOY_MANAGE).await?;
    let cdn = state
        .config
        .cdn
        .as_ref()
        .ok_or_else(|| ApiError::BadRequest("no CDN is configured ([cdn])".into()))?;
    cdn.queue([crate::cdn::ALL.to_owned()]);
    cdn.flush().await;
    Ok(data(cdn.recent().into_iter().next()))
}
