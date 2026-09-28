//! Review workflows in the admin: `workflows.manage` edits them; editors see and move the
//! stage of the entries they may update, and assign them to other admins.

use std::collections::HashSet;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, RawQuery, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use serde::Deserialize;
use serde_json::{Value, json};
use verdin_auth::{AdminPrincipal, Grant, actions};

use super::{
    AdminState, ApiResult, body, content_grant, data, double_option, ensure_owner, principal,
    require,
};
use crate::error::ApiError;
use crate::review::{Review, Workflow, WorkflowInput};

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/review-workflows", get(list).post(create))
        .route("/review-workflows/{id}", get(get_one).put(update).delete(remove))
        .route("/review/assigned", get(assigned))
        .route("/review/assignees", get(assignees))
        .route("/review/roles", get(roles))
        .route("/content/{uid}/review", get(entries))
        .route("/content/{uid}/{document_id}/review", get(entry).put(update_entry))
}

fn service(state: &AdminState) -> Result<&Review, ApiError> {
    state.config.review.as_ref().ok_or(ApiError::NotFound)
}

fn internal(error: impl std::fmt::Display) -> ApiError {
    ApiError::Internal(error.to_string())
}

fn known_types(state: &AdminState) -> HashSet<String> {
    state.service.registry().types().map(|model| model.content_type.uid.clone()).collect()
}

async fn list(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    let review = service(&state)?;
    require(&state, &headers, actions::WORKFLOWS_MANAGE).await?;
    Ok(data(review.list()))
}

async fn get_one(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let review = service(&state)?;
    require(&state, &headers, actions::WORKFLOWS_MANAGE).await?;
    Ok(data(review.get(id).ok_or(ApiError::NotFound)?))
}

async fn create(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    let review = service(&state)?;
    require(&state, &headers, actions::WORKFLOWS_MANAGE).await?;
    let input: WorkflowInput = body(&bytes)?;
    let id = review.save(None, &input, &known_types(&state)).await?;
    Ok((StatusCode::CREATED, data(review.get(id))).into_response())
}

async fn update(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let review = service(&state)?;
    require(&state, &headers, actions::WORKFLOWS_MANAGE).await?;
    review.get(id).ok_or(ApiError::NotFound)?;
    let input: WorkflowInput = body(&bytes)?;
    review.save(Some(id), &input, &known_types(&state)).await?;
    Ok(data(review.get(id)))
}

