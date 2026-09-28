//! `/api/users`: end users managed over the content API, as in Strapi's users-permissions.
//! Roles (and API tokens) are granted `find`, `findOne`, `create`, `update` and `delete`
//! on the subject `plugin::users-permissions.user`. Answers are plain JSON (no `data`
//! envelope), like Strapi's.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use serde::Deserialize;
use serde_json::{Value, json};
use verdin_auth::users::{AUTHENTICATED, EndUser, EndUserQuery, EndUserUpdate, NewEndUser};
use verdin_auth::{AuthError, ContentAction, USERS_SUBJECT};

use super::{ApiResult, Users, account_error, body};
use crate::error::ApiError;

async fn allow(users: &Users, headers: &HeaderMap, action: ContentAction) -> Result<(), ApiError> {
    let actor =
        users.auth.content_actor(crate::handlers::bearer(headers)?).await.map_err(|error| {
            match error {
                AuthError::Unauthorized => ApiError::Unauthorized,
                other => ApiError::from(other),
            }
        })?;
    if actor.allows(USERS_SUBJECT, action) { Ok(()) } else { Err(ApiError::Forbidden) }
}

fn with_role(user: &EndUser, populate: bool) -> Value {
    let mut value = serde_json::to_value(user).expect("users serialize");
    if populate {
        value["role"] = json!({
            "id": user.role.id,
            "name": user.role.name,
            "description": user.role.description,
            "type": user.role.kind,
        });
    }
    value
}

fn id(raw: &str) -> Result<i64, ApiError> {
    raw.parse().map_err(|_| ApiError::NotFound)
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub(super) struct FindQuery {
    /// `populate=role` or `populate=*`.
    populate: Option<String>,
    #[serde(rename = "pagination[page]")]
    page: Option<u64>,
    #[serde(rename = "pagination[pageSize]")]
    page_size: Option<u64>,
    /// Username or email containing it.
    #[serde(rename = "_q")]
    search: Option<String>,
}

impl FindQuery {
    fn populate_role(&self) -> bool {
        matches!(self.populate.as_deref(), Some("role" | "*"))
    }
}

pub(super) async fn find(
    State(users): State<Users>,
    Query(query): Query<FindQuery>,
    headers: HeaderMap,
) -> ApiResult {
    allow(&users, &headers, ContentAction::Find).await?;
    let (found, _) = users
        .auth
        .end_users(&EndUserQuery {
            page: query.page.unwrap_or(1).max(1),
            page_size: query.page_size.unwrap_or(100).clamp(1, 100),
            search: query.search.clone(),
        })
        .await?;
    let populate = query.populate_role();
    Ok(Json(found.iter().map(|user| with_role(user, populate)).collect::<Vec<_>>()).into_response())
}

pub(super) async fn count(
    State(users): State<Users>,
    Query(query): Query<FindQuery>,
    headers: HeaderMap,
) -> ApiResult {
    allow(&users, &headers, ContentAction::Find).await?;
    let (_, total) =
        users.auth.end_users(&EndUserQuery { page: 1, page_size: 1, search: query.search }).await?;
    Ok(Json(total).into_response())
}

pub(super) async fn find_one(
    State(users): State<Users>,
    Path(raw): Path<String>,
    Query(query): Query<FindQuery>,
    headers: HeaderMap,
) -> ApiResult {
    allow(&users, &headers, ContentAction::FindOne).await?;
    let user = users.auth.end_user(id(&raw)?).await?;
    Ok(Json(with_role(&user, query.populate_role())).into_response())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UserBody {
    username: Option<String>,
    email: Option<String>,
    password: Option<String>,
    confirmed: Option<bool>,
    blocked: Option<bool>,
    /// A role id.
    role: Option<i64>,
}

pub(super) async fn create(
    State(users): State<Users>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    allow(&users, &headers, ContentAction::Create).await?;
    let input: UserBody = body(&bytes)?;
    let (Some(username), Some(email), Some(password)) =
        (input.username, input.email, input.password)
    else {
        return Err(ApiError::BadRequest("username, email and password are required".into()));
    };
    let (user, _) = users
        .auth
        .create_end_user(
            NewEndUser {
                username,
                email,
                password: Some(password),
                provider: "local".into(),
                confirmed: input.confirmed.unwrap_or(true),
                blocked: input.blocked.unwrap_or(false),
                role: None,
            },
            AUTHENTICATED,
        )
        .await
        .map_err(account_error)?;
    let user = match input.role {
        Some(role) if role != user.role.id => users
            .auth
            .update_end_user(user.id, EndUserUpdate { role_id: Some(role), ..Default::default() })
            .await
            .map_err(account_error)?,
        _ => user,
    };
    Ok((StatusCode::CREATED, Json(with_role(&user, true))).into_response())
}

pub(super) async fn update(
    State(users): State<Users>,
    Path(raw): Path<String>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    allow(&users, &headers, ContentAction::Update).await?;
    let input: UserBody = body(&bytes)?;
    let update = EndUserUpdate {
        username: input.username,
        email: input.email,
        password: input.password,
        confirmed: input.confirmed,
        blocked: input.blocked,
        role_id: input.role,
    };
    let user = users.auth.update_end_user(id(&raw)?, update).await.map_err(account_error)?;
    Ok(Json(with_role(&user, true)).into_response())
}

pub(super) async fn remove(
    State(users): State<Users>,
    Path(raw): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    allow(&users, &headers, ContentAction::Delete).await?;
    let user = users.auth.end_user(id(&raw)?).await?;
    users.auth.delete_end_user(user.id).await?;
    Ok(Json(with_role(&user, false)).into_response())
}
