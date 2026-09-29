//! Admin sign-in through OpenID Connect providers (the `sso` feature):
//! `GET /auth/sso` lists them for the login page, `GET /auth/sso/{id}` goes to the provider
//! and `GET /auth/sso/{id}/callback` comes back with a session (the refresh cookie), then to
//! the panel, which restores the session like on any page load.

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use serde::Deserialize;
use serde_json::json;
use verdin_auth::SsoAccount;
use verdin_auth::crypto::random_token;

use super::{AdminState, ApiResult, ClientIp, cookie, data, feature_host, rate_limit, user_agent};
use crate::error::ApiError;
use crate::features::SSO;
use crate::sso::{self, SsoProvider, SsoSettings};

const SSO_COOKIE: &str = "verdin_sso";

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/auth/sso", get(list))
        .route("/auth/sso/{id}", get(start))
        .route("/auth/sso/{id}/callback", get(callback))
}

fn settings(state: &AdminState) -> Result<SsoSettings, ApiError> {
    let states = feature_host(state)?.states();
    if !states.enabled(SSO) {
        return Ok(SsoSettings::default());
    }
    SsoSettings::parse(states.settings(SSO))
}

fn provider(state: &AdminState, id: &str) -> Result<SsoProvider, ApiError> {
    settings(state)?.provider(id).cloned().ok_or(ApiError::NotFound)
}

/// The client for the provider's endpoints: public addresses only (unless private
/// networks are allowed, as in development).
fn http(state: &AdminState) -> Result<reqwest::Client, ApiError> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .no_proxy();
    if !state.config.allow_private_urls {
        builder = builder.dns_resolver(std::sync::Arc::new(crate::webhooks::PublicResolver));
    }
    builder.build().map_err(|error| ApiError::Internal(error.to_string()))
}

/// Endpoints from discovery must be https URLs that pass the webhook address rules.
fn check_endpoint(state: &AdminState, url: &str) -> Result<(), ApiError> {
    let secure = url::Url::parse(url).is_ok_and(|url| {
        url.scheme() == "https" || (state.config.allow_private_urls && url.scheme() == "http")
    });
    if !secure {
        return Err(ApiError::BadRequest("the provider's endpoints must use https".into()));
    }
    crate::webhooks::check_url(url, state.config.allow_private_urls).map_err(ApiError::BadRequest)
}

fn callback_url(state: &AdminState, id: &str) -> String {
    format!(
        "{}{}/api/auth/sso/{id}/callback",
        state.config.public_url.trim_end_matches('/'),
        state.config.path
    )
}

fn sso_cookie(state: &AdminState, value: &str, max_age: i64) -> HeaderValue {
    let secure = if state.config.secure_cookies { "; Secure" } else { "" };
    let path = format!("{}/api/auth/sso", state.config.path);
    // Lax: the provider sends the browser back with a top-level cross-site navigation.
    HeaderValue::from_str(&format!(
        "{SSO_COOKIE}={value}; HttpOnly; SameSite=Lax; Path={path}; Max-Age={max_age}{secure}"
    ))
    .expect("cookie header is ASCII")
}

/// The OIDC nonce of a sign-in attempt, derived from its state nonce.
fn oidc_nonce(state: &AdminState, id: &str, nonce: &str) -> String {
    state.auth.sign(&format!("sso-nonce:{id}:{nonce}"))
}

/// `GET /auth/sso`: the providers for the login page (none while the feature is off).
async fn list(State(state): State<AdminState>) -> ApiResult {
    let providers = settings(&state).unwrap_or_default().providers;
    Ok(data(
        providers
            .iter()
            .map(|provider| json!({ "id": provider.id, "name": provider.name }))
            .collect::<Vec<_>>(),
    ))
}

/// `GET /auth/sso/{id}`: to the provider's sign-in page.
async fn start(
    State(state): State<AdminState>,
    Path(id): Path<String>,
    ClientIp(ip): ClientIp,
) -> ApiResult {
    rate_limit(&state, &ip)?;
    let provider = provider(&state, &id)?;
    check_endpoint(&state, &provider.issuer)?;
    let discovery = sso::discover(&http(&state)?, &provider.issuer).await?;
    let nonce = random_token();
    let verifier = random_token();
    let signature = state.auth.sign(&format!("sso:{id}:{nonce}"));
    let mut url = url::Url::parse(&discovery.authorization_endpoint)
        .map_err(|error| ApiError::BadRequest(format!("authorization endpoint: {error}")))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &provider.client_id)
        .append_pair("redirect_uri", &callback_url(&state, &id))
        .append_pair("scope", &provider.scopes.join(" "))
        .append_pair("state", &format!("{nonce}.{signature}"))
        .append_pair("nonce", &oidc_nonce(&state, &id, &nonce))
        .append_pair("code_challenge", &sso::pkce_challenge(&verifier))
        .append_pair("code_challenge_method", "S256");
    let mut response = Redirect::to(url.as_str()).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, sso_cookie(&state, &format!("{nonce}.{verifier}"), 600));
    Ok(response)
}

#[derive(Deserialize)]
struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

fn request_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.to_owned())
}

