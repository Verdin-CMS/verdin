//! Admin API (docs/architecture.md §13), nested under `{admin.path}/api`.
//!
//! Admins authenticate with a short-lived access token (`Authorization: Bearer`) and a
//! rotating refresh token in an `HttpOnly; SameSite=Strict` cookie scoped to the auth
//! routes. Refresh and logout also require the `X-Verdin-CSRF` header, which cross-site
//! requests cannot set without a CORS preflight.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{ConnectInfo, FromRequestParts, Path, RawQuery, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use bytes::Bytes;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};
use verdin_auth::{
    AdminPrincipal, ApiTokenUpdate, AuthService, ContentAction, Grant, NewApiToken, NewUser,
    Permission, Session, TokenKind, UserUpdate, actions,
};
use verdin_content::{DocumentService, OutputOptions, Registry, WriteOptions};
use verdin_db::{ColumnKind, Database, SqlValue};
use verdin_query::{Condition, Filter, Limits, Op, Operand, Query, Status};
use verdin_schema::{Attribute, AttributeKind, ContentTypeKind};

use crate::error::ApiError;
use crate::handlers::{bearer, parse_data};
use crate::limiter::RateLimiter;

#[path = "engagement.rs"]
pub(crate) mod engagement;

pub const REFRESH_COOKIE: &str = "verdin_refresh";
pub const CSRF_HEADER: &str = "x-verdin-csrf";

/// Refreshes allowed per login attempt allowed (per IP and minute).
const REFRESH_BUDGET: u32 = 10;

/// A boxed future, for the object-safe [`SchemaEditor`].
pub type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

/// A proposed schema edit from the content-type builder. Values are schema files in their
/// on-disk JSON format; `None` deletes the file.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct SchemaChange {
    /// By `singularName`.
    pub content_types: std::collections::BTreeMap<String, Option<Value>>,
    /// By `category.name`.
    pub components: std::collections::BTreeMap<String, Option<Value>>,
    /// `old=new` table renames and `table.old=new` column renames.
    pub rename_tables: Vec<String>,
    pub rename_columns: Vec<String>,
    /// Highest risk to apply: `safe`, `risky` or `destructive`.
    pub allow: Option<String>,
}

/// Edits the schema files of a project in development mode (`verdin dev`).
pub trait SchemaEditor: Send + Sync {
    /// Current schema files: `{ contentTypes: { name: json }, components: { uid: json } }`.
    fn sources(&self) -> BoxFuture<'_, Result<Value, ApiError>>;
    /// Validates `change` and returns the migration it needs, without applying anything.
    fn plan(&self, change: SchemaChange) -> BoxFuture<'_, Result<Value, ApiError>>;
    /// Migrates the database, writes the files and reloads the server.
    fn apply(&self, change: SchemaChange) -> BoxFuture<'_, Result<Value, ApiError>>;
}

#[derive(Clone)]
pub struct AdminConfig {
    /// Admin mount path (e.g. `/admin`); the API lives under `{path}/api`.
    pub path: String,
    /// Mark the refresh cookie `Secure` (disable only for plain-HTTP development).
    pub secure_cookies: bool,
    pub limits: Limits,
    pub output: OutputOptions,
    /// `development` or `production`, reported by `/system/info`.
    pub mode: &'static str,
    /// Login/registration/refresh attempts per client IP per minute.
    pub auth_rate_limit: u32,
    /// Present in development mode: enables the content-type builder routes.
    pub schema_editor: Option<Arc<dyn SchemaEditor>>,
}

impl Default for AdminConfig {
    fn default() -> Self {
        Self {
            path: "/admin".into(),
            secure_cookies: true,
            limits: Limits::default(),
            output: OutputOptions::default(),
            mode: "production",
            auth_rate_limit: 20,
            schema_editor: None,
        }
    }
}

#[derive(Clone)]
struct AdminState {
    auth: AuthService,
    service: DocumentService,
    config: Arc<AdminConfig>,
    limiter: Arc<RateLimiter>,
    /// Refreshes run on every page load: their own, larger budget (the token itself is
    /// unguessable and reuse revokes the session family).
    refresh_limiter: Arc<RateLimiter>,
    flavor: &'static str,
}

type ApiResult = Result<Response, ApiError>;

