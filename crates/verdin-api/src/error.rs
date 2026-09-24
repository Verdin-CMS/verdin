//! Errors in Strapi's response format:
//! `{ "data": null, "error": { "status", "name", "message", "details" } }`.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use verdin_content::ContentError;
use verdin_query::QueryError;

#[derive(Debug)]
pub enum ApiError {
    NotFound,
    Forbidden,
    MethodNotAllowed,
    BadRequest(String),
    Content(ContentError),
}

impl From<ContentError> for ApiError {
    fn from(error: ContentError) -> Self {
        ApiError::Content(error)
    }
}

impl From<QueryError> for ApiError {
    fn from(error: QueryError) -> Self {
        ApiError::BadRequest(error.message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, name, message, details) = match self {
            ApiError::NotFound => {
                (StatusCode::NOT_FOUND, "NotFoundError", "Not Found".to_owned(), json!({}))
            }
            ApiError::Forbidden => {
                (StatusCode::FORBIDDEN, "ForbiddenError", "Forbidden".to_owned(), json!({}))
            }
            ApiError::MethodNotAllowed => (
                StatusCode::METHOD_NOT_ALLOWED,
                "MethodNotAllowedError",
                "Method Not Allowed".to_owned(),
                json!({}),
            ),
            ApiError::BadRequest(message) => {
                (StatusCode::BAD_REQUEST, "ValidationError", message, json!({}))
            }
            ApiError::Content(error) => match error {
                ContentError::NotFound | ContentError::UnknownType(_) => {
                    (StatusCode::NOT_FOUND, "NotFoundError", "Not Found".to_owned(), json!({}))
                }
                ContentError::Validation(ref issues) => {
                    let message = error.to_string();
                    (
                        StatusCode::BAD_REQUEST,
                        "ValidationError",
                        message,
                        json!({ "errors": issues }),
                    )
                }
                ContentError::BadRequest(message) => {
                    (StatusCode::BAD_REQUEST, "ValidationError", message, json!({}))
                }
                ContentError::Db(error) => {
                    tracing::error!(%error, "database error while serving the content API");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "ApplicationError",
                        "Internal Server Error".to_owned(),
                        json!({}),
                    )
                }
            },
        };
        let body: Value = json!({
            "data": null,
            "error": { "status": status.as_u16(), "name": name, "message": message, "details": details },
        });
        (status, Json(body)).into_response()
    }
}