async fn remove(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let review = service(&state)?;
    require(&state, &headers, actions::WORKFLOWS_MANAGE).await?;
    if !review.delete(id).await? {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// The locale key of an entry: the requested (or default) locale for localized types.
fn locale_key(state: &AdminState, uid: &str, raw: Option<&str>) -> Result<String, ApiError> {
    let model = state.service.registry().get(uid)?;
    if !model.content_type.localized {
        return Ok(String::new());
    }
    Ok(crate::handlers::locale_param(raw)?.unwrap_or_else(|| state.config.locales.default_code()))
}

/// Stages the admin may move entries into.
fn movable(principal: &AdminPrincipal, workflow: &Workflow) -> Vec<i64> {
    let manager = principal.permissions.allows(actions::WORKFLOWS_MANAGE);
    workflow
        .stages
        .iter()
        .filter(|stage| {
            manager
                || stage.roles.is_empty()
                || principal.user.roles.iter().any(|role| stage.roles.contains(&role.code))
        })
        .map(|stage| stage.id)
        .collect()
}

async fn entry(
    State(state): State<AdminState>,
    Path((uid, document_id)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
) -> ApiResult {
    let review = service(&state)?;
    let (principal, grant) = content_grant(&state, &headers, &uid, actions::CONTENT_READ).await?;
    ensure_owner(&state, &uid, &document_id, &principal, grant).await?;
    let Some(workflow) = review.workflow_for(&uid) else { return Ok(data(Value::Null)) };
    let locale = locale_key(&state, &uid, raw.as_deref())?;
    let entry = review.entry(&uid, &document_id, &locale).await.map_err(internal)?;
    let updatable = principal.permissions.content(actions::CONTENT_UPDATE, &uid) != Grant::None;
    Ok(data(json!({
        "workflow": workflow,
        // Entries created before their type joined the workflow start at the first stage.
        "stageId": entry.as_ref().map_or(workflow.stages[0].id, |entry| entry.stage_id),
        "assigneeId": entry.as_ref().and_then(|entry| entry.assignee_id),
        "updatedAt": entry.as_ref().and_then(|entry| entry.updated_at.clone()),
        "updatedBy": entry.as_ref().and_then(|entry| entry.updated_by),
        "canMoveTo": if updatable { movable(&principal, &workflow) } else { Vec::new() },
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EntryChange {
    #[serde(default)]
    stage_id: Option<i64>,
    #[serde(default, deserialize_with = "double_option")]
    assignee_id: Option<Option<i64>>,
}

async fn update_entry(
    State(state): State<AdminState>,
    Path((uid, document_id)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let review = service(&state)?;
    let (principal, grant) = content_grant(&state, &headers, &uid, actions::CONTENT_UPDATE).await?;
    ensure_owner(&state, &uid, &document_id, &principal, grant).await?;
    // The entry must exist (in this locale, for localized types).
    let locale = locale_key(&state, &uid, raw.as_deref())?;
    let localized = state.service.in_locale((!locale.is_empty()).then(|| locale.clone()));
    localized.created_by(&uid, &document_id).await?;
    let workflow = review.workflow_for(&uid).ok_or(ApiError::NotFound)?;
    let change: EntryChange = body(&bytes)?;
    if let Some(stage) = change.stage_id {
        if workflow.stage(stage).is_none() {
            return Err(ApiError::BadRequest(format!(
                "stage {stage} is not part of {}",
                workflow.name
            )));
        }
        if !movable(&principal, &workflow).contains(&stage) {
            return Err(ApiError::Forbidden);
        }
    }
    if let Some(Some(assignee)) = change.assignee_id {
        let user = state
            .auth
            .user(assignee)
            .await
            .map_err(|_| ApiError::BadRequest(format!("no admin {assignee}")))?;
        let reader = state.auth.permission_set(user.id).await?;
        if !user.is_active || reader.content(actions::CONTENT_READ, &uid) == Grant::None {
            return Err(ApiError::BadRequest(format!("{} cannot read {uid}", user.email)));
        }
    }
    let before = review.entry(&uid, &document_id, &locale).await.map_err(internal)?;
    let updated = review
        .update_entry(
            &uid,
            &document_id,
            &locale,
            change.stage_id,
            change.assignee_id,
            Some(principal.user.id),
        )
        .await?;
    let from = before.as_ref().map_or(workflow.stages[0].id, |entry| entry.stage_id);
    if let Some(webhooks) = &state.config.webhooks
        && from != updated.stage_id
    {
        let stage =
            |id: i64| workflow.stage(id).map(|stage| json!({ "id": stage.id, "name": stage.name }));
        let data = json!({
            "model": uid,
            "entry": { "documentId": document_id, "locale": (!locale.is_empty()).then_some(&locale) },
            "workflow": { "id": workflow.id, "name": workflow.name },
            "stages": { "from": stage(from), "to": stage(updated.stage_id) },
        });
        webhooks.emit("review-workflows.updateEntryStage", Some(&uid), data).await;
    }
    if let Some(audit) = &state.config.audit {
        let record = |action: &str, details: Value| {
            let entry = crate::audit::AuditEntry {
                actor_kind: "admin",
                actor_id: Some(principal.user.id),
                action: action.into(),
                subject: Some(uid.clone()),
                subject_id: Some(document_id.clone()),
                details,
                ip: None,
            };
            let audit = audit.clone();
            async move { audit.record(entry).await }
        };
        if before.as_ref().map(|entry| entry.stage_id) != Some(updated.stage_id) {
            let name = workflow.stage(updated.stage_id).map(|stage| stage.name.clone());
            record("entry.stage", json!({ "stage": name, "locale": locale })).await;
        }
        if before.as_ref().and_then(|entry| entry.assignee_id) != updated.assignee_id {
            record("entry.assign", json!({ "assignee": updated.assignee_id, "locale": locale }))
                .await;
        }
    }
    Ok(data(updated))
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct EntriesQuery {
    /// Comma-separated.
    document_ids: String,
    locale: Option<String>,
}

/// `GET /content/{uid}/review?documentIds=a,b`: stages of list rows.
async fn entries(
    State(state): State<AdminState>,
    Path(uid): Path<String>,
    Query(query): Query<EntriesQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let review = service(&state)?;
    content_grant(&state, &headers, &uid, actions::CONTENT_READ).await?;
    if review.workflow_for(&uid).is_none() {
        return Ok(data(Vec::<()>::new()));
    }
    let ids: Vec<String> = query
        .document_ids
        .split(',')
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .take(200)
        .map(str::to_owned)
        .collect();
    let raw = query.locale.map(|locale| format!("locale={locale}"));
    let locale = locale_key(&state, &uid, raw.as_deref())?;
    let entries = review.entries(&uid, &ids, &locale).await.map_err(internal)?;
    Ok(axum::Json(json!({ "data": entries, "meta": { "workflow": review.workflow_for(&uid) } }))
        .into_response())
}

#[derive(Deserialize)]
struct AssigneesQuery {
    uid: String,
}

/// `GET /review/assignees?uid=`: active admins who can read the type, for whoever may
/// update its entries (they need not manage users).
async fn assignees(
    State(state): State<AdminState>,
    Query(query): Query<AssigneesQuery>,
    headers: HeaderMap,
) -> ApiResult {
    service(&state)?;
    content_grant(&state, &headers, &query.uid, actions::CONTENT_UPDATE).await?;
    let mut candidates = Vec::new();
    for user in state.auth.users().await? {
        if !user.is_active {
            continue;
        }
        let permissions = state.auth.permission_set(user.id).await?;
        if permissions.content(actions::CONTENT_READ, &query.uid) == Grant::None {
            continue;
        }
        candidates.push(json!({
            "id": user.id,
            "email": user.email,
            "firstname": user.firstname,
            "lastname": user.lastname,
        }));
    }
    Ok(data(candidates))
}

/// `GET /review/roles`: role codes and names for stage permissions (`workflows.manage`
/// without `roles.manage`).
async fn roles(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    service(&state)?;
    require(&state, &headers, actions::WORKFLOWS_MANAGE).await?;
    let roles: Vec<Value> = state
        .auth
        .roles()
        .await?
        .into_iter()
        .map(|role| json!({ "id": role.id, "code": role.code, "name": role.name }))
        .collect();
    Ok(data(roles))
}

/// `GET /review/assigned`: entries assigned to the caller, among types they can read.
async fn assigned(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    let review = service(&state)?;
    let principal = principal(&state, &headers).await?;
    let entries: Vec<_> = review
        .assigned_to(principal.user.id)
        .await
        .map_err(internal)?
        .into_iter()
        .filter(|entry| {
            principal.permissions.content(actions::CONTENT_READ, &entry.uid) != Grant::None
        })
        .collect();
    Ok(data(entries))
}
