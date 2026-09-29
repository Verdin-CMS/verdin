//! Comments and tasks on entries (the `comments` feature). Reading an entry's type is
//! enough to read and write its comments and tasks; comments are edited and deleted by
//! their author (or a Super Admin), tasks by their creator or assignee. Mentioned admins
//! and assignees are emailed; the admin realtime stream announces changes.

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use serde::Deserialize;
use verdin_auth::{AdminPrincipal, Grant, actions};

use super::{AdminState, ApiResult, body, data, double_option, ensure_owner, principal};
use crate::comments::{Comments, Entry, MAX_BODY, TaskChanges, TaskFilter, mentions};
use crate::error::ApiError;

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/comments", get(threads).post(add_comment))
        .route("/comments/{id}", put(edit_comment).delete(delete_comment))
        .route("/comments/{id}/resolve", post(resolve))
        .route("/comments/{id}/reopen", post(reopen))
        .route("/tasks", get(tasks).post(add_task))
        .route("/tasks/{id}", put(update_task).delete(delete_task))
}

fn service(state: &AdminState) -> Result<&Comments, ApiError> {
    state.config.comments.as_ref().ok_or(ApiError::NotFound)
}

fn internal(error: impl std::fmt::Display) -> ApiError {
    ApiError::Internal(error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntryQuery {
    uid: String,
    document_id: String,
    locale: Option<String>,
}

/// The entry, once the admin may read it (in its locale).
async fn readable_entry(
    state: &AdminState,
    principal: &AdminPrincipal,
    uid: &str,
    document_id: &str,
    locale: Option<&str>,
) -> Result<Entry, ApiError> {
    let model = state.service.registry().get(uid)?;
    let service = state.service.in_locale(locale.map(str::to_owned));
    let locale = service.locale_of(model)?;
    let scoped = model.content_type.localized.then_some(locale.as_str());
    let grant = principal.permissions.content_in(actions::CONTENT_READ, uid, scoped);
    if grant == Grant::None {
        return Err(ApiError::Forbidden);
    }
    ensure_owner(state, uid, document_id, principal, grant).await?;
    if !service.exists(uid, document_id).await? {
        return Err(ApiError::NotFound);
    }
    Ok(Entry { uid: uid.to_owned(), document_id: document_id.to_owned(), locale })
}

/// The admin may read `entry` (for mentions and assignees).
async fn may_read(state: &AdminState, user_id: i64, entry: &Entry) -> bool {
    let Ok(user) = state.auth.user(user_id).await else { return false };
    if !user.is_active {
        return false;
    }
    let Ok(permissions) = state.auth.permission_set(user_id).await else { return false };
    let locale = (!entry.locale.is_empty()).then_some(entry.locale.as_str());
    match permissions.content_in(actions::CONTENT_READ, &entry.uid, locale) {
        Grant::None => false,
        Grant::Own => state
            .service
            .created_by(&entry.uid, &entry.document_id)
            .await
            .is_ok_and(|creator| creator == Some(user_id)),
        _ => true,
    }
}

fn entry_url(state: &AdminState, entry: &Entry) -> String {
    let locale =
        if entry.locale.is_empty() { String::new() } else { format!("?locale={}", entry.locale) };
    format!(
        "{}{}/content/{}/{}{locale}",
        state.config.public_url.trim_end_matches('/'),
        state.config.path,
        entry.uid,
        entry.document_id
    )
}

/// Emails `user_id` about an entry, when a mailer is set up.
async fn notify(state: &AdminState, user_id: i64, subject: &str, intro: &str, entry: &Entry) {
    let Some(mailer) = &state.config.mailer else { return };
    let Ok(user) = state.auth.user(user_id).await else { return };
    let url = entry_url(state, entry);
    let name = user.firstname.clone().unwrap_or_else(|| user.email.clone());
    let escape = |text: &str| {
        text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
    };
    let message = verdin_email::Message {
        to: user.email.clone(),
        subject: subject.to_owned(),
        text: format!("Hello {name},\n\n{intro}\n\nOpen the entry: {url}\n"),
        html: Some(format!(
            "<p>Hello {},</p><p>{}</p><p><a href=\"{url}\">Open the entry</a></p>",
            escape(&name),
            escape(intro)
        )),
    };
    if let Err(error) = mailer.send(&message).await {
        tracing::warn!(%error, user = user_id, "could not send the notification");
    }
}

fn author_name(principal: &AdminPrincipal) -> String {
    principal.user.firstname.clone().unwrap_or_else(|| principal.user.email.clone())
}

fn announce(state: &AdminState, event: &str, entry: &Entry) {
    if let Some(realtime) = &state.config.realtime {
        realtime.announce(event, &entry.uid, &entry.document_id, &entry.locale);
    }
}

fn check_body(body: &str) -> Result<&str, ApiError> {
    let body = body.trim();
    if body.is_empty() {
        return Err(ApiError::BadRequest("the comment is empty".into()));
    }
    if body.chars().count() > MAX_BODY {
        return Err(ApiError::BadRequest(format!("comments are at most {MAX_BODY} characters")));
    }
    Ok(body)
}

async fn threads(
    State(state): State<AdminState>,
    Query(query): Query<EntryQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let comments = service(&state)?;
    let principal = principal(&state, &headers).await?;
    let entry =
        readable_entry(&state, &principal, &query.uid, &query.document_id, query.locale.as_deref())
            .await?;
    Ok(data(comments.threads(&entry).await.map_err(internal)?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct NewComment {
    uid: String,
    document_id: String,
    locale: Option<String>,
    field: Option<String>,
    parent_id: Option<i64>,
    body: String,
}

async fn add_comment(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let comments = service(&state)?;
    let principal = principal(&state, &headers).await?;
    let input: NewComment = body(&bytes)?;
    let entry =
        readable_entry(&state, &principal, &input.uid, &input.document_id, input.locale.as_deref())
            .await?;
    let text = check_body(&input.body)?;
    if let Some(field) = &input.field {
        let model = state.service.registry().get(&entry.uid)?;
        let root = field.split('.').next().unwrap_or_default();
        if !model.content_type.attributes.contains_key(root) {
            return Err(ApiError::BadRequest(format!("unknown field `{field}`")));
        }
    }
    let mut field = input.field.clone();
    if let Some(parent) = input.parent_id {
        let parent = comments.comment(parent).await.map_err(internal)?.ok_or(ApiError::NotFound)?;
        let same = parent.uid == entry.uid
            && parent.document_id == entry.document_id
            && parent.locale == entry.locale;
        if !same || parent.parent_id.is_some() {
            return Err(ApiError::BadRequest("replies go to a thread of the same entry".into()));
        }
        // Replies share the thread's field.
        field = parent.field;
    }
    let comment = comments
        .add_comment(&entry, field.as_deref(), input.parent_id, text, principal.user.id)
        .await
        .map_err(internal)?;
    announce(&state, "comment.create", &entry);
    let author = author_name(&principal);
    for mentioned in mentions(text) {
        if mentioned != principal.user.id && may_read(&state, mentioned, &entry).await {
            let intro = format!("{author} mentioned you in a comment: \"{text}\"");
            notify(&state, mentioned, &format!("{author} mentioned you"), &intro, &entry).await;
        }
    }
    Ok((StatusCode::CREATED, data(comment)).into_response())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EditComment {
    body: String,
}

/// The comment, when its entry is readable by the admin.
async fn own_comment(
    state: &AdminState,
    principal: &AdminPrincipal,
    id: i64,
) -> Result<(crate::comments::Comment, Entry), ApiError> {
    let comments = service(state)?;
    let comment = comments.comment(id).await.map_err(internal)?.ok_or(ApiError::NotFound)?;
    let locale = (!comment.locale.is_empty()).then_some(comment.locale.as_str());
    let entry =
        readable_entry(state, principal, &comment.uid, &comment.document_id, locale).await?;
    Ok((comment, entry))
}

async fn edit_comment(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let input: EditComment = body(&bytes)?;
    let (comment, entry) = own_comment(&state, &principal, id).await?;
    if comment.author_id != Some(principal.user.id) {
        return Err(ApiError::Forbidden);
    }
    let text = check_body(&input.body)?;
    let updated = service(&state)?.edit_comment(id, text).await.map_err(internal)?;
    announce(&state, "comment.update", &entry);
    Ok(data(updated))
}

async fn delete_comment(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let (comment, entry) = own_comment(&state, &principal, id).await?;
    if comment.author_id != Some(principal.user.id) && !principal.permissions.super_admin {
        return Err(ApiError::Forbidden);
    }
    service(&state)?.delete_comment(id).await.map_err(internal)?;
    announce(&state, "comment.delete", &entry);
    Ok(StatusCode::NO_CONTENT.into_response())
}

async fn resolve(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    set_resolved(state, id, headers, true).await
}

async fn reopen(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    set_resolved(state, id, headers, false).await
}

async fn set_resolved(state: AdminState, id: i64, headers: HeaderMap, resolved: bool) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let (comment, entry) = own_comment(&state, &principal, id).await?;
    if comment.parent_id.is_some() {
        return Err(ApiError::BadRequest("threads are resolved by their first comment".into()));
    }
    let by = resolved.then_some(principal.user.id);
    let updated = service(&state)?.resolve(id, by).await.map_err(internal)?;
    announce(&state, if resolved { "comment.resolve" } else { "comment.reopen" }, &entry);
    Ok(data(updated))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TasksQuery {
    uid: Option<String>,
    document_id: Option<String>,
    locale: Option<String>,
    /// `true`: the caller's tasks, across entries.
    #[serde(default)]
    mine: bool,
    status: Option<String>,
}

async fn tasks(
    State(state): State<AdminState>,
    Query(query): Query<TasksQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let comments = service(&state)?;
    let principal = principal(&state, &headers).await?;
    let entry = match (&query.uid, &query.document_id) {
        (Some(uid), Some(document_id)) => Some(
            readable_entry(&state, &principal, uid, document_id, query.locale.as_deref()).await?,
        ),
        (None, None) if query.mine => None,
        _ => {
            return Err(ApiError::BadRequest(
                "ask for an entry's tasks (`uid` and `documentId`) or your own (`mine=true`)"
                    .into(),
            ));
        }
    };
    let filter = TaskFilter {
        entry,
        assignee_id: query.mine.then_some(principal.user.id),
        status: query.status.clone(),
    };
    let mut list = comments.tasks(&filter).await.map_err(internal)?;
    if query.mine {
        // Entries the caller can no longer read are left out.
        let mut visible = Vec::with_capacity(list.len());
        for task in list {
            let locale = (!task.locale.is_empty()).then_some(task.locale.as_str());
            if principal.permissions.content_in(actions::CONTENT_READ, &task.uid, locale)
                != Grant::None
            {
                visible.push(task);
            }
        }
        list = visible;
    }
    Ok(data(list))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct NewTask {
    uid: String,
    document_id: String,
    locale: Option<String>,
    title: String,
    description: Option<String>,
    assignee_id: Option<i64>,
    due_date: Option<String>,
}

fn parse_date(text: &str) -> Result<time::Date, ApiError> {
    let format = time::macros::format_description!("[year]-[month]-[day]");
    time::Date::parse(text, &format)
        .map_err(|_| ApiError::BadRequest("dueDate is a YYYY-MM-DD date".into()))
}

fn check_title(title: &str) -> Result<&str, ApiError> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 255 {
        return Err(ApiError::BadRequest("the title needs 1 to 255 characters".into()));
    }
    Ok(title)
}

async fn check_assignee(
    state: &AdminState,
    assignee: Option<i64>,
    entry: &Entry,
) -> Result<(), ApiError> {
    match assignee {
        Some(id) if !may_read(state, id, entry).await => {
            Err(ApiError::BadRequest("the assignee cannot read this entry".into()))
        }
        _ => Ok(()),
    }
}

async fn add_task(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    let comments = service(&state)?;
    let principal = principal(&state, &headers).await?;
    let input: NewTask = body(&bytes)?;
    let entry =
        readable_entry(&state, &principal, &input.uid, &input.document_id, input.locale.as_deref())
            .await?;
    let title = check_title(&input.title)?;
    let due = input.due_date.as_deref().map(parse_date).transpose()?;
    check_assignee(&state, input.assignee_id, &entry).await?;
    let task = comments
        .add_task(
            &entry,
            title,
            input.description.as_deref(),
            input.assignee_id,
            due,
            principal.user.id,
        )
        .await
        .map_err(internal)?;
    announce(&state, "task.create", &entry);
    if let Some(assignee) = input.assignee_id.filter(|id| *id != principal.user.id) {
        let author = author_name(&principal);
        let intro = format!("{author} assigned you a task: \"{title}\"");
        notify(&state, assignee, &format!("New task: {title}"), &intro, &entry).await;
    }
    Ok((StatusCode::CREATED, data(task)).into_response())
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TaskPatch {
    title: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    description: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    assignee_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    due_date: Option<Option<String>>,
    status: Option<String>,
}

async fn editable_task(
    state: &AdminState,
    principal: &AdminPrincipal,
    id: i64,
) -> Result<(crate::comments::Task, Entry), ApiError> {
    let task = service(state)?.task(id).await.map_err(internal)?.ok_or(ApiError::NotFound)?;
    let locale = (!task.locale.is_empty()).then_some(task.locale.as_str());
    let entry = readable_entry(state, principal, &task.uid, &task.document_id, locale).await?;
    let me = Some(principal.user.id);
    if task.created_by != me && task.assignee_id != me && !principal.permissions.super_admin {
        return Err(ApiError::Forbidden);
    }
    Ok((task, entry))
}

async fn update_task(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let input: TaskPatch = body(&bytes)?;
    let (task, entry) = editable_task(&state, &principal, id).await?;
    if let Some(status) = &input.status
        && !matches!(status.as_str(), "open" | "done")
    {
        return Err(ApiError::BadRequest("status is `open` or `done`".into()));
    }
    if let Some(assignee) = input.assignee_id {
        check_assignee(&state, assignee, &entry).await?;
    }
    let changes = TaskChanges {
        title: input.title.as_deref().map(check_title).transpose()?.map(str::to_owned),
        description: input.description.clone(),
        assignee_id: input.assignee_id,
        due_date: match &input.due_date {
            None => None,
            Some(None) => Some(None),
            Some(Some(text)) => Some(Some(parse_date(text)?)),
        },
        status: input.status.clone(),
    };
    let updated = service(&state)?
        .update_task(id, changes)
        .await
        .map_err(internal)?
        .ok_or(ApiError::NotFound)?;
    announce(&state, "task.update", &entry);
    if let Some(Some(assignee)) = input.assignee_id
        && Some(assignee) != task.assignee_id
        && assignee != principal.user.id
    {
        let author = author_name(&principal);
        let intro = format!("{author} assigned you a task: \"{}\"", updated.title);
        notify(&state, assignee, &format!("New task: {}", updated.title), &intro, &entry).await;
    }
    Ok(data(updated))
}

async fn delete_task(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let (task, entry) = editable_task(&state, &principal, id).await?;
    if task.created_by != Some(principal.user.id) && !principal.permissions.super_admin {
        return Err(ApiError::Forbidden);
    }
    service(&state)?.delete_task(id).await.map_err(internal)?;
    announce(&state, "task.delete", &entry);
    Ok(StatusCode::NO_CONTENT.into_response())
}