/// `GET /auth/sso/{id}/callback`: back from the provider. Failures go to the login page
/// with `?ssoError=`.
async fn callback(
    State(state): State<AdminState>,
    Path(id): Path<String>,
    Query(query): Query<Callback>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
) -> Response {
    let result = finish(&state, &id, query, &ip, &headers).await;
    let mut response = match result {
        Ok(response) => response,
        Err(error) => {
            let reason = match &error {
                ApiError::BadRequest(message) | ApiError::Internal(message) => message.clone(),
                ApiError::Forbidden => "the sign-in request expired or was not started here".into(),
                ApiError::Unauthorized | ApiError::Content(_) => {
                    "no admin account for this identity".into()
                }
                other => format!("{other:?}"),
            };
            tracing::warn!(provider = %id, %reason, "SSO sign-in failed");
            let target = format!(
                "{}/login?ssoError={}",
                state.config.path,
                url::form_urlencoded::byte_serialize(reason.as_bytes()).collect::<String>()
            );
            Redirect::to(&target).into_response()
        }
    };
    response.headers_mut().append(header::SET_COOKIE, sso_cookie(&state, "", 0));
    response
}

async fn finish(
    state: &AdminState,
    id: &str,
    query: Callback,
    ip: &str,
    headers: &HeaderMap,
) -> Result<Response, ApiError> {
    rate_limit(state, ip)?;
    let provider = provider(state, id)?;
    if let Some(error) = query.error {
        return Err(ApiError::BadRequest(format!("{} refused: {error}", provider.name)));
    }
    let (Some(code), Some(returned)) = (query.code, query.state) else {
        return Err(ApiError::BadRequest("missing code or state".into()));
    };
    let (nonce, signature) = returned.split_once('.').ok_or(ApiError::Forbidden)?;
    let stored = request_cookie(headers, SSO_COOKIE).ok_or(ApiError::Forbidden)?;
    let (cookie_nonce, verifier) = stored.split_once('.').ok_or(ApiError::Forbidden)?;
    if cookie_nonce != nonce
        || !state.auth.verify_signature(&format!("sso:{id}:{nonce}"), signature)
    {
        return Err(ApiError::Forbidden);
    }

    let http = http(state)?;
    check_endpoint(state, &provider.issuer)?;
    let discovery = sso::discover(&http, &provider.issuer).await?;
    check_endpoint(state, &discovery.token_endpoint)?;
    let redirect_uri = callback_url(state, id);
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("client_id", provider.client_id.as_str()),
        ("code_verifier", verifier),
    ];
    // Confidential clients: the secret comes from the environment only.
    let secret = state.config.sso_secrets.get(id).cloned();
    if let Some(secret) = &secret {
        form.push(("client_secret", secret.as_str()));
    }
    let answer: serde_json::Value = http
        .post(&discovery.token_endpoint)
        .header(header::ACCEPT, "application/json")
        .form(&form)
        .send()
        .await
        .map_err(|error| ApiError::BadRequest(format!("token exchange failed: {error}")))?
        .json()
        .await
        .map_err(|_| {
            ApiError::BadRequest("the token endpoint returned an unexpected answer".into())
        })?;
    let id_token = answer["id_token"].as_str().ok_or_else(|| {
        let why = answer["error_description"]
            .as_str()
            .or(answer["error"].as_str())
            .unwrap_or("no ID token");
        ApiError::BadRequest(format!("token exchange failed: {why}"))
    })?;
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let claims = sso::id_token_claims(
        id_token,
        &discovery.issuer,
        &provider.client_id,
        &oidc_nonce(state, id, nonce),
        now,
    )?;

    let email = claims["email"]
        .as_str()
        .ok_or_else(|| ApiError::BadRequest(format!("{} did not share an email", provider.name)))?;
    let verified = claims.get("email_verified") == Some(&serde_json::Value::Bool(true));
    if !verified && !provider.trust_unverified_email {
        return Err(ApiError::BadRequest("the provider did not verify the email".into()));
    }
    if !sso::allowed_email(&provider, email) {
        return Err(ApiError::BadRequest("this email domain may not sign in".into()));
    }
    let create = if provider.auto_create {
        let mut roles = Vec::new();
        for code in sso::mapped_roles(&provider, &claims) {
            match state.auth.role_by_code(&code).await {
                Ok(role) => roles.push(role.id),
                Err(_) => tracing::warn!(provider = %id, role = %code, "SSO role not found"),
            }
        }
        let text = |key: &str| claims[key].as_str().map(str::to_owned);
        Some(SsoAccount { firstname: text("given_name"), lastname: text("family_name"), roles })
    } else {
        None
    };
    let login = state
        .auth
        .sso_login(email, create, !provider.provider_mfa, user_agent(headers))
        .await
        .map_err(|error| match error {
            verdin_auth::AuthError::InvalidCredentials => ApiError::Unauthorized,
            other => ApiError::from(other),
        })?;
    let session = match login {
        verdin_auth::Login::Session(session) => session,
        // The admin finishes signing in with their second factor on the login page.
        verdin_auth::Login::SecondFactor { token, methods } => {
            let target = format!(
                "{}/login?twoFactorToken={token}&methods={}",
                state.config.path,
                methods.join(",")
            );
            let mut response = Redirect::to(&target).into_response();
            response
                .headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            return Ok(response);
        }
    };
    if let Some(audit) = &state.config.audit {
        audit
            .record(crate::audit::AuditEntry {
                actor_kind: "admin",
                actor_id: Some(session.user.id),
                action: "admin.login".into(),
                subject: Some("sso".into()),
                subject_id: Some(id.to_owned()),
                details: json!({ "provider": id }),
                ip: Some(ip.to_owned()),
            })
            .await;
    }
    let max_age =
        (session.refresh_expires_at - time::OffsetDateTime::now_utc()).whole_seconds().max(0);
    let mut response = Redirect::to(&format!("{}/", state.config.path)).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, cookie(state, &session.refresh_token, max_age));
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}
