//! Audit logs: who changed what and when. Content and media changes come from the
//! Document Service and the media library (whichever API made them); other admin actions
//! from a middleware on the admin API. Kept `retention` long.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use axum::body::{Body, to_bytes};
use axum::extract::{MatchedPath, Request, State};
use axum::http::{Method, header};
use axum::middleware::Next;
use axum::response::Response;
use serde_json::{Map, Value, json};
use verdin_auth::AuthService;
use verdin_content::DocumentService;
use verdin_content::events::{
    BoxFuture, DocumentEvent, DocumentListener, EventKind, FileEventKind, FileListener,
};
use verdin_db::value::truncate_millis;
use verdin_db::{ColumnKind as K, Database, SqlValue as V};
use verdin_migrate::system::AUDIT_LOGS;

/// One recorded action.
#[derive(Debug, Clone, Default)]
pub struct AuditEntry {
    /// `admin`, `api` (content API callers) or `system`.
    pub actor_kind: &'static str,
    pub actor_id: Option<i64>,
    pub action: String,
    pub subject: Option<String>,
    pub subject_id: Option<String>,
    pub details: Value,
    pub ip: Option<String>,
}

#[derive(Clone)]
pub struct Audit {
    inner: Arc<Inner>,
}

struct Inner {
    db: Database,
    enabled: AtomicBool,
    retention: Duration,
}

impl Audit {
    pub fn new(db: Database, retention: Duration) -> Self {
        Self { inner: Arc::new(Inner { db, enabled: AtomicBool::new(true), retention }) }
    }

    /// The `audit` feature switch.
    pub fn set_enabled(&self, enabled: bool) {
        self.inner.enabled.store(enabled, Ordering::Relaxed);
    }

    pub fn database(&self) -> &Database {
        &self.inner.db
    }

    /// Records an entry; failures are logged (the action itself already happened).
    pub async fn record(&self, entry: AuditEntry) {
        if !self.inner.enabled.load(Ordering::Relaxed) {
            return;
        }
        let text = |value: Option<String>| value.map_or(V::Null(K::Text), V::Text);
        let result = self
            .inner
            .db
            .queries()
            .execute(
                &format!(
                    "INSERT INTO {AUDIT_LOGS} (at, actor_kind, actor_id, action, subject, subject_id, \
                     details, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                ),
                &[
                    V::DateTime(truncate_millis(time::OffsetDateTime::now_utc())),
                    V::from(entry.actor_kind),
                    entry.actor_id.map_or(V::Null(K::BigInt), V::BigInt),
                    V::Text(entry.action.chars().take(128).collect()),
                    text(entry.subject.map(|value| value.chars().take(255).collect())),
                    text(entry.subject_id.map(|value| value.chars().take(64).collect())),
                    V::Json(if entry.details.is_null() { json!({}) } else { entry.details }),
                    text(entry.ip),
                ],
            )
            .await;
        if let Err(error) = result {
            tracing::warn!(%error, "could not record an audit log entry");
        }
    }

    /// Removes entries older than the retention.
    pub async fn prune(&self) -> Result<u64, verdin_db::DbError> {
        let retention =
            time::Duration::try_from(self.inner.retention).unwrap_or(time::Duration::days(90));
        let before = truncate_millis(time::OffsetDateTime::now_utc()) - retention;
        self.inner
            .db
            .queries()
            .execute(&format!("DELETE FROM {AUDIT_LOGS} WHERE at < ?"), &[V::DateTime(before)])
            .await
    }

    /// Prunes once a day.
    pub fn spawn_pruning(&self) -> tokio::task::JoinHandle<()> {
        let audit = self.clone();
        tokio::spawn(async move {
            loop {
                if let Err(error) = audit.prune().await {
                    tracing::warn!(%error, "audit log pruning failed");
                }
                tokio::time::sleep(Duration::from_secs(24 * 3600)).await;
            }
        })
    }

    pub fn listener(&self) -> Arc<dyn DocumentListener> {
        Arc::new(self.clone())
    }
}

impl DocumentListener for Audit {
    fn notify<'a>(&'a self, event: &'a DocumentEvent, _: &'a DocumentService) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let action = match event.kind {
                EventKind::Created => "entry.create",
                EventKind::Updated => "entry.update",
                EventKind::Published => "entry.publish",
                EventKind::Unpublished => "entry.unpublish",
                EventKind::DraftDiscarded => "entry.discard-draft",
                EventKind::Deleted => "entry.delete",
            };
            self.record(AuditEntry {
                actor_kind: if event.actor.is_some() { "admin" } else { "api" },
                actor_id: event.actor,
                action: action.into(),
                subject: Some(event.uid.clone()),
                subject_id: Some(event.document_id.clone()),
                details: event
                    .locale
                    .as_ref()
                    .map_or(json!({}), |locale| json!({ "locale": locale })),
                ip: None,
            })
            .await;
        })
    }
}