pub fn router(db: Database, registry: Registry, auth: AuthService, config: AdminConfig) -> Router {
    let limiter = Arc::new(RateLimiter::new(config.auth_rate_limit, Duration::from_secs(60)));
    let refresh_limiter = Arc::new(RateLimiter::new(
        config.auth_rate_limit.saturating_mul(REFRESH_BUDGET),
        Duration::from_secs(60),
    ));
    let state = AdminState {
        flavor: db.flavor().as_str(),
        service: DocumentService::new(db, registry, config.output),
        auth,
        config: Arc::new(config),
        limiter,
        refresh_limiter,
    };
    Router::new()
        .route("/auth/status", get(auth_status))
        .route("/auth/register-first-admin", post(register_first_admin))
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/users", get(list_users).post(create_user))
        .route("/users/me/preferences", get(get_preferences).put(put_preferences))
        .route("/users/{id}", get(get_user).put(update_user).delete(delete_user))
        .route("/roles", get(list_roles).post(create_role))
        .route("/roles/{id}", get(get_role).put(update_role).delete(delete_role))
        .route("/api-tokens", get(list_tokens).post(create_token))
        .route("/api-tokens/{id}", get(get_token).put(update_token).delete(delete_token))
        .route("/public-permissions", get(get_public).put(put_public))
        .route("/content-types", get(content_types))
        .route("/components", get(components))
        .route("/content/{uid}", get(content_list).post(content_create))
        .route(
            "/content/{uid}/{document_id}",
            get(content_get).put(content_update).delete(content_delete),
        )
        .route("/content/{uid}/{document_id}/actions/{action}", post(content_action))
        .route("/content/{uid}/uid-available", get(uid_available))
        .route("/schema", get(schema_sources))
        .route("/schema/plan", post(schema_plan))
        .route("/schema/apply", post(schema_apply))
        .route("/system/info", get(system_info))
        .merge(engagement::routes())
        .fallback(|| async { ApiError::NotFound })
        .with_state(state)
}

/// The client address when the server records it (`into_make_service_with_connect_info`).
struct ClientIp(String);

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

fn body<T: DeserializeOwned>(bytes: &Bytes) -> Result<T, ApiError> {
    serde_json::from_slice(bytes)
        .map_err(|error| ApiError::BadRequest(format!("invalid request body: {error}")))
}

fn data(value: impl serde::Serialize) -> Response {
    Json(json!({ "data": value })).into_response()
}

async fn principal(state: &AdminState, headers: &HeaderMap) -> Result<AdminPrincipal, ApiError> {
    let token = bearer(headers)?.ok_or(ApiError::Unauthorized)?;
    Ok(state.auth.authenticate(token).await?)
}

async fn require(
    state: &AdminState,
    headers: &HeaderMap,
    action: &str,
) -> Result<AdminPrincipal, ApiError> {
    let principal = principal(state, headers).await?;
    if principal.permissions.allows(action) { Ok(principal) } else { Err(ApiError::Forbidden) }
}

fn rate_limit(state: &AdminState, ip: &str) -> Result<(), ApiError> {
    if state.limiter.allow(ip) { Ok(()) } else { Err(ApiError::TooManyRequests) }
}

fn user_agent(headers: &HeaderMap) -> Option<&str> {
    headers.get(header::USER_AGENT).and_then(|value| value.to_str().ok())
}

// ------------------------------------------------------------------- auth

fn cookie(state: &AdminState, value: &str, max_age: i64) -> HeaderValue {
    let secure = if state.config.secure_cookies { "; Secure" } else { "" };
    let path = format!("{}/api/auth", state.config.path);
    HeaderValue::from_str(&format!("{REFRESH_COOKIE}={value}; HttpOnly; SameSite=Strict; Path={path}; Max-Age={max_age}{secure}"))
        .expect("cookie header is ASCII")
}

fn refresh_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == REFRESH_COOKIE)
        .map(|(_, value)| value.to_owned())
}

fn require_csrf(headers: &HeaderMap) -> Result<(), ApiError> {
    if headers.contains_key(CSRF_HEADER) { Ok(()) } else { Err(ApiError::Forbidden) }
}

