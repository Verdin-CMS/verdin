//! Collaboration features of the admin: which documents an admin has seen, votes on
//! documents and dashboard polls. Everything here requires an admin session; document
//! views and votes also require read access to the document.

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, put};
use axum::{Json, Router};
use bytes::Bytes;
use serde::Deserialize;
use serde_json::{Value, json};
use time::OffsetDateTime;
use verdin_auth::{AdminPrincipal, actions};
use verdin_db::value::{format_datetime, truncate_millis};
use verdin_db::{ColumnKind as K, Database, SqlValue as V};
use verdin_migrate::system::{DOCUMENT_VIEWS, DOCUMENT_VOTES, POLL_VOTES, POLLS};
use verdin_query::temporal::parse_datetime;
use verdin_query::{Filter, MarkFilter};

use super::{AdminState, ApiResult, body, content_grant, data, ensure_owner, principal};
use crate::error::ApiError;

const MAX_POLL_OPTIONS: usize = 10;
const MAX_OPTION_LENGTH: usize = 200;
const MAX_QUESTION_LENGTH: usize = 500;
const MAX_VOTE_IDS: usize = 100;

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/engagement/{uid}/votes", get(vote_summaries))
        .route("/engagement/{uid}/votes/top", get(top_voted))
        .route("/engagement/{uid}/{document_id}/vote", put(vote))
        .route("/engagement/{uid}/{document_id}/view", put(view))
        .route("/polls", get(list_polls).post(create_poll))
        .route("/polls/{id}", get(get_poll).put(update_poll).delete(delete_poll))
        .route("/polls/{id}/vote", put(vote_poll))
}

fn now() -> OffsetDateTime {
    truncate_millis(OffsetDateTime::now_utc())
}

fn db(state: &AdminState) -> &Database {
    state.service.db()
}

/// Filter for `?unseen=true` on admin lists: documents the admin has not seen since
/// their last change by someone else.
pub(super) fn unseen_filter(uid: &str, user_id: i64) -> Filter {
    Filter::Not(Box::new(Filter::Marked(MarkFilter {
        table: DOCUMENT_VIEWS.into(),
        user_id,
        content_type: uid.into(),
    })))
}

/// Keeps "seen" marks and votes in line with document writes, from any API.
pub struct EngagementListener {
    db: Database,
}

impl EngagementListener {
    pub fn new(db: Database) -> Self {
        Self { db }
    }
}

impl verdin_content::events::DocumentListener for EngagementListener {
    fn notify<'a>(
        &'a self,
        event: &'a verdin_content::events::DocumentEvent,
    ) -> verdin_content::events::BoxFuture<'a, ()> {
        Box::pin(async move {
            use verdin_content::events::EventKind;
            let result = match event.kind {
                EventKind::Deleted => deleted(&self.db, &event.uid, &event.document_id).await,
                _ => changed(&self.db, &event.uid, &event.document_id, event.actor).await,
            };
            if let Err(error) = result {
                tracing::warn!(?error, uid = %event.uid, "could not update seen marks");
            }
        })
    }
}

/// A document changed: it becomes unseen for everyone but its editor.
pub(crate) async fn changed(
    db: &Database,
    uid: &str,
    document_id: &str,
    actor: Option<i64>,
) -> Result<(), ApiError> {
    let mut params = vec![V::Text(uid.into()), V::Text(document_id.into())];
    let mut sql =
        format!("DELETE FROM {DOCUMENT_VIEWS} WHERE content_type = ? AND document_id = ?");
    if let Some(actor) = actor {
        sql.push_str(" AND user_id <> ?");
        params.push(V::BigInt(actor));
    }
    db.queries().execute(&sql, &params).await.map_err(internal)?;
    Ok(())
}

/// A document was deleted: forget its views and votes.
pub(crate) async fn deleted(db: &Database, uid: &str, document_id: &str) -> Result<(), ApiError> {
    for table in [DOCUMENT_VIEWS, DOCUMENT_VOTES] {
        db.queries()
            .execute(
                &format!("DELETE FROM {table} WHERE content_type = ? AND document_id = ?"),
                &[V::Text(uid.into()), V::Text(document_id.into())],
            )
            .await
            .map_err(internal)?;
    }
    Ok(())
}

fn internal(error: verdin_db::DbError) -> ApiError {
    ApiError::Internal(error.to_string())
}

