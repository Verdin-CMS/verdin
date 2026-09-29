//! CDN cache tags and purges (`[cdn]`). Content API reads carry `Cache-Tag` (Cloudflare)
//! and `Surrogate-Key` (Fastly) headers — `vd`, `vd-<singularName>` and the tags of every
//! type the response can populate — and content that changes publicly purges its type's
//! tag: publishing, unpublishing, deleting, and every write to types without draft &
//! publish. Purges are batched for a moment and retried.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method};
use axum::middleware::Next;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Notify;
use verdin_content::DocumentService;
use verdin_content::events::{BoxFuture, DocumentEvent, DocumentListener, EventKind};
use verdin_schema::{Attribute, AttributeKind, Schema};

/// The tag of every response.
pub const ALL: &str = "vd";
const RECENT: usize = 20;
/// Cloudflare takes at most 30 tags per purge request.
const CHUNK: usize = 30;

/// `[cdn]` in `verdin.toml`; the API token comes from `VERDIN_CDN_TOKEN`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CdnConfig {
    pub provider: CdnProvider,
    /// Cloudflare zone.
    pub zone_id: Option<String>,
    /// Fastly service.
    pub service_id: Option<String>,
    /// `webhook`: receives `{ "tags": [...] }` (with `Authorization: Bearer <token>` when
    /// a token is set).
    pub url: Option<String>,
    /// How long changes are gathered before purging, in milliseconds (default 1000).
    pub debounce_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CdnProvider {
    #[default]
    None,
    Cloudflare,
    Fastly,
    Webhook,
}

/// The tag of a content type's responses.
pub fn type_tag(singular_name: &str) -> String {
    format!("{ALL}-{singular_name}")
}

/// Tags of a content type's responses: its own and those of every type its documents can
/// populate (relations, also inside components and dynamic zones, followed transitively),
/// so purging a related type also refreshes the responses that embed it. Polymorphic
/// relations can reach any type, so they bring in every type's tag.
pub fn response_tags(schema: &Schema, uid: &str) -> Vec<String> {
    let mut types = BTreeSet::from([uid.to_owned()]);
    let mut queue = vec![uid.to_owned()];
    let mut components = BTreeSet::new();
    let mut any = false;
    while let Some(current) = queue.pop() {
        let Some(content_type) = schema.content_type(&current) else { continue };
        let mut attributes: Vec<&Attribute> = content_type.attributes.values().collect();
        while let Some(attribute) = attributes.pop() {
            match &attribute.kind {
                AttributeKind::Relation { target, .. } => {
                    if types.insert(target.clone()) {
                        queue.push(target.clone());
                    }
                }
                AttributeKind::Morph { .. } => any = true,
                AttributeKind::Component { component, .. } => {
                    if components.insert(component.clone())
                        && let Some(component) = schema.component(component)
                    {
                        attributes.extend(component.attributes.values());
                    }
                }
                AttributeKind::DynamicZone { components: uids, .. } => {
                    for uid in uids {
                        if components.insert(uid.clone())
                            && let Some(component) = schema.component(uid)
                        {
                            attributes.extend(component.attributes.values());
                        }
                    }
                }
                _ => {}
            }
        }
    }
    if any {
        types.extend(schema.content_types.keys().cloned());
    }
    let own = schema.content_type(uid).map(|content_type| type_tag(&content_type.singular_name));
    let mut tags: Vec<String> = own.iter().cloned().collect();
    tags.extend(
        types
            .iter()
            .filter_map(|uid| schema.content_type(uid))
            .map(|content_type| type_tag(&content_type.singular_name))
            .filter(|tag| Some(tag) != own.as_ref()),
    );
    tags
}

/// Adds the cache tags of `/{name}…` responses (`tags`: route name → its response tags).
pub(crate) async fn tag_responses(
    State(names): State<Arc<HashMap<String, Vec<String>>>>,
    request: Request,
    next: Next,
) -> Response {
    let reading = matches!(*request.method(), Method::GET | Method::HEAD);
    let tags = request
        .uri()
        .path()
        .trim_start_matches('/')
        .split('/')
        .next()
        .and_then(|name| names.get(name))
        .cloned();
    let mut response = next.run(request).await;
    if reading
        && response.status().is_success()
        && let Some(tags) = tags
    {
        let headers = response.headers_mut();
        if let Ok(value) = HeaderValue::from_str(&format!("{ALL},{}", tags.join(","))) {
            headers.insert("cache-tag", value);
        }
        if let Ok(value) = HeaderValue::from_str(&format!("{ALL} {}", tags.join(" "))) {
            headers.insert("surrogate-key", value);
        }
    }
    response
}

