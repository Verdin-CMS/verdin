//! The shared event bus: with several instances of one project, what an instance announces
//! in process reaches the others. Realtime streams get other instances' events, presence
//! converges, anonymous reads caches are emptied, search indexes re-read changed entries
//! and transform caches drop changed files. Webhooks, scheduled work and plugin hooks do
//! not travel: they run once, on the instance that made the change.
//!
//! One instance needs none of it: [`EventBus::local`] publishes nothing and costs nothing.
//! The database backend ([`DatabaseBus`]) appends events to `vd_cluster_events` and each
//! instance reads the rows after the last one it saw. PostgreSQL wakes readers with
//! `LISTEN/NOTIFY` (a notification only names its sender, so payloads never meet the
//! 8000-byte limit); MySQL, MariaDB and SQLite poll. Redis or NATS would be further
//! [`Backend`]s. See https://verdin-cms.github.io/verdin/deploy/scaling/.

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use verdin_content::DocumentService;
use verdin_content::events::{
    BoxFuture, DocumentEvent, DocumentListener, EventKind, FileEventKind, FileListener,
};
use verdin_content::media::FileRecord;
use verdin_db::{ColumnKind, Database, Flavor, SqlValue as V};
use verdin_migrate::system::CLUSTER_EVENTS;

use crate::realtime::Realtime;

/// The PostgreSQL channel instances notify on.
pub const CHANNEL: &str = "verdin_events";
/// Events waiting to be sent or applied; past this, new ones are dropped (and counted).
const QUEUE: usize = 4096;
/// Rows read at once.
const BATCH: usize = 500;
/// How long rows stay for instances that fall behind.
const RETENTION: Duration = Duration::from_secs(600);
const PRUNE_EVERY: Duration = Duration::from_secs(60);
/// How long readers wait for a missing id before moving past it. Ids are handed out when
/// a row is inserted but seen when it commits, not always in order (PostgreSQL, MySQL),
/// and a failed insert leaves its id unused.
const GAP_GRACE: Duration = Duration::from_secs(10);
/// With `LISTEN`, the table is still read this often, in case a notification was missed.
const LISTEN_FALLBACK: Duration = Duration::from_secs(30);

/// What travels between instances.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ClusterEvent {
    /// A content write (`entry.create`…).
    Document {
        kind: String,
        uid: String,
        document_id: String,
        locale: Option<String>,
        actor: Option<i64>,
    },
    /// A media library change (`media.create`…).
    File { kind: String, id: i64, document_id: String, hash: String },
    /// An admin's heartbeat on an entry. `since`: when they started editing (Unix ms), so
    /// that every instance gives the soft lock to the same admin.
    Presence {
        uid: String,
        document_id: String,
        locale: String,
        user_id: i64,
        name: String,
        editing: bool,
        leave: bool,
        since: i64,
    },
    /// An admin-only event about an entry (comments, tasks).
    Announce { event: String, uid: String, document_id: String, locale: String },
}

/// Counters for `/_metrics`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BusStats {
    /// Events this instance sent to the others.
    pub sent: u64,
    /// Events received from the others.
    pub received: u64,
    /// Events lost: the queue was full or the backend failed.
    pub dropped: u64,
}

#[derive(Default)]
struct Counters {
    sent: AtomicU64,
    received: AtomicU64,
    dropped: AtomicU64,
}

struct Shared {
    instance: String,
    sender: mpsc::Sender<ClusterEvent>,
    counters: Counters,
    /// Reads documents for the consumers of other instances' writes (the search index).
    service: Mutex<Option<DocumentService>>,
}

/// The publishing side of the bus, cheap to clone. [`EventBus::local`] (the default) is a
/// single instance's: nothing is published.
#[derive(Clone, Default)]
pub struct EventBus {
    shared: Option<Arc<Shared>>,
}

impl EventBus {
    pub fn local() -> Self {
        Self::default()
    }

    /// A bus shared through `backend`; events flow once the runner is spawned.
    pub fn new(instance: impl Into<String>, backend: Arc<dyn Backend>) -> (Self, BusRunner) {
        let (sender, receiver) = mpsc::channel(QUEUE);
        let shared = Arc::new(Shared {
            instance: instance.into(),
            sender,
            counters: Counters::default(),
            service: Mutex::new(None),
        });
        (Self { shared: Some(shared.clone()) }, BusRunner { shared, receiver, backend })
    }

