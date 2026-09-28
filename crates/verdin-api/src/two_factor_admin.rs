//! Two-factor authentication: the second sign-in step (public), the signed-in admin's
//! factors (reachable while their role waits for one), and resetting another admin's.

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use serde::Deserialize;
use serde_json::json;
use verdin_auth::actions;

use super::{
    AdminState, ApiResult, ClientIp, body, data, principal_during_setup, rate_limit, require,
    session_response, user_agent,
};

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/auth/login/two-factor", post(login_two_factor))
        .route("/auth/two-factor", get(status))
        .route("/auth/two-factor/totp/setup", post(totp_setup))
        .route("/auth/two-factor/totp/enable", post(totp_enable))
        .route("/auth/two-factor/totp/disable", post(totp_disable))
        .route("/auth/two-factor/recovery-codes", post(recovery_codes))
        .route("/users/{id}/two-factor", delete(reset))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SecondStep {
    two_factor_token: String,
    code: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PasswordBody {
    password: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CodeBody {
    code: String,
}

/// `{ twoFactorToken, code }`: a TOTP or recovery code finishes signing in.
async fn login_two_factor(
    State(state): State<AdminState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    rate_limit(&state, &ip)?;
    let input: SecondStep = body(&bytes)?;
    let session = state
        .auth
        .login_with_code(&input.two_factor_token, &input.code, user_agent(&headers))
        .await?;
    Ok(session_response(&state, session, StatusCode::OK))
}

async fn status(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    let principal = principal_during_setup(&state, &headers).await?;
    Ok(data(state.auth.two_factor_status(principal.user.id).await?))
}

async fn totp_setup(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal_during_setup(&state, &headers).await?;
    let input: PasswordBody = body(&bytes)?;
    let setup = state.auth.totp_setup(principal.user.id, &input.password).await?;
    let mut response = data(setup);
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

async fn totp_enable(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal_during_setup(&state, &headers).await?;
    let input: CodeBody = body(&bytes)?;
    let codes = state.auth.totp_enable(principal.user.id, &input.code).await?;
    let mut response = data(json!({ "recoveryCodes": codes }));
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

async fn totp_disable(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal_during_setup(&state, &headers).await?;
    let input: PasswordBody = body(&bytes)?;
    let status = state.auth.two_factor_status(principal.user.id).await?;
    if status.required && status.passkeys.is_empty() {
        return Err(crate::error::ApiError::BadRequest(
            "your role requires a second factor: add a passkey before turning TOTP off".into(),
        ));
    }
    state.auth.totp_disable(principal.user.id, &input.password).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn recovery_codes(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal_during_setup(&state, &headers).await?;
    let input: PasswordBody = body(&bytes)?;
    let codes = state.auth.regenerate_recovery_codes(principal.user.id, &input.password).await?;
    let mut response = data(json!({ "recoveryCodes": codes }));
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

/// Removes every second factor of an admin who lost theirs (`users.manage`).
async fn reset(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let principal = require(&state, &headers, actions::USERS_MANAGE).await?;
    // A Super Admin's factors only yield to another Super Admin.
    let target = state.auth.user(id).await?;
    let target_is_super = target.roles.iter().any(|role| role.code == verdin_auth::SUPER_ADMIN);
    if target_is_super && !principal.permissions.super_admin {
        return Err(crate::error::ApiError::Forbidden);
    }
    state.auth.reset_two_factor(id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
