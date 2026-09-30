---
title: 監視
description: 稼働中の Verdin インスタンスを監視します。/_health と /_ready のチェック、/_metrics の Prometheus メトリクスと Grafana ダッシュボード、OpenTelemetry のトレース、Sentry のエラー報告、ログの形式、レベル、リクエスト ID を説明します。
sidebar:
  order: 10
---

Verdin のインスタンスは、2 つのヘルスエンドポイント、任意の Prometheus メトリクス、任意の OpenTelemetry のトレースと Sentry のエラー報告、構造化ログを通じて自身の状態を報告します。このページでは、それぞれが返すものとオンにする方法を説明します。

## ヘルスチェック

どちらのエンドポイントも、API のプレフィックスの外側、サーバーのルートで提供され、認証は不要です。

| エンドポイント | 応答 | 用途 |
| --- | --- | --- |
| `GET /_health` | プロセスが HTTP を提供している間は常に `200 {"status":"ok"}`。 | 生存確認: 応答しなくなったらプロセスを再起動します。 |
| `GET /_ready` | データベースが ping に応答すれば `200 {"status":"ready","database":"postgres"}`、応答しなければ `503 {"status":"unavailable"}`。 | 準備完了の確認とロードバランサーのチェック: 200 を返すインスタンスにだけトラフィックを送ります。 |

`database` は `postgres`、`mysql`、`mariadb`、`sqlite` のいずれかです。`/_ready` はマイグレーションを確認しません。`verdin start` はマイグレーションが保留中だと起動を拒否する（`--migrate` で適用しない限り）ので、稼働中のサーバーには保留中のマイグレーションはありません。

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Prometheus メトリクス

メトリクスをオンにして、トークンを設定します。

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

すると `GET /_metrics` が Prometheus のテキスト形式（バージョン 0.0.4）を提供します。トークン（`[metrics].token` より優先される `VERDIN_METRICS_TOKEN`）がある場合、`Authorization: Bearer <token>` なしのスクレイプは `401` になります。トークンがない場合は、ポートに到達できる誰もがメトリクスを読めます。

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

インスタンスが複数ある場合は、それぞれをスクレイプしてください。各インスタンスは自分のリクエストだけを数えます。

