//! Errors in Strapi's response format:
//! `{ "data": null, "error": { "status", "name", "message", "details" } }`.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use verdin_auth::AuthError;
use verdin_content::ContentError;
use verdin_query::QueryError;

#[derive(Debug)]
pub enum ApiError {
    NotFound,
    Unauthorized,
    Forbidden,
    MethodNotAllowed,
    TooManyRequests,
    BadRequest(String),
    Conflict(String),
    PayloadTooLarge(String),
    Content(ContentError),
    Internal(String),
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

impl From<AuthError> for ApiError {
    fn from(error: AuthError) -> Self {
        match error {
            AuthError::InvalidCredentials => ApiError::BadRequest("Invalid credentials".into()),
            AuthError::Unauthorized => ApiError::Unauthorized,
            AuthError::Forbidden => ApiError::Forbidden,
            AuthError::NotFound => ApiError::NotFound,
            AuthError::AlreadyInitialized => ApiError::Forbidden,
            AuthError::Validation(message) => ApiError::BadRequest(message),
            AuthError::Conflict(message) => ApiError::Conflict(message),
            AuthError::InvalidConfig(message) => ApiError::Internal(message),
            AuthError::Db(error) => ApiError::Internal(error.to_string()),
        }
    }
}

fn simple(
    status: StatusCode,
    name: &'static str,
    message: &str,
) -> (StatusCode, &'static str, String, Value) {
    (status, name, message.to_owned(), json!({}))
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, name, message, details) = match self {
            ApiError::NotFound => simple(StatusCode::NOT_FOUND, "NotFoundError", "Not Found"),
            ApiError::Unauthorized => {
                simple(StatusCode::UNAUTHORIZED, "UnauthorizedError", "Unauthorized")
            }
            ApiError::Forbidden => simple(StatusCode::FORBIDDEN, "ForbiddenError", "Forbidden"),
            ApiError::MethodNotAllowed => simple(
                StatusCode::METHOD_NOT_ALLOWED,
                "MethodNotAllowedError",
                "Method Not Allowed",
            ),
            ApiError::TooManyRequests => simple(
                StatusCode::TOO_MANY_REQUESTS,
                "RateLimitError",
                "Too many requests, please try again later",
            ),
            ApiError::BadRequest(message) => {
                (StatusCode::BAD_REQUEST, "ValidationError", message, json!({}))
            }
            ApiError::Conflict(message) => {
                (StatusCode::CONFLICT, "ConflictError", message, json!({}))
            }
            ApiError::PayloadTooLarge(message) => {
                (StatusCode::PAYLOAD_TOO_LARGE, "PayloadTooLargeError", message, json!({}))
            }
            ApiError::Internal(message) => {
                tracing::error!(%message, "internal error");
                simple(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "ApplicationError",
                    "Internal Server Error",
                )
            }
            ApiError::Content(error) => match error {
                ContentError::NotFound | ContentError::UnknownType(_) => {
                    simple(StatusCode::NOT_FOUND, "NotFoundError", "Not Found")
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
                    tracing::error!(%error, "database error while serving an API request");
                    simple(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "ApplicationError",
                        "Internal Server Error",
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

impl From<verdin_upload::UploadError> for ApiError {
    fn from(error: verdin_upload::UploadError) -> Self {
        use verdin_upload::UploadError as E;
        match error {
            E::Validation(message) => ApiError::BadRequest(message),
            E::NotFound => ApiError::NotFound,
            E::TooLarge(_) => ApiError::PayloadTooLarge(error.to_string()),
            E::Storage(message) => ApiError::Internal(message),
            E::Db(error) => ApiError::Internal(error.to_string()),
        }
    }
}
