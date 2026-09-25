//! Webhooks: document and media events delivered to external URLs. Events are queued in
//! `vd_webhook_deliveries` in the same process that made the write, and a worker sends
//! them with an HMAC signature, retrying with backoff; the table doubles as the delivery log.

use std::collections::BTreeMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use hmac::{Hmac, KeyInit, Mac};
use serde_json::{Value, json};
use sha2::Sha256;
use time::OffsetDateTime;
use tokio::sync::Notify;
use verdin_content::DocumentService;
use verdin_content::events::{BoxFuture, DocumentEvent, DocumentListener, EventKind};
use verdin_db::value::{format_datetime, truncate_millis};
use verdin_db::{ColumnKind as K, Database, DbError, SqlValue as V};
use verdin_migrate::system::{WEBHOOK_DELIVERIES, WEBHOOKS};
use verdin_query::{PageMode, Pagination, Query, Status};

/// Every event a webhook may subscribe to.
pub const EVENTS: &[&str] = &[
    "entry.create",
    "entry.update",
    "entry.delete",
    "entry.publish",
    "entry.unpublish",
    "entry.discard-draft",
    "media.create",
    "media.update",
    "media.delete",
];

/// The event of test deliveries (`POST /webhooks/{id}/trigger`).
pub const TEST_EVENT: &str = "trigger-test";

/// Kept of a response body in the log.
const RESPONSE_EXCERPT: usize = 2048;
/// Deliveries claimed per worker pass.
const BATCH: usize = 20;

#[derive(Debug, Clone)]
pub struct WebhookOptions {
    /// Allow URLs that resolve to loopback, private or link-local addresses. Off in
    /// production: an admin could otherwise probe the internal network (SSRF).
    pub allow_private_networks: bool,
    /// Wait before each retry; a delivery gets `retry_delays.len() + 1` attempts.
    pub retry_delays: Vec<Duration>,
    pub timeout: Duration,
    /// Finished deliveries older than this are removed from the log.
    pub retention: Duration,
}

impl Default for WebhookOptions {
    fn default() -> Self {
        Self {
            allow_private_networks: false,
            retry_delays: [30, 120, 600, 3600, 6 * 3600].map(Duration::from_secs).to_vec(),
            timeout: Duration::from_secs(10),
            retention: Duration::from_secs(30 * 24 * 3600),
        }
    }
}

/// A configured webhook.
#[derive(Debug, Clone)]
pub struct Webhook {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub events: Vec<String>,
    /// Content type uids; empty means every type.
    pub content_types: Vec<String>,
    pub secret: Option<String>,
    pub enabled: bool,
    pub created_at: Option<OffsetDateTime>,
    pub updated_at: Option<OffsetDateTime>,
}

impl Webhook {
    fn wants(&self, event: &str, uid: Option<&str>) -> bool {
        self.enabled
            && self.events.iter().any(|wanted| wanted == event)
            && (self.content_types.is_empty()
                || uid.is_some_and(|uid| self.content_types.iter().any(|wanted| wanted == uid)))
    }

    pub fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "url": self.url,
            "headers": self.headers,
            "events": self.events,
            "contentTypes": self.content_types,
            "signed": self.secret.is_some(),
            "enabled": self.enabled,
            "createdAt": self.created_at.map(format_datetime),
            "updatedAt": self.updated_at.map(format_datetime),
        })
    }
}

/// The result of one delivery attempt.
#[derive(Debug, Clone)]
pub struct Attempt {
    pub status: Option<u16>,
    pub body: Option<String>,
    pub error: Option<String>,
    pub duration_ms: i64,
}

impl Attempt {
    pub fn succeeded(&self) -> bool {
        self.status.is_some_and(|status| (200..300).contains(&status))
    }
}

#[derive(Clone)]
pub struct Webhooks {
    inner: Arc<Inner>,
}

struct Inner {
    db: Database,
    options: WebhookOptions,
    client: reqwest::Client,
    wake: Notify,
    enabled: AtomicBool,
    /// Loaded on first use, dropped when webhooks change.
    cache: RwLock<Option<Arc<Vec<Webhook>>>>,
}

type Result<T, E = DbError> = std::result::Result<T, E>;

fn now() -> OffsetDateTime {
    truncate_millis(OffsetDateTime::now_utc())
}

