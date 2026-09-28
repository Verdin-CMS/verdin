//! Realtime events over Server-Sent Events: content and media changes as they commit, and
//! (for the admin) who is viewing or editing an entry. Each subscriber only receives what
//! it may read. Events are those of this instance (see docs/scaling.md).

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::{self, Stream, StreamExt};
use serde::Serialize;
use serde_json::json;
use tokio::sync::broadcast;
use verdin_content::DocumentService;
use verdin_content::events::{
    BoxFuture, DocumentEvent, DocumentListener, FileEventKind, FileListener,
};

/// How long a presence lasts without a heartbeat.
pub const PRESENCE_TTL: Duration = Duration::from_secs(45);
/// Content API streams end after this long; clients reconnect (and re-authenticate).
pub const STREAM_LIFETIME: Duration = Duration::from_secs(3600);
/// Admin streams follow the access token's life.
pub const ADMIN_STREAM_LIFETIME: Duration = Duration::from_secs(15 * 60);
const CHANNEL: usize = 1024;

/// One event as subscribers receive it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    /// `entry.create`, `entry.publish`…, `media.create`…, or `presence`.
    pub event: String,
    /// Content type uid (`plugin::upload.file` for media).
    pub uid: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    /// Media events: the file id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_id: Option<i64>,
    /// Presence events: who is on the entry now.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presence: Option<Vec<Viewer>>,
    /// Content events of draft & publish types that only concern drafts.
    #[serde(skip)]
    pub drafts_only: bool,
    /// Presence events are for the admin only.
    #[serde(skip)]
    pub admin_only: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Viewer {
    pub user_id: i64,
    pub name: String,
    pub editing: bool,
    /// The first admin still editing holds the (soft) lock.
    pub holds_lock: bool,
}

struct Seen {
    name: String,
    editing: bool,
    since: Instant,
    last: Instant,
}

type EntryKey = (String, String, String);

#[derive(Clone)]
pub struct Realtime {
    sender: broadcast::Sender<Message>,
    presence: Arc<Mutex<HashMap<EntryKey, HashMap<i64, Seen>>>>,
    /// Content types whose writes only touch drafts (draft & publish).
    draft_types: Arc<Mutex<std::collections::HashSet<String>>>,
}

impl Default for Realtime {
    fn default() -> Self {
        Self::new()
    }
}

impl Realtime {
    pub fn new() -> Self {
        Self {
            sender: broadcast::channel(CHANNEL).0,
            presence: Arc::default(),
            draft_types: Arc::default(),
        }
    }

    /// The types with draft & publish (from the current schema).
    pub fn set_draft_types(&self, types: impl IntoIterator<Item = String>) {
        *self.draft_types.lock().expect("draft types") = types.into_iter().collect();
    }

    pub fn listener(&self) -> Arc<dyn DocumentListener> {
        Arc::new(self.clone())
    }

