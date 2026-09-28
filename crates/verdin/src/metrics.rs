//! Prometheus metrics at `/_metrics` (`[metrics]`): HTTP requests by area, method and
//! status class with latency histograms, the webhook queue, realtime subscribers and
//! uptime. Text exposition format 0.0.4, no dependencies.

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

/// Paths that name the area of a request (`/api`, `/admin`, …), longest first.
#[derive(Clone)]
pub struct Metrics {
    inner: Arc<Inner>,
}

struct Inner {
    started: Instant,
    areas: Vec<(String, &'static str)>,
    requests: Mutex<BTreeMap<(&'static str, String, &'static str), Series>>,
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
        let seconds = elapsed.as_secs_f64();
        let mut requests = self.inner.requests.lock().expect("metrics");
        let series = requests.entry((area, method.to_owned(), class)).or_default();
        series.count += 1;
        series.sum += seconds;
        for (bucket, upper) in series.buckets.iter_mut().zip(BUCKETS) {
            if seconds <= upper {
                *bucket += 1;
            }
        }
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
                for (upper, count) in BUCKETS.iter().zip(series.buckets) {
                    let _ = writeln!(
                        out,
                        "verdin_http_request_duration_seconds_bucket{{{labels},le=\"{upper}\"}} {count}"
                    );
                }
                let _ = writeln!(
                    out,
                    "verdin_http_request_duration_seconds_bucket{{{labels},le=\"+Inf\"}} {}",
                    series.count
                );
                let _ = writeln!(
                    out,
                    "verdin_http_request_duration_seconds_sum{{{labels}}} {}",
                    series.sum
                );
                let _ = writeln!(
                    out,
                    "verdin_http_request_duration_seconds_count{{{labels}}} {}",
                    series.count
                );
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
    }
}
