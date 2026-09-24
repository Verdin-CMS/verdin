//! Document events: every write through the Document Service is announced to listeners
//! after it commits, whichever API made it (REST, admin, GraphQL). Listeners keep derived
//! state in sync (e.g. "seen" marks) and will feed webhooks.

use std::future::Future;
use std::pin::Pin;

/// A boxed future, for object-safe listeners.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Created,
    Updated,
    Published,
    Unpublished,
    DraftDiscarded,
    Deleted,
}

impl EventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "entry.create",
            Self::Updated => "entry.update",
            Self::Published => "entry.publish",
            Self::Unpublished => "entry.unpublish",
            Self::DraftDiscarded => "entry.discard-draft",
            Self::Deleted => "entry.delete",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentEvent {
    pub kind: EventKind,
    pub uid: String,
    pub document_id: String,
    /// The admin who made the change (`None` for the content API).
    pub actor: Option<i64>,
}

/// Receives events after the write committed. Failures are the listener's to log: the
/// write itself already succeeded.
pub trait DocumentListener: Send + Sync {
    fn notify<'a>(&'a self, event: &'a DocumentEvent) -> BoxFuture<'a, ()>;
}
