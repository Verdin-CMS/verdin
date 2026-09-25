//! End users' routes on the content API (the `users` feature), compatible with Strapi v5's
//! users-permissions plugin: `/auth/local/register`, `/auth/local`, email confirmation,
//! password reset and change, `/users/me`, and OAuth sign-in through `/connect/{provider}`.

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{ConnectInfo, FromRequestParts, Path, Query, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use bytes::Bytes;
use serde::Deserialize;
use serde_json::{Value, json};
use verdin_auth::users::{AUTHENTICATED, EndUser, NewEndUser};
use verdin_auth::{AuthError, AuthService};
use verdin_email::{Mailer, Message, render};

use crate::error::ApiError;
use crate::limiter::RateLimiter;

type ApiResult = Result<Response, ApiError>;

const OAUTH_COOKIE: &str = "verdin_oauth";

/// Settings of the `users` feature (Settings → End users).
#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UsersSettings {
    pub allow_register: bool,
    pub email_confirmation: bool,
    pub default_role: String,
    pub jwt_expires_in_days: u32,
    /// Where `/auth/email-confirmation` redirects after confirming.
    pub email_confirmation_redirection: Option<String>,
    /// The frontend page that receives `?code=` to reset a password.
    pub reset_password_url: Option<String>,
    pub providers: BTreeMap<String, ProviderSettings>,
    pub templates: Templates,
}

