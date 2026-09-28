//! Admins' accounts: invitations and password resets (public routes, with one-time links),
//! the signed-in admin's profile and sessions, and regenerating API tokens.

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use serde::Deserialize;
use serde_json::json;
use verdin_auth::account::LinkKind;
use verdin_auth::{AdminUser, AuthError, UserUpdate, actions};

use super::{
    AdminState, ApiResult, ClientIp, body, data, double_option, principal, rate_limit,
    refresh_cookie, require, session_response, user_agent,
};
use crate::error::ApiError;

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/auth/invitation", get(invitation))
        .route("/auth/accept-invitation", post(accept_invitation))
        .route("/auth/forgot-password", post(forgot_password))
        .route("/auth/reset-password", post(reset_password))
        .route("/users/me", get(profile).put(update_profile))
        // Under `/auth`, where the refresh cookie is sent (to mark the current session).
        .route("/auth/sessions", get(sessions))
        .route("/auth/sessions/{id}", delete(revoke_session))
        .route("/users/{id}/invite", post(reinvite))
        .route("/api-tokens/{id}/regenerate", post(regenerate_token))
}

/// The admin panel's URL for a one-time link.
pub(super) fn link_url(state: &AdminState, kind: LinkKind, token: &str) -> String {
    let page = match kind {
        LinkKind::Invite => "accept-invitation",
        LinkKind::Reset => "reset-password",
    };
    format!(
        "{}{}/auth/{page}?token={token}",
        state.config.public_url.trim_end_matches('/'),
        state.config.path
    )
}

fn display_name(user: &AdminUser) -> String {
    user.firstname.clone().unwrap_or_else(|| user.email.clone())
}

/// Emails a link when a mailer is set up; returns whether it was sent.
async fn send_link(state: &AdminState, user: &AdminUser, kind: LinkKind, url: &str) -> bool {
    let Some(mailer) = &state.config.mailer else { return false };
    let name = display_name(user);
    let (subject, intro, action, lasts) = match kind {
        LinkKind::Invite => (
            "You are invited to Verdin",
            "An account was created for you in the Verdin admin panel.",
            "Choose your password",
            "7 days",
        ),
        LinkKind::Reset => (
            "Reset your Verdin password",
            "Someone asked to reset the password of your Verdin admin account. If it was not you, ignore this email.",
            "Choose a new password",
            "1 hour",
        ),
    };
    let message = verdin_email::Message {
        to: user.email.clone(),
        subject: subject.into(),
        text: format!(
            "Hello {name},\n\n{intro}\n\n{action}: {url}\n\nThe link works for {lasts}.\n"
        ),
        html: Some(format!(
            "<p>Hello {name},</p><p>{intro}</p><p><a href=\"{url}\">{action}</a></p><p style=\"color:#666\">The link works for {lasts}.</p>",
            name = html_escape(&name),
        )),
    };
    match mailer.send(&message).await {
        Ok(()) => true,
        Err(error) => {
            tracing::warn!(%error, user = user.id, "could not send the email");
            false
        }
    }
}

fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Invites a new admin: a link to choose a password, emailed when possible.
pub(super) async fn invite(
    state: &AdminState,
    user: &AdminUser,
) -> Result<serde_json::Value, ApiError> {
    let token = state.auth.issue_link(user.id, LinkKind::Invite).await?;
    let url = link_url(state, LinkKind::Invite, &token);
    let emailed = send_link(state, user, LinkKind::Invite, &url).await;
    Ok(json!({ "inviteUrl": url, "emailed": emailed }))
}

async fn reinvite(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::USERS_MANAGE).await?;
    let user = state.auth.user(id).await?;
    Ok(data(invite(&state, &user).await?))
}

#[derive(Deserialize)]
struct TokenQuery {
    token: String,
}

/// `GET /auth/invitation?token=`: who the invitation is for.
async fn invitation(
    State(state): State<AdminState>,
    ClientIp(ip): ClientIp,
    Query(query): Query<TokenQuery>,
) -> ApiResult {
    rate_limit(&state, &ip)?;
    let user = state.auth.link_user(&query.token, LinkKind::Invite).await.map_err(expired)?;
    Ok(data(json!({ "email": user.email, "firstname": user.firstname, "lastname": user.lastname })))
}