    /// Whether events reach other instances.
    pub fn is_shared(&self) -> bool {
        self.shared.is_some()
    }

    /// This instance's id on the bus.
    pub fn instance(&self) -> Option<&str> {
        self.shared.as_deref().map(|shared| shared.instance.as_str())
    }

    /// Queues `event` for the other instances; never waits.
    pub fn publish(&self, event: ClusterEvent) {
        let Some(shared) = &self.shared else { return };
        if shared.sender.try_send(event).is_err() {
            shared.counters.dropped.fetch_add(1, Ordering::Relaxed);
            tracing::warn!("event bus: the send queue is full; an event was dropped");
        }
    }

    /// The service consumers read documents with (set on every schema rebuild).
    pub fn set_service(&self, service: DocumentService) {
        if let Some(shared) = &self.shared {
            *shared.service.lock().expect("bus service") = Some(service);
        }
    }

    pub fn stats(&self) -> Option<BusStats> {
        let counters = &self.shared.as_ref()?.counters;
        Some(BusStats {
            sent: counters.sent.load(Ordering::Relaxed),
            received: counters.received.load(Ordering::Relaxed),
            dropped: counters.dropped.load(Ordering::Relaxed),
        })
    }

    /// Publishes this instance's content writes (among the Document Service's listeners).
    pub fn listener(&self) -> Arc<dyn DocumentListener> {
        Arc::new(self.clone())
    }

    /// Publishes this instance's media changes (among the upload service's listeners).
    pub fn file_listener(&self) -> Arc<dyn FileListener> {
        Arc::new(self.clone())
    }
}

impl DocumentListener for EventBus {
    fn notify<'a>(&'a self, event: &'a DocumentEvent, _: &'a DocumentService) -> BoxFuture<'a, ()> {
        self.publish(ClusterEvent::Document {
            kind: event.kind.as_str().into(),
            uid: event.uid.clone(),
            document_id: event.document_id.clone(),
            locale: event.locale.clone(),
            actor: event.actor,
        });
        Box::pin(async {})
    }
}

impl FileListener for EventBus {
    fn file_changed<'a>(&'a self, kind: FileEventKind, file: &'a FileRecord) -> BoxFuture<'a, ()> {
        self.publish(ClusterEvent::File {
            kind: kind.as_str().into(),
            id: file.id,
            document_id: file.document_id.clone(),
            hash: file.hash.clone(),
        });
        Box::pin(async {})
    }
}

/// What applies other instances' events here.
#[derive(Clone, Default)]
pub struct Consumers {
    /// Presence and admin announcements (content and media events reach the realtime
    /// streams through `documents` and `files`, like the other listeners).
    pub realtime: Option<Realtime>,
    /// Told about other instances' content writes: the realtime streams, the reads cache,
    /// the search index (which re-reads the entry).
    pub documents: Vec<Arc<dyn DocumentListener>>,
    /// Told about other instances' media changes: the realtime streams, the reads cache,
    /// the transform cache.
    pub files: Vec<Arc<dyn FileListener>>,
}

impl Consumers {
    async fn apply(&self, event: ClusterEvent, service: Option<DocumentService>) {
        match event {
            ClusterEvent::Document { kind, uid, document_id, locale, actor } => {
                let Some(kind) = EventKind::parse(&kind) else { return };
                let Some(service) = service else {
                    tracing::debug!("event bus: no document service yet; content event skipped");
                    return;
                };
                let event = DocumentEvent { kind, uid, document_id, locale, actor };
                for listener in &self.documents {
                    listener.notify(&event, &service).await;
                }
            }
            ClusterEvent::File { kind, id, document_id, hash } => {
                let Some(kind) = FileEventKind::parse(&kind) else { return };
                let file = FileRecord { id, document_id, hash, ..Default::default() };
                for listener in &self.files {
                    listener.file_changed(kind, &file).await;
                }
            }
            ClusterEvent::Presence {
                uid,
                document_id,
                locale,
                user_id,
                name,
                editing,
                leave,
                since,
            } => {
                if let Some(realtime) = &self.realtime {
                    realtime.remote_heartbeat(
                        (uid, document_id, locale),
                        user_id,
                        &name,
                        editing,
                        leave,
                        since,
                    );
                }
            }
            ClusterEvent::Announce { event, uid, document_id, locale } => {
                if let Some(realtime) = &self.realtime {
                    realtime.remote_announce(&event, &uid, &document_id, &locale);
                }
            }
        }
    }
}

