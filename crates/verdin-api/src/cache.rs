//! Content API traffic controls: rate limits per client, `ETag`s on reads, and an optional
//! in-memory cache of anonymous reads, emptied whenever content or media changes.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::body::{Body, to_bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use sha2::{Digest, Sha256};
use verdin_content::events::{
    BoxFuture, DocumentEvent, DocumentListener, FileEventKind, FileListener,
};

use crate::error::ApiError;
use crate::limiter::RateLimiter;

/// Largest response kept in the cache or given an `ETag`.
const MAX_BODY: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default)]
pub struct TrafficConfig {
    /// Requests per minute and IP without a token (0: unlimited).
    pub public_per_minute: u32,
    /// Requests per minute and token (0: unlimited).
    pub token_per_minute: u32,
    /// Anonymous reads are cached this long (zero: no cache).
    pub cache_ttl: Duration,
    pub cache_entries: usize,
}

struct Entry {
    stored: Instant,
    headers: HeaderMap,
    body: Bytes,
}

/// The cache of anonymous reads.
#[derive(Clone)]
pub struct ResponseCache {
    ttl: Duration,
    capacity: usize,
    entries: Arc<Mutex<HashMap<String, Entry>>>,
}

impl ResponseCache {
    pub fn new(ttl: Duration, capacity: usize) -> Self {
        Self { ttl, capacity: capacity.max(1), entries: Arc::default() }
    }

    pub fn clear(&self) {
        self.entries.lock().expect("cache lock").clear();
    }

    pub fn len(&self) -> usize {
        self.entries.lock().expect("cache lock").len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn get(&self, key: &str) -> Option<(HeaderMap, Bytes)> {
        let mut entries = self.entries.lock().expect("cache lock");
        match entries.get(key) {
            Some(entry) if entry.stored.elapsed() < self.ttl => {
                Some((entry.headers.clone(), entry.body.clone()))
            }
            Some(_) => {
                entries.remove(key);
                None
            }
            None => None,
        }
    }

    fn put(&self, key: String, headers: HeaderMap, body: Bytes) {
        let mut entries = self.entries.lock().expect("cache lock");
        if entries.len() >= self.capacity {
            let ttl = self.ttl;
            entries.retain(|_, entry| entry.stored.elapsed() < ttl);
            if entries.len() >= self.capacity {
                // Still full: drop the oldest entry.
                if let Some(oldest) =
                    entries.iter().min_by_key(|(_, entry)| entry.stored).map(|(key, _)| key.clone())
                {
                    entries.remove(&oldest);
                }
            }
        }
        entries.insert(key, Entry { stored: Instant::now(), headers, body });
    }

    pub fn listener(&self) -> Arc<dyn DocumentListener> {
        Arc::new(self.clone())
    }
}

impl DocumentListener for ResponseCache {
    fn notify<'a>(
        &'a self,
        _: &'a DocumentEvent,
        _: &'a verdin_content::DocumentService,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move { self.clear() })
    }
}

impl FileListener for ResponseCache {
    fn file_changed<'a>(
        &'a self,
        _: FileEventKind,
        _: &'a verdin_content::media::FileRecord,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move { self.clear() })
    }
}

#[derive(Clone)]
pub(crate) struct Traffic {
    public: Option<Arc<RateLimiter>>,
    tokens: Option<Arc<RateLimiter>>,
    cache: Option<ResponseCache>,
}

impl Traffic {
    pub(crate) fn new(config: TrafficConfig, cache: Option<ResponseCache>) -> Self {
        let limiter = |limit: u32| {
            (limit > 0).then(|| Arc::new(RateLimiter::new(limit, Duration::from_secs(60))))
        };
        Self {
            public: limiter(config.public_per_minute),
            tokens: limiter(config.token_per_minute),
            cache: cache.filter(|cache| !cache.ttl.is_zero()),
        }
    }
}

fn client(request: &Request) -> (Option<String>, String) {
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|token| hex(&Sha256::digest(token.trim().as_bytes())));
    let ip = request
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map_or_else(|| "unknown".to_owned(), |info| info.0.ip().to_string());
    (token, ip)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn etag(body: &[u8]) -> String {
    format!("W/\"{}\"", hex(&Sha256::digest(body)[..12]))
}

fn matches(headers: &HeaderMap, tag: &str) -> bool {
    headers.get(header::IF_NONE_MATCH).and_then(|value| value.to_str().ok()).is_some_and(|value| {
        value.split(',').any(|candidate| candidate.trim() == tag || candidate.trim() == "*")
    })
}

fn not_modified(tag: &str) -> Response {
    let mut response = StatusCode::NOT_MODIFIED.into_response();
    response.headers_mut().insert(header::ETAG, HeaderValue::from_str(tag).expect("ASCII tag"));
    response
}

pub(crate) async fn middleware(
    State(traffic): State<Traffic>,
    request: Request,
    next: Next,
) -> Response {
    let (token, ip) = client(&request);
    let limiter = match &token {
        Some(_) => traffic.tokens.as_ref(),
        None => traffic.public.as_ref(),
    };
    if let Some(limiter) = limiter
        && !limiter.allow(token.as_deref().unwrap_or(&ip))
    {
        let mut response = ApiError::TooManyRequests.into_response();
        response.headers_mut().insert(header::RETRY_AFTER, HeaderValue::from_static("60"));
        return response;
    }
    if request.method() != Method::GET {
        return next.run(request).await;
    }
    let request_headers = request.headers().clone();
    // Only anonymous reads are shared: authorized answers depend on the caller.
    let key = (token.is_none() && !request_headers.contains_key(header::COOKIE))
        .then(|| request.uri().to_string())
        .filter(|_| traffic.cache.is_some());
    if let (Some(cache), Some(key)) = (&traffic.cache, &key)
        && let Some((headers, body)) = cache.get(key)
    {
        let tag = headers
            .get(header::ETAG)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        if !tag.is_empty() && matches(&request_headers, &tag) {
            return not_modified(&tag);
        }
        let mut response = Response::new(Body::from(body));
        *response.headers_mut() = headers;
        response.headers_mut().insert("x-cache", HeaderValue::from_static("HIT"));
        return response;
    }

    let response = next.run(request).await;
    let is_json = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/json"));
    if response.status() != StatusCode::OK || !is_json {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    let Ok(bytes) = to_bytes(body, MAX_BODY).await else {
        return ApiError::Internal("response too large to tag".into()).into_response();
    };
    let tag = etag(&bytes);
    parts.headers.insert(header::ETAG, HeaderValue::from_str(&tag).expect("ASCII tag"));
    if let (Some(cache), Some(key)) = (&traffic.cache, key) {
        cache.put(key, parts.headers.clone(), bytes.clone());
        parts.headers.insert("x-cache", HeaderValue::from_static("MISS"));
    }
    if matches(&request_headers, &tag) {
        return not_modified(&tag);
    }
    Response::from_parts(parts, Body::from(bytes))
}
