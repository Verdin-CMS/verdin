//! `GET /_events` on the content API: realtime content and media events for what the
//! caller may read (see [`crate::realtime`]).

use axum::Router;
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::Deserialize;
use verdin_auth::{AuthError, AuthService, ContentAction, ContentActor, UPLOAD_SUBJECT};

use crate::error::ApiError;
use crate::realtime::{Message, Realtime, wanted_types};

#[derive(Clone)]
struct EventsState {
    realtime: Realtime,
    auth: AuthService,
}

pub(crate) fn content(realtime: Realtime, auth: AuthService) -> Router {
    Router::new().route("/_events", get(events)).with_state(EventsState { realtime, auth })
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct EventsQuery {
    /// Comma-separated content type uids (`plugin::upload` for media).
    types: Option<String>,
}

/// Whether a content API caller may receive `message`.
pub(crate) fn content_allows(actor: &ContentActor, message: &Message) -> bool {
    if message.admin_only {
        return false;
    }
    if message.uid == UPLOAD_SUBJECT {
        return actor.allows(UPLOAD_SUBJECT, ContentAction::Find)
            || actor.allows(UPLOAD_SUBJECT, ContentAction::FindOne);
    }
    let readable = actor.allows(&message.uid, ContentAction::Find)
        || actor.allows(&message.uid, ContentAction::FindOne);
    readable && (!message.drafts_only || actor.allows(&message.uid, ContentAction::ReadDrafts))
}

async fn events(
    State(state): State<EventsState>,
    Query(query): Query<EventsQuery>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let actor =
        state.auth.content_actor(crate::handlers::bearer(&headers)?).await.map_err(|error| {
            match error {
                AuthError::Unauthorized => ApiError::Unauthorized,
                other => ApiError::from(other),
            }
        })?;
    let types = wanted_types(query.types.as_deref());
    let allow = move |message: &Message| {
        types.as_ref().is_none_or(|types| types.contains(&message.uid))
            && content_allows(&actor, message)
    };
    Ok(state.realtime.stream(crate::realtime::STREAM_LIFETIME, false, allow).into_response())
}