impl Webhooks {
    pub fn new(db: Database, options: WebhookOptions) -> Self {
        let mut client = reqwest::Client::builder()
            .user_agent(concat!("Verdin-Webhooks/", env!("CARGO_PKG_VERSION")))
            .timeout(options.timeout)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy();
        if !options.allow_private_networks {
            client = client.dns_resolver(Arc::new(PublicResolver));
        }
        let client = client.build().expect("the HTTP client builds");
        Self {
            inner: Arc::new(Inner {
                db,
                options,
                client,
                wake: Notify::new(),
                enabled: AtomicBool::new(true),
                cache: RwLock::new(None),
            }),
        }
    }

    pub fn options(&self) -> &WebhookOptions {
        &self.inner.options
    }

    /// The `webhooks` feature switch: while off, no event is queued or sent.
    pub fn set_enabled(&self, enabled: bool) {
        self.inner.enabled.store(enabled, Ordering::Relaxed);
        if enabled {
            self.inner.wake.notify_one();
        }
    }

    pub fn enabled(&self) -> bool {
        self.inner.enabled.load(Ordering::Relaxed)
    }

    /// The listener to attach to every Document Service.
    pub fn listener(&self) -> Arc<dyn DocumentListener> {
        Arc::new(self.clone())
    }

    pub fn database(&self) -> &Database {
        &self.inner.db
    }

    fn db(&self) -> &Database {
        &self.inner.db
    }

    // ------------------------------------------------------------ webhooks

    /// Forgets the cached webhooks after a change.
    pub fn invalidate(&self) {
        *self.inner.cache.write().expect("webhook cache") = None;
    }

