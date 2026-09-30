//! Prometheus metrics at `/_metrics` (`[metrics]`): HTTP requests by area, method and
//! status class with latency histograms, plugin calls by plugin, kind and function, the
//! webhook queue, realtime subscribers and uptime. Text exposition format 0.0.4, no
//! dependencies.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use verdin_db::{ColumnKind, Database};

/// Latency buckets, in seconds.
const BUCKETS: [f64; 11] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0];

#[derive(Default)]
struct Series {
    count: u64,
    sum: f64,
    buckets: [u64; BUCKETS.len()],
}

impl Series {
    fn observe(&mut self, elapsed: Duration) {
        let seconds = elapsed.as_secs_f64();
        self.count += 1;
        self.sum += seconds;
        for (bucket, upper) in self.buckets.iter_mut().zip(BUCKETS) {
            if seconds <= upper {
                *bucket += 1;
            }
        }
    }

    /// `{name}_bucket`, `_sum` and `_count` lines for one label set.
    fn render(&self, out: &mut String, name: &str, labels: &str) {
        for (upper, count) in BUCKETS.iter().zip(self.buckets) {
            let _ = writeln!(out, "{name}_bucket{{{labels},le=\"{upper}\"}} {count}");
        }
        let _ = writeln!(out, "{name}_bucket{{{labels},le=\"+Inf\"}} {}", self.count);
        let _ = writeln!(out, "{name}_sum{{{labels}}} {}", self.sum);
        let _ = writeln!(out, "{name}_count{{{labels}}} {}", self.count);
    }
}

/// Calls of one plugin function: durations and failures (traps, time-outs, invalid output).
#[derive(Default)]
struct PluginSeries {
    series: Series,
    errors: u64,
}

/// A label value with `\`, `"` and new lines escaped.
fn label(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
}

/// Paths that name the area of a request (`/api`, `/admin`, …), longest first.
#[derive(Clone)]
pub struct Metrics {
    inner: Arc<Inner>,
}

