//! Content API handlers.
//!
//! Collection types: `/{pluralName}` and `/{pluralName}/{documentId}`.
//! Single types: `/{singularName}`.
//! With draft & publish, `POST` and `PUT` publish unless `?status=draft` (Strapi v5).

use axum::Json;
use axum::extract::{Path, RawQuery, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use serde_json::{Value, json};
use verdin_content::WriteOptions;
use verdin_query::{Query, Status};

use crate::error::ApiError;
use crate::{ApiState, Route};

type ApiResult = Result<Response, ApiError>;

pub async fn openapi(State(state): State<ApiState>) -> ApiResult {
    authorize(&state)?;
    Ok(Json((*state.openapi).clone()).into_response())
}

pub async fn not_found() -> ApiError {
    ApiError::NotFound
}

pub async fn root_get(
    State(state): State<ApiState>,
    Path(name): Path<String>,
    RawQuery(raw): RawQuery,
) -> ApiResult {
    let route = resolve(&state, &name)?;
    let query = parse_query(&state, route, raw.as_deref())?;
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
    body: Bytes,
) -> ApiResult {
    let route = resolve(&state, &name)?;
    if route.single {
        return Err(ApiError::MethodNotAllowed);
    }
    let query = parse_query(&state, route, raw.as_deref())?;
    let data = parse_data(&body)?;
    let document_id = state.service.create(&route.uid, &data, write_options(&query)).await?;
    read_back(&state, route, &document_id, &query, StatusCode::CREATED).await
}

/// Single types: update the document, or create it on first write.
pub async fn root_put(
    State(state): State<ApiState>,
    Path(name): Path<String>,
    RawQuery(raw): RawQuery,
    body: Bytes,
) -> ApiResult {
    let route = resolve(&state, &name)?;
    if !route.single {
        return Err(ApiError::MethodNotAllowed);
    }
    let query = parse_query(&state, route, raw.as_deref())?;
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

pub async fn root_delete(State(state): State<ApiState>, Path(name): Path<String>) -> ApiResult {
    let route = resolve(&state, &name)?;
    if !route.single {
        return Err(ApiError::MethodNotAllowed);
    }
    let document_id =
        state.service.single_document_id(&route.uid).await?.ok_or(ApiError::NotFound)?;
    state.service.delete(&route.uid, &document_id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub async fn document_get(
    State(state): State<ApiState>,
    Path((name, document_id)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
) -> ApiResult {
    let route = collection(&state, &name)?;
    let query = parse_query(&state, route, raw.as_deref())?;
    read_back(&state, route, &document_id, &query, StatusCode::OK).await
}

pub async fn document_put(
    State(state): State<ApiState>,
    Path((name, document_id)): Path<(String, String)>,
    RawQuery(raw): RawQuery,
    body: Bytes,
) -> ApiResult {
    let route = collection(&state, &name)?;
    let query = parse_query(&state, route, raw.as_deref())?;
    let data = parse_data(&body)?;
    state.service.update(&route.uid, &document_id, &data, write_options(&query)).await?;
    read_back(&state, route, &document_id, &query, StatusCode::OK).await
}

pub async fn document_delete(
    State(state): State<ApiState>,
    Path((name, document_id)): Path<(String, String)>,
) -> ApiResult {
    let route = collection(&state, &name)?;
    state.service.delete(&route.uid, &document_id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// `POST /{pluralName}/{documentId}/actions/{publish|unpublish|discard-draft}`.
pub async fn document_action(
    State(state): State<ApiState>,
    Path((name, document_id, action)): Path<(String, String, String)>,
    RawQuery(raw): RawQuery,
) -> ApiResult {
    let route = collection(&state, &name)?;
    let mut query = parse_query(&state, route, raw.as_deref())?;
    match action.as_str() {
        "publish" => {
            state.service.publish(&route.uid, &document_id).await?;
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

fn authorize(state: &ApiState) -> Result<(), ApiError> {
    if state.config.open_access { Ok(()) } else { Err(ApiError::Forbidden) }
}

fn resolve<'a>(state: &'a ApiState, name: &str) -> Result<&'a Route, ApiError> {
    let route = state.routes.get(name).ok_or(ApiError::NotFound)?;
    authorize(state)?;
    Ok(route)
}

fn collection<'a>(state: &'a ApiState, name: &str) -> Result<&'a Route, ApiError> {
    let route = resolve(state, name)?;
    if route.single { Err(ApiError::NotFound) } else { Ok(route) }
}

fn parse_query(state: &ApiState, route: &Route, raw: Option<&str>) -> Result<Query, ApiError> {
    let model = state.service.registry().get(&route.uid)?;
    let catalog = state.service.registry().catalog();
    Ok(verdin_query::parse_request(raw, &model.fields, catalog, &state.config.limits)?)
}

fn parse_data(body: &Bytes) -> Result<Value, ApiError> {
    let body: Value = serde_json::from_slice(body).map_err(|error| {
        ApiError::BadRequest(format!("request body is not valid JSON: {error}"))
    })?;
    match body.get("data") {
        Some(data @ Value::Object(_)) => Ok(data.clone()),
        _ => Err(ApiError::BadRequest("Missing \"data\" payload in the request body".into())),
    }
}

fn write_options(query: &Query) -> WriteOptions {
    WriteOptions { publish: query.status == Status::Published }
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
