---
title: Monitoring
description: Watch a running Verdin instance — the /_health and /_ready checks, Prometheus metrics at /_metrics and their token, log format, levels and request ids.
sidebar:
  order: 10
---

A Verdin instance reports on itself through two health endpoints, optional Prometheus
metrics and structured logs. This page lists what each one returns and how to turn it
on.

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
