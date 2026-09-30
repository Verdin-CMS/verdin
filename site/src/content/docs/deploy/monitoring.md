---
title: Monitoring
description: Watch a running Verdin instance — the /_health and /_ready checks, Prometheus metrics at /_metrics and a Grafana dashboard, OpenTelemetry traces, Sentry error reports, log format, levels and request ids.
sidebar:
  order: 10
---

A Verdin instance reports on itself through two health endpoints, optional Prometheus
metrics, optional OpenTelemetry traces and Sentry error reports, and structured logs.
This page lists what each one returns and how to turn it on.

## Health checks

Both endpoints are served at the root of the server, outside the API prefixes, and need
no authentication.

| Endpoint | Answers | Use it for |
| --- | --- | --- |
| `GET /_health` | Always `200 {"status":"ok"}` while the process serves HTTP. | Liveness: restart the process when it stops answering. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}` when the database answers a ping, `503 {"status":"unavailable"}` when it does not. | Readiness and load balancer checks: send traffic only to instances that answer 200. |

`database` is `postgres`, `mysql`, `mariadb` or `sqlite`. `/_ready` does not check
migrations: `verdin start` refuses to start while migrations are pending (unless
`--migrate` applies them), so a running server has none.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Prometheus metrics

Turn metrics on and set a token:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

`GET /_metrics` then serves the Prometheus text format (version 0.0.4). With a token
(`VERDIN_METRICS_TOKEN`, which wins over `[metrics].token`), a scrape without
`Authorization: Bearer <token>` gets `401`. Without a token, anyone who reaches the port
can read the metrics.

```yaml title="prometheus.yml"
scrape_configs:
  - job_name: verdin
    metrics_path: /_metrics
    authorization:
      type: Bearer
      credentials: <the token>
    static_configs:
      - targets: ["verdin:1337"]
```

With several instances, scrape each one: every instance counts its own requests.

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | HTTP requests served. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | Time to serve requests. Buckets from 5 ms to 10 s. |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Time [plugin](/extending/plugins/) functions took. Same buckets. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Plugin calls that failed: a trap, a time-out, output that is not JSON, or a startup function's `{ error }`. |
| `verdin_webhook_deliveries_pending` | gauge | | Webhook deliveries waiting to be sent. |
| `verdin_realtime_subscribers` | gauge | | Open realtime event streams. |
| `verdin_cluster_events_total` | counter | `direction` | Events on the [shared event bus](/deploy/scaling/#shared-event-bus), with `[cluster].bus` set: `sent` to other instances, `received` from them, `dropped` (a full queue or a failed write). |
| `verdin_uptime_seconds` | gauge | | Seconds since the process started. |
| `verdin_build_info` | gauge | `version` | Always 1; the running version. |

`area` is the part of the server: `api` (content API), `admin_api`, `admin` (the panel's
files), `graphql`, `mcp`, `uploads`, `internal` (paths starting with `/_`) or `other`.
`status` is the status class: `2xx`, `3xx`, `4xx` or `5xx`.
For plugin calls, `kind` is `hook`, `route`, `job`, `startup` or `graphql`; the plugin
series appear after the first call (see the
[plugin reference](/extending/plugin-reference/#metrics)).

Useful alerts: `/_ready` failing, a rising share of `5xx`, a growing
`verdin_webhook_deliveries_pending` (a webhook target is down), a rising
`verdin_plugin_call_errors_total` or slow plugin hooks (they delay the writes they run on),
and `verdin_uptime_seconds` resetting (restarts).

### Grafana dashboard

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
is a dashboard for these metrics: request rate, share of `5xx` and latency quantiles by
area, method and status class, pending webhook deliveries, realtime subscribers, event
bus traffic, and plugin call rate, p95 and errors per plugin function. Import it in Grafana
(**Dashboards → New → Import**) and pick your Prometheus data source; the `instance` and
`area` variables at the top filter every panel.

## Traces (OpenTelemetry)

Verdin can export a trace of every request to an OpenTelemetry collector (the
OpenTelemetry Collector, Grafana Alloy or Tempo, Jaeger, Honeycomb, Datadog…) over
OTLP/HTTP. It is off by default:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

The standard variables work as well and win over the file:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

Each trace holds:

- **A request span** (kind `server`), named after the method and the path with ids
  replaced by `{id}` (`PUT /api/articles/{id}`), with `http.response.status_code` and an
  error status on `5xx`. A request with a W3C `traceparent` header joins the caller's
  trace.
- **A span per database statement** (kind `client`) under it: `db.system.name`
  (`postgresql`, `mysql`, `mariadb` or `sqlite`) and `db.query.text`, the SQL with its
  `?` placeholders. Bound values are never recorded, so content, passwords and tokens stay
  out of traces. `COMMIT` and `ROLLBACK` have their own spans, and on SQLite a
  `write lock` span shows how long a write waited for the writers ahead of it.
- The log events written while serving the request, as span events.

Statements run outside a request (startup, migrations, background jobs) are not traced.
`[telemetry].sample_ratio` keeps a share of the traces (`0.1` keeps one in ten); the
spans are sent in batches and flushed when the server stops. The log level does not
filter traces: `[log].level = "warn"` still exports every request.

## Error reporting (Sentry)

Set a DSN to send panics and `5xx` responses to [Sentry](https://sentry.io) (or a
Sentry-compatible service such as GlitchTip):

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn` works too; the variable wins. A `5xx` arrives as an error event
`POST /api/articles answered 500`, tagged with `http.method`, `http.status_code` and the
`request_id`, which matches the `X-Request-Id` header and the log lines of that request.
Events carry the Verdin version as the release and `production` (`verdin start`) or
`development` (`verdin dev`) as the environment, unless `SENTRY_ENVIRONMENT` or
`[telemetry].sentry_environment` names another. URLs are reported with secret-looking
query values hidden, as in the logs; request bodies and headers are never sent.

## Logs

Verdin writes logs to standard error.

| Setting | Values | Default |
| --- | --- | --- |
| `[log].format` | `pretty` (for terminals) or `json` (one object per line) | `pretty`; `json` in the Docker image |
| `[log].level` | A level or filter: `error`, `warn`, `info`, `debug`, `trace`, or per module (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | Same syntax; wins over `[log].level` when set | unset |

Use `json` in production and ship standard error to your log system. A JSON line looks
like:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

At startup, `WARN` lines point out settings to fix in production, such as
`[email].provider is 'log'` or secure cookies turned off.

### Requests

Every request gets a request id: the incoming `X-Request-Id` header if there is one, or
a new UUID. It is sent back in the `X-Request-Id` response header and attached to every
log line written while serving the request (`request_id`, with `method` and `uri`).
Pass the header from your proxy to follow a request across systems.

Requests are not logged one by one at the `info` level. To log each request with its
status and latency, raise the HTTP layer's level:

```sh
RUST_LOG=info,tower_http=debug
```

Logged URLs hide the values of query parameters whose names look secret (`token`,
`code`, `state`, `password`, `key`, `signature`, `jwt`…), for example
`/api/connect/github/callback?code=[hidden]`.

## In the admin panel

Add the **System** widget to the home dashboard to see the version, the database and
the schema at a glance.