/// The caller may read `document_id` (it exists, and "own" grants cover it).
async fn readable(
    state: &AdminState,
    headers: &HeaderMap,
    uid: &str,
    document_id: &str,
) -> Result<AdminPrincipal, ApiError> {
    let (principal, grant) = content_grant(state, headers, uid, actions::CONTENT_READ).await?;
    state.service.created_by(uid, document_id).await?;
    ensure_owner(state, uid, document_id, &principal, grant).await?;
    Ok(principal)
}

// ------------------------------------------------------------------ views

/// `PUT /engagement/{uid}/{documentId}/view`: the caller has seen the current version.
async fn view(
    State(state): State<AdminState>,
    Path((uid, document_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> ApiResult {
    let principal = readable(&state, &headers, &uid, &document_id).await?;
    let mut tx = db(&state).begin().await.map_err(internal)?;
    let key = [V::BigInt(principal.user.id), V::Text(uid.clone()), V::Text(document_id.clone())];
    tx.execute(
        &format!(
            "DELETE FROM {DOCUMENT_VIEWS} WHERE user_id = ? AND content_type = ? AND document_id = ?"
        ),
        &key,
    )
    .await
    .map_err(internal)?;
    let mut params = key.to_vec();
    params.push(V::DateTime(now()));
    tx.execute(
        &format!(
            "INSERT INTO {DOCUMENT_VIEWS} (user_id, content_type, document_id, viewed_at) \
             VALUES (?, ?, ?, ?)"
        ),
        &params,
    )
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

// ------------------------------------------------------------------ votes

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdsQuery {
    #[serde(default)]
    document_ids: String,
}

#[derive(Deserialize)]
struct LimitQuery {
    limit: Option<u32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct VoteBody {
    /// 1 (up), -1 (down) or 0 (withdraw).
    value: i8,
}

#[derive(Default, Clone, Copy)]
struct Tally {
    up: i64,
    down: i64,
    mine: i64,
}

impl Tally {
    fn json(self) -> Value {
        json!({ "score": self.up - self.down, "up": self.up, "down": self.down, "mine": self.mine })
    }
}

async fn tallies(
    state: &AdminState,
    uid: &str,
    document_ids: &[String],
    user_id: i64,
) -> Result<std::collections::HashMap<String, Tally>, ApiError> {
    let mut tallies: std::collections::HashMap<String, Tally> =
        document_ids.iter().map(|id| (id.clone(), Tally::default())).collect();
    if document_ids.is_empty() {
        return Ok(tallies);
    }
    let marks = vec!["?"; document_ids.len()].join(", ");
    let mut params = vec![V::Text(uid.into())];
    params.extend(document_ids.iter().map(|id| V::Text(id.clone())));
    let rows = db(state)
        .queries()
        .fetch_all(
            &format!(
                "SELECT document_id, user_id, value FROM {DOCUMENT_VOTES} \
                 WHERE content_type = ? AND document_id IN ({marks})"
            ),
            &params,
            &[K::Text, K::BigInt, K::SmallInt],
        )
        .await
        .map_err(internal)?;
    for row in rows {
        let document = row[0].as_text().unwrap_or_default().to_owned();
        let voter = row[1].as_i64().unwrap_or_default();
        let value = row[2].as_i64().unwrap_or_default();
        let tally = tallies.entry(document).or_default();
        if value > 0 {
            tally.up += 1;
        } else {
            tally.down += 1;
        }
        if voter == user_id {
            tally.mine = value.signum();
        }
    }
    Ok(tallies)
}

/// `GET /engagement/{uid}/votes?documentIds=a,b`: score, ups, downs and the caller's vote.
async fn vote_summaries(
    State(state): State<AdminState>,
    Path(uid): Path<String>,
    Query(query): Query<IdsQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let (principal, _) = content_grant(&state, &headers, &uid, actions::CONTENT_READ).await?;
    let ids: Vec<String> = query
        .document_ids
        .split(',')
        .filter(|id| !id.is_empty())
        .take(MAX_VOTE_IDS)
        .map(str::to_owned)
        .collect();
    let tallies = tallies(&state, &uid, &ids, principal.user.id).await?;
    let map: serde_json::Map<String, Value> =
        tallies.into_iter().map(|(id, tally)| (id, tally.json())).collect();
    Ok(data(map))
}

/// `GET /engagement/{uid}/votes/top?limit=10`: most voted documents, best score first.
async fn top_voted(
    State(state): State<AdminState>,
    Path(uid): Path<String>,
    Query(query): Query<LimitQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let (principal, _) = content_grant(&state, &headers, &uid, actions::CONTENT_READ).await?;
    let limit = query.limit.unwrap_or(10).clamp(1, 50);
    let rows = db(&state)
        .queries()
        .fetch_all(
            &format!(
                "SELECT document_id FROM {DOCUMENT_VOTES} \
                 WHERE content_type = ? GROUP BY document_id \
                 ORDER BY SUM(value) DESC, document_id ASC LIMIT {limit}"
            ),
            &[V::Text(uid.clone())],
            &[K::Text],
        )
        .await
        .map_err(internal)?;
    let ids: Vec<String> =
        rows.iter().map(|row| row[0].as_text().unwrap_or_default().to_owned()).collect();
    let tallies = tallies(&state, &uid, &ids, principal.user.id).await?;
    let list: Vec<Value> = ids
        .iter()
        .map(|id| {
            let mut value = tallies.get(id).copied().unwrap_or_default().json();
            value["documentId"] = json!(id);
            value
        })
        .collect();
    Ok(data(list))
}

/// `PUT /engagement/{uid}/{documentId}/vote` with `{ "value": 1 | -1 | 0 }`.
async fn vote(
    State(state): State<AdminState>,
    Path((uid, document_id)): Path<(String, String)>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = readable(&state, &headers, &uid, &document_id).await?;
    let input: VoteBody = body(&bytes)?;
    if !(-1..=1).contains(&input.value) {
        return Err(ApiError::BadRequest("value must be 1, -1 or 0".into()));
    }
    let mut tx = db(&state).begin().await.map_err(internal)?;
    let key = [V::BigInt(principal.user.id), V::Text(uid.clone()), V::Text(document_id.clone())];
    tx.execute(
        &format!(
            "DELETE FROM {DOCUMENT_VOTES} WHERE user_id = ? AND content_type = ? AND document_id = ?"
        ),
        &key,
    )
    .await
    .map_err(internal)?;
    if input.value != 0 {
        let mut params = key.to_vec();
        params.push(V::SmallInt(i16::from(input.value)));
        params.push(V::DateTime(now()));
        tx.execute(
            &format!(
                "INSERT INTO {DOCUMENT_VOTES} (user_id, content_type, document_id, value, created_at) \
                 VALUES (?, ?, ?, ?, ?)"
            ),
            &params,
        )
        .await
        .map_err(internal)?;
    }
    tx.commit().await.map_err(internal)?;
    let tallies =
        tallies(&state, &uid, std::slice::from_ref(&document_id), principal.user.id).await?;
    Ok(data(tallies.get(&document_id).copied().unwrap_or_default().json()))
}

// ------------------------------------------------------------------ polls

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct NewPoll {
    question: String,
    options: Vec<String>,
    #[serde(default)]
    multiple: bool,
    closes_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PollUpdate {
    closed: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PollVote {
    /// Indexes into `options`; empty withdraws the vote.
    choices: Vec<usize>,
}

#[derive(Deserialize)]
struct PollsQuery {
    ids: Option<String>,
}

struct PollRow {
    id: i64,
    question: String,
    options: Vec<String>,
    multiple: bool,
    closed: bool,
    closes_at: Option<OffsetDateTime>,
    created_by: Option<i64>,
    created_at: Option<OffsetDateTime>,
}

impl PollRow {
    fn open(&self) -> bool {
        !self.closed && self.closes_at.is_none_or(|at| at > OffsetDateTime::now_utc())
    }
}

async fn load_polls(state: &AdminState, ids: Option<&[i64]>) -> Result<Vec<PollRow>, ApiError> {
    let (filter, params) = match ids {
        Some([]) => return Ok(Vec::new()),
        Some(ids) => (
            format!(" WHERE id IN ({})", vec!["?"; ids.len()].join(", ")),
            ids.iter().map(|id| V::BigInt(*id)).collect(),
        ),
        None => (String::new(), Vec::new()),
    };
    let rows = db(state)
        .queries()
        .fetch_all(
            &format!(
                "SELECT id, question, options, multiple, closed, closes_at, created_by, created_at \
                 FROM {POLLS}{filter} ORDER BY id DESC LIMIT 100"
            ),
            &params,
            &[K::BigInt, K::Text, K::Json, K::Bool, K::Bool, K::DateTime, K::BigInt, K::DateTime],
        )
        .await
        .map_err(internal)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let mut row = row.into_iter();
            let mut next = || row.next().unwrap_or(V::Null(K::Text));
            PollRow {
                id: next().as_i64().unwrap_or_default(),
                question: next().into_text().unwrap_or_default(),
                options: match next() {
                    V::Json(Value::Array(items)) => items
                        .into_iter()
                        .filter_map(|item| item.as_str().map(str::to_owned))
                        .collect(),
                    _ => Vec::new(),
                },
                multiple: matches!(next(), V::Bool(true)),
                closed: matches!(next(), V::Bool(true)),
                closes_at: match next() {
                    V::DateTime(at) => Some(at),
                    _ => None,
                },
                created_by: next().as_i64(),
                created_at: match next() {
                    V::DateTime(at) => Some(at),
                    _ => None,
                },
            }
        })
        .collect())
}

/// Polls with results, the caller's choices and whether they may close or delete them.
async fn polls_json(
    state: &AdminState,
    polls: Vec<PollRow>,
    principal: &AdminPrincipal,
) -> Result<Vec<Value>, ApiError> {
    if polls.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<V> = polls.iter().map(|poll| V::BigInt(poll.id)).collect();
    let marks = vec!["?"; ids.len()].join(", ");
    let votes = db(state)
        .queries()
        .fetch_all(
            &format!(
                "SELECT poll_id, user_id, choice FROM {POLL_VOTES} WHERE poll_id IN ({marks})"
            ),
            &ids,
            &[K::BigInt, K::BigInt, K::SmallInt],
        )
        .await
        .map_err(internal)?;
    Ok(polls
        .into_iter()
        .map(|poll| {
            let mut results = vec![0_i64; poll.options.len()];
            let mut mine = Vec::new();
            let mut voters = std::collections::HashSet::new();
            for vote in votes.iter().filter(|vote| vote[0].as_i64() == Some(poll.id)) {
                let user = vote[1].as_i64().unwrap_or_default();
                let choice = vote[2].as_i64().unwrap_or(-1);
                if let Some(count) = usize::try_from(choice).ok().and_then(|c| results.get_mut(c)) {
                    *count += 1;
                    voters.insert(user);
                    if user == principal.user.id {
                        mine.push(choice);
                    }
                }
            }
            mine.sort_unstable();
            json!({
                "id": poll.id,
                "question": poll.question,
                "options": poll.options,
                "multiple": poll.multiple,
                "closed": poll.closed,
                "open": poll.open(),
                "closesAt": poll.closes_at.map(format_datetime),
                "createdAt": poll.created_at.map(format_datetime),
                "createdBy": poll.created_by,
                "results": results,
                "voters": voters.len(),
                "mine": mine,
                "canManage": principal.permissions.super_admin
                    || poll.created_by == Some(principal.user.id),
            })
        })
        .collect())
}

fn poll_id(id: &str) -> Result<i64, ApiError> {
    id.parse().map_err(|_| ApiError::NotFound)
}

async fn one_poll(state: &AdminState, id: i64) -> Result<PollRow, ApiError> {
    load_polls(state, Some(&[id])).await?.into_iter().next().ok_or(ApiError::NotFound)
}

/// `GET /polls[?ids=1,2]`.
async fn list_polls(
    State(state): State<AdminState>,
    Query(query): Query<PollsQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let ids: Option<Vec<i64>> = query
        .ids
        .map(|ids| ids.split(',').filter_map(|id| id.parse().ok()).take(MAX_VOTE_IDS).collect());
    let polls = load_polls(&state, ids.as_deref()).await?;
    Ok(data(polls_json(&state, polls, &principal).await?))
}

async fn get_poll(
    State(state): State<AdminState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let poll = one_poll(&state, poll_id(&id)?).await?;
    let mut list = polls_json(&state, vec![poll], &principal).await?;
    Ok(data(list.remove(0)))
}

/// `POST /polls`: any admin may start a poll.
async fn create_poll(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let input: NewPoll = body(&bytes)?;
    let question = input.question.trim().to_owned();
    let options: Vec<String> = input
        .options
        .iter()
        .map(|option| option.trim().to_owned())
        .filter(|option| !option.is_empty())
        .collect();
    if question.is_empty() || question.chars().count() > MAX_QUESTION_LENGTH {
        return Err(ApiError::BadRequest(format!(
            "question must have 1 to {MAX_QUESTION_LENGTH} characters"
        )));
    }
    if !(2..=MAX_POLL_OPTIONS).contains(&options.len())
        || options.iter().any(|option| option.chars().count() > MAX_OPTION_LENGTH)
    {
        return Err(ApiError::BadRequest(format!(
            "a poll needs 2 to {MAX_POLL_OPTIONS} options of up to {MAX_OPTION_LENGTH} characters"
        )));
    }
    let closes_at = match input.closes_at.as_deref().filter(|at| !at.is_empty()) {
        Some(at) => Some(
            parse_datetime(at)
                .ok_or_else(|| ApiError::BadRequest("closesAt must be an ISO 8601 date".into()))?,
        ),
        None => None,
    };
    let at = now();
    let id = db(&state)
        .queries()
        .insert_returning_id(
            &format!(
                "INSERT INTO {POLLS} (question, options, multiple, closed, closes_at, created_by, \
                 created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            ),
            &[
                V::Text(question),
                V::Json(json!(options)),
                V::Bool(input.multiple),
                V::Bool(false),
                closes_at.map_or(V::Null(K::DateTime), V::DateTime),
                V::BigInt(principal.user.id),
                V::DateTime(at),
                V::DateTime(at),
            ],
        )
        .await
        .map_err(internal)?;
    let poll = one_poll(&state, id).await?;
    let mut list = polls_json(&state, vec![poll], &principal).await?;
    Ok((StatusCode::CREATED, Json(json!({ "data": list.remove(0) }))).into_response())
}

fn ensure_manager(poll: &PollRow, principal: &AdminPrincipal) -> Result<(), ApiError> {
    if principal.permissions.super_admin || poll.created_by == Some(principal.user.id) {
        Ok(())
    } else {
        Err(ApiError::Forbidden)
    }
}

/// `PUT /polls/{id}` with `{ "closed": true }`: the author or a Super Admin.
async fn update_poll(
    State(state): State<AdminState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let id = poll_id(&id)?;
    ensure_manager(&one_poll(&state, id).await?, &principal)?;
    let input: PollUpdate = body(&bytes)?;
    db(&state)
        .queries()
        .execute(
            &format!("UPDATE {POLLS} SET closed = ?, updated_at = ? WHERE id = ?"),
            &[V::Bool(input.closed), V::DateTime(now()), V::BigInt(id)],
        )
        .await
        .map_err(internal)?;
    let mut list = polls_json(&state, vec![one_poll(&state, id).await?], &principal).await?;
    Ok(data(list.remove(0)))
}

async fn delete_poll(
    State(state): State<AdminState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let id = poll_id(&id)?;
    ensure_manager(&one_poll(&state, id).await?, &principal)?;
    let mut tx = db(&state).begin().await.map_err(internal)?;
    tx.execute(&format!("DELETE FROM {POLL_VOTES} WHERE poll_id = ?"), &[V::BigInt(id)])
        .await
        .map_err(internal)?;
    tx.execute(&format!("DELETE FROM {POLLS} WHERE id = ?"), &[V::BigInt(id)])
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// `PUT /polls/{id}/vote` with `{ "choices": [0] }`: replaces the caller's vote.
async fn vote_poll(
    State(state): State<AdminState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let principal = principal(&state, &headers).await?;
    let poll = one_poll(&state, poll_id(&id)?).await?;
    if !poll.open() {
        return Err(ApiError::BadRequest("this poll is closed".into()));
    }
    let input: PollVote = body(&bytes)?;
    let mut choices = input.choices;
    choices.sort_unstable();
    choices.dedup();
    if choices.iter().any(|choice| *choice >= poll.options.len())
        || (!poll.multiple && choices.len() > 1)
    {
        return Err(ApiError::BadRequest("invalid choice".into()));
    }
    let mut tx = db(&state).begin().await.map_err(internal)?;
    tx.execute(
        &format!("DELETE FROM {POLL_VOTES} WHERE poll_id = ? AND user_id = ?"),
        &[V::BigInt(poll.id), V::BigInt(principal.user.id)],
    )
    .await
    .map_err(internal)?;
    let at = now();
    for choice in &choices {
        tx.execute(
            &format!(
                "INSERT INTO {POLL_VOTES} (poll_id, user_id, choice, created_at) VALUES (?, ?, ?, ?)"
            ),
            &[
                V::BigInt(poll.id),
                V::BigInt(principal.user.id),
                V::SmallInt(i16::try_from(*choice).unwrap_or_default()),
                V::DateTime(at),
            ],
        )
        .await
        .map_err(internal)?;
    }
    tx.commit().await.map_err(internal)?;
    let mut list = polls_json(&state, vec![poll], &principal).await?;
    Ok(data(list.remove(0)))
}
