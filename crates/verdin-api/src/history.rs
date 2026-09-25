//! Content history: a snapshot of a document after every create, save, publish,
//! unpublish and discarded draft, from any API, kept in `vd_history_versions` (newest
//! `max_versions` per document).

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use verdin_content::DocumentService;
use verdin_content::events::{BoxFuture, DocumentEvent, DocumentListener, EventKind};
use verdin_db::value::truncate_millis;
use verdin_db::{ColumnKind as K, Database, DbError, SqlValue as V};
use verdin_migrate::system::HISTORY_VERSIONS;
use verdin_query::Status;

#[derive(Clone)]
pub struct History {
    inner: Arc<Inner>,
}

struct Inner {
    db: Database,
    max_versions: usize,
    enabled: AtomicBool,
}

impl History {
    pub fn new(db: Database, max_versions: usize) -> Self {
        Self {
            inner: Arc::new(Inner {
                db,
                max_versions: max_versions.max(1),
                enabled: AtomicBool::new(true),
            }),
        }
    }

    /// The `history` feature switch: while off, no version is recorded.
    pub fn set_enabled(&self, enabled: bool) {
        self.inner.enabled.store(enabled, Ordering::Relaxed);
    }

    pub fn enabled(&self) -> bool {
        self.inner.enabled.load(Ordering::Relaxed)
    }

    pub fn listener(&self) -> Arc<dyn DocumentListener> {
        Arc::new(self.clone())
    }

    pub fn database(&self) -> &Database {
        &self.inner.db
    }

    async fn record(
        &self,
        event: &DocumentEvent,
        service: &DocumentService,
    ) -> Result<(), verdin_content::ContentError> {
        let model = service.registry().get(&event.uid)?;
        let status = if event.kind == EventKind::Published || !model.draft_and_publish() {
            Status::Published
        } else {
            Status::Draft
        };
        let Some(data) = service.snapshot(&event.uid, &event.document_id, status).await? else {
            return Ok(());
        };
        let db = &self.inner.db;
        db.queries()
            .execute(
                &format!(
                    "INSERT INTO {HISTORY_VERSIONS} (content_type, document_id, locale, event, status, \
                     data, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                ),
                &[
                    V::Text(event.uid.clone()),
                    V::Text(event.document_id.clone()),
                    V::Text(event.locale.clone().unwrap_or_default()),
                    V::Text(event.kind.as_str().into()),
                    V::Text(status.as_str().into()),
                    V::Json(data),
                    event.actor.map_or(V::Null(K::BigInt), V::BigInt),
                    V::DateTime(truncate_millis(time::OffsetDateTime::now_utc())),
                ],
            )
            .await?;
        self.prune(&event.uid, &event.document_id, event.locale.as_deref().unwrap_or_default())
            .await?;
        Ok(())
    }

    /// Keeps the newest `max_versions` of a document.
    async fn prune(&self, uid: &str, document_id: &str, locale: &str) -> Result<(), DbError> {
        let db = &self.inner.db;
        let rows = db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id FROM {HISTORY_VERSIONS} WHERE content_type = ? AND document_id = ? \
                     AND locale = ? ORDER BY id DESC LIMIT 1000 OFFSET {}",
                    self.inner.max_versions
                ),
                &[V::Text(uid.into()), V::Text(document_id.into()), V::Text(locale.into())],
                &[K::BigInt],
            )
            .await?;
        let ids: Vec<V> = rows.into_iter().filter_map(|row| row.into_iter().next()).collect();
        if ids.is_empty() {
            return Ok(());
        }
        db.queries()
            .execute(
                &format!(
                    "DELETE FROM {HISTORY_VERSIONS} WHERE id IN ({})",
                    vec!["?"; ids.len()].join(", ")
                ),
                &ids,
            )
            .await?;
        Ok(())
    }

    /// Forgets the versions of a deleted document (or of its deleted locale).
    async fn forget(&self, uid: &str, document_id: &str, locale: &str) -> Result<(), DbError> {
        self.inner
            .db
            .queries()
            .execute(
                &format!(
                    "DELETE FROM {HISTORY_VERSIONS} WHERE content_type = ? AND document_id = ? \
                     AND locale = ?"
                ),
                &[V::Text(uid.into()), V::Text(document_id.into()), V::Text(locale.into())],
            )
            .await?;
        Ok(())
    }
}

impl DocumentListener for History {
    fn notify<'a>(
        &'a self,
        event: &'a DocumentEvent,
        service: &'a DocumentService,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            if event.kind == EventKind::Deleted {
                let locale = event.locale.as_deref().unwrap_or_default();
                if let Err(error) = self.forget(&event.uid, &event.document_id, locale).await {
                    tracing::warn!(%error, uid = %event.uid, "could not remove history versions");
                }
                return;
            }
            if !self.enabled() {
                return;
            }
            if let Err(error) = self.record(event, service).await {
                tracing::warn!(%error, uid = %event.uid, "could not record a history version");
            }
        })
    }
}
