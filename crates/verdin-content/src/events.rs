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
    /// The locale of the version written, for localized types.
    pub locale: Option<String>,
    /// The admin who made the change (`None` for the content API).
    pub actor: Option<i64>,
}

/// Receives events after the write committed, with the service that made it (to read the
/// document). Failures are the listener's to log: the write itself already succeeded.
pub trait DocumentListener: Send + Sync {
    fn notify<'a>(
        &'a self,
        event: &'a DocumentEvent,
        service: &'a crate::DocumentService,
    ) -> BoxFuture<'a, ()>;
}

/// Media library changes, announced after they are stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileEventKind {
    Created,
    Updated,
    Deleted,
}

impl FileEventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "media.create",
            Self::Updated => "media.update",
            Self::Deleted => "media.delete",
        }
    }
}

pub trait FileListener: Send + Sync {
    fn file_changed<'a>(
        &'a self,
        kind: FileEventKind,
        file: &'a crate::media::FileRecord,
    ) -> BoxFuture<'a, ()>;
}

/// Writes a [`DocumentHook`] runs before.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookAction {
    Create,
    Update,
    Delete,
    Publish,
    Unpublish,
}

impl HookAction {
    /// `beforeCreate`, `beforeUpdate`… (Strapi's lifecycle names).
    pub fn before(self) -> &'static str {
        match self {
            Self::Create => "beforeCreate",
            Self::Update => "beforeUpdate",
            Self::Delete => "beforeDelete",
            Self::Publish => "beforePublish",
            Self::Unpublish => "beforeUnpublish",
        }
    }
}

#[derive(Debug, Clone)]
pub struct HookContext<'a> {
    pub action: HookAction,
    pub uid: &'a str,
    pub document_id: Option<&'a str>,
    pub locale: Option<String>,
    /// The data being written (create, update).
    pub data: Option<&'a serde_json::Value>,
}

/// Runs before a write: may replace the data (`Ok(Some(data))`) or refuse the write
/// (`Err(message)`, a 400 for the caller).
pub trait DocumentHook: Send + Sync {
    fn before<'a>(
        &'a self,
        context: HookContext<'a>,
    ) -> BoxFuture<'a, Result<Option<serde_json::Value>, String>>;
}