fn expired(error: AuthError) -> ApiError {
    match error {
        AuthError::NotFound => ApiError::BadRequest("this link is invalid or has expired".into()),
        other => other.into(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AcceptBody {
    token: String,
    password: String,
    #[serde(default, deserialize_with = "double_option")]
    firstname: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    lastname: Option<Option<String>>,
}

/// `POST /auth/accept-invitation`: sets the password and signs in.
async fn accept_invitation(
    State(state): State<AdminState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    rate_limit(&state, &ip)?;
    let input: AcceptBody = body(&bytes)?;
    let update =
        UserUpdate { firstname: input.firstname, lastname: input.lastname, ..Default::default() };
    let session = state
        .auth
        .accept_invitation(&input.token, &input.password, update, user_agent(&headers))
        .await
        .map_err(expired)?;
    Ok(session_response(&state, session, StatusCode::OK))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ForgotBody {
    email: String,
}

/// `POST /auth/forgot-password`: always 204, whether the email is known or not.
async fn forgot_password(
    State(state): State<AdminState>,
    ClientIp(ip): ClientIp,
    bytes: Bytes,
) -> ApiResult {
    rate_limit(&state, &ip)?;
    let input: ForgotBody = body(&bytes)?;
    if state.config.mailer.is_none() {
        tracing::warn!("password reset asked but no email provider is set up");
    } else if let Some((user, token)) = state.auth.request_reset(&input.email).await? {
        let url = link_url(&state, LinkKind::Reset, &token);
        send_link(&state, &user, LinkKind::Reset, &url).await;
    }
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResetBody {
    token: String,
    password: String,
}

/// `POST /auth/reset-password`: a new password; every session of the account ends.
async fn reset_password(
    State(state): State<AdminState>,
    ClientIp(ip): ClientIp,
    bytes: Bytes,
) -> ApiResult {
    rate_limit(&state, &ip)?;
    let input: ResetBody = body(&bytes)?;
    state
        .auth
        .use_link(&input.token, LinkKind::Reset, &input.password, UserUpdate::default())
        .await
        .map_err(expired)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn profile(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    Ok(data(principal.user))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProfileBody {
    email: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    firstname: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    lastname: Option<Option<String>>,
    password: Option<String>,
    /// Needed to change the email or the password.
    current_password: Option<String>,
}

/// `PUT /users/me`: the admin's own names, email and password.
async fn update_profile(
    State(state): State<AdminState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let input: ProfileBody = body(&bytes)?;
    let sensitive = input.password.is_some()
        || input
            .email
            .as_ref()
            .is_some_and(|email| !email.trim().eq_ignore_ascii_case(&principal.user.email));
    if sensitive {
        rate_limit(&state, &ip)?;
        let current = input.current_password.as_deref().unwrap_or_default();
        if !state.auth.check_current_password(principal.user.id, current).await? {
            return Err(ApiError::BadRequest("the current password is not correct".into()));
        }
    }
    let update = UserUpdate {
        email: input.email,
        password: input.password.clone(),
        firstname: input.firstname,
        lastname: input.lastname,
        ..Default::default()
    };
    let user = state.auth.update_user(principal.user.id, update).await?;
    // A new password ends every session, this one included: open a new one.
    if input.password.is_some() {
        let session = state.auth.start_session(user.id, user_agent(&headers)).await?;
        return Ok(session_response(&state, session, StatusCode::OK));
    }
    Ok(data(user))
}

async fn sessions(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let current = match refresh_cookie(&headers) {
        Some(token) => state.auth.session_of(&token).await?,
        None => None,
    };
    let sessions: Vec<serde_json::Value> = state
        .auth
        .sessions(principal.user.id)
        .await?
        .into_iter()
        .map(|session| {
            let is_current = current.as_deref() == Some(session.id.as_str());
            let mut value = serde_json::to_value(session).expect("serializable");
            value["current"] = json!(is_current);
            value
        })
        .collect();
    Ok(data(sessions))
}

async fn revoke_session(
    State(state): State<AdminState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    state.auth.revoke_session(principal.user.id, &id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// `POST /api-tokens/{id}/regenerate`: the new secret is shown once, as on creation.
async fn regenerate_token(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::TOKENS_MANAGE).await?;
    let (token, secret) = state.auth.regenerate_api_token(id).await?;
    let mut value = serde_json::to_value(token).expect("serializable");
    value["accessKey"] = json!(secret);
    Ok(data(value))
}