    pub async fn list(&self) -> Result<Arc<Vec<Webhook>>> {
        if let Some(hooks) = self.inner.cache.read().expect("webhook cache").clone() {
            return Ok(hooks);
        }
        let rows = self
            .db()
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, name, url, headers, events, content_types, secret, enabled, \
                     created_at, updated_at FROM {WEBHOOKS} ORDER BY id"
                ),
                &[],
                &[
                    K::BigInt,
                    K::Text,
                    K::Text,
                    K::Json,
                    K::Json,
                    K::Json,
                    K::Text,
                    K::Bool,
                    K::DateTime,
                    K::DateTime,
                ],
            )
            .await?;
        let strings = |value: V| match value {
            V::Json(Value::Array(items)) => {
                items.into_iter().filter_map(|item| item.as_str().map(str::to_owned)).collect()
            }
            _ => Vec::new(),
        };
        let hooks: Vec<Webhook> = rows
            .into_iter()
            .map(|row| {
                let mut row = row.into_iter();
                let mut next = || row.next().unwrap_or(V::Null(K::Text));
                Webhook {
                    id: next().as_i64().unwrap_or_default(),
                    name: next().into_text().unwrap_or_default(),
                    url: next().into_text().unwrap_or_default(),
                    headers: match next() {
                        V::Json(value) => serde_json::from_value(value).unwrap_or_default(),
                        _ => BTreeMap::new(),
                    },
                    events: strings(next()),
                    content_types: strings(next()),
                    secret: next().into_text(),
                    enabled: matches!(next(), V::Bool(true)),
                    created_at: match next() {
                        V::DateTime(at) => Some(at),
                        _ => None,
                    },
                    updated_at: match next() {
                        V::DateTime(at) => Some(at),
                        _ => None,
                    },
                }
            })
            .collect();
        let hooks = Arc::new(hooks);
        *self.inner.cache.write().expect("webhook cache") = Some(hooks.clone());
        Ok(hooks)
    }

    pub async fn get(&self, id: i64) -> Result<Option<Webhook>> {
        Ok(self.list().await?.iter().find(|hook| hook.id == id).cloned())
    }

    // -------------------------------------------------------------- queue

    /// Queues `event` for every webhook that wants it.
    pub async fn enqueue(&self, event: &str, uid: Option<&str>, payload: Value) -> Result<usize> {
        if !self.enabled() {
            return Ok(0);
        }
        let hooks = self.list().await?;
        let targets: Vec<&Webhook> = hooks.iter().filter(|hook| hook.wants(event, uid)).collect();
        for hook in &targets {
            self.insert_delivery(hook.id, event, &payload, "pending", None).await?;
        }
        if !targets.is_empty() {
            self.inner.wake.notify_one();
        }
        Ok(targets.len())
    }

    /// Whether any enabled webhook wants `event` (skips building payloads otherwise).
    async fn wanted(&self, event: &str, uid: Option<&str>) -> bool {
        self.enabled()
            && match self.list().await {
                Ok(hooks) => hooks.iter().any(|hook| hook.wants(event, uid)),
                Err(error) => {
                    tracing::warn!(%error, "could not load webhooks");
                    false
                }
            }
    }

    async fn insert_delivery(
        &self,
        webhook_id: i64,
        event: &str,
        payload: &Value,
        status: &str,
        attempt: Option<&Attempt>,
    ) -> Result<i64> {
        let at = now();
        let int = |value: Option<i64>| value.map_or(V::Null(K::Int), |value| V::Int(value as i32));
        let text = |value: Option<&String>| value.map_or(V::Null(K::Text), |v| V::Text(v.clone()));
        self.db()
            .queries()
            .insert_returning_id(
                &format!(
                    "INSERT INTO {WEBHOOK_DELIVERIES} (webhook_id, event, payload, status, attempts, \
                     next_attempt_at, response_status, response_body, error, duration_ms, \
                     created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                ),
                &[
                    V::BigInt(webhook_id),
                    V::Text(event.into()),
                    V::Json(payload.clone()),
                    V::Text(status.into()),
                    V::Int(i32::from(attempt.is_some())),
                    if attempt.is_some() { V::Null(K::DateTime) } else { V::DateTime(at) },
                    int(attempt.and_then(|a| a.status).map(i64::from)),
                    text(attempt.and_then(|a| a.body.as_ref())),
                    text(attempt.and_then(|a| a.error.as_ref())),
                    int(attempt.map(|a| a.duration_ms)),
                    V::DateTime(at),
                    V::DateTime(at),
                ],
            )
            .await
    }

    /// Sends every due delivery once; returns how many were attempted.
    pub async fn deliver_due(&self) -> Result<usize> {
        if !self.enabled() {
            return Ok(0);
        }
        let rows = self
            .db()
            .queries()
            .fetch_all(
                &format!(
                    "SELECT id, webhook_id, event, payload, attempts FROM {WEBHOOK_DELIVERIES} \
                     WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at, id \
                     LIMIT {BATCH}"
                ),
                &[V::DateTime(now())],
                &[K::BigInt, K::BigInt, K::Text, K::Json, K::Int],
            )
            .await?;
        let mut attempted = 0;
        for row in rows {
            let mut row = row.into_iter();
            let mut next = || row.next().unwrap_or(V::Null(K::Text));
            let (id, webhook_id) = (next().as_i64().unwrap_or_default(), next().as_i64());
            let event = next().into_text().unwrap_or_default();
            let payload = match next() {
                V::Json(value) => value,
                _ => Value::Null,
            };
            let attempts = next().as_i64().unwrap_or_default() + 1;
            // Claim it: another instance may be delivering the same queue.
            let claimed = self
                .db()
                .queries()
                .execute(
                    &format!(
                        "UPDATE {WEBHOOK_DELIVERIES} SET status = 'sending', updated_at = ? \
                         WHERE id = ? AND status = 'pending'"
                    ),
                    &[V::DateTime(now()), V::BigInt(id)],
                )
                .await?;
            if claimed != 1 {
                continue;
            }
            attempted += 1;
            let hook = match webhook_id {
                Some(webhook_id) => self.get(webhook_id).await?,
                None => None,
            };
            let attempt = match hook.as_ref().filter(|hook| hook.enabled) {
                Some(hook) => self.send(hook, id, &event, &payload).await,
                None => Attempt {
                    status: None,
                    body: None,
                    error: Some("the webhook was disabled or deleted".into()),
                    duration_ms: 0,
                },
            };
            let retry = (!attempt.succeeded() && hook.as_ref().is_some_and(|hook| hook.enabled))
                .then(|| self.inner.options.retry_delays.get(attempts as usize - 1))
                .flatten();
            self.record(id, attempts, &attempt, retry.copied()).await?;
        }
        Ok(attempted)
    }

    async fn record(
        &self,
        id: i64,
        attempts: i64,
        attempt: &Attempt,
        retry: Option<Duration>,
    ) -> Result<()> {
        let status = match (attempt.succeeded(), retry) {
            (true, _) => "succeeded",
            (false, Some(_)) => "pending",
            (false, None) => "failed",
        };
        let next = retry.map_or(V::Null(K::DateTime), |delay| V::DateTime(now() + delay));
        let text = |value: &Option<String>| value.clone().map_or(V::Null(K::Text), V::Text);
        self.db()
            .queries()
            .execute(
                &format!(
                    "UPDATE {WEBHOOK_DELIVERIES} SET status = ?, attempts = ?, next_attempt_at = ?, \
                     response_status = ?, response_body = ?, error = ?, duration_ms = ?, \
                     updated_at = ? WHERE id = ?"
                ),
                &[
                    V::Text(status.into()),
                    V::Int(attempts as i32),
                    next,
                    attempt.status.map_or(V::Null(K::Int), |status| V::Int(i32::from(status))),
                    text(&attempt.body),
                    text(&attempt.error),
                    V::Int(attempt.duration_ms as i32),
                    V::DateTime(now()),
                    V::BigInt(id),
                ],
            )
            .await?;
        Ok(())
    }

    /// Sends a test event to `hook` now and logs it.
    pub async fn trigger(&self, hook: &Webhook) -> Result<(i64, Attempt)> {
        let payload = json!({ "event": TEST_EVENT, "createdAt": format_datetime(now()) });
        let id = self.insert_delivery(hook.id, TEST_EVENT, &payload, "sending", None).await?;
        let attempt = self.send(hook, id, TEST_EVENT, &payload).await;
        self.record(id, 1, &attempt, None).await?;
        Ok((id, attempt))
    }

    /// Sends a logged delivery again now (no further automatic retries).
    pub async fn redeliver(&self, delivery_id: i64) -> Result<Option<Attempt>> {
        let rows = self
            .db()
            .queries()
            .fetch_all(
                &format!(
                    "SELECT webhook_id, event, payload, attempts FROM {WEBHOOK_DELIVERIES} \
                     WHERE id = ? AND status <> 'sending'"
                ),
                &[V::BigInt(delivery_id)],
                &[K::BigInt, K::Text, K::Json, K::Int],
            )
            .await?;
        let Some(row) = rows.into_iter().next() else { return Ok(None) };
        let mut row = row.into_iter();
        let mut next = || row.next().unwrap_or(V::Null(K::Text));
        let Some(hook) = self.get(next().as_i64().unwrap_or_default()).await? else {
            return Ok(None);
        };
        let event = next().into_text().unwrap_or_default();
        let payload = match next() {
            V::Json(value) => value,
            _ => Value::Null,
        };
        let attempts = next().as_i64().unwrap_or_default() + 1;
        let attempt = self.send(&hook, delivery_id, &event, &payload).await;
        self.record(delivery_id, attempts, &attempt, None).await?;
        Ok(Some(attempt))
    }

    async fn send(
        &self,
        hook: &Webhook,
        delivery_id: i64,
        event: &str,
        payload: &Value,
    ) -> Attempt {
        let started = Instant::now();
        let elapsed = || started.elapsed().as_millis().min(i64::MAX as u128) as i64;
        if let Err(error) = check_url(&hook.url, self.inner.options.allow_private_networks) {
            return Attempt { status: None, body: None, error: Some(error), duration_ms: 0 };
        }
        let body = serde_json::to_vec(payload).expect("JSON serializes");
        let mut request = self.inner.client.post(&hook.url);
        for (name, value) in &hook.headers {
            request = request.header(name, value);
        }
        request = request
            .header("content-type", "application/json")
            .header("x-verdin-event", event)
            .header("x-verdin-delivery", delivery_id.to_string());
        if let Some(secret) = &hook.secret {
            let timestamp = OffsetDateTime::now_utc().unix_timestamp();
            request = request.header("x-verdin-signature", signature(secret, timestamp, &body));
        }
        match request.body(body).send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                let text = response.text().await.unwrap_or_default();
                let excerpt: String = text.chars().take(RESPONSE_EXCERPT).collect();
                Attempt {
                    status: Some(status),
                    body: (!excerpt.is_empty()).then_some(excerpt),
                    error: None,
                    duration_ms: elapsed(),
                }
            }
            Err(error) => Attempt {
                status: None,
                body: None,
                error: Some(describe(&error)),
                duration_ms: elapsed(),
            },
        }
    }

    /// Removes finished deliveries past the retention, and returns interrupted ones
    /// (`sending` for over a minute: the process stopped mid-request) to the queue.
    pub async fn maintain(&self) -> Result<()> {
        let at = now();
        let retention = time::Duration::try_from(self.inner.options.retention)
            .unwrap_or(time::Duration::days(30));
        self.db()
            .queries()
            .execute(
                &format!(
                    "DELETE FROM {WEBHOOK_DELIVERIES} WHERE status IN ('succeeded', 'failed') \
                     AND updated_at < ?"
                ),
                &[V::DateTime(at - retention)],
            )
            .await?;
        self.db()
            .queries()
            .execute(
                &format!(
                    "UPDATE {WEBHOOK_DELIVERIES} SET status = 'pending', next_attempt_at = ? \
                     WHERE status = 'sending' AND updated_at < ?"
                ),
                &[V::DateTime(at), V::DateTime(at - time::Duration::minutes(1))],
            )
            .await?;
        Ok(())
    }

    /// The delivery worker: sends due deliveries when woken by new events, and polls for
    /// retries.
    pub fn spawn(&self) -> tokio::task::JoinHandle<()> {
        let webhooks = self.clone();
        tokio::spawn(async move {
            let mut last_maintenance: Option<Instant> = None;
            loop {
                if last_maintenance.is_none_or(|at| at.elapsed() > Duration::from_secs(3600)) {
                    if let Err(error) = webhooks.maintain().await {
                        tracing::warn!(%error, "webhook log maintenance failed");
                    }
                    last_maintenance = Some(Instant::now());
                }
                loop {
                    match webhooks.deliver_due().await {
                        Ok(count) if count >= BATCH => continue,
                        Ok(_) => break,
                        Err(error) => {
                            tracing::warn!(%error, "webhook delivery failed");
                            break;
                        }
                    }
                }
                tokio::select! {
                    () = webhooks.inner.wake.notified() => {}
                    () = tokio::time::sleep(Duration::from_secs(15)) => {}
                }
            }
        })
    }

    // -------------------------------------------------------------- media

    /// Queues a media library event (`media.create`, `media.update`, `media.delete`).
    pub async fn media(&self, event: &str, file: Value) {
        if !self.wanted(event, None).await {
            return;
        }
        let payload = json!({
            "event": event,
            "createdAt": format_datetime(now()),
            "media": file,
        });
        if let Err(error) = self.enqueue(event, None, payload).await {
            tracing::warn!(%error, event, "could not queue a webhook delivery");
        }
    }
}

