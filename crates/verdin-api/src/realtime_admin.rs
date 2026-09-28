//! The admin's realtime channel (`GET /events`) and presence on entries
//! (`POST /presence`, `GET /presence`): who is viewing or editing, and the soft lock.

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::get;
use serde::Deserialize;
use verdin_auth::{Grant, UPLOAD_SUBJECT, actions};

use super::{AdminState, ApiResult, body, data, principal};
use crate::error::ApiError;
use crate::realtime::{Message, Realtime, wanted_types};

pub(super) fn routes() -> Router<AdminState> {
    Router::new().route("/events", get(events)).route("/presence", get(viewers).post(heartbeat))
}

fn service(state: &AdminState) -> Result<&Realtime, ApiError> {
    state.config.realtime.as_ref().ok_or(ApiError::NotFound)
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct EventsQuery {
    types: Option<String>,
}

async fn events(
    State(state): State<AdminState>,
    Query(query): Query<EventsQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let realtime = service(&state)?.clone();
    let principal = principal(&state, &headers).await?;
    let types = wanted_types(query.types.as_deref());
    let permissions = principal.permissions;
    let allow = move |message: &Message| {
        if types.as_ref().is_some_and(|types| !types.contains(&message.uid)) {
            return false;
        }
        if message.uid == UPLOAD_SUBJECT {
            return permissions.media(actions::MEDIA_READ) != Grant::None;
        }
        permissions.content(actions::CONTENT_READ, &message.uid) != Grant::None
    };
    Ok(realtime.stream(crate::realtime::ADMIN_STREAM_LIFETIME, true, allow).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntryQuery {
    uid: String,
    document_id: String,
    #[serde(default)]
    locale: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Heartbeat {
    uid: String,
    document_id: String,
    #[serde(default)]
    locale: Option<String>,
    /// Has unsaved changes / is typing.
    #[serde(default)]
    editing: bool,
    /// Closing the editor.
    #[serde(default)]
    leave: bool,
}

async fn readable(
    state: &AdminState,
    headers: &HeaderMap,
    uid: &str,
) -> Result<verdin_auth::AdminPrincipal, ApiError> {
    state.service.registry().get(uid)?;
    let principal = principal(state, headers).await?;
    if principal.permissions.content(actions::CONTENT_READ, uid) == Grant::None {
        return Err(ApiError::Forbidden);
    }
    Ok(principal)
}

fn name_of(principal: &verdin_auth::AdminPrincipal) -> String {
    let user = &principal.user;
    match (&user.firstname, &user.lastname) {
        (Some(first), Some(last)) => format!("{first} {last}"),
        (Some(first), None) => first.clone(),
        _ => user.email.clone(),
    }
}

/// `POST /presence`: every ~20 s while the editor is open; returns who is on the entry.
async fn heartbeat(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    let realtime = service(&state)?;
    let input: Heartbeat = body(&bytes)?;
    let principal = readable(&state, &headers, &input.uid).await?;
    let key = (input.uid, input.document_id, input.locale.unwrap_or_default());
    let viewers = realtime.heartbeat(
        key,
        principal.user.id,
        &name_of(&principal),
        input.editing,
        input.leave,
    );
    Ok(data(viewers))
}

async fn viewers(
    State(state): State<AdminState>,
    Query(query): Query<EntryQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let realtime = service(&state)?;
    readable(&state, &headers, &query.uid).await?;
    let key = (query.uid, query.document_id, query.locale.unwrap_or_default());
    Ok(data(realtime.viewers(&key)))
}
