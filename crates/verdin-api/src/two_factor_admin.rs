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
use verdin_auth::passkeys::RelyingParty;

use crate::error::ApiError;

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
        .route("/auth/two-factor/passkeys/options", post(passkey_options))
        .route("/auth/two-factor/passkeys", post(add_passkey))
        .route("/auth/two-factor/passkeys/{id}", delete(remove_passkey))
        .route("/auth/login/passkey/options", post(login_passkey_options))
        .route("/users/{id}/two-factor", delete(reset))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SecondStep {
    two_factor_token: String,
    /// A TOTP or recovery code…
    code: Option<String>,
    /// …or a passkey assertion for the challenge of `/auth/login/passkey/options`.
    challenge_token: Option<String>,
    credential: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TokenBody {
    two_factor_token: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct NewPasskey {
    challenge_token: String,
    #[serde(default)]
    name: String,
    credential: serde_json::Value,
}

/// The admin panel's origin, which passkeys are bound to.
fn relying_party(state: &AdminState) -> Result<RelyingParty, ApiError> {
    RelyingParty::from_url(&state.config.public_url, "Verdin").ok_or_else(|| {
        ApiError::Internal("server.public_url is not a valid URL: passkeys need it".into())
    })
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
    let agent = user_agent(&headers);
    let session = match (&input.code, &input.challenge_token, &input.credential) {
        (Some(code), None, None) => {
            state.auth.login_with_code(&input.two_factor_token, code, agent).await?
        }
        (None, Some(challenge), Some(credential)) => {
            let rp = relying_party(&state)?;
            state
                .auth
                .login_with_passkey(&input.two_factor_token, &rp, challenge, credential, agent)
                .await?
        }
        _ => {
            return Err(ApiError::BadRequest(
                "send a `code`, or a `challengeToken` and `credential`".into(),
            ));
        }
    };
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
        return Err(ApiError::BadRequest(
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

async fn passkey_options(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal_during_setup(&state, &headers).await?;
    let input: PasswordBody = body(&bytes)?;
    let rp = relying_party(&state)?;
    Ok(data(
        state.auth.passkey_registration_options(principal.user.id, &input.password, &rp).await?,
    ))
}

async fn add_passkey(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal_during_setup(&state, &headers).await?;
    let input: NewPasskey = body(&bytes)?;
    let rp = relying_party(&state)?;
    let (passkey, codes) = state
        .auth
        .add_passkey(principal.user.id, &rp, &input.challenge_token, &input.name, &input.credential)
        .await?;
    let mut response =
        (StatusCode::CREATED, data(json!({ "passkey": passkey, "recoveryCodes": codes })))
            .into_response();
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

async fn remove_passkey(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal_during_setup(&state, &headers).await?;
    let input: PasswordBody = body(&bytes)?;
    let status = state.auth.two_factor_status(principal.user.id).await?;
    if status.required && !status.totp && status.passkeys.len() == 1 {
        return Err(ApiError::BadRequest(
            "your role requires a second factor: add another before removing this one".into(),
        ));
    }
    state.auth.remove_passkey(principal.user.id, id, &input.password).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// `{ twoFactorToken }`: the challenge for signing in with a passkey.
async fn login_passkey_options(
    State(state): State<AdminState>,
    ClientIp(ip): ClientIp,
    bytes: Bytes,
) -> ApiResult {
    rate_limit(&state, &ip)?;
    let input: TokenBody = body(&bytes)?;
    let rp = relying_party(&state)?;
    Ok(data(state.auth.passkey_login_options(&input.two_factor_token, &rp).await?))
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
        return Err(ApiError::Forbidden);
    }
    state.auth.reset_two_factor(id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