impl DocumentListener for Webhooks {
    fn notify<'a>(
        &'a self,
        event: &'a DocumentEvent,
        service: &'a DocumentService,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let name = event.kind.as_str();
            if !self.wanted(name, Some(&event.uid)).await {
                return;
            }
            let model = service.registry().get(&event.uid).ok().map(|model| &model.content_type);
            let entry = match event.kind {
                EventKind::Deleted => json!({ "documentId": event.document_id }),
                kind => {
                    let status = if kind == EventKind::Published
                        || model.is_some_and(|model| !model.draft_and_publish)
                    {
                        Status::Published
                    } else {
                        Status::Draft
                    };
                    let query = Query {
                        filters: None,
                        sort: Vec::new(),
                        fields: None,
                        populate: Vec::new(),
                        pagination: Pagination {
                            mode: PageMode::Offset { start: 0, limit: 1 },
                            with_count: false,
                        },
                        status,
                    };
                    match service.find_one(&event.uid, &event.document_id, &query).await {
                        Ok(Some(entry)) => entry,
                        Ok(None) => json!({ "documentId": event.document_id }),
                        Err(error) => {
                            tracing::warn!(%error, uid = %event.uid, "could not read a webhook entry");
                            json!({ "documentId": event.document_id })
                        }
                    }
                }
            };
            let payload = json!({
                "event": name,
                "createdAt": format_datetime(now()),
                "model": model.map(|model| model.singular_name.clone()),
                "uid": event.uid,
                "locale": event.locale,
                "entry": entry,
            });
            if let Err(error) = self.enqueue(name, Some(&event.uid), payload).await {
                tracing::warn!(%error, event = name, "could not queue a webhook delivery");
            }
        })
    }
}

