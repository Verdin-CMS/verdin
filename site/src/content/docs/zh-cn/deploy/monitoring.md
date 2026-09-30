---
title: 监控
description: 观察运行中的 Verdin 实例：/_health 和 /_ready 检查、/_metrics 上的 Prometheus 指标和 Grafana 仪表板、OpenTelemetry 追踪、Sentry 错误报告、日志格式、日志级别和请求 id。
sidebar:
  order: 10
---

Verdin 实例通过两个健康检查端点、可选的 Prometheus 指标、可选的 OpenTelemetry 追踪和 Sentry 错误报告，以及结构化日志报告自身状态。本页列出每一项返回的内容以及如何开启。

## 健康检查

两个端点都位于服务器根路径下、API 前缀之外，无需身份验证。

| 端点 | 响应 | 用途 |
| --- | --- | --- |
| `GET /_health` | 只要进程在提供 HTTP 服务，就始终返回 `200 {"status":"ok"}`。 | 存活检查：进程不再响应时重启它。 |
| `GET /_ready` | 数据库响应 ping 时返回 `200 {"status":"ready","database":"postgres"}`，否则返回 `503 {"status":"unavailable"}`。 | 就绪检查和负载均衡器检查：只把流量发送给返回 200 的实例。 |

`database` 为 `postgres`、`mysql`、`mariadb` 或 `sqlite`。`/_ready` 不检查迁移：有待处理的迁移时 `verdin start` 会拒绝启动（除非 `--migrate` 执行了它们），因此正在运行的服务器不会有待处理的迁移。

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Prometheus 指标

开启指标并设置一个令牌：

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

之后 `GET /_metrics` 会提供 Prometheus 文本格式（版本 0.0.4）。设置了令牌时（`VERDIN_METRICS_TOKEN` 优先于 `[metrics].token`），不带 `Authorization: Bearer <token>` 的抓取会收到 `401`。没有令牌时，任何能访问该端口的人都可以读取指标。

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

有多个实例时，请逐个抓取：每个实例只统计自己的请求。

