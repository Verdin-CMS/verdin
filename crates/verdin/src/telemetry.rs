//! `[telemetry]`: OpenTelemetry traces over OTLP/HTTP (HTTP request spans from the server,
//! query spans from `verdin_db`) and Sentry reports of panics and 5xx responses. Both are
//! off by default and only run in `verdin start` and `verdin dev`.

use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result, bail};
use axum::http::HeaderMap;
use opentelemetry::KeyValue;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::trace::{Sampler, SdkTracerProvider};
use tracing::Level;
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::filter::Targets;
use tracing_subscriber::{Layer, Registry};

use crate::config::TelemetryConfig;

static TRACES: AtomicBool = AtomicBool::new(false);
static SENTRY: AtomicBool = AtomicBool::new(false);

/// A tracing layer added next to the log output.
pub type BoxedLayer = Box<dyn Layer<Registry> + Send + Sync>;

/// Keeps the exporters running; dropping it flushes the spans and events still queued.
#[derive(Default)]
pub struct Telemetry {
    provider: Option<SdkTracerProvider>,
    _sentry: Option<sentry::ClientInitGuard>,
}

impl Drop for Telemetry {
    fn drop(&mut self) {
        if let Some(provider) = self.provider.take()
            && let Err(error) = provider.shutdown()
        {
            eprintln!("flushing traces failed: {error}");
        }
    }
}

/// Whether spans are exported (the server then names and links request spans).
pub fn traces_enabled() -> bool {
    TRACES.load(Ordering::Relaxed)
}

/// Whether panics and 5xx responses go to Sentry.
pub fn sentry_enabled() -> bool {
    SENTRY.load(Ordering::Relaxed)
}

/// Starts the exporters `config` turns on. Returns the tracing layer that feeds the
/// OpenTelemetry exporter, if any, for `init_logging` to install.
pub fn init(
    config: &TelemetryConfig,
    development: bool,
) -> Result<(Telemetry, Option<BoxedLayer>)> {
    let mut telemetry = Telemetry::default();
    let mut layer = None;
    let disabled = env("OTEL_SDK_DISABLED").is_some_and(|value| value.eq_ignore_ascii_case("true"));
    if config.enabled && !disabled {
        let provider = tracer_provider(config)?;
        let tracer = provider.tracer("verdin");
        opentelemetry::global::set_text_map_propagator(
            opentelemetry_sdk::propagation::TraceContextPropagator::new(),
        );
        // Request spans and the events in them at `info`, query spans at `debug`
        // (`[log].level` only filters the log output).
        let filter =
            Targets::new().with_default(Level::INFO).with_target("verdin_db", Level::DEBUG);
        layer =
            Some(tracing_opentelemetry::layer().with_tracer(tracer).with_filter(filter).boxed());
        telemetry.provider = Some(provider);
        TRACES.store(true, Ordering::Relaxed);
    }

    if let Some(dsn) =
        env("SENTRY_DSN").or_else(|| config.sentry_dsn.clone().filter(|dsn| !dsn.is_empty()))
    {
        let dsn =
            dsn.parse::<sentry::types::Dsn>().context("SENTRY_DSN / [telemetry].sentry_dsn")?;
        let environment = env("SENTRY_ENVIRONMENT")
            .or_else(|| config.sentry_environment.clone())
            .unwrap_or_else(|| if development { "development" } else { "production" }.into());
        let mut options = sentry::ClientOptions::default();
        options.dsn = Some(dsn);
        options.release = sentry::release_name!();
        options.environment = Some(environment.into());
        telemetry._sentry = Some(sentry::init(options));
        SENTRY.store(true, Ordering::Relaxed);
    }
    Ok((telemetry, layer))
}