    pub fn file_listener(&self) -> Arc<dyn FileListener> {
        Arc::new(self.clone())
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Message> {
        self.sender.subscribe()
    }

    fn send(&self, message: Message) {
        // No subscribers is fine.
        let _ = self.sender.send(message);
    }

    /// Records a heartbeat and returns who is on the entry. `editing: false` with
    /// `leave: true` removes the admin.
    pub fn heartbeat(
        &self,
        key: EntryKey,
        user_id: i64,
        name: &str,
        editing: bool,
        leave: bool,
    ) -> Vec<Viewer> {
        let now = Instant::now();
        let (viewers, changed) = {
            let mut presence = self.presence.lock().expect("presence");
            let entry = presence.entry(key.clone()).or_default();
            let before: Vec<(i64, bool)> = snapshot(entry, now);
            entry.retain(|_, seen| now.duration_since(seen.last) < PRESENCE_TTL);
            if leave {
                entry.remove(&user_id);
            } else {
                let seen = entry.entry(user_id).or_insert_with(|| Seen {
                    name: name.to_owned(),
                    editing,
                    since: now,
                    last: now,
                });
                if editing && !seen.editing {
                    // Starting to edit: queue behind whoever already edits.
                    seen.since = now;
                }
                seen.editing = editing;
                seen.last = now;
                seen.name = name.to_owned();
            }
            let viewers = viewers(entry);
            let after: Vec<(i64, bool)> = snapshot(entry, now);
            if entry.is_empty() {
                presence.remove(&key);
            }
            (viewers, before != after)
        };
        if changed {
            let (uid, document_id, locale) = key;
            self.send(Message {
                event: "presence".into(),
                uid,
                document_id: Some(document_id),
                locale: (!locale.is_empty()).then_some(locale),
                file_id: None,
                presence: Some(viewers.clone()),
                drafts_only: false,
                admin_only: true,
            });
        }
        viewers
    }

    pub fn viewers(&self, key: &EntryKey) -> Vec<Viewer> {
        let now = Instant::now();
        let mut presence = self.presence.lock().expect("presence");
        let Some(entry) = presence.get_mut(key) else { return Vec::new() };
        entry.retain(|_, seen| now.duration_since(seen.last) < PRESENCE_TTL);
        viewers(entry)
    }

    /// An SSE response of the messages `allow` lets through.
    pub fn stream<A>(
        &self,
        lifetime: Duration,
        allow: A,
    ) -> Sse<impl Stream<Item = Result<Event, Infallible>> + use<A>>
    where
        A: Fn(&Message) -> bool + Send + Sync + 'static,
    {
        let receiver = self.subscribe();
        let deadline = tokio::time::Instant::now() + lifetime;
        let hello = stream::once(async { Ok(Event::default().event("ready").data("{}")) });
        let events = stream::unfold((receiver, allow), move |(mut receiver, allow)| async move {
            loop {
                let next = tokio::time::timeout_at(deadline, receiver.recv()).await;
                match next {
                    Err(_) => return None,
                    Ok(Ok(message)) if allow(&message) => {
                        let data = serde_json::to_string(&message).expect("messages serialize");
                        let event = Event::default().event(message.event.clone()).data(data);
                        return Some((Ok(event), (receiver, allow)));
                    }
                    Ok(Ok(_)) => continue,
                    Ok(Err(broadcast::error::RecvError::Lagged(missed))) => {
                        let data = json!({ "missed": missed }).to_string();
                        return Some((
                            Ok(Event::default().event("lagged").data(data)),
                            (receiver, allow),
                        ));
                    }
                    Ok(Err(broadcast::error::RecvError::Closed)) => return None,
                }
            }
        });
        Sse::new(hello.chain(events)).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
    }
}

fn snapshot(entry: &HashMap<i64, Seen>, now: Instant) -> Vec<(i64, bool)> {
    let mut items: Vec<(i64, bool)> = entry
        .iter()
        .filter(|(_, seen)| now.duration_since(seen.last) < PRESENCE_TTL)
        .map(|(id, seen)| (*id, seen.editing))
        .collect();
    items.sort();
    items
}

fn viewers(entry: &HashMap<i64, Seen>) -> Vec<Viewer> {
    let holder = entry
        .iter()
        .filter(|(_, seen)| seen.editing)
        .min_by_key(|(_, seen)| seen.since)
        .map(|(id, _)| *id);
    let mut viewers: Vec<Viewer> = entry
        .iter()
        .map(|(id, seen)| Viewer {
            user_id: *id,
            name: seen.name.clone(),
            editing: seen.editing,
            holds_lock: Some(*id) == holder,
        })
        .collect();
    viewers.sort_by_key(|viewer| viewer.user_id);
    viewers
}

impl DocumentListener for Realtime {
    fn notify<'a>(&'a self, event: &'a DocumentEvent, _: &'a DocumentService) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            use verdin_content::events::EventKind as K;
            let drafts = self.draft_types.lock().expect("draft types").contains(&event.uid);
            let drafts_only =
                drafts && matches!(event.kind, K::Created | K::Updated | K::DraftDiscarded);
            self.send(Message {
                event: event.kind.as_str().into(),
                uid: event.uid.clone(),
                document_id: Some(event.document_id.clone()),
                locale: event.locale.clone(),
                file_id: None,
                presence: None,
                drafts_only,
                admin_only: false,
            });
        })
    }
}

impl FileListener for Realtime {
    fn file_changed<'a>(
        &'a self,
        kind: FileEventKind,
        file: &'a verdin_content::media::FileRecord,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.send(Message {
                event: kind.as_str().into(),
                uid: verdin_auth::UPLOAD_SUBJECT.into(),
                document_id: Some(file.document_id.clone()),
                locale: None,
                file_id: Some(file.id),
                presence: None,
                drafts_only: false,
                admin_only: false,
            });
        })
    }
}

/// `?types=api::article,api::page`: the content types a subscriber wants (none: all).
pub fn wanted_types(raw: Option<&str>) -> Option<Vec<String>> {
    let types: Vec<String> = raw?
        .split(',')
        .map(str::trim)
        .filter(|uid| !uid.is_empty())
        .filter_map(|uid| {
            verdin_schema::normalize_content_type_uid(uid).or_else(|| Some(uid.to_owned()))
        })
        .collect();
    (!types.is_empty()).then_some(types)
}