struct Inner {
    started: Instant,
    areas: Vec<(String, &'static str)>,
    requests: Mutex<BTreeMap<(&'static str, String, &'static str), Series>>,
    /// By plugin, kind and function: plugins and their exports are fixed at load, so the
    /// label set is bounded.
    plugin_calls: Mutex<BTreeMap<(String, &'static str, String), PluginSeries>>,
    token: Option<String>,
    db: Database,
    realtime: verdin_api::realtime::Realtime,
}

impl Metrics {
    pub fn new(
        db: Database,
        realtime: verdin_api::realtime::Realtime,
        api_prefix: &str,
        admin_path: &str,
        token: Option<String>,
    ) -> Self {
        let mut areas = vec![
            (format!("{admin_path}/api"), "admin_api"),
            (admin_path.to_owned(), "admin"),
            (api_prefix.to_owned(), "api"),
            ("/graphql".to_owned(), "graphql"),
            ("/mcp".to_owned(), "mcp"),
            ("/uploads".to_owned(), "uploads"),
        ];
        areas.sort_by_key(|(path, _)| std::cmp::Reverse(path.len()));
        Self {
            inner: Arc::new(Inner {
                started: Instant::now(),
                areas,
                requests: Mutex::default(),
                plugin_calls: Mutex::default(),
                token: token.filter(|token| !token.is_empty()),
                db,
                realtime,
            }),
        }
    }

    fn area(&self, path: &str) -> &'static str {
        if path.starts_with("/_") {
            return "internal";
        }
        self.inner
            .areas
            .iter()
            .find(|(prefix, _)| path == prefix || path.starts_with(&format!("{prefix}/")))
            .map_or("other", |(_, area)| area)
    }

    fn record(&self, area: &'static str, method: &str, status: StatusCode, elapsed: Duration) {
        let class = match status.as_u16() {
            100..=199 => "1xx",
            200..=299 => "2xx",
            300..=399 => "3xx",
            400..=499 => "4xx",
            _ => "5xx",
        };
        let mut requests = self.inner.requests.lock().expect("metrics");
        requests.entry((area, method.to_owned(), class)).or_default().observe(elapsed);
    }

    /// Records the plugins' calls from now on.
    pub fn observe_plugins(&self, plugins: &verdin_plugins::Plugins) {
        let metrics = self.clone();
        plugins.set_observer(Arc::new(move |plugin, kind, function, elapsed, failed| {
            metrics.record_plugin_call(plugin, kind, function, elapsed, failed);
        }));
    }

    fn record_plugin_call(
        &self,
        plugin: &str,
        kind: verdin_plugins::CallKind,
        function: &str,
        elapsed: Duration,
        failed: bool,
    ) {
        let mut calls = self.inner.plugin_calls.lock().expect("metrics");
        let entry =
            calls.entry((plugin.to_owned(), kind.as_str(), function.to_owned())).or_default();
        entry.series.observe(elapsed);
        entry.errors += u64::from(failed);
    }

    async fn render(&self) -> String {
        let mut out = String::new();
        let _ = writeln!(out, "# HELP verdin_uptime_seconds Seconds since the process started.");
        let _ = writeln!(out, "# TYPE verdin_uptime_seconds gauge");
        let _ = writeln!(out, "verdin_uptime_seconds {}", self.inner.started.elapsed().as_secs());
        let _ = writeln!(out, "# HELP verdin_build_info Verdin's version.");
        let _ = writeln!(out, "# TYPE verdin_build_info gauge");
        let _ = writeln!(out, "verdin_build_info{{version=\"{}\"}} 1", env!("CARGO_PKG_VERSION"));

        {
            let requests = self.inner.requests.lock().expect("metrics");
            let _ = writeln!(out, "# HELP verdin_http_requests_total HTTP requests served.");
            let _ = writeln!(out, "# TYPE verdin_http_requests_total counter");
            for ((area, method, class), series) in requests.iter() {
                let _ = writeln!(
                    out,
                    "verdin_http_requests_total{{area=\"{area}\",method=\"{method}\",status=\"{class}\"}} {}",
                    series.count
                );
            }
            let _ = writeln!(
                out,
                "# HELP verdin_http_request_duration_seconds Time to serve HTTP requests."
            );
            let _ = writeln!(out, "# TYPE verdin_http_request_duration_seconds histogram");
            for ((area, method, class), series) in requests.iter() {
                let labels = format!("area=\"{area}\",method=\"{method}\",status=\"{class}\"");
                series.render(&mut out, "verdin_http_request_duration_seconds", &labels);
            }
        }

        {
            let calls = self.inner.plugin_calls.lock().expect("metrics");
            if !calls.is_empty() {
                let _ = writeln!(
                    out,
                    "# HELP verdin_plugin_call_duration_seconds Time plugin functions took."
                );
                let _ = writeln!(out, "# TYPE verdin_plugin_call_duration_seconds histogram");
                for ((plugin, kind, function), calls) in calls.iter() {
                    let labels = format!(
                        "plugin=\"{}\",kind=\"{kind}\",function=\"{}\"",
                        label(plugin),
                        label(function)
                    );
                    calls.series.render(&mut out, "verdin_plugin_call_duration_seconds", &labels);
                }
                let _ = writeln!(
                    out,
                    "# HELP verdin_plugin_call_errors_total Plugin calls that failed (trap, time-out, invalid output)."
                );
                let _ = writeln!(out, "# TYPE verdin_plugin_call_errors_total counter");
                for ((plugin, kind, function), calls) in calls.iter() {
                    let _ = writeln!(
                        out,
                        "verdin_plugin_call_errors_total{{plugin=\"{}\",kind=\"{kind}\",function=\"{}\"}} {}",
                        label(plugin),
                        label(function),
                        calls.errors
                    );
                }
            }
        }

        let pending = self
            .inner
            .db
            .queries()
            .fetch_all(
                &format!(
                    "SELECT COUNT(*) FROM {} WHERE status = 'pending'",
                    verdin_migrate::system::WEBHOOK_DELIVERIES
                ),
                &[],
                &[ColumnKind::BigInt],
            )
            .await
            .ok()
            .and_then(|rows| rows.into_iter().next()?.into_iter().next()?.as_i64());
        if let Some(pending) = pending {
            let _ = writeln!(
                out,
                "# HELP verdin_webhook_deliveries_pending Webhook deliveries waiting to be sent."
            );
            let _ = writeln!(out, "# TYPE verdin_webhook_deliveries_pending gauge");
            let _ = writeln!(out, "verdin_webhook_deliveries_pending {pending}");
        }
        let _ = writeln!(out, "# HELP verdin_realtime_subscribers Open realtime event streams.");
        let _ = writeln!(out, "# TYPE verdin_realtime_subscribers gauge");
        let _ = writeln!(out, "verdin_realtime_subscribers {}", self.inner.realtime.subscribers());
        if let Some(stats) = self.inner.realtime.bus().stats() {
            let _ = writeln!(
                out,
                "# HELP verdin_cluster_events_total Events on the shared event bus ([cluster]), by \
                 direction: sent to other instances, received from them, dropped."
            );
            let _ = writeln!(out, "# TYPE verdin_cluster_events_total counter");
            for (direction, count) in
                [("sent", stats.sent), ("received", stats.received), ("dropped", stats.dropped)]
            {
                let _ = writeln!(
                    out,
                    "verdin_cluster_events_total{{direction=\"{direction}\"}} {count}"
                );
            }
        }
        out
    }
}

/// Records every request (the `/_metrics` scrape included).
pub async fn middleware(State(metrics): State<Metrics>, request: Request, next: Next) -> Response {
    let area = metrics.area(request.uri().path());
    let method = request.method().as_str().to_owned();
    let started = Instant::now();
    let response = next.run(request).await;
    metrics.record(area, &method, response.status(), started.elapsed());
    response
}

/// `GET /_metrics`; with a token set, only `Authorization: Bearer <token>`.
pub async fn scrape(State(metrics): State<Metrics>, headers: HeaderMap) -> Response {
    if let Some(expected) = &metrics.inner.token {
        let given = headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "));
        let matches = given.is_some_and(|given| {
            verdin_auth::crypto::sha256_hex(given) == verdin_auth::crypto::sha256_hex(expected)
        });
        if !matches {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    }
    let mut response = metrics.render().await.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
    );
    response
}

#[cfg(test)]
mod tests {
    use axum::Router;
    use axum::body::Body;
    use axum::routing::get;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn counts_requests_by_area() {
        let db = Database::connect("sqlite::memory:", &Default::default()).await.unwrap();
        let metrics = Metrics::new(db, Default::default(), "/api", "/admin", Some("s3cret".into()));
        let app = Router::new()
            .route("/api/articles", get(|| async { "ok" }))
            .route("/_metrics", get(scrape))
            .with_state(metrics.clone())
            .layer(axum::middleware::from_fn_with_state(metrics.clone(), middleware));
        for _ in 0..3 {
            app.clone()
                .oneshot(Request::get("/api/articles").body(Body::empty()).unwrap())
                .await
                .unwrap();
        }
        app.clone()
            .oneshot(Request::get("/admin/api/nope").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let denied = app
            .clone()
            .oneshot(Request::get("/_metrics").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
        let response = app
            .oneshot(
                Request::get("/_metrics")
                    .header("authorization", "Bearer s3cret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let text =
            String::from_utf8(response.into_body().collect().await.unwrap().to_bytes().to_vec())
                .unwrap();
        assert!(
            text.contains(r#"verdin_http_requests_total{area="api",method="GET",status="2xx"} 3"#),
            "{text}"
        );
        assert!(
            text.contains(
                r#"verdin_http_requests_total{area="admin_api",method="GET",status="4xx"} 1"#
            ),
            "{text}"
        );
        assert!(text.contains(r#"verdin_http_request_duration_seconds_bucket{area="api",method="GET",status="2xx",le="+Inf"} 3"#));
        assert!(text.contains("verdin_realtime_subscribers 0"));
        assert!(!text.contains("verdin_plugin_call"), "no plugin calls yet");
        assert!(!text.contains("verdin_cluster_events"), "one instance: no bus");
    }

    #[tokio::test]
    async fn event_bus_counters() {
        let db = Database::connect("sqlite::memory:", &Default::default()).await.unwrap();
        let backend = verdin_api::cluster::DatabaseBus::new(db.clone(), Duration::from_secs(1));
        let (bus, _runner) = verdin_api::cluster::EventBus::new("a", Arc::new(backend));
        let realtime = verdin_api::realtime::Realtime::new().with_bus(bus);
        let metrics = Metrics::new(db, realtime, "/api", "/admin", None);
        let text = metrics.render().await;
        assert!(text.contains(r#"verdin_cluster_events_total{direction="sent"} 0"#), "{text}");
        assert!(text.contains(r#"verdin_cluster_events_total{direction="dropped"} 0"#));
    }

    #[tokio::test]
    async fn plugin_calls_by_plugin_kind_and_function() {
        use verdin_plugins::CallKind;
        let db = Database::connect("sqlite::memory:", &Default::default()).await.unwrap();
        let metrics = Metrics::new(db, Default::default(), "/api", "/admin", None);
        let millis = Duration::from_millis;
        metrics.record_plugin_call("shop", CallKind::Hook, "before_create", millis(3), false);
        metrics.record_plugin_call("shop", CallKind::Hook, "before_create", millis(30), true);
        metrics.record_plugin_call("shop", CallKind::Startup, "start", millis(700), false);
        metrics.record_plugin_call("shop", CallKind::Route, "a\"b", millis(1), false);
        let text = metrics.render().await;
        let hook = r#"plugin="shop",kind="hook",function="before_create""#;
        for line in [
            format!(r#"verdin_plugin_call_duration_seconds_bucket{{{hook},le="0.005"}} 1"#),
            format!(r#"verdin_plugin_call_duration_seconds_bucket{{{hook},le="0.05"}} 2"#),
            format!(r#"verdin_plugin_call_duration_seconds_count{{{hook}}} 2"#),
            format!("verdin_plugin_call_errors_total{{{hook}}} 1"),
            r#"verdin_plugin_call_errors_total{plugin="shop",kind="startup",function="start"} 0"#
                .to_owned(),
            r#"verdin_plugin_call_duration_seconds_count{plugin="shop",kind="route",function="a\"b"} 1"#
                .to_owned(),
            "# TYPE verdin_plugin_call_duration_seconds histogram".to_owned(),
        ] {
            assert!(text.contains(&line), "{line} in {text}");
        }
    }
}