fn session_response(state: &AdminState, session: Session, status: StatusCode) -> Response {
    let max_age =
        (session.refresh_expires_at - time::OffsetDateTime::now_utc()).whole_seconds().max(0);
    let mut response = (
        status,
        Json(json!({ "data": {
            "user": session.user,
            "accessToken": session.access_token,
            "accessTokenExpiresAt": verdin_db::value::format_datetime(session.access_expires_at),
        }})),
    )
        .into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, cookie(state, &session.refresh_token, max_age));
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn auth_status(State(state): State<AdminState>) -> ApiResult {
    Ok(data(json!({ "hasAdmin": state.auth.has_admin().await? })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RegisterBody {
    email: String,
    password: String,
    firstname: Option<String>,
    lastname: Option<String>,
}

async fn register_first_admin(
    State(state): State<AdminState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    rate_limit(&state, &ip)?;
    let input: RegisterBody = body(&bytes)?;
    let user = NewUser {
        email: input.email,
        password: input.password,
        firstname: input.firstname,
        lastname: input.lastname,
        ..NewUser::default()
    };
    let session = state.auth.register_first_admin(user, user_agent(&headers)).await?;
    Ok(session_response(&state, session, StatusCode::CREATED))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LoginBody {
    email: String,
    password: String,
}

async fn login(
    State(state): State<AdminState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    rate_limit(&state, &ip)?;
    let input: LoginBody = body(&bytes)?;
    let session = state.auth.login(&input.email, &input.password, user_agent(&headers)).await?;
    Ok(session_response(&state, session, StatusCode::OK))
}

async fn refresh(
    State(state): State<AdminState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
) -> ApiResult {
    if !state.refresh_limiter.allow(&ip) {
        return Err(ApiError::TooManyRequests);
    }
    require_csrf(&headers)?;
    let token = refresh_cookie(&headers).ok_or(ApiError::Unauthorized)?;
    let session = state.auth.refresh(&token, user_agent(&headers)).await?;
    Ok(session_response(&state, session, StatusCode::OK))
}

async fn logout(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    require_csrf(&headers)?;
    if let Some(token) = refresh_cookie(&headers) {
        state.auth.logout(&token).await?;
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(header::SET_COOKIE, cookie(&state, "", 0));
    Ok(response)
}

async fn me(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    Ok(data(json!({ "user": principal.user, "permissions": principal.permissions })))
}

// ------------------------------------------------------------------ users

/// Any signed-in admin reads and writes their own preferences; no permission needed.
async fn get_preferences(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    Ok(data(state.auth.preferences(principal.user.id).await?))
}

async fn put_preferences(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let mut input: serde_json::Value = body(&bytes)?;
    let value = input.get_mut("data").map(serde_json::Value::take).unwrap_or(input);
    state.auth.set_preferences(principal.user.id, value.clone()).await?;
    Ok(data(value))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct UserBody {
    email: String,
    password: String,
    firstname: Option<String>,
    lastname: Option<String>,
    roles: Vec<i64>,
    #[serde(default = "default_true")]
    is_active: bool,
}

fn default_true() -> bool {
    true
}

/// Distinguishes a missing field (keep) from an explicit `null` (clear).
fn double_option<'de, T: Deserialize<'de>, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct UserPatch {
    email: Option<String>,
    password: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    firstname: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    lastname: Option<Option<String>>,
    roles: Option<Vec<i64>>,
    is_active: Option<bool>,
}

async fn list_users(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    require(&state, &headers, actions::USERS_MANAGE).await?;
    Ok(data(state.auth.users().await?))
}

async fn get_user(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::USERS_MANAGE).await?;
    Ok(data(state.auth.user(id).await?))
}

async fn create_user(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::USERS_MANAGE).await?;
    let input: UserBody = body(&bytes)?;
    let user = state
        .auth
        .create_user(NewUser {
            email: input.email,
            password: input.password,
            firstname: input.firstname,
            lastname: input.lastname,
            roles: input.roles,
            is_active: input.is_active,
        })
        .await?;
    Ok((StatusCode::CREATED, data(user)).into_response())
}

async fn update_user(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::USERS_MANAGE).await?;
    let input: UserPatch = body(&bytes)?;
    let update = UserUpdate {
        email: input.email,
        password: input.password,
        firstname: input.firstname,
        lastname: input.lastname,
        roles: input.roles,
        is_active: input.is_active,
    };
    Ok(data(state.auth.update_user(id, update).await?))
}

async fn delete_user(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::USERS_MANAGE).await?;
    state.auth.delete_user(id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

// ------------------------------------------------------------------ roles

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RoleBody {
    code: String,
    name: String,
    description: Option<String>,
    #[serde(default)]
    permissions: Vec<Permission>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct RolePatch {
    name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    description: Option<Option<String>>,
    permissions: Option<Vec<Permission>>,
}

fn check_subjects(state: &AdminState, permissions: &[Permission]) -> Result<(), ApiError> {
    for permission in permissions {
        if let Some(subject) = &permission.subject
            && subject != verdin_auth::ALL_SUBJECTS
            && state.service.registry().get(subject).is_err()
        {
            return Err(ApiError::BadRequest(format!("unknown content type `{subject}`")));
        }
    }
    Ok(())
}

async fn list_roles(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    require(&state, &headers, actions::ROLES_MANAGE).await?;
    Ok(data(state.auth.roles().await?))
}

async fn get_role(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::ROLES_MANAGE).await?;
    Ok(data(state.auth.role(id).await?))
}

async fn create_role(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::ROLES_MANAGE).await?;
    let input: RoleBody = body(&bytes)?;
    check_subjects(&state, &input.permissions)?;
    let role = state
        .auth
        .create_role(&input.code, &input.name, input.description, input.permissions)
        .await?;
    Ok((StatusCode::CREATED, data(role)).into_response())
}

async fn update_role(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::ROLES_MANAGE).await?;
    let input: RolePatch = body(&bytes)?;
    if let Some(permissions) = &input.permissions {
        check_subjects(&state, permissions)?;
    }
    Ok(data(state.auth.update_role(id, input.name, input.description, input.permissions).await?))
}

async fn delete_role(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::ROLES_MANAGE).await?;
    state.auth.delete_role(id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

// ------------------------------------------------------ tokens and public

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GrantBody {
    subject: String,
    action: String,
}

fn grants(
    state: &AdminState,
    grants: Vec<GrantBody>,
) -> Result<Vec<(String, ContentAction)>, ApiError> {
    grants
        .into_iter()
        .map(|grant| {
            state.service.registry().get(&grant.subject).map_err(|_| {
                ApiError::BadRequest(format!("unknown content type `{}`", grant.subject))
            })?;
            let action = ContentAction::parse(&grant.action).ok_or_else(|| {
                ApiError::BadRequest(format!("unknown content API action `{}`", grant.action))
            })?;
            Ok((grant.subject, action))
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TokenBody {
    name: String,
    description: Option<String>,
    kind: TokenKind,
    expires_in_days: Option<u32>,
    #[serde(default)]
    permissions: Vec<GrantBody>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct TokenPatch {
    name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    description: Option<Option<String>>,
    kind: Option<TokenKind>,
    permissions: Option<Vec<GrantBody>>,
}

async fn list_tokens(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    require(&state, &headers, actions::TOKENS_MANAGE).await?;
    Ok(data(state.auth.api_tokens().await?))
}

async fn get_token(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::TOKENS_MANAGE).await?;
    Ok(data(state.auth.api_token(id).await?))
}

async fn create_token(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::TOKENS_MANAGE).await?;
    let input: TokenBody = body(&bytes)?;
    let permissions = grants(&state, input.permissions)?;
    let (token, secret) = state
        .auth
        .create_api_token(NewApiToken {
            name: input.name,
            description: input.description,
            kind: input.kind,
            expires_in_days: input.expires_in_days,
            permissions,
        })
        .await?;
    let mut value = serde_json::to_value(token).expect("token serializes");
    value["accessKey"] = Value::String(secret);
    let mut response = (StatusCode::CREATED, data(value)).into_response();
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

async fn update_token(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::TOKENS_MANAGE).await?;
    let input: TokenPatch = body(&bytes)?;
    let permissions = input.permissions.map(|list| grants(&state, list)).transpose()?;
    let update = ApiTokenUpdate {
        name: input.name,
        description: input.description,
        kind: input.kind,
        permissions,
    };
    Ok(data(state.auth.update_api_token(id, update).await?))
}

async fn delete_token(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    require(&state, &headers, actions::TOKENS_MANAGE).await?;
    state.auth.delete_api_token(id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn get_public(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    require(&state, &headers, actions::ROLES_MANAGE).await?;
    let mut list: Vec<Value> = state
        .auth
        .public_grants()
        .await?
        .into_iter()
        .map(|(subject, action)| json!({ "subject": subject, "action": action.as_str() }))
        .collect();
    list.sort_by_key(|grant| grant.to_string());
    Ok(data(list))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PublicBody {
    permissions: Vec<GrantBody>,
}

async fn put_public(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    require(&state, &headers, actions::ROLES_MANAGE).await?;
    let input: PublicBody = body(&bytes)?;
    state.auth.set_public_grants(&grants(&state, input.permissions)?).await?;
    get_public(State(state), headers).await
}

// ------------------------------------------------------------------ schema

/// An attribute in the schema file format, for the admin's forms.
fn attribute_json(attribute: &Attribute) -> Value {
    let mut out = Map::new();
    out.insert("type".into(), json!(attribute.kind.type_name()));
    let mut set = |key: &str, value: Value| {
        if !value.is_null() && value != json!(false) {
            out.insert(key.into(), value);
        }
    };
    set("required", json!(attribute.required));
    set("private", json!(attribute.private));
    if !attribute.configurable {
        out.insert("configurable".into(), json!(false));
    }
    if let Some(default) = &attribute.default {
        out.insert("default".into(), default.clone());
    }
    let mut set = |key: &str, value: Value| {
        if !value.is_null() && value != json!(false) {
            out.insert(key.into(), value);
        }
    };
    use AttributeKind as A;
    match &attribute.kind {
        A::String { min_length, max_length, regex, unique } => {
            set("minLength", json!(min_length));
            set("maxLength", json!(max_length));
            set("regex", json!(regex));
            set("unique", json!(unique));
        }
        A::Email { min_length, max_length, unique } => {
            set("minLength", json!(min_length));
            set("maxLength", json!(max_length));
            set("unique", json!(unique));
        }
        A::Text { min_length, max_length } | A::RichText { min_length, max_length } => {
            set("minLength", json!(min_length));
            set("maxLength", json!(max_length));
        }
        A::Uid { target_field, min_length, max_length, regex } => {
            set("targetField", json!(target_field));
            set("minLength", json!(min_length));
            set("maxLength", json!(max_length));
            set("regex", json!(regex));
        }
        A::Integer { min, max, unique } | A::BigInteger { min, max, unique } => {
            set("min", json!(min));
            set("max", json!(max));
            set("unique", json!(unique));
        }
        A::Float { min, max, unique } => {
            set("min", json!(min));
            set("max", json!(max));
            set("unique", json!(unique));
        }
        A::Decimal { precision, scale, min, max, unique } => {
            set("precision", json!(precision));
            set("scale", json!(scale));
            set("min", json!(min));
            set("max", json!(max));
            set("unique", json!(unique));
        }
        A::Date { unique } | A::Time { unique } | A::DateTime { unique } => {
            set("unique", json!(unique))
        }
        A::Enumeration { values } => set("enum", json!(values)),
        A::Boolean | A::Json => {}
        A::Relation { relation, target, inversed_by, mapped_by } => {
            set("relation", json!(relation.as_str()));
            set("target", json!(target));
            set("inversedBy", json!(inversed_by));
            set("mappedBy", json!(mapped_by));
        }
        A::Component { component, repeatable, min, max } => {
            set("component", json!(component));
            set("repeatable", json!(repeatable));
            set("min", json!(min));
            set("max", json!(max));
        }
        A::DynamicZone { components, min, max } => {
            set("components", json!(components));
            set("min", json!(min));
            set("max", json!(max));
        }
    }
    Value::Object(out)
}

fn attributes_json(attributes: &indexmap::IndexMap<String, Attribute>) -> Value {
    Value::Object(
        attributes
            .iter()
            .map(|(name, attribute)| (name.clone(), attribute_json(attribute)))
            .collect(),
    )
}

/// Content types the admin may read.
async fn content_types(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let schema = &state.service.registry().schema;
    let list: Vec<Value> = schema
        .content_types
        .values()
        .filter(|content_type| principal.permissions.content(actions::CONTENT_READ, &content_type.uid) != Grant::None)
        .map(|content_type| {
            json!({
                "uid": content_type.uid,
                "kind": if content_type.kind == ContentTypeKind::SingleType { "singleType" } else { "collectionType" },
                "singularName": content_type.singular_name,
                "pluralName": content_type.plural_name,
                "displayName": content_type.display_name,
                "description": content_type.description,
                "draftAndPublish": content_type.draft_and_publish,
                "attributes": attributes_json(&content_type.attributes),
            })
        })
        .collect();
    Ok(data(list))
}

async fn components(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    principal(&state, &headers).await?;
    let list: Vec<Value> = state
        .service
        .registry()
        .schema
        .components
        .values()
        .map(|component| {
            json!({
                "uid": component.uid,
                "category": component.category,
                "displayName": component.display_name,
                "description": component.description,
                "icon": component.icon,
                "attributes": attributes_json(&component.attributes),
            })
        })
        .collect();
    Ok(data(list))
}

async fn system_info(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    principal(&state, &headers).await?;
    Ok(data(
        json!({ "version": env!("CARGO_PKG_VERSION"), "database": state.flavor, "mode": state.config.mode }),
    ))
}

// ----------------------------------------------------------------- content

/// Resolves `action` on `uid` for the admin: `None` is forbidden, `Own` adds a creator
/// restriction.
async fn content_grant(
    state: &AdminState,
    headers: &HeaderMap,
    uid: &str,
    action: &str,
) -> Result<(AdminPrincipal, Grant), ApiError> {
    state.service.registry().get(uid)?;
    let principal = principal(state, headers).await?;
    match principal.permissions.content(action, uid) {
        Grant::None => Err(ApiError::Forbidden),
        grant => Ok((principal, grant)),
    }
}

async fn ensure_owner(
    state: &AdminState,
    uid: &str,
    document_id: &str,
    principal: &AdminPrincipal,
    grant: Grant,
) -> Result<(), ApiError> {
    if grant == Grant::Own
        && state.service.created_by(uid, document_id).await? != Some(principal.user.id)
    {
        return Err(ApiError::Forbidden);
    }
    Ok(())
}

/// Admin reads default to drafts (the editable version) unless `status` is given.
fn admin_query(
    state: &AdminState,
    uid: &str,
    raw: Option<&str>,
    principal: &AdminPrincipal,
    grant: Grant,
) -> Result<Query, ApiError> {
    let registry = state.service.registry();
    let model = registry.get(uid)?;
    let mut query =
        verdin_query::parse_request(raw, &model.fields, registry.catalog(), &state.config.limits)?;
    let explicit_status =
        raw.is_some_and(|raw| raw.split('&').any(|pair| pair.starts_with("status=")));
    if !explicit_status {
        query.status = Status::Draft;
    }
    if grant == Grant::Own {
        let own = Filter::Condition(Condition {
            column: "created_by_id".into(),
            path: Vec::new(),
            kind: ColumnKind::BigInt,
            op: Op::Eq,
            operand: Operand::Value(SqlValue::BigInt(principal.user.id)),
        });
        query.filters = Some(match query.filters.take() {
            Some(filter) => Filter::And(vec![filter, own]),
            None => own,
        });
    }
    Ok(query)
}

async fn read_document(
    state: &AdminState,
    uid: &str,
    document_id: &str,
    query: &Query,
    status: StatusCode,
) -> ApiResult {
    let document =
        state.service.find_one(uid, document_id, query).await?.ok_or(ApiError::NotFound)?;
    Ok((status, Json(json!({ "data": document, "meta": {} }))).into_response())
}

async fn content_list(
    State(state): State<AdminState>,
    Path(uid): Path<String>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
) -> ApiResult {
    let (principal, grant) = content_grant(&state, &headers, &uid, actions::CONTENT_READ).await?;
    // `unseen=true` (admin only): documents the caller has not opened since they changed.
    let mut unseen = false;
    let raw = raw.map(|raw| {
        raw.split('&')
            .filter(|pair| match *pair {
                "unseen=true" => {
                    unseen = true;
                    false
                }
                "unseen=false" => false,
                _ => true,
            })
            .collect::<Vec<_>>()
            .join("&")
    });
    let mut query = admin_query(&state, &uid, raw.as_deref(), &principal, grant)?;
    if unseen {
        let filter = engagement::unseen_filter(&uid, principal.user.id);
        query.filters = Some(match query.filters.take() {
            Some(existing) => Filter::And(vec![existing, filter]),
            None => filter,
        });
    }
    let page = state.service.find_many(&uid, &query).await?;
    Ok(Json(json!({ "data": page.documents, "meta": { "pagination": page.meta } })).into_response())
}

async fn content_get(
    State(state): State<AdminState>,
    Path((uid, document_id)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
) -> ApiResult {
    let (principal, grant) = content_grant(&state, &headers, &uid, actions::CONTENT_READ).await?;
    let query = admin_query(&state, &uid, raw.as_deref(), &principal, grant)?;
    read_document(&state, &uid, &document_id, &query, StatusCode::OK).await
}

/// Admin writes save the draft; publishing is an explicit action.
async fn content_create(
    State(state): State<AdminState>,
    Path(uid): Path<String>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let (principal, _) = content_grant(&state, &headers, &uid, actions::CONTENT_CREATE).await?;
    let data = parse_data(&bytes)?;
    let options = WriteOptions { publish: false, actor: Some(principal.user.id) };
    let document_id = state.service.create(&uid, &data, options).await?;
    // The creator may always see what they just wrote.
    let query = admin_query(&state, &uid, raw.as_deref(), &principal, Grant::All)?;
    read_document(&state, &uid, &document_id, &query, StatusCode::CREATED).await
}

async fn content_update(
    State(state): State<AdminState>,
    Path((uid, document_id)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let (principal, grant) = content_grant(&state, &headers, &uid, actions::CONTENT_UPDATE).await?;
    ensure_owner(&state, &uid, &document_id, &principal, grant).await?;
    let data = parse_data(&bytes)?;
    let options = WriteOptions { publish: false, actor: Some(principal.user.id) };
    state.service.update(&uid, &document_id, &data, options).await?;
    engagement::changed(state.service.db(), &uid, &document_id, Some(principal.user.id)).await?;
    let query = admin_query(&state, &uid, raw.as_deref(), &principal, Grant::All)?;
    read_document(&state, &uid, &document_id, &query, StatusCode::OK).await
}

async fn content_delete(
    State(state): State<AdminState>,
    Path((uid, document_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> ApiResult {
    let (principal, grant) = content_grant(&state, &headers, &uid, actions::CONTENT_DELETE).await?;
    ensure_owner(&state, &uid, &document_id, &principal, grant).await?;
    state.service.delete(&uid, &document_id).await?;
    engagement::deleted(state.service.db(), &uid, &document_id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn content_action(
    State(state): State<AdminState>,
    Path((uid, document_id, action)): Path<(String, String, String)>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
) -> ApiResult {
    let (principal, grant) =
        content_grant(&state, &headers, &uid, actions::CONTENT_PUBLISH).await?;
    ensure_owner(&state, &uid, &document_id, &principal, grant).await?;
    let mut query = admin_query(&state, &uid, raw.as_deref(), &principal, Grant::All)?;
    match action.as_str() {
        "publish" => {
            state.service.publish(&uid, &document_id, Some(principal.user.id)).await?;
            query.status = Status::Published;
        }
        "unpublish" => state.service.unpublish(&uid, &document_id).await?,
        "discard-draft" => state.service.discard_draft(&uid, &document_id).await?,
        _ => return Err(ApiError::NotFound),
    }
    engagement::changed(state.service.db(), &uid, &document_id, Some(principal.user.id)).await?;
    read_document(&state, &uid, &document_id, &query, StatusCode::OK).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UidQuery {
    field: String,
    value: String,
    document_id: Option<String>,
}

/// `GET /content/{uid}/uid-available?field=slug&value=…[&documentId=…]`.
async fn uid_available(
    State(state): State<AdminState>,
    Path(uid): Path<String>,
    axum::extract::Query(query): axum::extract::Query<UidQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let writable = [actions::CONTENT_CREATE, actions::CONTENT_UPDATE]
        .iter()
        .any(|action| principal.permissions.content(action, &uid) != Grant::None);
    if !writable {
        return Err(ApiError::Forbidden);
    }
    let (available, suggestion) = state
        .service
        .uid_availability(&uid, &query.field, &query.value, query.document_id.as_deref())
        .await?;
    Ok(data(json!({ "available": available, "suggestion": suggestion })))
}

async fn editor(
    state: &AdminState,
    headers: &HeaderMap,
) -> Result<Arc<dyn SchemaEditor>, ApiError> {
    require(state, headers, actions::SCHEMA_MANAGE).await?;
    // Outside development mode the builder does not exist.
    state.config.schema_editor.clone().ok_or(ApiError::NotFound)
}

async fn schema_sources(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    let editor = editor(&state, &headers).await?;
    Ok(data(editor.sources().await?))
}

async fn schema_plan(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let editor = editor(&state, &headers).await?;
    Ok(data(editor.plan(body(&bytes)?).await?))
}

async fn schema_apply(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let editor = editor(&state, &headers).await?;
    Ok(data(editor.apply(body(&bytes)?).await?))
}
