---
title: 監視
description: 稼働中の Verdin インスタンスを監視します。/_health と /_ready のチェック、/_metrics の Prometheus メトリクスとそのトークン、ログの形式、レベル、リクエスト ID を説明します。
sidebar:
  order: 10
---

Verdin のインスタンスは、2 つのヘルスエンドポイント、任意の Prometheus メトリクス、構造化ログを通じて自身の状態を報告します。このページでは、それぞれが返すものとオンにする方法を説明します。

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
| `verdin_webhook_deliveries_pending` | gauge | | 送信待ちの Webhook の配信。 |
| `verdin_realtime_subscribers` | gauge | | 開いているリアルタイムのイベントストリーム。 |
| `verdin_uptime_seconds` | gauge | | プロセスの起動からの秒数。 |
| `verdin_build_info` | gauge | `version` | 常に 1。実行中のバージョン。 |

`area` はサーバーの部分です: `api`（コンテンツ API）、`admin_api`、`admin`（パネルのファイル）、`graphql`、`mcp`、`uploads`、`internal`（`/_` で始まるパス）、`other`。`status` はステータスのクラスです: `2xx`、`3xx`、`4xx`、`5xx`。

役立つアラート: `/_ready` の失敗、`5xx` の割合の上昇、`verdin_webhook_deliveries_pending` の増加（Webhook の送信先がダウンしている）、`verdin_uptime_seconds` のリセット（再起動）。

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
