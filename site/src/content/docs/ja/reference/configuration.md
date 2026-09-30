---
title: 設定のリファレンス
description: verdin.toml のすべてのセクションとキーをデフォルト値とともに説明し、Verdin が読む環境変数を一覧にします。
sidebar:
  order: 1
  label: 設定
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs, crates/verdin-api/src/ai.rs
and crates/verdin/src/telemetry.rs.
Keep it in step when keys change. -->

設定は階層になっています: **組み込みのデフォルト ← `verdin.toml` ← 環境変数**。ファイルは任意で、すべてのキーにデフォルトがあります。不明なキーは拒否されるので、タイプミスは無視されずに起動時に失敗します。

- どのキーも `VERDIN_<SECTION>__<KEY>`（アンダースコア 2 つ）で上書きできます。たとえば `VERDIN_SERVER__PORT=8080` や `VERDIN_ADMIN__SECURE_COOKIES=false` です。ネストしたテーブルには `__` をもう 1 つ付けます: `VERDIN_ADMIN__BRANDING__TITLE=ACME`。ここでも不明なキーは拒否されるので、`VERDIN_` で始まり `__` を含む変数は、実在するキーを指している必要があります。
- `VERDIN_DATABASE_URL` は `database.url` の省略形です。
- ファイルは作業ディレクトリの `verdin.toml`、または `-c, --config` か `VERDIN_CONFIG` で指定したパスです。その中の相対パス（スキーマ、プラグイン、アップロード、SQLite のファイル）は、ファイルのディレクトリを基準に解決されます。
- 設定ファイルの隣にある `.env` ファイルが最初に読み込まれます。環境ですでに設定されている変数が優先されます。

