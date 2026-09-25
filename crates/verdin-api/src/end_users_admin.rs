//! Settings → End users: accounts and roles of the content API's end users, and a test
//! email. Everything needs `endusers.manage` (the test email `features.manage`).

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use bytes::Bytes;
use serde::Deserialize;
use serde_json::{Value, json};
use verdin_auth::actions;
use verdin_auth::users::{AUTHENTICATED, EndUser, EndUserQuery, EndUserUpdate, NewEndUser};

use super::{AdminState, ApiResult, GrantBody, body, data, grants, require};
use crate::error::ApiError;

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/end-users", get(list).post(create))
        .route("/end-users/{id}", get(get_one).put(update).delete(remove))
        .route("/end-user-roles", get(roles).post(create_role))
        .route("/end-user-roles/{id}", axum::routing::put(update_role).delete(delete_role))
        .route("/email/test", post(test_email))
}

fn id(raw: &str) -> Result<i64, ApiError> {
    raw.parse().map_err(|_| ApiError::NotFound)
}

fn user_json(user: &EndUser) -> Value {
    let mut value = serde_json::to_value(user).expect("users serialize");
    value["role"] = json!({ "id": user.role.id, "name": user.role.name, "type": user.role.kind });
    value
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct ListQuery {
    page: Option<u64>,
    page_size: Option<u64>,
    search: Option<String>,
}

async fn list(
    State(state): State<AdminState>,
    Query(query): Query<ListQuery>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::ENDUSERS_MANAGE).await?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(25).clamp(1, 100);
    let (users, total) =
        state.auth.end_users(&EndUserQuery { page, page_size, search: query.search }).await?;
    Ok(axum::Json(json!({
        "data": users.iter().map(user_json).collect::<Vec<_>>(),
        "meta": { "pagination": {
            "page": page, "pageSize": page_size, "total": total,
            "pageCount": (total as u64).div_ceil(page_size),
        } },
    }))
    .into_response())
}

async fn get_one(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::ENDUSERS_MANAGE).await?;
    Ok(data(user_json(&state.auth.end_user(id(&raw)?).await?)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NewUser {
    username: String,
    email: String,
    password: String,
    #[serde(default = "yes")]
    confirmed: bool,
    #[serde(default)]
    blocked: bool,
    role: Option<i64>,
}

fn yes() -> bool {
    true
}

async fn create(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    require(&state, &headers, actions::ENDUSERS_MANAGE).await?;
    let input: NewUser = body(&bytes)?;
    let (user, _) = state
        .auth
        .create_end_user(
            NewEndUser {
                username: input.username,
                email: input.email,
                password: Some(input.password),
                provider: "local".into(),
                confirmed: input.confirmed,
                blocked: input.blocked,
                role: None,
            },
            AUTHENTICATED,
        )
        .await?;
    let user = match input.role {
        Some(role_id) if role_id != user.role.id => {
            state
                .auth
                .update_end_user(
                    user.id,
                    EndUserUpdate { role_id: Some(role_id), ..Default::default() },
                )
                .await?
        }
        _ => user,
    };
    Ok((StatusCode::CREATED, axum::Json(json!({ "data": user_json(&user) }))).into_response())
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct UserChange {
    username: Option<String>,
    email: Option<String>,
    password: Option<String>,
    confirmed: Option<bool>,
    blocked: Option<bool>,
    role: Option<i64>,
}

async fn update(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::ENDUSERS_MANAGE).await?;
    let input: UserChange = body(&bytes)?;
    let user = state
        .auth
        .update_end_user(
            id(&raw)?,
            EndUserUpdate {
                username: input.username,
                email: input.email,
                password: input.password.filter(|password| !password.is_empty()),
                confirmed: input.confirmed,
                blocked: input.blocked,
                role_id: input.role,
            },
        )
        .await?;
    Ok(data(user_json(&user)))
}

async fn remove(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::ENDUSERS_MANAGE).await?;
    state.auth.delete_end_user(id(&raw)?).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn roles(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    require(&state, &headers, actions::ENDUSERS_MANAGE).await?;
    let roles = state.auth.end_user_roles().await?;
    let list: Vec<Value> = roles
        .into_iter()
        .map(|(role, grants, users)| {
            let mut permissions: Vec<Value> = grants
                .into_iter()
                .map(|(subject, action)| json!({ "subject": subject, "action": action.as_str() }))
                .collect();
            permissions.sort_by_key(|grant| grant.to_string());
            json!({
                "id": role.id, "name": role.name, "description": role.description, "type": role.kind,
                "users": users, "permissions": permissions,
            })
        })
        .collect();
    Ok(data(list))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RoleBody {
    name: String,
    description: Option<String>,
    #[serde(default)]
    permissions: Vec<GrantBody>,
}

async fn save_role(
    state: AdminState,
    headers: HeaderMap,
    id: Option<i64>,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::ENDUSERS_MANAGE).await?;
    let input: RoleBody = body(&bytes)?;
    let grants = grants(&state, input.permissions)?;
    state.auth.save_end_user_role(id, &input.name, input.description.as_deref(), &grants).await?;
    let response = roles(State(state), headers).await?;
    let status = if id.is_none() { StatusCode::CREATED } else { StatusCode::OK };
    Ok((status, response).into_response())
}

async fn create_role(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    save_role(state, headers, None, bytes).await
}

async fn update_role(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let role = id(&raw)?;
    save_role(state, headers, Some(role), bytes).await
}

async fn delete_role(
    State(state): State<AdminState>,
    Path(raw): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::ENDUSERS_MANAGE).await?;
    state.auth.delete_end_user_role(id(&raw)?).await?;
    roles(State(state), headers).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TestEmail {
    to: String,
}

/// `POST /email/test`: sends a message through `[email]`.
async fn test_email(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::FEATURES_MANAGE).await?;
    let mailer = state.config.mailer.as_ref().ok_or(ApiError::NotFound)?;
    let input: TestEmail = body(&bytes)?;
    let message = verdin_email::Message {
        to: input.to.trim().to_owned(),
        subject: "Verdin test email".into(),
        text: "This is a test email from Verdin: email delivery works.".into(),
        html: None,
    };
    match mailer.send(&message).await {
        Ok(()) => {
            Ok(data(json!({ "sent": true, "provider": mailer.provider(), "from": mailer.from() })))
        }
        Err(verdin_email::EmailError::Address(address)) => {
            Err(ApiError::BadRequest(format!("invalid address `{address}`")))
        }
        Err(error) => Ok(data(
            json!({ "sent": false, "provider": mailer.provider(), "error": error.to_string() }),
        )),
    }
}