/// Carries events between instances. Implementations skip nothing: [`BusRunner`] leaves
/// out this instance's own events.
pub trait Backend: Send + Sync + 'static {
    /// Sends one event of `instance` to every instance.
    fn publish<'a>(
        &'a self,
        instance: &'a str,
        event: &'a ClusterEvent,
    ) -> BoxFuture<'a, Result<(), String>>;

    /// Hands every instance's events, as `(instance, event)`, to `deliver` until the task
    /// is aborted or `deliver` is closed; reconnects by itself.
    fn subscribe(
        self: Arc<Self>,
        instance: String,
        deliver: mpsc::Sender<(String, ClusterEvent)>,
    ) -> BoxFuture<'static, ()>;
}

/// The receiving side, spawned once serving starts.
pub struct BusRunner {
    shared: Arc<Shared>,
    receiver: mpsc::Receiver<ClusterEvent>,
    backend: Arc<dyn Backend>,
}

/// The bus's background tasks.
pub struct BusTasks(Vec<JoinHandle<()>>);

impl BusTasks {
    pub fn abort(&self) {
        self.0.iter().for_each(JoinHandle::abort);
    }

    /// Aborts the tasks and waits until they are gone (with their connections).
    pub async fn stop(self) {
        self.abort();
        for task in self.0 {
            let _ = task.await;
        }
    }
}

impl BusRunner {
    /// Sends this instance's events and applies the others' with `consumers`.
    pub fn spawn(self, consumers: Consumers) -> BusTasks {
        let BusRunner { shared, mut receiver, backend } = self;
        tracing::info!(instance = %shared.instance, "event bus: sharing events with other instances");
        let sending = {
            let (shared, backend) = (shared.clone(), backend.clone());
            tokio::spawn(async move {
                while let Some(event) = receiver.recv().await {
                    match backend.publish(&shared.instance, &event).await {
                        Ok(()) => shared.counters.sent.fetch_add(1, Ordering::Relaxed),
                        Err(error) => {
                            tracing::warn!(%error, "event bus: sending an event failed");
                            shared.counters.dropped.fetch_add(1, Ordering::Relaxed)
                        }
                    };
                }
            })
        };
        let (deliver, mut incoming) = mpsc::channel(QUEUE);
        let receiving = tokio::spawn(backend.subscribe(shared.instance.clone(), deliver));
        let applying = tokio::spawn(async move {
            while let Some((instance, event)) = incoming.recv().await {
                if instance == shared.instance {
                    continue;
                }
                shared.counters.received.fetch_add(1, Ordering::Relaxed);
                let service = shared.service.lock().expect("bus service").clone();
                consumers.apply(event, service).await;
            }
        });
        BusTasks(vec![sending, receiving, applying])
    }
}

/// Unix milliseconds now.
pub(crate) fn now_ms() -> i64 {
    i64::try_from(time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000)
        .unwrap_or(i64::MAX)
}

/// The bus on the project's database: `vd_cluster_events`, with `LISTEN/NOTIFY` on
/// PostgreSQL and polling elsewhere.
pub struct DatabaseBus {
    db: Database,
    poll_interval: Duration,
}

impl DatabaseBus {
    /// `poll_interval`: how often MySQL, MariaDB and SQLite read new events (PostgreSQL is
    /// woken by `NOTIFY`, and polls at this pace only while it cannot listen).
    pub fn new(db: Database, poll_interval: Duration) -> Self {
        Self { db, poll_interval: poll_interval.max(Duration::from_millis(10)) }
    }

    async fn last_id(&self) -> verdin_db::Result<i64> {
        let rows = self
            .db
            .queries()
            .fetch_all(&format!("SELECT MAX(id) FROM {CLUSTER_EVENTS}"), &[], &[ColumnKind::BigInt])
            .await?;
        Ok(rows.first().and_then(|row| row.first()).and_then(V::as_i64).unwrap_or(0))
    }

