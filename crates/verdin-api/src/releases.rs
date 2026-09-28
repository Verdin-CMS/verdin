//! Releases: entries published or unpublished together, now or at a scheduled date. A
//! background task runs due releases; each action records whether it succeeded.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde::Serialize;
use time::OffsetDateTime;
use verdin_content::DocumentService;
use verdin_db::value::{format_datetime, truncate_millis};
use verdin_db::{ColumnKind as K, Database, DbError, SqlValue as V};
use verdin_migrate::system::{RELEASE_ACTIONS, RELEASES};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub id: i64,
    pub name: String,
    pub scheduled_at: Option<String>,
    pub status: String,
    pub released_at: Option<String>,
    pub error: Option<String>,
    pub created_by: Option<i64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub actions: Vec<ReleaseAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAction {
    pub id: i64,
    pub uid: String,
    pub document_id: String,
    /// Empty for types that are not localized.
    pub locale: String,
    /// `publish` or `unpublish`.
    pub action: String,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct Releases {
    inner: Arc<Inner>,
}

struct Inner {
    db: Database,
    /// The current Document Service (replaced when the app is rebuilt).
    service: RwLock<Option<DocumentService>>,
    wake: tokio::sync::Notify,
    /// The `releases` feature switch: scheduled releases wait while it is off.
    enabled: AtomicBool,
    running: tokio::sync::Mutex<()>,
}

fn now() -> OffsetDateTime {
    truncate_millis(OffsetDateTime::now_utc())
}

fn datetime(value: V) -> Option<String> {
    match value {
        V::DateTime(at) => Some(format_datetime(at)),
        _ => None,
    }
}

impl Releases {
    pub fn new(db: Database) -> Self {
        Self {
            inner: Arc::new(Inner {
                db,
                service: RwLock::new(None),
                wake: tokio::sync::Notify::new(),
                enabled: AtomicBool::new(true),
                running: tokio::sync::Mutex::new(()),
            }),
        }
    }

    pub fn set_service(&self, service: DocumentService) {
        *self.inner.service.write().expect("release service") = Some(service);
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.inner.enabled.store(enabled, Ordering::Relaxed);
        self.inner.wake.notify_one();
    }

    fn db(&self) -> &Database {
        &self.inner.db
    }

    pub async fn list(&self, status: Option<&str>) -> Result<Vec<Release>, DbError> {
        let (filter, params) = match status {
            Some(status) => (" WHERE status = ?", vec![V::from(status)]),
            None => ("", Vec::new()),
        };
        let rows = self
            .db()
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, name, scheduled_at, status, released_at, error, created_by, created_at, \
                     updated_at FROM {RELEASES}{filter} ORDER BY id DESC LIMIT 500"
                ),
                &params,
                &[K::BigInt, K::Text, K::DateTime, K::Text, K::DateTime, K::Text, K::BigInt, K::DateTime, K::DateTime],
            )
            .await?;
        let mut releases: Vec<Release> = rows
            .into_iter()
            .map(|row| {
                let mut row = row.into_iter();
                let mut next = || row.next().unwrap_or(V::Null(K::Text));
                Release {
                    id: next().as_i64().unwrap_or_default(),
                    name: next().into_text().unwrap_or_default(),
                    scheduled_at: datetime(next()),
                    status: next().into_text().unwrap_or_default(),
                    released_at: datetime(next()),
                    error: next().into_text(),
                    created_by: next().as_i64(),
                    created_at: datetime(next()),
                    updated_at: datetime(next()),
                    actions: Vec::new(),
                }
            })
            .collect();
        for release in &mut releases {
            release.actions = self.actions(release.id).await?;
        }
        Ok(releases)
    }

    pub async fn get(&self, id: i64) -> Result<Option<Release>, DbError> {
        Ok(self.list(None).await?.into_iter().find(|release| release.id == id))
    }

    async fn actions(&self, release_id: i64) -> Result<Vec<ReleaseAction>, DbError> {
        let rows = self
            .db()
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, content_type, document_id, locale, action, status, error \
                     FROM {RELEASE_ACTIONS} WHERE release_id = ? ORDER BY id"
                ),
                &[V::BigInt(release_id)],
                &[K::BigInt, K::Text, K::Text, K::Text, K::Text, K::Text, K::Text],
            )
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let mut row = row.into_iter();
                let mut next = || row.next().unwrap_or(V::Null(K::Text));
                ReleaseAction {
                    id: next().as_i64().unwrap_or_default(),
                    uid: next().into_text().unwrap_or_default(),
                    document_id: next().into_text().unwrap_or_default(),
                    locale: next().into_text().unwrap_or_default(),
                    action: next().into_text().unwrap_or_default(),
                    status: next().into_text().unwrap_or_default(),
                    error: next().into_text(),
                }
            })
            .collect())
    }

    /// Releases containing an entry (the editor's panel).
    pub async fn for_entry(&self, uid: &str, document_id: &str) -> Result<Vec<Release>, DbError> {
        let rows = self
            .db()
            .queries()
            .fetch_all(
                &format!(
                    "SELECT DISTINCT release_id FROM {RELEASE_ACTIONS} WHERE content_type = ? AND document_id = ?"
                ),
                &[V::from(uid), V::from(document_id)],
                &[K::BigInt],
            )
            .await?;
        let ids: Vec<i64> = rows.into_iter().filter_map(|row| row[0].as_i64()).collect();
        Ok(self.list(None).await?.into_iter().filter(|release| ids.contains(&release.id)).collect())
    }

    pub async fn create(
        &self,
        name: &str,
        scheduled_at: Option<OffsetDateTime>,
        actor: Option<i64>,
    ) -> Result<i64, DbError> {
        let at = now();
        let id = self
            .db()
            .queries()
            .insert_returning_id(
                &format!(
                    "INSERT INTO {RELEASES} (name, scheduled_at, status, released_at, error, created_by, \
                     created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                ),
                &[
                    V::from(name),
                    scheduled_at.map_or(V::Null(K::DateTime), V::DateTime),
                    V::from("pending"),
                    V::Null(K::DateTime),
                    V::Null(K::Text),
                    actor.map_or(V::Null(K::BigInt), V::BigInt),
                    V::DateTime(at),
                    V::DateTime(at),
                ],
            )
            .await?;
        self.inner.wake.notify_one();
        Ok(id)
    }

    /// Renames or reschedules a pending release.
    pub async fn update(
        &self,
        id: i64,
        name: &str,
        scheduled_at: Option<OffsetDateTime>,
    ) -> Result<bool, DbError> {
        let updated = self
            .db()
            .queries()
            .execute(
                &format!(
                    "UPDATE {RELEASES} SET name = ?, scheduled_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
                ),
                &[
                    V::from(name),
                    scheduled_at.map_or(V::Null(K::DateTime), V::DateTime),
                    V::DateTime(now()),
                    V::BigInt(id),
                ],
            )
            .await?;
        self.inner.wake.notify_one();
        Ok(updated > 0)
    }

    pub async fn delete(&self, id: i64) -> Result<bool, DbError> {
        let mut tx = self.db().begin().await?;
        tx.execute(
            &format!("DELETE FROM {RELEASE_ACTIONS} WHERE release_id = ?"),
            &[V::BigInt(id)],
        )
        .await?;
        let deleted =
            tx.execute(&format!("DELETE FROM {RELEASES} WHERE id = ?"), &[V::BigInt(id)]).await?;
        tx.commit().await?;
        Ok(deleted > 0)
    }

    /// Adds (or replaces) the action on an entry of a pending release.
    pub async fn add_action(
        &self,
        release_id: i64,
        uid: &str,
        document_id: &str,
        locale: &str,
        action: &str,
    ) -> Result<(), DbError> {
        let mut tx = self.db().begin().await?;
        tx.execute(
            &format!(
                "DELETE FROM {RELEASE_ACTIONS} WHERE release_id = ? AND content_type = ? AND document_id = ? AND locale = ?"
            ),
            &[V::BigInt(release_id), V::from(uid), V::from(document_id), V::from(locale)],
        )
        .await?;
        tx.execute(
            &format!(
                "INSERT INTO {RELEASE_ACTIONS} (release_id, content_type, document_id, locale, action, status, \
                 error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            ),
            &[
                V::BigInt(release_id),
                V::from(uid),
                V::from(document_id),
                V::from(locale),
                V::from(action),
                V::from("pending"),
                V::Null(K::Text),
                V::DateTime(now()),
            ],
        )
        .await?;
        tx.commit().await
    }

    pub async fn remove_action(&self, release_id: i64, action_id: i64) -> Result<bool, DbError> {
        Ok(self
            .db()
            .queries()
            .execute(
                &format!("DELETE FROM {RELEASE_ACTIONS} WHERE release_id = ? AND id = ?"),
                &[V::BigInt(release_id), V::BigInt(action_id)],
            )
            .await?
            > 0)
    }

    /// Runs a pending release now; returns it with the result of each action.
    pub async fn run(&self, id: i64, actor: Option<i64>) -> Result<Option<Release>, DbError> {
        let _running = self.inner.running.lock().await;
        let claimed = self
            .db()
            .queries()
            .execute(
                &format!("UPDATE {RELEASES} SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'"),
                &[V::DateTime(now()), V::BigInt(id)],
            )
            .await?;
        if claimed == 0 {
            return self.get(id).await;
        }
        let service = self.inner.service.read().expect("release service").clone();
        let mut failures = 0;
        for action in self.actions(id).await? {
            let result = match &service {
                None => Err("content is not available".to_owned()),
                Some(service) => {
                    let service = service
                        .in_locale((!action.locale.is_empty()).then(|| action.locale.clone()));
                    match action.action.as_str() {
                        "publish" => service.publish(&action.uid, &action.document_id, actor).await,
                        _ => service.unpublish(&action.uid, &action.document_id).await,
                    }
                    .map_err(|error| error.to_string())
                }
            };
            failures += usize::from(result.is_err());
            self.db()
                .queries()
                .execute(
                    &format!("UPDATE {RELEASE_ACTIONS} SET status = ?, error = ? WHERE id = ?"),
                    &[
                        V::from(if result.is_ok() { "done" } else { "failed" }),
                        result.err().map_or(V::Null(K::Text), V::Text),
                        V::BigInt(action.id),
                    ],
                )
                .await?;
        }
        let (status, error) = if failures == 0 {
            ("done", V::Null(K::Text))
        } else {
            ("failed", V::Text(format!("{failures} action(s) failed")))
        };
        self.db()
            .queries()
            .execute(
                &format!("UPDATE {RELEASES} SET status = ?, error = ?, released_at = ?, updated_at = ? WHERE id = ?"),
                &[V::from(status), error, V::DateTime(now()), V::DateTime(now()), V::BigInt(id)],
            )
            .await?;
        self.get(id).await
    }

    /// Runs every pending release whose date has come; returns how many ran.
    pub async fn run_due(&self) -> Result<usize, DbError> {
        if !self.inner.enabled.load(Ordering::Relaxed) {
            return Ok(0);
        }
        let rows = self
            .db()
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, created_by FROM {RELEASES} WHERE status = 'pending' AND scheduled_at IS NOT NULL \
                     AND scheduled_at <= ? ORDER BY scheduled_at"
                ),
                &[V::DateTime(now())],
                &[K::BigInt, K::BigInt],
            )
            .await?;
        let count = rows.len();
        // Scheduled publications are credited to whoever created the release.
        for row in rows {
            if let Some(id) = row[0].as_i64() {
                self.run(id, row[1].as_i64()).await?;
            }
        }
        Ok(count)
    }

    /// Checks for due releases every 30 seconds (and when releases change).
    pub fn spawn(&self) -> tokio::task::JoinHandle<()> {
        let releases = self.clone();
        tokio::spawn(async move {
            loop {
                if let Err(error) = releases.run_due().await {
                    tracing::warn!(%error, "scheduled releases failed");
                }
                tokio::select! {
                    () = releases.inner.wake.notified() => {}
                    () = tokio::time::sleep(Duration::from_secs(30)) => {}
                }
            }
        })
    }
}
