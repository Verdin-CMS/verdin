//! Content API handlers.
//!
//! Collection types: `/{pluralName}` and `/{pluralName}/{documentId}`.
//! Single types: `/{singularName}`.
//! With draft & publish, `POST` and `PUT` publish unless `?status=draft` (Strapi v5).
//!
//! Callers are the public role (no `Authorization`) or an API token (`Bearer`); every
//! route needs its action granted, and reading drafts also needs `readDrafts`.

use axum::Json;
use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use serde_json::{Value, json};
use verdin_auth::{AuthError, ContentAction};
use verdin_content::WriteOptions;
use verdin_query::{Query, Status};

use crate::error::ApiError;
use crate::{ApiState, Route};

type ApiResult = Result<Response, ApiError>;

/// Any valid API token may read the OpenAPI document.
pub async fn openapi(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult {
    if !state.config.openapi_public {
        let actor = state.auth.content_actor(bearer(&headers)?).await.map_err(ApiError::from)?;
        if !actor.is_token() {
            return Err(ApiError::Forbidden);
        }
    }
    Ok(Json((*state.openapi).clone()).into_response())
}

/// The state with its Document Service reading and writing `?locale=` (the default
/// locale when absent).
fn localized(mut state: ApiState, raw: Option<&str>) -> Result<ApiState, ApiError> {
    state.service = state.service.in_locale(locale_param(raw)?);
    Ok(state)
}

/// `locale` of a raw query string, checked.
pub(crate) fn locale_param(raw: Option<&str>) -> Result<Option<String>, ApiError> {
    let Some(value) = raw
        .into_iter()
        .flat_map(|raw| raw.split('&'))
        .filter_map(|pair| pair.split_once('='))
        .find(|(key, _)| *key == "locale")
        .map(|(_, value)| value)
    else {
        return Ok(None);
    };
    if verdin_content::locales::valid_code(value) {
        Ok(Some(value.to_owned()))
    } else {
        Err(ApiError::BadRequest(format!("invalid locale `{value}`")))
    }
}

pub async fn not_found() -> ApiError {
    ApiError::NotFound
}

pub async fn root_get(
    State(state): State<ApiState>,
    Path(name): Path<String>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
) -> ApiResult {
    let state = localized(state, raw.as_deref())?;
    let route = route(&state, &name)?;
    let query =
        authorized_query(&state, &headers, route, ContentAction::Find, raw.as_deref()).await?;
    if route.single {
        let document_id =
            state.service.single_document_id(&route.uid).await?.ok_or(ApiError::NotFound)?;
        return read_back(&state, route, &document_id, &query, StatusCode::OK).await;
    }
    let page = state.service.find_many(&route.uid, &query).await?;
    Ok(Json(json!({ "data": page.documents, "meta": { "pagination": page.meta } })).into_response())
}

pub async fn root_post(
    State(state): State<ApiState>,
    Path(name): Path<String>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    let state = localized(state, raw.as_deref())?;
    let route = route(&state, &name)?;
    if route.single {
        return Err(ApiError::MethodNotAllowed);
    }
    let query =
        authorized_query(&state, &headers, route, ContentAction::Create, raw.as_deref()).await?;
    let data = parse_data(&body)?;
    let document_id = state.service.create(&route.uid, &data, write_options(&query)).await?;
    read_back(&state, route, &document_id, &query, StatusCode::CREATED).await
}

/// Single types: update the document, or create it on first write.
pub async fn root_put(
    State(state): State<ApiState>,
    Path(name): Path<String>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    let state = localized(state, raw.as_deref())?;
    let route = route(&state, &name)?;
    if !route.single {
        return Err(ApiError::MethodNotAllowed);
    }
    let query =
        authorized_query(&state, &headers, route, ContentAction::Update, raw.as_deref()).await?;
    let data = parse_data(&body)?;
    let options = write_options(&query);
    let document_id = match state.service.single_document_id(&route.uid).await? {
        Some(document_id) => {
            state.service.update(&route.uid, &document_id, &data, options).await?;
            document_id
        }
        None => state.service.create(&route.uid, &data, options).await?,
    };
    read_back(&state, route, &document_id, &query, StatusCode::OK).await
}

pub async fn root_delete(
    State(state): State<ApiState>,
    Path(name): Path<String>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
) -> ApiResult {
    let state = localized(state, raw.as_deref())?;
    let route = route(&state, &name)?;
    if !route.single {
        return Err(ApiError::MethodNotAllowed);
    }
    authorize(&state, &headers, route, ContentAction::Delete).await?;
    let document_id =
        state.service.single_document_id(&route.uid).await?.ok_or(ApiError::NotFound)?;
    state.service.delete(&route.uid, &document_id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub async fn document_get(
    State(state): State<ApiState>,
    Path((name, document_id)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
) -> ApiResult {
    let state = localized(state, raw.as_deref())?;
    let route = collection(&state, &name)?;
    let query =
        authorized_query(&state, &headers, route, ContentAction::FindOne, raw.as_deref()).await?;
    read_back(&state, route, &document_id, &query, StatusCode::OK).await
}

pub async fn document_put(
    State(state): State<ApiState>,
    Path((name, document_id)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    let state = localized(state, raw.as_deref())?;
    let route = collection(&state, &name)?;
    let query =
        authorized_query(&state, &headers, route, ContentAction::Update, raw.as_deref()).await?;
    let data = parse_data(&body)?;
    state.service.update(&route.uid, &document_id, &data, write_options(&query)).await?;
    read_back(&state, route, &document_id, &query, StatusCode::OK).await
}

pub async fn document_delete(
    State(state): State<ApiState>,
    Path((name, document_id)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
) -> ApiResult {
    let state = localized(state, raw.as_deref())?;
    let route = collection(&state, &name)?;
    authorize(&state, &headers, route, ContentAction::Delete).await?;
    state.service.delete(&route.uid, &document_id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// `POST /{pluralName}/{documentId}/actions/{publish|unpublish|discard-draft}`.
pub async fn document_action(
    State(state): State<ApiState>,
    Path((name, document_id, action)): Path<(String, String, String)>,
    RawQuery(raw): RawQuery,
    headers: HeaderMap,
) -> ApiResult {
    let state = localized(state, raw.as_deref())?;
    let route = collection(&state, &name)?;
    let mut query =
        authorized_query(&state, &headers, route, ContentAction::Publish, raw.as_deref()).await?;
    match action.as_str() {
        "publish" => {
            state.service.publish(&route.uid, &document_id, None).await?;
            query.status = Status::Published;
        }
        "unpublish" => {
            state.service.unpublish(&route.uid, &document_id).await?;
            query.status = Status::Draft;
        }
        "discard-draft" => {
            state.service.discard_draft(&route.uid, &document_id).await?;
            query.status = Status::Draft;
        }
        _ => return Err(ApiError::NotFound),
    }
    read_back(&state, route, &document_id, &query, StatusCode::OK).await
}

/// The bearer token, if any. A malformed `Authorization` header is `401`.
pub(crate) fn bearer(headers: &HeaderMap) -> Result<Option<&str>, ApiError> {
    let Some(value) = headers.get(axum::http::header::AUTHORIZATION) else { return Ok(None) };
    let value = value.to_str().map_err(|_| ApiError::Unauthorized)?;
    value
        .strip_prefix("Bearer ")
        .map(|token| Some(token.trim()))
        .filter(|token| token.is_some_and(|token| !token.is_empty()))
        .ok_or(ApiError::Unauthorized)
}

async fn authorize(
    state: &ApiState,
    headers: &HeaderMap,
    route: &Route,
    action: ContentAction,
) -> Result<verdin_auth::ContentActor, ApiError> {
    let actor = state.auth.content_actor(bearer(headers)?).await.map_err(|error| match error {
        AuthError::Unauthorized => ApiError::Unauthorized,
        other => ApiError::from(other),
    })?;
    if actor.allows(&route.uid, action) { Ok(actor) } else { Err(ApiError::Forbidden) }
}

/// Authorizes `action`, parses the query, and requires `readDrafts` for `?status=draft`
/// on reads.
async fn authorized_query(
    state: &ApiState,
    headers: &HeaderMap,
    route: &Route,
    action: ContentAction,
    raw: Option<&str>,
) -> Result<Query, ApiError> {
    let actor = authorize(state, headers, route, action).await?;
    let query = parse_query(state, route, raw)?;
    let read = matches!(action, ContentAction::Find | ContentAction::FindOne);
    if read && query.status == Status::Draft && !actor.allows(&route.uid, ContentAction::ReadDrafts)
    {
        return Err(ApiError::Forbidden);
    }
    Ok(query)
}

fn route<'a>(state: &'a ApiState, name: &str) -> Result<&'a Route, ApiError> {
    state.routes.get(name).ok_or(ApiError::NotFound)
}

fn collection<'a>(state: &'a ApiState, name: &str) -> Result<&'a Route, ApiError> {
    let route = route(state, name)?;
    if route.single { Err(ApiError::NotFound) } else { Ok(route) }
}

fn parse_query(state: &ApiState, route: &Route, raw: Option<&str>) -> Result<Query, ApiError> {
    let model = state.service.registry().get(&route.uid)?;
    let catalog = state.service.registry().catalog();
    Ok(verdin_query::parse_request(raw, &model.fields, catalog, &state.config.limits)?)
}

pub(crate) fn parse_data(body: &Bytes) -> Result<Value, ApiError> {
    let body: Value = serde_json::from_slice(body).map_err(|error| {
        ApiError::BadRequest(format!("request body is not valid JSON: {error}"))
    })?;
    match body.get("data") {
        Some(data @ Value::Object(_)) => Ok(data.clone()),
        _ => Err(ApiError::BadRequest("Missing \"data\" payload in the request body".into())),
    }
}

fn write_options(query: &Query) -> WriteOptions {
    WriteOptions { publish: query.status == Status::Published, actor: None }
}

/// After a write, the response shows the version that was written (`status`).
async fn read_back(
    state: &ApiState,
    route: &Route,
    document_id: &str,
    query: &Query,
    status: StatusCode,
) -> ApiResult {
    let document =
        state.service.find_one(&route.uid, document_id, query).await?.ok_or(ApiError::NotFound)?;
    Ok((status, Json(json!({ "data": document, "meta": {} }))).into_response())
}