fn tracer_provider(config: &TelemetryConfig) -> Result<SdkTracerProvider> {
    if !(0.0..=1.0).contains(&config.sample_ratio) {
        bail!("[telemetry].sample_ratio must be between 0.0 and 1.0");
    }
    let mut exporter = opentelemetry_otlp::SpanExporter::builder().with_http();
    // The exporter reads the standard variables itself, but an endpoint given in code
    // would win over them.
    let from_env = env("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT").is_some()
        || env("OTEL_EXPORTER_OTLP_ENDPOINT").is_some();
    if let Some(endpoint) = config.endpoint.as_deref().filter(|_| !from_env) {
        if !(endpoint.starts_with("http://") || endpoint.starts_with("https://")) {
            bail!("[telemetry].endpoint must be an http:// or https:// URL");
        }
        exporter = exporter.with_endpoint(format!("{}/v1/traces", endpoint.trim_end_matches('/')));
    }
    let exporter = exporter.build().context("configuring the OTLP trace exporter")?;

    let mut resource = opentelemetry_sdk::Resource::builder()
        .with_attribute(KeyValue::new("service.version", env!("CARGO_PKG_VERSION")));
    if env("OTEL_SERVICE_NAME").is_none() {
        resource = resource.with_service_name(config.service_name.clone());
    }
    Ok(SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_sampler(Sampler::ParentBased(Box::new(Sampler::TraceIdRatioBased(
            config.sample_ratio,
        ))))
        .with_resource(resource.build())
        .build())
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

/// Makes `span` a child of the caller's trace (a W3C `traceparent` header).
pub fn set_remote_parent(span: &tracing::Span, headers: &HeaderMap) {
    struct Headers<'a>(&'a HeaderMap);
    impl opentelemetry::propagation::Extractor for Headers<'_> {
        fn get(&self, key: &str) -> Option<&str> {
            self.0.get(key).and_then(|value| value.to_str().ok())
        }
        fn keys(&self) -> Vec<&str> {
            self.0.keys().map(|name| name.as_str()).collect()
        }
    }
    let context = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract(&Headers(headers))
    });
    let _ = span.set_parent(context);
}

/// The name of a request span: the method and the path with ids replaced by `{id}`, so
/// that requests to the same route share a name.
pub fn span_name(method: &str, path: &str) -> String {
    let path: Vec<&str> = path
        .split('/')
        .map(|segment| {
            let digits = segment.bytes().filter(u8::is_ascii_digit).count();
            let numeric = !segment.is_empty() && digits == segment.len();
            // Document ids (24–26 lowercase letters and digits) and file hashes.
            let id_like = segment.len() >= 16
                && digits > 0
                && segment.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
            if numeric || id_like { "{id}" } else { segment }
        })
        .collect();
    format!("{method} {}", path.join("/"))
}

/// Sends a 5xx response to Sentry (see [`sentry_enabled`]).
pub fn report_server_error(method: &str, path: &str, status: u16, request_id: &str) {
    sentry::with_scope(
        |scope| {
            scope.set_tag("http.method", method);
            scope.set_tag("http.status_code", status);
            if !request_id.is_empty() {
                scope.set_tag("request_id", request_id);
            }
        },
        || {
            sentry::capture_message(
                &format!("{method} {path} answered {status}"),
                sentry::Level::Error,
            )
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn span_names_group_routes() {
        assert_eq!(span_name("GET", "/api/articles"), "GET /api/articles");
        assert_eq!(
            span_name("PUT", "/api/articles/01j9zq3w5m6k8r2t4v6x8y0a1b"),
            "PUT /api/articles/{id}"
        );
        assert_eq!(span_name("GET", "/admin/api/users/42"), "GET /admin/api/users/{id}");
        assert_eq!(
            span_name("GET", "/admin/api/content-manager"),
            "GET /admin/api/content-manager"
        );
        assert_eq!(span_name("GET", "/"), "GET /");
    }

    #[test]
    fn off_by_default() {
        let (telemetry, layer) = init(&TelemetryConfig::default(), false).unwrap();
        assert!(layer.is_none());
        assert!(telemetry.provider.is_none());
        assert!(!traces_enabled());
    }

    #[test]
    fn rejects_bad_settings() {
        let config = TelemetryConfig { enabled: true, sample_ratio: 2.0, ..Default::default() };
        assert!(init(&config, false).is_err());
        let config = TelemetryConfig {
            enabled: true,
            endpoint: Some("collector:4318".into()),
            ..Default::default()
        };
        assert!(init(&config, false).is_err());
        let config = TelemetryConfig { sentry_dsn: Some("not a dsn".into()), ..Default::default() };
        assert!(init(&config, false).is_err());
    }
}