impl verdin_content::events::FileListener for Webhooks {
    fn file_changed<'a>(
        &'a self,
        kind: verdin_content::events::FileEventKind,
        file: &'a verdin_content::media::FileRecord,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move { self.media(kind.as_str(), file.to_json()).await })
    }
}

/// `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, like Stripe's.
pub fn signature(secret: &str, timestamp: i64, body: &[u8]) -> String {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(secret.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(body);
    let digest = mac.finalize().into_bytes();
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("t={timestamp},v1={hex}")
}

fn describe(error: &reqwest::Error) -> String {
    use std::error::Error as _;
    let mut message = if error.is_timeout() {
        "timed out".to_owned()
    } else if error.is_connect() {
        "could not connect".to_owned()
    } else {
        error.to_string()
    };
    let mut source = error.source();
    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    message
}

/// Checks a webhook URL: `http(s)`, a host, and (unless allowed) no private IP literal.
/// Host names are checked again when resolved (see [`PublicResolver`]).
pub fn check_url(url: &str, allow_private: bool) -> std::result::Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| format!("invalid URL: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("the URL must use http or https".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("put credentials in headers, not in the URL".into());
    }
    let host = match parsed.host() {
        Some(host) => host,
        None => return Err("the URL needs a host".into()),
    };
    if allow_private {
        return Ok(());
    }
    let ip = match host {
        url::Host::Ipv4(ip) => Some(IpAddr::V4(ip)),
        url::Host::Ipv6(ip) => Some(IpAddr::V6(ip)),
        url::Host::Domain(domain) => {
            let domain = domain.trim_end_matches('.').to_ascii_lowercase();
            if domain == "localhost" || domain.ends_with(".localhost") {
                return Err("private network addresses are not allowed".into());
            }
            None
        }
    };
    if ip.is_some_and(|ip| !is_public(ip)) {
        return Err("private network addresses are not allowed".into());
    }
    Ok(())
}

