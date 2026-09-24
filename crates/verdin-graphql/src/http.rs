//! `POST /graphql` (and `GET` for queries), authenticated like the content API.

use std::sync::Arc;

use async_graphql::dynamic::Schema;
use async_graphql::http::GraphiQLSource;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use serde_json::json;
use verdin_auth::{AuthError, AuthService};

use crate::Options;

#[derive(Clone)]
struct Endpoint {
    schema: Schema,
    auth: AuthService,
    options: Options,
    path: Arc<str>,
}

/// Routes for `path` (e.g. `/graphql`).
pub fn router(schema: Schema, auth: AuthService, options: Options, path: &str) -> Router {
    let endpoint = Endpoint { schema, auth, options, path: path.into() };
    Router::new().route(path, get(get_request).post(post_request)).with_state(endpoint)
}

fn failure(status: StatusCode, message: &str) -> Response {
    (status, axum::Json(json!({ "errors": [{ "message": message }] }))).into_response()
}

/// `Ok(None)` without a header; `Err(())` when it is not a Bearer token.
fn bearer(headers: &HeaderMap) -> Result<Option<&str>, ()> {
    match headers.get(header::AUTHORIZATION) {
        None => Ok(None),
        Some(value) => {
            value.to_str().ok().and_then(|value| value.strip_prefix("Bearer ")).map(Some).ok_or(())
        }
    }
}

async fn execute(
    endpoint: &Endpoint,
    headers: &HeaderMap,
    request: async_graphql::Request,
) -> Response {
    let Ok(token) = bearer(headers) else {
        return failure(StatusCode::UNAUTHORIZED, "Malformed authorization header");
    };
    let actor = match endpoint.auth.content_actor(token).await {
        Ok(actor) => actor,
        Err(AuthError::Unauthorized) => return failure(StatusCode::UNAUTHORIZED, "Unauthorized"),
        Err(error) => {
            tracing::error!(%error, "authenticating a GraphQL request");
            return failure(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error");
        }
    };
    let response = endpoint.schema.execute(request.data(actor)).await;
    axum::Json(response).into_response()
}

async fn post_request(
    State(endpoint): State<Endpoint>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let request: async_graphql::Request = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(error) => {
            return failure(StatusCode::BAD_REQUEST, &format!("invalid GraphQL request: {error}"));
        }
    };
    execute(&endpoint, &headers, request).await
}

/// `GET ?query=…` runs queries (never mutations); a browser without a query gets GraphiQL
/// when the playground is on.
async fn get_request(
    State(endpoint): State<Endpoint>,
    headers: HeaderMap,
    RawQuery(raw): RawQuery,
) -> Response {
    let params: std::collections::HashMap<String, String> =
        url_decode(raw.as_deref().unwrap_or_default());
    let Some(query) = params.get("query") else {
        let wants_html = headers
            .get(header::ACCEPT)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|accept| accept.contains("text/html"));
        if wants_html && endpoint.options.playground {
            return playground(&endpoint.path);
        }
        return failure(StatusCode::BAD_REQUEST, "missing `query`");
    };
    if query.trim_start().starts_with("mutation") {
        return failure(StatusCode::METHOD_NOT_ALLOWED, "mutations need POST");
    }
    let mut request = async_graphql::Request::new(query.clone());
    if let Some(variables) = params.get("variables") {
        match serde_json::from_str(variables) {
            Ok(variables) => {
                request = request.variables(async_graphql::Variables::from_json(variables))
            }
            Err(error) => {
                return failure(StatusCode::BAD_REQUEST, &format!("invalid variables: {error}"));
            }
        }
    }
    if let Some(name) = params.get("operationName") {
        request = request.operation_name(name.clone());
    }
    execute(&endpoint, &headers, request).await
}

fn url_decode(raw: &str) -> std::collections::HashMap<String, String> {
    url::form_urlencoded::parse(raw.as_bytes()).into_owned().collect()
}

/// GraphiQL loads from unpkg: its page alone allows that origin.
fn playground(path: &str) -> Response {
    let html = GraphiQLSource::build().endpoint(path).title("Verdin GraphQL").finish();
    let mut response = Html(html).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'none'; script-src 'self' 'unsafe-inline' https://unpkg.com; \
             style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://unpkg.com; \
             font-src 'self' data: https://unpkg.com; connect-src 'self'; frame-ancestors 'none'; \
             base-uri 'none'; form-action 'none'",
        ),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    response
}