    /// New events of every instance, in id order.
    async fn read(&self, reader: &mut Reader) -> verdin_db::Result<Vec<(String, ClusterEvent)>> {
        let mut events = Vec::new();
        loop {
            let cursor = reader.cursor;
            let rows = self
                .db
                .queries()
                .fetch_all(
                    &format!(
                        "SELECT id, instance, payload FROM {CLUSTER_EVENTS} WHERE id > ? \
                         ORDER BY id LIMIT {BATCH}"
                    ),
                    &[V::BigInt(cursor)],
                    &[ColumnKind::BigInt, ColumnKind::Text, ColumnKind::Text],
                )
                .await?;
            let full = rows.len() == BATCH;
            for row in rows {
                let mut row = row.into_iter();
                let (Some(id), Some(instance), Some(payload)) = (
                    row.next().and_then(|value| value.as_i64()),
                    row.next().and_then(V::into_text),
                    row.next().and_then(V::into_text),
                ) else {
                    continue;
                };
                if !reader.accept(id) {
                    continue;
                }
                match serde_json::from_str(&payload) {
                    Ok(event) => events.push((instance, event)),
                    // From a newer version during a rolling deploy, say.
                    Err(error) => tracing::debug!(%error, id, "event bus: unknown event skipped"),
                }
            }
            reader.advance(Instant::now());
            // More rows wait only when a full batch moved the cursor.
            if !full || reader.cursor == cursor {
                return Ok(events);
            }
        }
    }

    async fn prune(&self) -> verdin_db::Result<()> {
        let before = now_ms() - i64::try_from(RETENTION.as_millis()).unwrap_or(i64::MAX);
        self.db
            .queries()
            .execute(
                &format!("DELETE FROM {CLUSTER_EVENTS} WHERE created_at < ?"),
                &[V::BigInt(before)],
            )
            .await
            .map(drop)
    }
}

impl Backend for DatabaseBus {
    fn publish<'a>(
        &'a self,
        instance: &'a str,
        event: &'a ClusterEvent,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            let payload = serde_json::to_string(event).map_err(|error| error.to_string())?;
            let mut queries = self.db.queries();
            queries
                .execute(
                    &format!(
                        "INSERT INTO {CLUSTER_EVENTS} (instance, payload, created_at) VALUES (?, ?, ?)"
                    ),
                    &[V::Text(instance.into()), V::Text(payload), V::BigInt(now_ms())],
                )
                .await
                .map_err(|error| error.to_string())?;
            if queries.flavor() == Flavor::Postgres {
                // Wakes the other instances; they read the row from the table.
                queries
                    .execute(
                        "SELECT pg_notify(?, ?)",
                        &[V::Text(CHANNEL.into()), V::Text(instance.into())],
                    )
                    .await
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    }

    fn subscribe(
        self: Arc<Self>,
        instance: String,
        deliver: mpsc::Sender<(String, ClusterEvent)>,
    ) -> BoxFuture<'static, ()> {
        Box::pin(async move {
            // Events before this start are history.
            let start = loop {
                match self.last_id().await {
                    Ok(id) => break id,
                    Err(error) => {
                        tracing::warn!(%error, "event bus: reading the last event failed");
                        tokio::time::sleep(self.poll_interval.max(Duration::from_secs(1))).await;
                    }
                }
            };
            let mut reader = Reader::new(start);
            let mut listener = match self.db.listen(CHANNEL).await {
                Ok(listener) => listener,
                Err(error) => {
                    tracing::warn!(%error, "event bus: LISTEN failed; polling instead");
                    None
                }
            };
            let mut pruned = Instant::now();
            loop {
                match &mut listener {
                    Some(listen) => {
                        // A pending gap is looked at again soon.
                        let wait =
                            if reader.waiting() { self.poll_interval } else { LISTEN_FALLBACK };
                        match tokio::time::timeout(wait, listen.recv()).await {
                            Ok(Ok(Some(sender))) if sender == instance => continue,
                            Ok(Ok(Some(_))) | Err(_) => {}
                            // Reconnects on the next call; reading now catches up.
                            Ok(Ok(None)) => {
                                tracing::warn!("event bus: the LISTEN connection was lost")
                            }
                            Ok(Err(error)) => {
                                tracing::warn!(%error, "event bus: LISTEN failed");
                                tokio::time::sleep(self.poll_interval).await;
                            }
                        }
                    }
                    None => tokio::time::sleep(self.poll_interval).await,
                }
                match self.read(&mut reader).await {
                    Ok(events) => {
                        for event in events {
                            if deliver.send(event).await.is_err() {
                                return;
                            }
                        }
                    }
                    Err(error) => tracing::warn!(%error, "event bus: reading events failed"),
                }
                if pruned.elapsed() >= PRUNE_EVERY {
                    pruned = Instant::now();
                    if let Err(error) = self.prune().await {
                        tracing::warn!(%error, "event bus: pruning old events failed");
                    }
                }
            }
        })
    }
}