impl Default for UsersSettings {
    fn default() -> Self {
        Self {
            allow_register: true,
            email_confirmation: false,
            default_role: AUTHENTICATED.into(),
            jwt_expires_in_days: 30,
            email_confirmation_redirection: None,
            reset_password_url: None,
            providers: BTreeMap::new(),
            templates: Templates::default(),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProviderSettings {
    pub enabled: bool,
    pub client_id: String,
    /// The frontend URL receiving `?access_token=` after the provider's consent screen.
    pub redirect_uri: String,
    pub scope: Option<Vec<String>>,
    /// Generic OAuth 2 providers (and tests): endpoints and the profile's fields.
    pub authorize_url: Option<String>,
    pub token_url: Option<String>,
    pub user_info_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Templates {
    pub confirmation: Template,
    pub reset_password: Template,
}

impl Default for Templates {
    fn default() -> Self {
        Self {
            confirmation: Template {
                subject: "Confirm your account".into(),
                text: "Hello {{username}},\n\nConfirm your account: {{url}}\n\nIf you did not sign up, ignore this email.".into(),
            },
            reset_password: Template {
                subject: "Reset your password".into(),
                text: "Hello {{username}},\n\nReset your password: {{url}}\n\nThe link expires in one hour. If you did not ask for it, ignore this email.".into(),
            },
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct Template {
    pub subject: String,
    pub text: String,
}

/// Everything the routes need.
#[derive(Clone)]
pub struct Users {
    pub auth: AuthService,
    pub settings: Arc<UsersSettings>,
    pub mailer: Mailer,
    /// Absolute URL of the content API (`https://cms.example.com/api`), for email links and
    /// OAuth callbacks.
    pub api_url: String,
    /// Browser-facing requests are over HTTPS (cookies get `Secure`).
    pub secure_cookies: bool,
    /// `VERDIN_OAUTH_<PROVIDER>_SECRET` of the configured providers.
    secrets: Arc<BTreeMap<String, String>>,
    limiter: Arc<RateLimiter>,
    http: reqwest::Client,
}

impl Users {
    pub fn new(
        auth: AuthService,
        settings: UsersSettings,
        mailer: Mailer,
        api_url: String,
        secure_cookies: bool,
    ) -> Self {
        let secrets = settings
            .providers
            .keys()
            .filter_map(|name| Some((name.clone(), std::env::var(secret_variable(name)).ok()?)))
            .collect();
        Self {
            auth,
            secrets: Arc::new(secrets),
            settings: Arc::new(settings),
            mailer,
            api_url: api_url.trim_end_matches('/').to_owned(),
            secure_cookies,
            limiter: Arc::new(RateLimiter::new(20, Duration::from_secs(60))),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("the HTTP client builds"),
        }
    }
}

pub(crate) fn routes(users: Users) -> Router {
    Router::new()
        .route("/auth/local/register", post(register))
        .route("/auth/local", post(login))
        .route("/auth/email-confirmation", get(email_confirmation))
        .route("/auth/send-email-confirmation", post(send_email_confirmation))
        .route("/auth/forgot-password", post(forgot_password))
        .route("/auth/reset-password", post(reset_password))
        .route("/auth/change-password", post(change_password))
        .route("/auth/{provider}/callback", get(provider_callback))
        .route("/users/me", get(me))
        .route("/connect/{provider}", get(connect))
        .route("/connect/{provider}/callback", get(connect_callback))
        .with_state(users)
}

/// The client address when the server records it (`into_make_service_with_connect_info`).
pub(crate) struct ClientIp(String);

impl<S: Send + Sync> FromRequestParts<S> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        let ip = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map_or_else(|| "unknown".to_owned(), |info| info.0.ip().to_string());
        Ok(ClientIp(ip))
    }
}

fn limit(users: &Users, ip: &str) -> Result<(), ApiError> {
    if users.limiter.allow(ip) { Ok(()) } else { Err(ApiError::TooManyRequests) }
}

fn body<T: serde::de::DeserializeOwned>(bytes: &Bytes) -> Result<T, ApiError> {
    serde_json::from_slice(bytes)
        .map_err(|error| ApiError::BadRequest(format!("invalid request body: {error}")))
}

/// Strapi answers account errors with 400.
fn account_error(error: AuthError) -> ApiError {
    match error {
        AuthError::Conflict(message) => ApiError::BadRequest(message),
        other => other.into(),
    }
}

fn session(users: &Users, user: &EndUser) -> Response {
    let ttl = time::Duration::days(i64::from(users.settings.jwt_expires_in_days.max(1)));
    Json(json!({ "jwt": users.auth.end_user_jwt(user, ttl), "user": user })).into_response()
}

async fn send(users: &Users, user: &EndUser, template: &Template, url: String) {
    let values = BTreeMap::from([
        ("username", user.username.clone()),
        ("email", user.email.clone()),
        ("url", url),
    ]);
    let message = Message {
        to: user.email.clone(),
        subject: render(&template.subject, &values, false),
        text: render(&template.text, &values, false),
        html: None,
    };
    if let Err(error) = users.mailer.send(&message).await {
        tracing::warn!(%error, "could not send an end user email");
    }
}

async fn send_confirmation(users: &Users, user: &EndUser, token: &str) {
    let url = format!("{}/auth/email-confirmation?confirmation={token}", users.api_url);
    send(users, user, &users.settings.templates.confirmation, url).await;
}

#[derive(Deserialize)]
struct Register {
    username: String,
    email: String,
    password: String,
}

async fn register(State(users): State<Users>, ClientIp(ip): ClientIp, bytes: Bytes) -> ApiResult {
    limit(&users, &ip)?;
    if !users.settings.allow_register {
        return Err(ApiError::BadRequest("Register action is currently disabled".into()));
    }
    let input: Register = body(&bytes)?;
    let confirm = users.settings.email_confirmation;
    let (user, token) = users
        .auth
        .create_end_user(
            NewEndUser {
                username: input.username,
                email: input.email,
                password: Some(input.password),
                provider: "local".into(),
                confirmed: !confirm,
                ..Default::default()
            },
            &users.settings.default_role,
        )
        .await
        .map_err(account_error)?;
    match token {
        Some(token) => {
            send_confirmation(&users, &user, &token).await;
            Ok(Json(json!({ "user": user })).into_response())
        }
        None => Ok(session(&users, &user)),
    }
}

#[derive(Deserialize)]
struct Login {
    identifier: String,
    password: String,
}

async fn login(State(users): State<Users>, ClientIp(ip): ClientIp, bytes: Bytes) -> ApiResult {
    limit(&users, &ip)?;
    let input: Login = body(&bytes)?;
    let user =
        users.auth.login_end_user(&input.identifier, &input.password).await.map_err(|error| {
            match error {
                AuthError::InvalidCredentials => {
                    ApiError::BadRequest("Invalid identifier or password".into())
                }
                other => other.into(),
            }
        })?;
    if user.blocked {
        return Err(ApiError::BadRequest(
            "Your account has been blocked by an administrator".into(),
        ));
    }
    if users.settings.email_confirmation && !user.confirmed {
        return Err(ApiError::BadRequest("Your account email is not confirmed".into()));
    }
    Ok(session(&users, &user))
}

#[derive(Deserialize)]
struct Confirmation {
    confirmation: String,
}

async fn email_confirmation(
    State(users): State<Users>,
    Query(query): Query<Confirmation>,
) -> ApiResult {
    let user = users.auth.confirm_end_user(&query.confirmation).await?;
    match users.settings.email_confirmation_redirection.as_deref().filter(|url| !url.is_empty()) {
        Some(url) => Ok(Redirect::to(url).into_response()),
        None => Ok(Json(json!({ "user": user })).into_response()),
    }
}

#[derive(Deserialize)]
struct EmailOnly {
    email: String,
}

async fn send_email_confirmation(
    State(users): State<Users>,
    ClientIp(ip): ClientIp,
    bytes: Bytes,
) -> ApiResult {
    limit(&users, &ip)?;
    let input: EmailOnly = body(&bytes)?;
    if let Some((user, token)) = users.auth.new_confirmation(&input.email).await? {
        send_confirmation(&users, &user, &token).await;
    }
    // The same answer whether or not the account exists.
    Ok(Json(json!({ "email": input.email, "sent": true })).into_response())
}

async fn forgot_password(
    State(users): State<Users>,
    ClientIp(ip): ClientIp,
    bytes: Bytes,
) -> ApiResult {
    limit(&users, &ip)?;
    let input: EmailOnly = body(&bytes)?;
    let Some(page) = users.settings.reset_password_url.clone().filter(|url| !url.is_empty()) else {
        return Err(ApiError::BadRequest(
            "password reset is not configured (resetPasswordUrl)".into(),
        ));
    };
    if let Some((user, code)) = users.auth.forgot_password(&input.email).await? {
        let separator = if page.contains('?') { '&' } else { '?' };
        let url = format!("{page}{separator}code={code}");
        send(&users, &user, &users.settings.templates.reset_password, url).await;
    }
    Ok(Json(json!({ "ok": true })).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reset {
    code: String,
    password: String,
    password_confirmation: String,
}

async fn reset_password(
    State(users): State<Users>,
    ClientIp(ip): ClientIp,
    bytes: Bytes,
) -> ApiResult {
    limit(&users, &ip)?;
    let input: Reset = body(&bytes)?;
    if input.password != input.password_confirmation {
        return Err(ApiError::BadRequest("Passwords do not match".into()));
    }
    let user = users.auth.reset_end_user_password(&input.code, &input.password).await?;
    Ok(session(&users, &user))
}

async fn signed_in(users: &Users, headers: &HeaderMap) -> Result<EndUser, ApiError> {
    let token = crate::handlers::bearer(headers)?.ok_or(ApiError::Unauthorized)?;
    Ok(users.auth.authenticate_end_user(token).await?)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangePassword {
    current_password: String,
    password: String,
    password_confirmation: String,
}

async fn change_password(
    State(users): State<Users>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let user = signed_in(&users, &headers).await?;
    let input: ChangePassword = body(&bytes)?;
    if input.password != input.password_confirmation {
        return Err(ApiError::BadRequest("Passwords do not match".into()));
    }
    let user = users
        .auth
        .change_end_user_password(user.id, &input.current_password, &input.password)
        .await?;
    Ok(session(&users, &user))
}

async fn me(State(users): State<Users>, headers: HeaderMap) -> ApiResult {
    let user = signed_in(&users, &headers).await?;
    Ok(Json(user).into_response())
}

// ------------------------------------------------------------------ OAuth

struct Endpoints {
    authorize: String,
    token: String,
    user: String,
    scope: Vec<String>,
}

fn endpoints(name: &str, provider: &ProviderSettings) -> Option<Endpoints> {
    let preset = match name {
        "github" => Some((
            "https://github.com/login/oauth/authorize",
            "https://github.com/login/oauth/access_token",
            "https://api.github.com/user",
            vec!["user:email".to_owned()],
        )),
        "google" => Some((
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://oauth2.googleapis.com/token",
            "https://openidconnect.googleapis.com/v1/userinfo",
            vec!["openid".to_owned(), "email".to_owned(), "profile".to_owned()],
        )),
        _ => None,
    };
    let pick =
        |own: &Option<String>, preset: Option<&str>| own.clone().or(preset.map(str::to_owned));
    Some(Endpoints {
        authorize: pick(&provider.authorize_url, preset.as_ref().map(|p| p.0))?,
        token: pick(&provider.token_url, preset.as_ref().map(|p| p.1))?,
        user: pick(&provider.user_info_url, preset.as_ref().map(|p| p.2))?,
        scope: provider.scope.clone().or(preset.map(|p| p.3)).unwrap_or_default(),
    })
}

fn secret_variable(provider: &str) -> String {
    format!("VERDIN_OAUTH_{}_SECRET", provider.to_uppercase().replace('-', "_"))
}

impl Users {
    /// Sets a provider's client secret (tests; servers read it from the environment).
    pub fn with_oauth_secret(mut self, provider: &str, secret: &str) -> Self {
        Arc::make_mut(&mut self.secrets).insert(provider.into(), secret.into());
        self
    }
}

fn provider<'a>(
    users: &'a Users,
    name: &str,
) -> Result<(&'a ProviderSettings, Endpoints, String), ApiError> {
    let settings = users
        .settings
        .providers
        .get(name)
        .filter(|provider| provider.enabled)
        .ok_or(ApiError::NotFound)?;
    let endpoints = endpoints(name, settings).ok_or(ApiError::NotFound)?;
    // Secrets come from the environment only.
    let secret = users.secrets.get(name).cloned().ok_or_else(|| {
        ApiError::Internal(format!("{} is not set for the {name} provider", secret_variable(name)))
    })?;
    Ok((settings, endpoints, secret))
}

fn callback_url(users: &Users, name: &str) -> String {
    format!("{}/connect/{name}/callback", users.api_url)
}

/// `GET /connect/{provider}`: to the provider's consent screen.
async fn connect(State(users): State<Users>, Path(name): Path<String>) -> ApiResult {
    let (settings, endpoints, _) = provider(&users, &name)?;
    let nonce = verdin_auth::crypto::random_token();
    let state = users.auth.sign(&format!("oauth:{name}:{nonce}"));
    let mut url = reqwest::Url::parse(&endpoints.authorize)
        .map_err(|error| ApiError::Internal(format!("{name} authorize URL: {error}")))?;
    url.query_pairs_mut()
        .append_pair("client_id", &settings.client_id)
        .append_pair("redirect_uri", &callback_url(&users, &name))
        .append_pair("response_type", "code")
        .append_pair("scope", &endpoints.scope.join(" "))
        .append_pair("state", &format!("{nonce}.{state}"));
    let secure = if users.secure_cookies { "; Secure" } else { "" };
    let cookie =
        format!("{OAUTH_COOKIE}={nonce}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600{secure}");
    let mut response = Redirect::to(url.as_str()).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).expect("ASCII cookie"));
    Ok(response)
}

#[derive(Deserialize)]
struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.to_owned())
}

/// `GET /connect/{provider}/callback`: exchanges the code, then sends the browser to the
/// frontend with the provider's `access_token` (Strapi's flow).
async fn connect_callback(
    State(users): State<Users>,
    Path(name): Path<String>,
    Query(query): Query<Callback>,
    headers: HeaderMap,
) -> ApiResult {
    let (settings, endpoints, secret) = provider(&users, &name)?;
    if let Some(error) = query.error {
        return Err(ApiError::BadRequest(format!("{name} refused: {error}")));
    }
    let (Some(code), Some(state)) = (query.code, query.state) else {
        return Err(ApiError::BadRequest("missing code or state".into()));
    };
    let (nonce, signature) = state.split_once('.').ok_or(ApiError::Forbidden)?;
    let bound = cookie(&headers, OAUTH_COOKIE).is_some_and(|cookie| cookie == nonce);
    if !bound || !users.auth.verify_signature(&format!("oauth:{name}:{nonce}"), signature) {
        return Err(ApiError::Forbidden);
    }
    let response = users
        .http
        .post(&endpoints.token)
        .header(header::ACCEPT, "application/json")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("client_id", settings.client_id.as_str()),
            ("client_secret", secret.as_str()),
            ("redirect_uri", callback_url(&users, &name).as_str()),
        ])
        .send()
        .await
        .map_err(|error| ApiError::BadRequest(format!("{name} token exchange failed: {error}")))?;
    let token: Value = response.json().await.unwrap_or(Value::Null);
    let Some(access_token) = token["access_token"].as_str() else {
        return Err(ApiError::BadRequest(format!("{name} did not return an access token")));
    };
    let separator = if settings.redirect_uri.contains('?') { '&' } else { '?' };
    let target =
        format!("{}{separator}access_token={}", settings.redirect_uri, urlencode(access_token));
    let mut response = Redirect::to(&target).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static("verdin_oauth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"),
    );
    Ok(response)
}