シークレットは `verdin.toml` からは決して読み込まれません。[環境変数](#環境変数)を参照してください。

## `[server]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | 待ち受けるアドレス。 |
| `port` | `1337` | 待ち受けるポート。 |
| `public_url` | 未設定 | ブラウザーがサーバーに到達するアドレス。例: `"https://cms.example.com"`。メール内のリンクと SSO のコールバックに使われます。デフォルトは `http://localhost:{port}`。 |
| `body_limit` | `"1mb"` | 通常の API リクエストのボディの最大サイズ（アップロードには独自の上限があります）。バイト数、または `b`、`kb`、`mb`、`gb` を付けた文字列。 |
| `request_timeout_secs` | `30` | 通常の API リクエストの制限時間。 |
| `sync_interval_secs` | `10` | 他のインスタンスが変更した設定（機能、プラグインの切り替え、ロケール、レビューワークフロー）を取り込む間隔。`0` でオフ（単一のインスタンス）。 |
| `trusted_proxies` | `[]` | `X-Forwarded-For` がクライアントを示すリバースプロキシ（IP または CIDR 範囲、例: `["10.0.0.0/8"]`）。レート制限と監査ログはそのアドレスを使います。設定しないと、プロキシの背後のすべてのクライアントが 1 つのアドレスを共有します。 |

## `[database]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `url` | 未設定 | 接続 URL: `postgres://…`、`mysql://…`（MySQL と MariaDB）、`sqlite://…`。必須で、通常は `VERDIN_DATABASE_URL` で設定します。 |
| `pool_max` | `10` | プール内の最大接続数。 |

## `[schema]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `path` | `"schema"` | スキーマのディレクトリ。設定ファイルからの相対パス。 |

## `[api]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `prefix` | `"/api"` | コンテンツ API を提供するパス。`/` で始まり、`/` で終わらないこと。 |
| `default_page_size` | `25` | リクエストで指定がないときのページサイズ。1 から `max_page_size` まで。 |
| `max_page_size` | `100` | リクエストで求められる最大のページサイズ。 |
| `decimal_as_string` | `false` | 小数を数値（Strapi 互換）ではなく文字列（正確）としてシリアライズします。 |
| `public_rate_limit` | `0` | トークンなしの場合の、クライアント IP ごとの 1 分あたりのリクエスト数（`0`: 無制限）。 |
| `token_rate_limit` | `0` | API トークンまたはエンドユーザーごとの 1 分あたりのリクエスト数（`0`: 無制限）。 |
| `cache_ttl_secs` | `0` | 匿名の読み取りをメモリに保持する時間（`0`: キャッシュなし）。変更があるとキャッシュは空になります。 |
| `cache_entries` | `1000` | キャッシュするレスポンスの最大数。 |
| `cors_origins` | `[]` | 別のサイトからコンテンツ API と GraphQL を呼び出すことを許可するブラウザーのオリジン（`["https://www.example.com"]`: スキーム、ホスト、ポートで、パスなし）、またはすべてを許可する `["*"]`（単独で。`*` は他のオリジンと組み合わせられません）。空の場合、ブラウザーから呼び出せるのは同じオリジンのページだけです。Admin API はクロスオリジンの呼び出しを一切受け付けません。 |

## `[admin]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `path` | `"/admin"` | 管理パネルを提供するパス。その API は `{path}/api` にあります。 |
| `secure_cookies` | 未設定 | リフレッシュ Cookie に `Secure` を付けます。未設定の場合、`verdin start` では付け、`verdin dev`（プレーンな HTTP でのローカル開発）では付けません。 |
| `auth_rate_limit` | `20` | クライアント IP ごとの 1 分あたりのログイン、登録、リフレッシュの試行回数。 |
| `assets_dir` | 未設定 | バイナリに埋め込まれたコピーの代わりに、このディレクトリ（設定ファイルからの相対パス）から管理パネルを提供します。 |

### `[admin.branding]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `title` | `"Verdin"` | サイドバー、ログインページ、ブラウザーのタブに表示されます。 |
| `logo` | 未設定 | 画像ファイル（SVG、PNG、WebP）。設定ファイルからの相対パス。 |
| `favicon` | 未設定 | アイコンファイル（ICO、PNG、SVG）。設定ファイルからの相対パス。 |
| `accent` | 未設定 | ボタン、リンク、フォーカスリングの `#rrggbb` の色。 |
| `translations` | `{}` | 言語ごとに置き換える管理画面のテキスト。たとえば `[admin.branding.translations.en]` に `"auth.login.title" = "Welcome to ACME"`。キーは `admin/public/i18n/en.json` のものです。 |

## `[upload]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | ファイルの保存先。下記を参照。 |
| `max_file_size` | `209715200` | 受け付ける最大のファイルサイズ（バイト、200 MB）。 |
| `responsive_formats` | `true` | ラスター画像のレスポンシブなフォーマットを生成します。 |
| `breakpoints` | large 1000、medium 750、small 500 | `{ name, width }` のテーブルとしてのレスポンシブなフォーマット（Strapi の `breakpoints`）。画像より幅の広いフォーマットはスキップされます。 |
| `max_image_megapixels` | `100` | 解凍爆弾に対するデコードの上限（メガピクセル）。 |
| `max_original_size` | 未設定 | これより大きい（どちらかの辺の）ピクセル数のラスターの元画像はアップロード時に縮小され、そのときメタデータ（EXIF、GPS）も削除されます。未設定なら元画像は送られたまま保たれます。 |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### ローカルプロバイダー

`dir`（プロジェクトからの相対パス）配下のファイルで、Verdin が `/uploads` で提供します。

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

ローカルのファイルの画像の変換: `/uploads/<file>?preset=thumb`、または署名付きの `?w=&h=&fit=&format=&q=`。描画結果はディスクにキャッシュされ、ファイル（そのフォーカルポイントを含む）が変わると破棄されます。cover のトリミングはファイルのフォーカルポイントを表示範囲に残し、画像が拡大されることはありません。変換できるのは JPEG、PNG、WebP、TIFF、BMP です（アニメーションの可能性がある GIF は不可）。

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `enabled` | `true` | 変換を提供します。 |
| `presets` | `{}` | 常に許可される、名前付きの変換: `{ w, h, fit, format, q }`。 |
| `allow_arbitrary` | `false` | 署名なしで任意のパラメーターを受け付けます。異なる URL がそれぞれ描画・キャッシュされるので、信頼できるネットワーク専用です。 |
| `max_size` | `4096` | `w` または `h` の最大値（ピクセル）。 |
| `cache_dir` | `".cache/transforms"` | 描画結果の保存先（プロジェクトからの相対パス。削除しても安全）。 |

パラメーター: `w`、`h`（ピクセル）、`fit`（デフォルトの `cover` はボックスに合わせてトリミング、`inside` はボックス内に収める、`fill` は引き伸ばす）、`format`（`jpeg`、`png`、`webp`。WebP の出力はロスレス）、`q`（JPEG の品質、1〜100、デフォルトは 80）。

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**署名付きの URL。** `VERDIN_IMAGE_SECRET` を設定すると、`s` は `<file>?<canonical query>` の HMAC-SHA256 の 16 進表記になります。正規化したクエリには、デフォルトでないパラメーターを名前順（`fit`、`format`、`h`、`q`、`w`。`fit=cover` は省く）に並べます。

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### S3 プロバイダー

S3 互換の任意のサービス（AWS、Cloudflare R2、MinIO、Backblaze B2 など）。認証情報は標準の `AWS_*` 環境変数（`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`）から読み込みます。

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `bucket` | 必須 | バケット名。 |
| `region` | 未設定 | バケットのリージョン。 |
| `endpoint` | 未設定 | AWS 以外のサービス用の独自のエンドポイント。例: `https://<account>.r2.cloudflarestorage.com`。 |
| `public_url` | 必須 | バケットまたはその CDN の公開のベース URL。ファイルは `{public_url}/{key}` としてリンクされます。 |
| `prefix` | `""` | バケット内のキーのプレフィックス。 |
| `path_style` | `false` | パススタイルのリクエスト（MinIO とほとんどのセルフホストのサービス）。 |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `allow_private_networks` | 未設定 | ループバック、プライベート、リンクローカルのアドレスの Webhook の URL を許可します。デプロイのターゲットと `[cdn]` の Webhook にも適用されます。未設定の場合、`verdin start` では許可せず（許可すると管理者が内部サービスに到達できてしまう）、`verdin dev` では許可します。 |
| `timeout_secs` | `10` | 各配信の制限時間。 |
| `retention_days` | `30` | 配信ログを保持する日数。 |

[Webhook](/ja/guides/integrations/webhooks/) を参照してください。

## `[history]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `max_versions` | `50` | ドキュメントごとに保持するバージョン（古いものは削除されます）。 |

## `[email]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `provider` | `"log"` | `log`（メールをログに書き出す）、`smtp`、`resend`、`postmark`。 |
| `from` | `"Verdin <no-reply@localhost>"` | 送信者。 |
| `reply_to` | 未設定 | 返信先のアドレス。 |

### `[email.smtp]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `host` | `"localhost"` | SMTP サーバー。 |
| `port` | `587` | SMTP のポート。 |
| `username` | 未設定 | SMTP のユーザー。パスワードは `VERDIN_EMAIL_SMTP_PASSWORD` から取得します。 |
| `security` | `"starttls"` | `starttls`、`tls`（暗黙的、通常はポート 465）、`none`（ローカルのリレー）。 |

## `[plugins]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `path` | `"plugins"` | プラグインのディレクトリ（プラグインごとに 1 つのサブディレクトリ）。設定ファイルからの相対パス。 |
| `run_jobs` | `true` | このインスタンスでプラグインのスケジュールされたジョブを実行します（複数ある場合は 1 つのインスタンスで）。 |

[プラグイン](/ja/extending/plugins/)を参照してください。

## `[audit]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `retention_days` | `90` | 監査ログのエントリーを保持する日数。 |

## `[digest]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `enabled` | `true` | このインスタンスから日次ダイジェストを送ります（複数ある場合は 1 つのインスタンスで）。 |
| `hour_utc` | `8` | 未読の変更の日次ダイジェストを送る時刻（UTC、0〜23）。 |

## `[log]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` または `json`。 |
| `level` | 未設定（`info`） | デフォルトのフィルター。`RUST_LOG` が設定されていればそちらが優先されます。 |

## `[metrics]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `enabled` | `false` | `/_metrics` で Prometheus のメトリクスを提供します。領域（`api`、`admin_api`、`graphql`、`mcp`、`uploads` など）、メソッド、ステータスのクラスごとの HTTP リクエストとレイテンシーのヒストグラム、保留中の Webhook の配信、開いているリアルタイムのストリーム、イベントバスのトラフィック、稼働時間です。 |
| `token` | 未設定 | スクレイプに `Authorization: Bearer <token>` が必要になります。`VERDIN_METRICS_TOKEN` がこれより優先されます。トークンがない場合、ポートに到達できる誰もがメトリクスを読めます。 |

## `[telemetry]`

トレースとエラー報告。どちらもデフォルトではオフで、`verdin start` と `verdin dev` だけが使います（[監視](/ja/deploy/monitoring/#トレースopentelemetry)を参照）。

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `enabled` | `false` | HTTP リクエストとそのデータベースクエリの OpenTelemetry のトレースを、OTLP/HTTP（protobuf）でエクスポートします。`OTEL_SDK_DISABLED=true` でオフになります。 |
| `endpoint` | 未設定（`http://localhost:4318`） | コレクターのベース URL。`/v1/traces` が付加されます。`OTEL_EXPORTER_OTLP_ENDPOINT`（ベース URL）と `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`（完全な URL）が優先されます。 |
| `service_name` | `"verdin"` | トレースの `service.name`。`OTEL_SERVICE_NAME` が優先されます。 |
| `sample_ratio` | `1.0` | 残すトレースの割合。`0.0` から `1.0`。`traceparent` ヘッダーを持つリクエストは、呼び出し元の判断に従います。 |
| `sentry_dsn` | 未設定 | パニックと 5xx のレスポンスを Sentry に報告します。`SENTRY_DSN` が優先されます。 |
| `sentry_environment` | 未設定 | Sentry の環境。`SENTRY_ENVIRONMENT` が優先されます。未設定の場合、`verdin start` では `production`、`verdin dev` では `development` です。 |

## `[ai]`

管理画面の AI アクション（設定 → 機能で **AI** の機能をオンにした場合）: エントリーを別のロケールに翻訳、画像の代替テキストを作成、テキストを要約、SEO のメタデータを提案します。これらは提案を返すだけで、編集者なしに何かが保存されることはありません。キーは `VERDIN_AI_KEY` から読み込みます（ローカルサーバーには不要）。

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`、`openai`、`openai-compatible`（Ollama、LM Studio、vLLM など）。 |
| `model` | `anthropic` では `claude-sonnet-5` | モデル。その他のプロバイダーでは必須です。 |
| `base_url` | プロバイダーのもの | 別のエンドポイント。例: `http://localhost:11434/v1`。 |
| `max_tokens` | `2048` | 応答の最大長。 |

```toml
[ai]
provider = "anthropic"
```

各管理者は 1 分あたり 30 回まで AI のリクエストを送れます。コンテンツと画像はプロバイダーに送られるので、組織が許可するプロバイダーを選んでください。

## `[cdn]`

コンテンツが公開の範囲で変わったときに、CDN のキャッシュをパージします。コンテンツ API のレスポンスには `vd` と `vd-<singularName>` のタグ（`Cache-Tag` と `Surrogate-Key` ヘッダー）が付きます。

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`、`fastly`、`webhook`。 |
| `zone_id` | 未設定 | Cloudflare のゾーン（タグによるパージ）。 |
| `service_id` | 未設定 | Fastly のサービス（サロゲートキーによるパージ）。 |
| `url` | 未設定 | `webhook`: `POST { "tags": [...] }` を受け取ります。 |
| `debounce_ms` | `1000` | パージの前に変更をまとめる時間。 |

API トークンは `VERDIN_CDN_TOKEN` から読み込みます（Webhook には Bearer トークンとして送られます）。

## `[search]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `enabled` | `false` | `$containsi` の代わりに全文インデックス（Tantivy）で `_q` を順位付けします。 |
| `dir` | `"data/search"` | インデックスのディレクトリ。プロジェクトからの相対パス。削除すると、次の起動時にインデックスが再構築されます。 |
| `memory_mb` | `50` | インデックス作成に使うメモリの上限。 |

インデックスはインスタンスのディスクにあります。インスタンスが複数ある場合は、[イベントバス](#cluster)をオンにすると、各インデックスがすべてのインスタンスの書き込みに追従します。

## `[cluster]`

1 つのプロジェクトの複数のインスタンス向けの共有イベントバスです（[複数のインスタンスの実行](/ja/deploy/scaling/#共有イベントバス)を参照）。

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `bus` | `"none"` | `none`: リアルタイムのイベント、プレゼンス、キャッシュの無効化、検索の更新は各インスタンスにとどまります。`database`: プロジェクトのデータベースを通じてすべてのインスタンスに届きます（PostgreSQL では `LISTEN/NOTIFY`、MySQL、MariaDB、SQLite ではポーリング）。 |
| `poll_interval_ms` | `1000` | MySQL、MariaDB、SQLite が他のインスタンスのイベントを読む間隔。PostgreSQL は `NOTIFY` で起こされ、リッスンできない間だけこの間隔を使います。 |
| `instance_id` | 未設定（起動のたびにランダム） | バス上とログでのこのインスタンスの名前。 |

```toml
[cluster]
bus = "database"
```

すべてのインスタンスで設定するか、`VERDIN_CLUSTER__BUS=database` で設定します。

## 環境変数

`VERDIN_<SECTION>__<KEY>` による上書きに加えて、Verdin は次の変数を読みます。

| 変数 | 説明 |
| --- | --- |
| `VERDIN_CONFIG` | 設定ファイルのパス（`--config` と同じ）。 |
| `VERDIN_DATABASE_URL` | `database.url` の省略形。 |
| `VERDIN_ADMIN_JWT_SECRET` | 管理者のセッショントークンに署名します。必須で、32 バイト以上。`verdin secrets` で生成してください。 |
| `VERDIN_TOKEN_PEPPER` | 保存されたトークンの鍵付きハッシュ。必須で、32 バイト以上。`verdin secrets` で生成してください。 |
| `VERDIN_ADMIN_PASSWORD` | `verdin admin create` と `verdin admin reset-password` のパスワード（ない場合は標準入力から読み込み）。[コマンドラインのリファレンス](/ja/reference/cli/)を参照してください。 |
| `VERDIN_EMAIL_SMTP_PASSWORD` | SMTP のパスワード。 |
| `VERDIN_EMAIL_API_KEY` | Resend と Postmark のプロバイダーの API キー。 |
| `VERDIN_SSO_<ID>_SECRET` | SSO プロバイダーのクライアントシークレット。`<ID>` はプロバイダーの ID を大文字にし、`-` を `_` にしたものです（[シングルサインオン](/ja/guides/auth/sso/)を参照）。 |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | エンドユーザーの OAuth プロバイダーのクライアントシークレット。SSO のものと同じ命名です（[エンドユーザー](/ja/guides/auth/end-users/)を参照）。 |
| `VERDIN_AI_KEY` | `[ai]` のプロバイダーの API キー。 |
| `VERDIN_CDN_TOKEN` | `[cdn]` のプロバイダーの API トークン。 |
| `VERDIN_IMAGE_SECRET` | 画像の変換の URL に署名します（[`[upload.transforms]`](#uploadtransforms) を参照）。 |
| `VERDIN_METRICS_TOKEN` | `[metrics].enabled` の場合の `/_metrics` のスクレイプ用の Bearer トークン。`[metrics].token` より優先されます。 |
| `OTEL_EXPORTER_OTLP_ENDPOINT`、`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | [`[telemetry]`](#telemetry) のトレースのコレクター。`[telemetry].endpoint` より優先されます。その他の標準の `OTEL_EXPORTER_OTLP_*` 変数（ヘッダー、タイムアウト、圧縮）も適用されます。 |
| `OTEL_SERVICE_NAME`、`OTEL_RESOURCE_ATTRIBUTES` | エクスポートされるトレースのリソース。`OTEL_SERVICE_NAME` は `[telemetry].service_name` より優先されます。 |
| `OTEL_SDK_DISABLED` | `true` にすると、`[telemetry].enabled` でもトレースのエクスポートをオフにします。 |
| `SENTRY_DSN`、`SENTRY_ENVIRONMENT` | Sentry のエラー報告。`[telemetry].sentry_dsn` と `sentry_environment` より優先されます。 |
| `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY` | S3 のアップロードプロバイダーの認証情報。 |
| `RUST_LOG` | ログのフィルター。`[log].level` より優先されます。 |