| 指标 | 类型 | 标签 | 含义 |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`、`method`、`status` | 已处理的 HTTP 请求数。 |
| `verdin_http_request_duration_seconds` | histogram | `area`、`method`、`status` | 处理请求的耗时。桶从 5 ms 到 10 s。 |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`、`kind`、`function` | [插件](/zh-cn/extending/plugins/)函数的耗时。桶相同。 |
| `verdin_plugin_call_errors_total` | counter | `plugin`、`kind`、`function` | 失败的插件调用：陷阱（trap）、超时、输出不是 JSON，或启动函数返回的 `{ error }`。 |
| `verdin_webhook_deliveries_pending` | gauge | | 等待发送的 webhook 投递数。 |
| `verdin_realtime_subscribers` | gauge | | 打开的实时事件流数。 |
| `verdin_cluster_events_total` | counter | `direction` | 设置了 `[cluster].bus` 时，[共享事件总线](/zh-cn/deploy/scaling/#共享事件总线)上的事件：`sent`（发给其他实例）、`received`（从其他实例接收）、`dropped`（队列已满或写入失败）。 |
| `verdin_uptime_seconds` | gauge | | 进程启动以来的秒数。 |
| `verdin_build_info` | gauge | `version` | 始终为 1；表示正在运行的版本。 |

`area` 表示服务器的哪一部分：`api`（内容 API）、`admin_api`、`admin`（管理后台的文件）、`graphql`、`mcp`、`uploads`、`internal`（以 `/_` 开头的路径）或 `other`。`status` 是状态码类别：`2xx`、`3xx`、`4xx` 或 `5xx`。对于插件调用，`kind` 为 `hook`、`route`、`job`、`startup` 或 `graphql`；插件相关的序列在第一次调用之后才会出现（参见[插件参考](/zh-cn/extending/plugin-reference/#指标)）。

有用的告警：`/_ready` 失败、`5xx` 占比上升、`verdin_webhook_deliveries_pending` 持续增长（某个 webhook 目标宕机）、`verdin_plugin_call_errors_total` 上升或插件钩子变慢（它们会拖慢所在的写入），以及 `verdin_uptime_seconds` 归零（发生了重启）。

### Grafana 仪表板

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json) 是这些指标的仪表板：按区域、方法和状态码类别划分的请求速率、`5xx` 占比和延迟分位数，待发送的 webhook 投递数、实时订阅者数、事件总线流量，以及每个插件函数的调用速率、p95 和错误数。在 Grafana 中导入它（**Dashboards → New → Import**），并选择你的 Prometheus 数据源；顶部的 `instance` 和 `area` 变量会筛选每个面板。

## OpenTelemetry 追踪

Verdin 可以通过 OTLP/HTTP 把每个请求的追踪导出到 OpenTelemetry 采集器（OpenTelemetry Collector、Grafana Alloy 或 Tempo、Jaeger、Honeycomb、Datadog……）。默认关闭：

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

标准变量同样有效，并且优先于文件：

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

每条追踪包含：

- **一个请求 span**（类型为 `server`），以方法和路径命名，其中的 id 替换为 `{id}`（`PUT /api/articles/{id}`），带有 `http.response.status_code`，在 `5xx` 时为错误状态。带有 W3C `traceparent` 头的请求会加入调用方的追踪。
- **每条数据库语句一个 span**（类型为 `client`），位于请求 span 之下：包含 `db.system.name`（`postgresql`、`mysql`、`mariadb` 或 `sqlite`）和 `db.query.text`，即带 `?` 占位符的 SQL。绑定的值不会被记录，因此内容、密码和令牌不会出现在追踪中。`COMMIT` 和 `ROLLBACK` 有各自的 span，在 SQLite 上，`write lock` span 会显示一次写入等待前面的写入者花了多长时间。
- 处理该请求期间写入的日志事件，作为 span 事件。

在请求之外执行的语句（启动、迁移、后台任务）不会被追踪。`[telemetry].sample_ratio` 保留一部分追踪（`0.1` 表示保留十分之一）；span 分批发送，并在服务器停止时刷新。日志级别不会过滤追踪：`[log].level = "warn"` 仍然会导出每个请求。

## Sentry 错误报告

设置 DSN，即可把 panic 和 `5xx` 响应发送到 [Sentry](https://sentry.io)（或 GlitchTip 等兼容 Sentry 的服务）：

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn` 同样可用；变量优先。一个 `5xx` 会作为错误事件 `POST /api/articles answered 500` 到达，带有 `http.method`、`http.status_code` 和 `request_id` 标签，其中 `request_id` 与 `X-Request-Id` 头以及该请求的日志行一致。事件以 Verdin 版本作为 release，以 `production`（`verdin start`）或 `development`（`verdin dev`）作为 environment，除非 `SENTRY_ENVIRONMENT` 或 `[telemetry].sentry_environment` 指定了其他值。URL 上看起来像机密的查询值会被隐藏，与日志中一样；请求体和请求头从不发送。

## 日志

Verdin 把日志写入标准错误输出。

| 设置 | 取值 | 默认值 |
| --- | --- | --- |
| `[log].format` | `pretty`（用于终端）或 `json`（每行一个对象） | `pretty`；Docker 镜像中为 `json` |
| `[log].level` | 一个级别或过滤器：`error`、`warn`、`info`、`debug`、`trace`，或按模块设置（`info,verdin_api=debug`） | `info` |
| `RUST_LOG` | 语法相同；设置后优先于 `[log].level` | 未设置 |

在生产环境中使用 `json`，并把标准错误输出发送到你的日志系统。一行 JSON 日志如下：

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

启动时，`WARN` 日志会指出生产环境中需要修正的设置，例如 `[email].provider is 'log'` 或关闭了安全 cookie。

### 请求

每个请求都有一个请求 id：如果传入了 `X-Request-Id` 请求头就使用它，否则生成一个新的 UUID。它会在 `X-Request-Id` 响应头中返回，并附加到处理该请求期间写入的每一行日志上（`request_id`，以及 `method` 和 `uri`）。从代理传入该请求头，就可以跨系统追踪一个请求。

在 `info` 级别下不会逐条记录请求。要记录每个请求及其状态码和延迟，请提高 HTTP 层的日志级别：

```sh
RUST_LOG=info,tower_http=debug
```

日志中的 URL 会隐藏名称看起来像密钥的查询参数的值（`token`、`code`、`state`、`password`、`key`、`signature`、`jwt`……），例如 `/api/connect/github/callback?code=[hidden]`。

## 在管理后台中

把 **系统** 小组件添加到首页仪表盘，即可一眼看到版本、数据库和 schema。