impl FileListener for Audit {
    fn file_changed<'a>(
        &'a self,
        kind: FileEventKind,
        file: &'a verdin_content::media::FileRecord,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let actor = match kind {
                FileEventKind::Created => file.created_by,
                _ => file.updated_by,
            };
            self.record(AuditEntry {
                actor_kind: if actor.is_some() { "admin" } else { "api" },
                actor_id: actor,
                action: kind.as_str().into(),
                subject: Some("plugin::upload.file".into()),
                subject_id: Some(file.id.to_string()),
                details: json!({ "name": file.name }),
                ip: None,
            })
            .await;
        })
    }
}

/// Admin API paths not worth a log line (or logged by the listeners).
fn ignored(path: &str) -> bool {
    const PREFIXES: &[&str] = &[
        "/auth/refresh",
        // The first step of a passkey sign-in; the sign-in itself is `/auth/login/two-factor`.
        "/auth/login/passkey/options",
        "/users/me/preferences",
        "/content/",
        "/upload/",
        "/engagement/",
        "/polls/",
        "/schema/plan",
        "/email/test",
    ];
    PREFIXES.iter().any(|prefix| path.starts_with(prefix))
}

#[derive(Clone)]
pub(crate) struct MiddlewareState {
    pub audit: Audit,
    pub auth: AuthService,
}

/// Records successful writes on the admin API (`{METHOD} {route}` with its parameters).
pub(crate) async fn middleware(
    State(state): State<MiddlewareState>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    // The matched route includes where the router is nested (`/admin/api`); the URI does
    // not: keep as many trailing segments as the URI has.
    let route = request.extensions().get::<MatchedPath>().map(|full| {
        let full: Vec<&str> = full.as_str().split('/').filter(|s| !s.is_empty()).collect();
        let depth = path.split('/').filter(|s| !s.is_empty()).count();
        format!("/{}", full[full.len().saturating_sub(depth)..].join("/"))
    });
    let relevant = !matches!(method, Method::GET | Method::HEAD | Method::OPTIONS)
        && route.as_deref().is_some_and(|route| !ignored(route));
    if !relevant {
        return next.run(request).await;
    }
    let ip = Some(crate::client::client_ip(request.extensions())).filter(|ip| ip != "unknown");
    let bearer = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|token| token.trim().to_owned());
    let response = next.run(request).await;
    if !response.status().is_success() {
        return response;
    }
    let route = route.unwrap_or_default();
    // Sign-ins, recorded once the session exists: after the password, or after the second
    // factor when the account has one (the password step then answers without a user).
    let login = matches!(
        route.as_str(),
        "/auth/login" | "/auth/login/two-factor" | "/auth/register-first-admin"
    );
    let (response, actor_id) = if login {
        // The session is created by this request: read the user from the answer.
        let (parts, body) = response.into_parts();
        let bytes = to_bytes(body, 1024 * 1024).await.unwrap_or_default();
        let id = serde_json::from_slice::<Value>(&bytes)
            .ok()
            .and_then(|body| body["data"]["user"]["id"].as_i64());
        (Response::from_parts(parts, Body::from(bytes)), id)
    } else {
        let id = match &bearer {
            Some(token) => {
                state.auth.authenticate(token).await.ok().map(|principal| principal.user.id)
            }
            None => None,
        };
        (response, id)
    };
    if login && actor_id.is_none() {
        return response;
    }
    // `/roles/{id}` with `/roles/3`: the last parameter is the subject.
    let segments: Vec<&str> = route.split('/').collect();
    let values: Vec<&str> = path.split('/').collect();
    debug_assert_eq!(segments.len(), values.len());
    let mut params = Map::new();
    // The last parameter in the path (the map is sorted by name).
    let mut subject_id = None;
    for (segment, value) in segments.iter().zip(values.iter()) {
        if let Some(name) = segment.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
            params.insert(name.trim_start_matches('*').to_owned(), json!(value));
            subject_id = Some((*value).to_owned());
        }
    }
    let action =
        if login { "admin.login".to_owned() } else { format!("{} {}", method.as_str(), route) };
    state
        .audit
        .record(AuditEntry {
            actor_kind: if actor_id.is_some() { "admin" } else { "system" },
            actor_id,
            action,
            subject: segments
                .get(1)
                .map(|resource| (*resource).to_owned())
                .filter(|s| !s.is_empty()),
            subject_id,
            details: if params.is_empty() { json!({}) } else { json!({ "params": params }) },
            ip,
        })
        .await;
    response
}