| メトリクス | 型 | ラベル | 意味 |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`、`method`、`status` | 処理した HTTP リクエスト。 |
| `verdin_http_request_duration_seconds` | histogram | `area`、`method`、`status` | リクエストの処理時間。バケットは 5 ms から 10 s まで。 |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`、`kind`、`function` | [プラグイン](/ja/extending/plugins/)の関数にかかった時間。バケットは同じ。 |
| `verdin_plugin_call_errors_total` | counter | `plugin`、`kind`、`function` | 失敗したプラグインの呼び出し。トラップ、タイムアウト、JSON ではない出力、または起動関数の `{ error }`。 |
| `verdin_webhook_deliveries_pending` | gauge | | 送信待ちの Webhook の配信。 |
| `verdin_realtime_subscribers` | gauge | | 開いているリアルタイムのイベントストリーム。 |
| `verdin_cluster_events_total` | counter | `direction` | `[cluster].bus` を設定した場合の[共有イベントバス](/ja/deploy/scaling/#共有イベントバス)上のイベント。他のインスタンスへの送信は `sent`、他のインスタンスからの受信は `received`、破棄（キューが満杯、または書き込みの失敗）は `dropped`。 |
| `verdin_uptime_seconds` | gauge | | プロセスの起動からの秒数。 |
| `verdin_build_info` | gauge | `version` | 常に 1。実行中のバージョン。 |

`area` はサーバーの部分です: `api`（コンテンツ API）、`admin_api`、`admin`（パネルのファイル）、`graphql`、`mcp`、`uploads`、`internal`（`/_` で始まるパス）、`other`。`status` はステータスのクラスです: `2xx`、`3xx`、`4xx`、`5xx`。
プラグインの呼び出しでは、`kind` は `hook`、`route`、`job`、`startup`、`graphql` のいずれかです。プラグインのシリーズは最初の呼び出しの後に現れます（[プラグインのリファレンス](/ja/extending/plugin-reference/#メトリクス)を参照）。

役立つアラート: `/_ready` の失敗、`5xx` の割合の上昇、`verdin_webhook_deliveries_pending` の増加（Webhook の送信先がダウンしている）、`verdin_plugin_call_errors_total` の増加や遅いプラグインのフック（フックが実行される書き込みを遅らせます）、`verdin_uptime_seconds` のリセット（再起動）。

### Grafana ダッシュボード

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json) は、これらのメトリクス用のダッシュボードです。リクエストレート、`5xx` の割合、エリア・メソッド・ステータスクラスごとのレイテンシの分位数、送信待ちの Webhook の配信、リアルタイムのサブスクライバー、イベントバスのトラフィック、プラグインの関数ごとの呼び出しレート、p95、エラーを表示します。Grafana でインポートし（**Dashboards → New → Import**）、Prometheus のデータソースを選んでください。上部の `instance` と `area` の変数が、すべてのパネルを絞り込みます。

## トレース（OpenTelemetry）

Verdin は、すべてのリクエストのトレースを、OTLP/HTTP で OpenTelemetry のコレクター（OpenTelemetry Collector、Grafana Alloy、Tempo、Jaeger、Honeycomb、Datadog など）にエクスポートできます。デフォルトではオフです。

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

標準の変数も使え、ファイルより優先されます。

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

各トレースには次のものが含まれます。

- **リクエストのスパン**（kind は `server`）。名前はメソッドとパスで、ID は `{id}` に置き換えられます（`PUT /api/articles/{id}`）。`http.response.status_code` を持ち、`5xx` ではエラーステータスになります。W3C の `traceparent` ヘッダー付きのリクエストは、呼び出し元のトレースに参加します。
- **データベースのステートメントごとのスパン**（kind は `client`）。その下に付き、`db.system.name`（`postgresql`、`mysql`、`mariadb`、`sqlite`）と、`?` プレースホルダーを含む SQL である `db.query.text` を持ちます。バインドされた値は記録されないので、コンテンツ、パスワード、トークンはトレースに含まれません。`COMMIT` と `ROLLBACK` には独自のスパンがあり、SQLite では `write lock` のスパンが、書き込みが先行する書き込み処理を待った時間を示します。
- リクエストの処理中に書かれたログイベント。スパンのイベントとして付きます。

リクエストの外で実行されるステートメント（起動、マイグレーション、バックグラウンドジョブ）はトレースされません。`[telemetry].sample_ratio` はトレースの一定の割合を残します（`0.1` なら 10 個に 1 個）。スパンはバッチで送信され、サーバーの停止時にフラッシュされます。ログレベルはトレースを絞り込みません。`[log].level = "warn"` でも、すべてのリクエストがエクスポートされます。

## エラー報告（Sentry）

DSN を設定すると、パニックと `5xx` のレスポンスを [Sentry](https://sentry.io)（または GlitchTip などの Sentry 互換サービス）に送信します。

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn` でも設定でき、変数が優先されます。`5xx` は、`POST /api/articles answered 500` というエラーイベントとして届き、`http.method`、`http.status_code`、`request_id` のタグが付きます。`request_id` は `X-Request-Id` ヘッダーとそのリクエストのログ行に一致します。イベントには、リリースとして Verdin のバージョンが、環境として `production`（`verdin start`）または `development`（`verdin dev`）が付きます。`SENTRY_ENVIRONMENT` や `[telemetry].sentry_environment` で別の名前を指定した場合を除きます。URL は、ログと同様に、秘密らしいクエリの値を隠して報告されます。リクエストのボディとヘッダーは送信されません。

## ログ

Verdin はログを標準エラー出力に書き込みます。

| 設定 | 値 | デフォルト |
| --- | --- | --- |
| `[log].format` | `pretty`（ターミナル向け）または `json`（1 行に 1 オブジェクト） | `pretty`。Docker イメージでは `json` |
| `[log].level` | レベルまたはフィルター: `error`、`warn`、`info`、`debug`、`trace`、またはモジュールごと（`info,verdin_api=debug`） | `info` |
| `RUST_LOG` | 同じ構文。設定すると `[log].level` より優先されます | 未設定 |

本番環境では `json` を使い、標準エラー出力をログシステムに送ってください。JSON の行は次のようになります。

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

起動時の `WARN` の行は、`[email].provider is 'log'` やセキュア Cookie のオフなど、本番環境で直すべき設定を指摘します。

### リクエスト

すべてのリクエストにリクエスト ID が付きます。受信した `X-Request-Id` ヘッダーがあればそれを、なければ新しい UUID を使います。ID は `X-Request-Id` レスポンスヘッダーで返され、リクエストの処理中に書かれるすべてのログ行に付きます（`request_id`、`method` と `uri` も）。システムをまたいでリクエストを追跡するには、プロキシからこのヘッダーを渡してください。

`info` レベルでは、リクエストは 1 件ずつログに記録されません。各リクエストをステータスとレイテンシー付きで記録するには、HTTP レイヤーのレベルを上げます。

```sh
RUST_LOG=info,tower_http=debug
```

ログに記録される URL では、名前がシークレットに見えるクエリパラメーター（`token`、`code`、`state`、`password`、`key`、`signature`、`jwt` など）の値が隠されます。例: `/api/connect/github/callback?code=[hidden]`。

## 管理パネルで

ホームのダッシュボードに**システム**ウィジェットを追加すると、バージョン、データベース、スキーマをひと目で確認できます。
