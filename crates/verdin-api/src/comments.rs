//! Comments and tasks on entries (the `comments` feature). Comments form threads — a root
//! and its replies — on an entry or one of its fields; resolving the root closes the
//! thread. Mentions are written `@[Name](user:12)`. Tasks are assigned to an admin, with an
//! optional due date.

use serde::Serialize;
use time::{Date, OffsetDateTime};
use verdin_db::value::{format_datetime, truncate_millis};
use verdin_db::{ColumnKind as K, Database, DbError, SqlValue as V};
use verdin_migrate::system::{COMMENTS, TASKS};

/// Longest comment, in characters.
pub const MAX_BODY: usize = 10_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: i64,
    pub uid: String,
    pub document_id: String,
    /// Empty for types that are not localized.
    pub locale: String,
    /// Attribute path the thread is about (`seo.metaTitle`), if any.
    pub field: Option<String>,
    pub parent_id: Option<i64>,
    pub body: String,
    pub author_id: Option<i64>,
    /// Admins mentioned in the body.
    pub mentions: Vec<i64>,
    pub resolved_at: Option<String>,
    pub resolved_by: Option<i64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// A root comment and its replies, oldest first.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    #[serde(flatten)]
    pub root: Comment,
    pub replies: Vec<Comment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub uid: String,
    pub document_id: String,
    pub locale: String,
    pub title: String,
    pub description: Option<String>,
    pub assignee_id: Option<i64>,
    /// `YYYY-MM-DD`.
    pub due_date: Option<String>,
    /// `open` or `done`.
    pub status: String,
    pub created_by: Option<i64>,
    pub completed_at: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Which entry.
#[derive(Debug, Clone)]
pub struct Entry {
    pub uid: String,
    pub document_id: String,
    pub locale: String,
}