fn urlencode(value: &str) -> String {
    reqwest::Url::parse_with_params("x:", &[("v", value)])
        .map(|url| url.query().unwrap_or_default().trim_start_matches("v=").to_owned())
        .unwrap_or_default()
}

#[derive(Deserialize)]
struct AccessToken {
    access_token: String,
}

/// `GET /auth/{provider}/callback?access_token=`: signs in with the provider's token.
async fn provider_callback(
    State(users): State<Users>,
    Path(name): Path<String>,
    Query(query): Query<AccessToken>,
    ClientIp(ip): ClientIp,
) -> ApiResult {
    limit(&users, &ip)?;
    let (_, endpoints, _) = provider(&users, &name)?;
    let profile: Value = users
        .http
        .get(&endpoints.user)
        .bearer_auth(&query.access_token)
        .header(header::USER_AGENT, "Verdin")
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| ApiError::BadRequest(format!("{name} profile request failed: {error}")))?
        .error_for_status()
        .map_err(|_| ApiError::BadRequest(format!("{name} refused the access token")))?
        .json()
        .await
        .map_err(|_| ApiError::BadRequest(format!("{name} returned an unexpected profile")))?;
    let mut email = profile["email"].as_str().map(str::to_owned);
    if name == "github" && email.is_none() {
        // Private GitHub emails: the primary verified one.
        let emails: Value = users
            .http
            .get("https://api.github.com/user/emails")
            .bearer_auth(&query.access_token)
            .header(header::USER_AGENT, "Verdin")
            .send()
            .await
            .map_err(|error| {
                ApiError::BadRequest(format!("github emails request failed: {error}"))
            })?
            .json()
            .await
            .unwrap_or(Value::Null);
        email = emails.as_array().and_then(|items| {
            items
                .iter()
                .find(|item| item["primary"] == true && item["verified"] == true)
                .and_then(|item| item["email"].as_str().map(str::to_owned))
        });
    }
    if profile.get("email_verified") == Some(&Value::Bool(false)) {
        return Err(ApiError::BadRequest(format!("the {name} email is not verified")));
    }
    let email =
        email.ok_or_else(|| ApiError::BadRequest(format!("{name} did not share an email")))?;
    let username = ["login", "username", "name", "preferred_username"]
        .iter()
        .find_map(|key| profile[*key].as_str())
        .unwrap_or_default()
        .to_owned();
    let user = users
        .auth
        .oauth_end_user(&name, &email, &username, &users.settings.default_role)
        .await
        .map_err(account_error)?;
    Ok(session(&users, &user))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_and_urls() {
        let settings: UsersSettings =
            serde_json::from_value(json!({ "emailConfirmation": true })).unwrap();
        assert!(settings.allow_register && settings.email_confirmation);
        assert_eq!(settings.templates.confirmation.subject, "Confirm your account");
        assert_eq!(urlencode("a b&c=d"), "a+b%26c%3Dd");
        let github = endpoints("github", &ProviderSettings::default()).unwrap();
        assert_eq!(github.scope, ["user:email"]);
        assert!(endpoints("custom", &ProviderSettings::default()).is_none());
    }
}