/// Which rows a reader has seen: every id up to `cursor`, and `seen` beyond it (rows read
/// past a gap). The cursor moves over a gap once it is `GAP_GRACE` old.
#[derive(Debug)]
struct Reader {
    cursor: i64,
    seen: BTreeSet<i64>,
    gap_since: Option<Instant>,
}

impl Reader {
    fn new(cursor: i64) -> Self {
        Self { cursor, seen: BTreeSet::new(), gap_since: None }
    }

    /// Whether row `id` is new (and records it).
    fn accept(&mut self, id: i64) -> bool {
        id > self.cursor && self.seen.insert(id)
    }

    /// Whether rows were read past a gap.
    fn waiting(&self) -> bool {
        !self.seen.is_empty()
    }

    fn advance(&mut self, now: Instant) {
        while let Some(&first) = self.seen.first() {
            if first == self.cursor + 1 {
                self.seen.pop_first();
                self.cursor = first;
                self.gap_since = None;
                continue;
            }
            let since = *self.gap_since.get_or_insert(now);
            if now.duration_since(since) < GAP_GRACE {
                return;
            }
            // Given up on: an insert that failed, or one that took far too long.
            self.cursor = first - 1;
            self.gap_since = None;
        }
        self.gap_since = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_round_trip_as_json() {
        let event = ClusterEvent::Presence {
            uid: "api::article.article".into(),
            document_id: "abc".into(),
            locale: String::new(),
            user_id: 7,
            name: "Ada".into(),
            editing: true,
            leave: false,
            since: 1_700_000_000_000,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "presence");
        assert_eq!(json["documentId"], "abc");
        assert_eq!(serde_json::from_value::<ClusterEvent>(json).unwrap(), event);
    }

    #[test]
    fn the_reader_waits_for_gaps_then_moves_on() {
        let start = Instant::now();
        let mut reader = Reader::new(10);
        assert!(!reader.accept(10), "rows up to the cursor are old");
        assert!(reader.accept(11));
        assert!(reader.accept(13));
        assert!(!reader.accept(13), "each row once");
        reader.advance(start);
        assert_eq!(reader.cursor, 11, "12 is missing");
        assert!(reader.waiting());

        // 12 commits late: it is still delivered, and the cursor catches up.
        assert!(reader.accept(12));
        reader.advance(start + Duration::from_secs(1));
        assert_eq!(reader.cursor, 13);
        assert!(!reader.waiting());

        // 14 never comes: the reader moves past it after the grace period.
        assert!(reader.accept(15));
        reader.advance(start + Duration::from_secs(2));
        assert_eq!(reader.cursor, 13);
        reader.advance(start + Duration::from_secs(2) + GAP_GRACE);
        assert_eq!(reader.cursor, 15);
        assert!(!reader.accept(14), "given up on");
    }

    async fn sqlite() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}", dir.path().join("bus.db").display());
        let db = Database::connect(&url, &Default::default()).await.unwrap();
        db.queries()
            .execute(
                &format!(
                    "CREATE TABLE {CLUSTER_EVENTS} (id INTEGER PRIMARY KEY AUTOINCREMENT, \
                     instance TEXT NOT NULL, payload TEXT NOT NULL, created_at BIGINT NOT NULL)"
                ),
                &[],
            )
            .await
            .unwrap();
        (dir, db)
    }

    fn announce(n: usize) -> ClusterEvent {
        ClusterEvent::Announce {
            event: format!("comment.{n}"),
            uid: "api::article.article".into(),
            document_id: "abc".into(),
            locale: String::new(),
        }
    }

    #[tokio::test]
    async fn polling_on_sqlite_reads_new_rows_once() {
        let (_dir, db) = sqlite().await;
        let bus = DatabaseBus::new(db.clone(), Duration::from_millis(10));
        bus.publish("a", &announce(0)).await.unwrap();
        // A reader starts after what is already there.
        let mut reader = Reader::new(bus.last_id().await.unwrap());
        assert!(bus.read(&mut reader).await.unwrap().is_empty());

        bus.publish("a", &announce(1)).await.unwrap();
        bus.publish("b", &announce(2)).await.unwrap();
        let events = bus.read(&mut reader).await.unwrap();
        assert_eq!(events, [("a".to_owned(), announce(1)), ("b".to_owned(), announce(2))]);
        assert!(bus.read(&mut reader).await.unwrap().is_empty(), "read once");

        // More than a batch arrives in order.
        for n in 0..BATCH + 5 {
            bus.publish("a", &announce(n)).await.unwrap();
        }
        let events = bus.read(&mut reader).await.unwrap();
        assert_eq!(events.len(), BATCH + 5);
        assert_eq!(events.last().unwrap().1, announce(BATCH + 4));
    }

    #[tokio::test]
    async fn pruning_drops_old_rows() {
        let (_dir, db) = sqlite().await;
        let bus = DatabaseBus::new(db.clone(), Duration::from_millis(10));
        db.queries()
            .execute(
                &format!(
                    "INSERT INTO {CLUSTER_EVENTS} (instance, payload, created_at) VALUES ('a', '{{}}', 0)"
                ),
                &[],
            )
            .await
            .unwrap();
        bus.publish("a", &announce(1)).await.unwrap();
        bus.prune().await.unwrap();
        let mut reader = Reader::new(0);
        assert_eq!(bus.read(&mut reader).await.unwrap(), [("a".to_owned(), announce(1))]);
    }

    #[tokio::test]
    async fn runners_skip_their_own_events() {
        let (_dir, db) = sqlite().await;
        let backend: Arc<dyn Backend> =
            Arc::new(DatabaseBus::new(db.clone(), Duration::from_millis(10)));
        let (a, runner_a) = EventBus::new("a", backend.clone());
        let (b, runner_b) = EventBus::new("b", backend);
        let (realtime_a, realtime_b) =
            (Realtime::new().with_bus(a.clone()), Realtime::new().with_bus(b.clone()));
        let mut on_a = realtime_a.subscribe();
        let mut on_b = realtime_b.subscribe();
        let tasks_a =
            runner_a.spawn(Consumers { realtime: Some(realtime_a.clone()), ..Default::default() });
        let tasks_b =
            runner_b.spawn(Consumers { realtime: Some(realtime_b.clone()), ..Default::default() });
        // Both readers have started.
        tokio::time::sleep(Duration::from_millis(100)).await;

        realtime_a.announce("comment.create", "api::article.article", "abc", "");
        assert_eq!(on_a.recv().await.unwrap().event, "comment.create", "local at once");
        let remote = tokio::time::timeout(Duration::from_secs(5), on_b.recv()).await.unwrap();
        assert_eq!(remote.unwrap().event, "comment.create");
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(on_a.try_recv().is_err(), "A does not get its own event back");
        assert_eq!(a.stats().unwrap().sent, 1);
        assert_eq!(b.stats().unwrap().received, 1);
        assert_eq!(a.stats().unwrap().received, 0);
        tasks_a.abort();
        tasks_b.abort();
    }

    /// PostgreSQL (`VERDIN_TEST_DATABASE_URL`): a notification wakes the listener, which
    /// tells a lost connection from a notification.
    #[tokio::test]
    async fn postgres_notifications_reach_listeners() {
        let test = verdin_testkit::TestDb::new().await;
        if test.flavor() != Flavor::Postgres {
            test.drop().await;
            return;
        }
        let mut listener = test.db.listen(CHANNEL).await.unwrap().expect("PostgreSQL listens");
        test.db
            .queries()
            .execute("SELECT pg_notify(?, ?)", &[V::Text(CHANNEL.into()), V::Text("a".into())])
            .await
            .unwrap();
        let payload = tokio::time::timeout(Duration::from_secs(5), listener.recv()).await;
        assert_eq!(payload.unwrap().unwrap().as_deref(), Some("a"));
        drop(listener);
        test.drop().await;
    }
}