/// One purge request, for the admin.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Purge {
    pub at: String,
    pub tags: Vec<String>,
    pub ok: bool,
    pub message: Option<String>,
}

#[derive(Clone)]
pub struct Cdn {
    inner: Arc<Inner>,
}

struct Inner {
    config: CdnConfig,
    token: Option<String>,
    client: reqwest::Client,
    pending: Mutex<BTreeSet<String>>,
    wake: Notify,
    recent: Mutex<Vec<Purge>>,
}

impl Cdn {
    /// `None` without a provider. Checks what the provider needs.
    pub fn new(
        config: CdnConfig,
        token: Option<String>,
        allow_private: bool,
    ) -> Result<Option<Self>, String> {
        let token = token.filter(|token| !token.is_empty());
        match config.provider {
            CdnProvider::None => return Ok(None),
            CdnProvider::Cloudflare if config.zone_id.is_none() || token.is_none() => {
                return Err("the cloudflare provider needs zone_id and VERDIN_CDN_TOKEN".into());
            }
            CdnProvider::Fastly if config.service_id.is_none() || token.is_none() => {
                return Err("the fastly provider needs service_id and VERDIN_CDN_TOKEN".into());
            }
            CdnProvider::Webhook => {
                let url = config.url.as_deref().ok_or("the webhook provider needs url")?;
                crate::webhooks::check_url(url, allow_private)?;
            }
            _ => {}
        }
        let mut client = reqwest::Client::builder()
            .user_agent(concat!("Verdin-CDN/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy();
        if !allow_private {
            client = client.dns_resolver(Arc::new(crate::webhooks::PublicResolver));
        }
        Ok(Some(Self {
            inner: Arc::new(Inner {
                config,
                token,
                client: client.build().map_err(|error| error.to_string())?,
                pending: Mutex::default(),
                wake: Notify::new(),
                recent: Mutex::default(),
            }),
        }))
    }

    pub fn provider(&self) -> CdnProvider {
        self.inner.config.provider
    }

    /// Queues tags for the next purge.
    pub fn queue(&self, tags: impl IntoIterator<Item = String>) {
        self.inner.pending.lock().expect("pending purges").extend(tags);
        self.inner.wake.notify_one();
    }

    pub fn recent(&self) -> Vec<Purge> {
        self.inner.recent.lock().expect("recent purges").clone()
    }

    /// Purges queued tags as they come (run once, in the background).
    pub fn spawn(&self) -> tokio::task::JoinHandle<()> {
        let cdn = self.clone();
        tokio::spawn(async move {
            let debounce = Duration::from_millis(cdn.inner.config.debounce_ms.unwrap_or(1000));
            loop {
                cdn.inner.wake.notified().await;
                tokio::time::sleep(debounce).await;
                cdn.flush().await;
            }
        })
    }

    /// Purges what is queued now.
    pub async fn flush(&self) {
        let tags: Vec<String> =
            std::mem::take(&mut *self.inner.pending.lock().expect("pending purges"))
                .into_iter()
                .collect();
        for chunk in tags.chunks(CHUNK) {
            let mut outcome = Err(String::new());
            for (attempt, delay) in [0u64, 1, 4].into_iter().enumerate() {
                if attempt > 0 {
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                }
                outcome = self.purge(chunk).await;
                if outcome.is_ok() {
                    break;
                }
            }
            if let Err(message) = &outcome {
                tracing::warn!(%message, tags = ?chunk, "CDN purge failed");
            }
            let mut recent = self.inner.recent.lock().expect("recent purges");
            recent.insert(
                0,
                Purge {
                    at: verdin_db::value::format_datetime(time::OffsetDateTime::now_utc()),
                    tags: chunk.to_vec(),
                    ok: outcome.is_ok(),
                    message: outcome.err(),
                },
            );
            recent.truncate(RECENT);
        }
    }

    async fn purge(&self, tags: &[String]) -> Result<(), String> {
        let config = &self.inner.config;
        let token = self.inner.token.as_deref().unwrap_or_default();
        let request = match config.provider {
            CdnProvider::None => return Ok(()),
            CdnProvider::Cloudflare => self
                .inner
                .client
                .post(format!(
                    "https://api.cloudflare.com/client/v4/zones/{}/purge_cache",
                    config.zone_id.as_deref().unwrap_or_default()
                ))
                .bearer_auth(token)
                .json(&json!({ "tags": tags })),
            CdnProvider::Fastly => self
                .inner
                .client
                .post(format!(
                    "https://api.fastly.com/service/{}/purge",
                    config.service_id.as_deref().unwrap_or_default()
                ))
                .header("Fastly-Key", token)
                .header("Surrogate-Key", tags.join(" ")),
            CdnProvider::Webhook => {
                let request = self
                    .inner
                    .client
                    .post(config.url.as_deref().unwrap_or_default())
                    .json(&json!({ "tags": tags }));
                if token.is_empty() { request } else { request.bearer_auth(token) }
            }
        };
        match request.send().await {
            Ok(response) if response.status().is_success() => Ok(()),
            Ok(response) => Err(format!("the CDN answered {}", response.status())),
            Err(error) => Err(crate::webhooks::describe(&error)),
        }
    }

    pub fn listener(&self) -> Arc<dyn DocumentListener> {
        Arc::new(self.clone())
    }
}

impl DocumentListener for Cdn {
    fn notify<'a>(
        &'a self,
        event: &'a DocumentEvent,
        service: &'a DocumentService,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let Ok(model) = service.registry().get(&event.uid) else { return };
            let public = match event.kind {
                EventKind::Published | EventKind::Unpublished | EventKind::Deleted => true,
                // Drafts are not served publicly.
                EventKind::Created | EventKind::Updated => !model.draft_and_publish(),
                _ => false,
            };
            if public {
                self.queue([type_tag(&model.content_type.singular_name)]);
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use axum::Router;
    use axum::body::Bytes;
    use axum::routing::post;

    use super::*;

    #[test]
    fn responses_carry_the_tags_of_the_types_they_can_populate() {
        use verdin_schema::Source;
        let content_type = |name: &str, attributes: serde_json::Value| {
            Source::content_type(
                name,
                json!({ "kind": "collectionType", "singularName": name, "pluralName": format!("{name}s"),
                        "displayName": name, "attributes": attributes })
                .to_string(),
            )
        };
        let schema = Schema::parse(&[
            content_type(
                "article",
                json!({ "title": { "type": "string" },
                        "category": { "type": "relation", "relation": "manyToOne", "target": "category" },
                        "seo": { "type": "component", "component": "shared.seo" } }),
            ),
            content_type(
                "category",
                json!({ "parent": { "type": "relation", "relation": "manyToOne", "target": "section" } }),
            ),
            content_type("section", json!({ "name": { "type": "string" } })),
            content_type("author", json!({ "name": { "type": "string" } })),
            content_type("tag", json!({ "label": { "type": "string" } })),
            Source::component(
                "shared",
                "seo",
                json!({ "displayName": "Seo",
                        "attributes": { "by": { "type": "relation", "relation": "oneWay", "target": "author" } } })
                .to_string(),
            ),
        ])
        .unwrap();
        assert_eq!(
            response_tags(&schema, "api::article"),
            ["vd-article", "vd-author", "vd-category", "vd-section"]
        );
        assert_eq!(response_tags(&schema, "api::tag"), ["vd-tag"]);
    }

    #[tokio::test]
    async fn purges_queued_tags_in_batches() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/purge", listener.local_addr().unwrap());
        let seen: Arc<Mutex<Vec<serde_json::Value>>> = Arc::default();
        let calls = seen.clone();
        let app = Router::new().route(
            "/purge",
            post(move |body: Bytes| {
                let calls = calls.clone();
                async move {
                    calls.lock().unwrap().push(serde_json::from_slice(&body).unwrap());
                    "ok"
                }
            }),
        );
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let config =
            CdnConfig { provider: CdnProvider::Webhook, url: Some(url), ..Default::default() };
        let cdn = Cdn::new(config, None, true).unwrap().unwrap();
        cdn.queue(["vd-article".to_owned()]);
        cdn.queue(["vd-article".to_owned(), "vd-page".to_owned()]);
        cdn.flush().await;
        assert_eq!(*seen.lock().unwrap(), [json!({ "tags": ["vd-article", "vd-page"] })]);
        assert!(cdn.recent()[0].ok);
        assert!(
            Cdn::new(
                CdnConfig { provider: CdnProvider::Cloudflare, ..Default::default() },
                None,
                false
            )
            .is_err()
        );
        assert!(Cdn::new(CdnConfig::default(), None, false).unwrap().is_none());
    }
}