#[derive(Debug, Clone, Default)]
pub struct TaskChanges {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub assignee_id: Option<Option<i64>>,
    pub due_date: Option<Option<Date>>,
    /// `open` or `done`.
    pub status: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct TaskFilter {
    pub entry: Option<Entry>,
    pub assignee_id: Option<i64>,
    pub status: Option<String>,
}

#[derive(Clone)]
pub struct Comments {
    db: Database,
}

fn now() -> OffsetDateTime {
    truncate_millis(OffsetDateTime::now_utc())
}

fn at(value: &V) -> Option<String> {
    match value {
        V::DateTime(at) => Some(format_datetime(*at)),
        _ => None,
    }
}

fn text(value: V) -> Option<String> {
    value.into_text()
}

/// The admins a body mentions (`@[Name](user:12)`), in order, once each.
pub fn mentions(body: &str) -> Vec<i64> {
    let mut found = Vec::new();
    let mut rest = body;
    while let Some(start) = rest.find("](user:") {
        rest = &rest[start + 7..];
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        if rest[digits.len()..].starts_with(')')
            && let Ok(id) = digits.parse::<i64>()
            && !found.contains(&id)
        {
            found.push(id);
        }
    }
    found
}

const COMMENT_COLUMNS: &str = "id, content_type, document_id, locale, field, parent_id, body, author_id, resolved_at, resolved_by_id, created_at, updated_at";
const COMMENT_KINDS: [K; 12] = [
    K::BigInt,
    K::Text,
    K::Text,
    K::Text,
    K::Text,
    K::BigInt,
    K::Text,
    K::BigInt,
    K::DateTime,
    K::BigInt,
    K::DateTime,
    K::DateTime,
];

fn comment(row: Vec<V>) -> Comment {
    let mut row = row.into_iter();
    let mut next = || row.next().unwrap_or(V::Null(K::Text));
    let id = next().as_i64().unwrap_or_default();
    let uid = text(next()).unwrap_or_default();
    let document_id = text(next()).unwrap_or_default();
    let locale = text(next()).unwrap_or_default();
    let field = text(next());
    let parent_id = next().as_i64();
    let body = text(next()).unwrap_or_default();
    let author_id = next().as_i64();
    let resolved_at = at(&next());
    let resolved_by = next().as_i64();
    let (created_at, updated_at) = (at(&next()), at(&next()));
    Comment {
        mentions: mentions(&body),
        id,
        uid,
        document_id,
        locale,
        field,
        parent_id,
        body,
        author_id,
        resolved_at,
        resolved_by,
        created_at,
        updated_at,
    }
}

const TASK_COLUMNS: &str = "id, content_type, document_id, locale, title, description, assignee_id, due_date, status, created_by_id, completed_at, created_at, updated_at";
const TASK_KINDS: [K; 13] = [
    K::BigInt,
    K::Text,
    K::Text,
    K::Text,
    K::Text,
    K::Text,
    K::BigInt,
    K::Date,
    K::Text,
    K::BigInt,
    K::DateTime,
    K::DateTime,
    K::DateTime,
];

fn task(row: Vec<V>) -> Task {
    let mut row = row.into_iter();
    let mut next = || row.next().unwrap_or(V::Null(K::Text));
    Task {
        id: next().as_i64().unwrap_or_default(),
        uid: text(next()).unwrap_or_default(),
        document_id: text(next()).unwrap_or_default(),
        locale: text(next()).unwrap_or_default(),
        title: text(next()).unwrap_or_default(),
        description: text(next()),
        assignee_id: next().as_i64(),
        due_date: match next() {
            V::Date(date) => Some(date.to_string()),
            _ => None,
        },
        status: text(next()).unwrap_or_default(),
        created_by: next().as_i64(),
        completed_at: at(&next()),
        created_at: at(&next()),
        updated_at: at(&next()),
    }
}

impl Comments {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    /// The threads of an entry, oldest first.
    pub async fn threads(&self, entry: &Entry) -> Result<Vec<Thread>, DbError> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT {COMMENT_COLUMNS} FROM {COMMENTS} WHERE content_type = ? AND document_id = ? AND locale = ? ORDER BY id"
                ),
                &[
                    V::Text(entry.uid.clone()),
                    V::Text(entry.document_id.clone()),
                    V::Text(entry.locale.clone()),
                ],
                &COMMENT_KINDS,
            )
            .await?;
        let comments: Vec<Comment> = rows.into_iter().map(comment).collect();
        let mut threads: Vec<Thread> = Vec::new();
        for comment in comments {
            match comment.parent_id {
                None => threads.push(Thread { root: comment, replies: Vec::new() }),
                Some(parent) => {
                    if let Some(thread) = threads.iter_mut().find(|thread| thread.root.id == parent)
                    {
                        thread.replies.push(comment);
                    }
                }
            }
        }
        Ok(threads)
    }

    pub async fn comment(&self, id: i64) -> Result<Option<Comment>, DbError> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT {COMMENT_COLUMNS} FROM {COMMENTS} WHERE id = ?"),
                &[V::BigInt(id)],
                &COMMENT_KINDS,
            )
            .await?;
        Ok(rows.into_iter().next().map(comment))
    }

    /// Adds a comment (a reply when `parent_id` names a root of the same entry).
    pub async fn add_comment(
        &self,
        entry: &Entry,
        field: Option<&str>,
        parent_id: Option<i64>,
        body: &str,
        author_id: i64,
    ) -> Result<Comment, DbError> {
        let now = now();
        let id = self
            .db
            .queries()
            .insert_returning_id(
                &format!(
                    "INSERT INTO {COMMENTS} (content_type, document_id, locale, field, parent_id, body, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                ),
                &[
                    V::Text(entry.uid.clone()),
                    V::Text(entry.document_id.clone()),
                    V::Text(entry.locale.clone()),
                    field.map_or(V::Null(K::Text), |field| V::Text(field.into())),
                    parent_id.map_or(V::Null(K::BigInt), V::BigInt),
                    V::Text(body.into()),
                    V::BigInt(author_id),
                    V::DateTime(now),
                    V::DateTime(now),
                ],
            )
            .await?;
        Ok(self.comment(id).await?.expect("just inserted"))
    }

    pub async fn edit_comment(&self, id: i64, body: &str) -> Result<Option<Comment>, DbError> {
        self.db
            .queries()
            .execute(
                &format!("UPDATE {COMMENTS} SET body = ?, updated_at = ? WHERE id = ?"),
                &[V::Text(body.into()), V::DateTime(now()), V::BigInt(id)],
            )
            .await?;
        self.comment(id).await
    }

    /// Resolves (or reopens) a thread.
    pub async fn resolve(&self, id: i64, by: Option<i64>) -> Result<Option<Comment>, DbError> {
        let (at, by) = match by {
            Some(by) => (V::DateTime(now()), V::BigInt(by)),
            None => (V::Null(K::DateTime), V::Null(K::BigInt)),
        };
        self.db
            .queries()
            .execute(
                &format!(
                    "UPDATE {COMMENTS} SET resolved_at = ?, resolved_by_id = ?, updated_at = ? WHERE id = ? AND parent_id IS NULL"
                ),
                &[at, by, V::DateTime(now()), V::BigInt(id)],
            )
            .await?;
        self.comment(id).await
    }

    /// Deletes a comment and, for a root, its replies.
    pub async fn delete_comment(&self, id: i64) -> Result<bool, DbError> {
        let mut tx = self.db.begin().await?;
        tx.execute(&format!("DELETE FROM {COMMENTS} WHERE parent_id = ?"), &[V::BigInt(id)])
            .await?;
        let deleted =
            tx.execute(&format!("DELETE FROM {COMMENTS} WHERE id = ?"), &[V::BigInt(id)]).await?;
        tx.commit().await?;
        Ok(deleted > 0)
    }

    /// Everything about an entry goes with it (a deleted document, in `locale` or all).
    pub async fn forget_entry(
        &self,
        uid: &str,
        document_id: &str,
        locale: Option<&str>,
    ) -> Result<(), DbError> {
        let mut scope = "content_type = ? AND document_id = ?".to_owned();
        let mut params = vec![V::Text(uid.into()), V::Text(document_id.into())];
        if let Some(locale) = locale {
            scope.push_str(" AND locale = ?");
            params.push(V::Text(locale.into()));
        }
        let mut tx = self.db.begin().await?;
        // Replies before their roots (they reference them).
        for statement in [
            format!("DELETE FROM {COMMENTS} WHERE {scope} AND parent_id IS NOT NULL"),
            format!("DELETE FROM {COMMENTS} WHERE {scope}"),
            format!("DELETE FROM {TASKS} WHERE {scope}"),
        ] {
            tx.execute(&statement, &params).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn tasks(&self, filter: &TaskFilter) -> Result<Vec<Task>, DbError> {
        let mut conditions = vec!["1 = 1".to_owned()];
        let mut params = Vec::new();
        if let Some(entry) = &filter.entry {
            conditions.push("content_type = ? AND document_id = ? AND locale = ?".into());
            params.extend([
                V::Text(entry.uid.clone()),
                V::Text(entry.document_id.clone()),
                V::Text(entry.locale.clone()),
            ]);
        }
        if let Some(assignee) = filter.assignee_id {
            conditions.push("assignee_id = ?".into());
            params.push(V::BigInt(assignee));
        }
        if let Some(status) = &filter.status {
            conditions.push("status = ?".into());
            params.push(V::Text(status.clone()));
        }
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT {TASK_COLUMNS} FROM {TASKS} WHERE {} ORDER BY status DESC, due_date IS NULL, due_date, id LIMIT 500",
                    conditions.join(" AND ")
                ),
                &params,
                &TASK_KINDS,
            )
            .await?;
        Ok(rows.into_iter().map(task).collect())
    }

    pub async fn task(&self, id: i64) -> Result<Option<Task>, DbError> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT {TASK_COLUMNS} FROM {TASKS} WHERE id = ?"),
                &[V::BigInt(id)],
                &TASK_KINDS,
            )
            .await?;
        Ok(rows.into_iter().next().map(task))
    }

    pub async fn add_task(
        &self,
        entry: &Entry,
        title: &str,
        description: Option<&str>,
        assignee_id: Option<i64>,
        due_date: Option<Date>,
        created_by: i64,
    ) -> Result<Task, DbError> {
        let now = now();
        let id = self
            .db
            .queries()
            .insert_returning_id(
                &format!(
                    "INSERT INTO {TASKS} (content_type, document_id, locale, title, description, assignee_id, due_date, status, created_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)"
                ),
                &[
                    V::Text(entry.uid.clone()),
                    V::Text(entry.document_id.clone()),
                    V::Text(entry.locale.clone()),
                    V::Text(title.into()),
                    description.map_or(V::Null(K::Text), |text| V::Text(text.into())),
                    assignee_id.map_or(V::Null(K::BigInt), V::BigInt),
                    due_date.map_or(V::Null(K::Date), V::Date),
                    V::BigInt(created_by),
                    V::DateTime(now),
                    V::DateTime(now),
                ],
            )
            .await?;
        Ok(self.task(id).await?.expect("just inserted"))
    }

    pub async fn update_task(
        &self,
        id: i64,
        changes: TaskChanges,
    ) -> Result<Option<Task>, DbError> {
        let mut assignments = vec!["updated_at = ?".to_owned()];
        let mut params = vec![V::DateTime(now())];
        if let Some(title) = changes.title {
            assignments.push("title = ?".into());
            params.push(V::Text(title));
        }
        if let Some(description) = changes.description {
            assignments.push("description = ?".into());
            params.push(description.map_or(V::Null(K::Text), V::Text));
        }
        if let Some(assignee) = changes.assignee_id {
            assignments.push("assignee_id = ?".into());
            params.push(assignee.map_or(V::Null(K::BigInt), V::BigInt));
        }
        if let Some(due) = changes.due_date {
            assignments.push("due_date = ?".into());
            params.push(due.map_or(V::Null(K::Date), V::Date));
        }
        if let Some(status) = changes.status {
            assignments.push("status = ?".into());
            assignments.push("completed_at = ?".into());
            params.push(V::Text(status.clone()));
            params.push(if status == "done" { V::DateTime(now()) } else { V::Null(K::DateTime) });
        }
        params.push(V::BigInt(id));
        self.db
            .queries()
            .execute(
                &format!("UPDATE {TASKS} SET {} WHERE id = ?", assignments.join(", ")),
                &params,
            )
            .await?;
        self.task(id).await
    }

    pub async fn delete_task(&self, id: i64) -> Result<bool, DbError> {
        let deleted = self
            .db
            .queries()
            .execute(&format!("DELETE FROM {TASKS} WHERE id = ?"), &[V::BigInt(id)])
            .await?;
        Ok(deleted > 0)
    }

    /// Open tasks per assignee (for the digest and the dashboard).
    pub async fn open_tasks_of(&self, assignee_id: i64) -> Result<Vec<Task>, DbError> {
        self.tasks(&TaskFilter {
            assignee_id: Some(assignee_id),
            status: Some("open".into()),
            ..Default::default()
        })
        .await
    }

    /// The listener that drops an entry's comments and tasks when it is deleted.
    pub fn listener(&self) -> std::sync::Arc<dyn verdin_content::events::DocumentListener> {
        std::sync::Arc::new(self.clone())
    }
}

impl verdin_content::events::DocumentListener for Comments {
    fn notify<'a>(
        &'a self,
        event: &'a verdin_content::events::DocumentEvent,
        _: &'a verdin_content::DocumentService,
    ) -> verdin_content::events::BoxFuture<'a, ()> {
        Box::pin(async move {
            if event.kind == verdin_content::events::EventKind::Deleted
                && let Err(error) =
                    self.forget_entry(&event.uid, &event.document_id, event.locale.as_deref()).await
            {
                tracing::warn!(%error, "dropping the comments of a deleted entry failed");
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_mentions() {
        assert_eq!(
            mentions(
                "hi @[Ada](user:1) and @[Bob](user:22), @[Ada](user:1) again; not @[x](user:3x)"
            ),
            [1, 22]
        );
        assert!(mentions("no mentions (user:4)").is_empty());
    }
}