/// Whether an address is on the public internet.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_unspecified()
                || ip.is_multicast()
                || a == 0
                || (a == 100 && (64..128).contains(&b))
                || (a == 192 && b == 0 && c == 0)
                || (a == 198 && (18..20).contains(&b))
                || a >= 240)
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return is_public(IpAddr::V4(v4));
            }
            let first = ip.segments()[0];
            !(ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
                || (first == 0x2001 && ip.segments()[1] == 0x0db8)
                || (first == 0x0064 && ip.segments()[1] == 0xff9b))
        }
    }
}

/// Resolves host names and keeps public addresses only, so that a public name pointing at
/// an internal address (DNS rebinding) is refused at connection time.
struct PublicResolver;

impl reqwest::dns::Resolve for PublicResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_owned();
        Box::pin(async move {
            let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await?
                .filter(|address| is_public(address.ip()))
                .collect();
            if addresses.is_empty() {
                return Err(format!("{host} resolves only to private network addresses").into());
            }
            Ok(Box::new(addresses.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert!(check_url("https://example.com/hook", false).is_ok());
        assert!(check_url("ftp://example.com", false).is_err());
        assert!(check_url("https://user:pass@example.com", false).is_err());
        for private in [
            "http://127.0.0.1:8080",
            "http://localhost/x",
            "http://api.localhost",
            "http://10.0.0.1",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/",
            "http://[fd00::1]/",
            "http://[::ffff:192.168.1.1]/",
            "http://100.64.0.1",
            "http://0.0.0.0",
        ] {
            assert!(check_url(private, false).is_err(), "{private}");
            assert!(check_url(private, true).is_ok(), "{private}");
        }
        assert!(is_public("8.8.8.8".parse().unwrap()));
        assert!(is_public("2606:4700::1111".parse().unwrap()));
    }

    #[test]
    fn signatures() {
        // printf '1700000000.{"a":1}' | openssl dgst -sha256 -hmac secret
        assert_eq!(
            signature("secret", 1_700_000_000, br#"{"a":1}"#),
            "t=1700000000,v1=49f24e537407743fa4a0242bb63b94b9a47ee99cbbe071ccd8a22550ae411686"
        );
    }
}
