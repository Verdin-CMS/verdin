---
title: プラグインのリファレンス
description: plugin.toml マニフェスト、機能、フックとそのペイロード、ホスト関数、ルート、ジョブ、起動関数、GraphQL フィールド、管理画面の拡張ポイント、制限、メトリクスを説明します。
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs, crates/verdin/src/metrics.rs and
admin/src/app/core/plugin-extensions.ts. -->

このページは、Verdin とプラグインの間の完全な取り決めです。マニフェスト、Verdin が各エクスポート関数に送るものと期待する戻り値、そしてモジュールが呼び出せるホスト関数を扱います。入門は[プラグイン](/ja/extending/plugins/)、実例は[プラグインのチュートリアル](/ja/extending/plugin-tutorial/)を参照してください。

## プラグインのディレクトリ

各プラグインは、`[plugins].path`（デフォルトは `verdin.toml` の隣の `plugins/`）配下のディレクトリです。

| ファイル | 必須 | 内容 |
| --- | --- | --- |
| `plugin.toml` | はい | マニフェスト。 |
| `plugin.wasm` | はい | モジュール（`wasm` で別のパスも指定できます）。 |
| `admin/` | いいえ | 管理パネルが読み込むファイル: `admin.script` モジュールとそのアセット。 |

起動時に、Verdin は `plugin.toml` を持つすべてのディレクトリを名前順に読み込みます。マニフェストが無効な場合、モジュールがない場合、別のプラグインがすでにその `name` を使っている場合、そのディレクトリはスキップされ、理由とともに**設定 → プラグイン**に表示されます。

## マニフェスト

```toml title="plugins/slugs/plugin.toml"
name = "slugs"
version = "1.0.0"
description = "Slugs from titles, and a color field"

[capabilities]
read = ["api::article"]
write = ["api::tag"]
http = ["api.example.com"]
kv = true
public_permissions = true

[limits]
timeout_ms = 5000
memory_mb = 64

[[hooks]]
on = "beforeCreate"
uid = "api::article"
function = "before_write"

[routes]
function = "handle"

[[jobs]]
schedule = "*/15 * * * *"
function = "refresh"

[startup]
function = "seed"
timeout_ms = 30000

[[graphql]]
name = "slugStats"
function = "stats"

[admin]
script = "index.js"

[[admin.widgets]]
id = "stats"
title = "Slug stats"
element = "slugs-stats"

[[admin.fields]]
id = "color"
title = "Color"
element = "slugs-color"
type = "string"

[[settings]]
key = "separator"
label = "Separator"
type = "select"
options = ["-", "_"]
default = "-"
```

どのテーブルでも、不明なキーはエラーになります。

### トップレベルのキー

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `name` | 必須 | URL、設定、カスタムフィールドで使うプラグインの ID。小文字の英字、数字、`-` からなり、英字で始まり、最大 64 文字。 |
| `version` | 必須 | 管理画面とログに表示されます。 |
| `description` | 未設定 | **設定 → プラグイン**に表示されます。 |
| `wasm` | `"plugin.wasm"` | モジュール。プラグインのディレクトリからの相対パス（`..` や絶対パスは不可）。 |
| `wasi` | `false` | モジュールに WASI（時計と乱数）を与えます。どちらの場合もファイルやソケットはありません。 |

### `[capabilities]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `read` | `[]` | `verdin_content` が読み取れる（`findMany`、`findOne`）コンテンツタイプ。`api::article` のような UID、またはすべてを表す `"*"`。 |
| `write` | `[]` | `create`、`update`、`delete`、`publish`、`unpublish` できるコンテンツタイプ。`read` を含みます。 |
| `http` | `[]` | モジュールが HTTP リクエストを送れるホスト。`api.example.com` または `*.example.com`。 |
| `kv` | `false` | プラグイン専用のキーバリューストレージ（`verdin_kv_get`、`verdin_kv_set`）。 |
| `public_permissions` | `false` | 公開ロールのコンテンツ API の権限の読み取りと置き換え（`verdin_public_permissions`）。 |

機能が制限するのはホストの呼び出しだけです。フックは `read` にかかわらず指定した型で実行され、ルートには誰でもアクセスできます。

### `[limits]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `timeout_ms` | `5000` | 1 回の呼び出しの制限時間（ミリ秒）。 |
| `memory_mb` | `64` | モジュールの最大メモリ（メガバイト）。 |

どちらも正の数である必要があります。

### `[[hooks]]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `on` | 必須 | イベント（下記）。 |
| `uid` | `"*"` | コンテンツタイプ（`api::article`）、またはすべてを表す `"*"`。 |
| `function` | 必須 | 呼び出すエクスポート関数。 |

イベント:

| 書き込みの前 | 書き込みの後 |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

名前は Strapi のライフサイクルの名前です。フックは、管理パネル、REST と GraphQL の API、リリースからの書き込みで実行されますが、`verdin import` コマンドによる書き込みでは実行されません。プラグインによる書き込みでは after フックは実行されますが、before フックは実行されません（[プラグインによる書き込み](#プラグインによる書き込み)を参照）。

### `[routes]`

| キー | 説明 |
| --- | --- |
| `function` | `/api/plugins/<name>` と `/api/plugins/<name>/…` へのすべてのリクエストを、メソッドを問わず処理するエクスポート関数。 |

パスは `[api].prefix` に従います。

### `[[jobs]]`

| キー | 説明 |
| --- | --- |
| `schedule` | UTC の cron 式。秒は任意: `*/15 * * * *`、`0 0 3 * * *`。 |
| `function` | 呼び出すエクスポート関数。 |

### `[startup]`

プラグインの開始時に実行される関数です。Strapi のプロジェクトが `bootstrap` で行うこと（コンテンツのシード投入、公開ロールの設定）に使います。

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `function` | 必須 | 呼び出すエクスポート関数。 |
| `timeout_ms` | `30000` | この関数専用の制限時間（ミリ秒）。シード投入はフックより時間がかかることがあるためです。正の値である必要があります。 |

実行されるタイミングは[起動関数](#起動関数)を参照してください。

### `[[graphql]]`

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `name` | 必須 | フィールド名。小文字の英字で始まり、その後に英字、数字、`_` が続きます。 |
| `function` | 必須 | フィールドを解決するエクスポート関数。 |
| `mutation` | `false` | フィールドを `Query` ではなく `Mutation` に追加します。 |
| `description` | 未設定 | スキーマ内のフィールドの説明。 |

各エントリーは `name(args: JSON): JSON` を追加します。コンテンツタイプがすでに使っている名前や、別のプラグインが先に使った名前はスキップされ、ログに警告が出ます。

### `[admin]`

| キー | 説明 |
| --- | --- |
| `script` | カスタム要素を定義する、`admin/` 配下の ES モジュール（`..` や絶対パスは不可）。 |
| `[[admin.widgets]]` | ダッシュボードのウィジェットの種類: `id`、`title`、`element`、任意の `description`。 |
| `[[admin.fields]]` | カスタムフィールド: `id`、`title`、`element`、`type`（値を保存する属性の型。`string` や `json` など）、任意の `description`。 |

`element` はカスタム要素の名前です。小文字の英字、数字、`-` からなり、少なくとも 1 つの `-` を含みます（`slugs-color`）。

### `[[settings]]`

**設定 → プラグイン → 設定**のフォームを宣言します。何も宣言しない場合、設定は自由な JSON オブジェクトです。

| キー | デフォルト | 説明 |
| --- | --- | --- |
| `key` | 必須 | 設定オブジェクト内のキー。英字、数字、`_` からなり、数字で始まらず、一意であること。 |
| `label` | 必須 | フォームのラベル。 |
| `type` | `"string"` | `string`、`text`、`url`、`number`、`integer`、`boolean`、`select` のいずれか。 |
| `description` | 未設定 | フィールドの下に表示するヘルプテキスト。 |
| `required` | `false` | `default` がない限り、値（テキストなら空でない値）が必要です。 |
| `options` | `[]` | `select` の選択肢（`select` では必須）。 |
| `default` | 未設定 | キーがないか `null` のときに使われます。フィールドに合う値である必要があります。 |
| `min`、`max` | 未設定 | `number` と `integer` の値の範囲、`string` と `text` の長さの範囲。 |

`url` の値は空か `http(s)://` の URL です。フォームがある場合、サーバーは不明なキー、誤った型、範囲外の値、必須の値の欠落を含む設定を拒否します（400）。

## エクスポートする関数

すべてのエクスポート関数は 1 つの JSON ドキュメントを受け取り、1 つを返します（何も返さないこともできます）。空の出力は `null` とみなされ、JSON でない出力は失敗とみなされます。

### before フック

入力:

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| フィールド | 説明 |
| --- | --- |
| `event` | フックのイベント。 |
| `uid` | コンテンツタイプ。 |
| `documentId` | ドキュメント。`beforeCreate` では `null`。 |
| `locale` | 多言語化された型では、書き込まれるロケール（リクエストで指定がなければデフォルトのロケール）。その他の型では `null`。 |
| `data` | 書き込まれるデータで、リクエストが送ったままの形です。作成と更新で渡されます。その他のイベントでは `null`。更新では、送られたフィールドだけです。 |

出力:

| 出力 | 効果 |
| --- | --- |
| `{ "data": { … } }` | 書き込まれるデータを置き換えます。元のデータと同じように検証されます。 |
| `{ "error": "message" }` | 書き込みを拒否します。呼び出し元はメッセージ付きの 400 を受け取ります。 |
| `{}` またはその他 | 書き込みはそのまま続行されます。 |

複数のフックが一致すると、プラグインの順序（ディレクトリ名）、次にマニフェストの順序で実行されます。各フックは、前のフックが返したデータを受け取ります。失敗したフック（トラップ、タイムアウト、無効な出力）はログに記録されてスキップされ、書き込みは続行されます。

### after フック

入力: `{ "event", "uid", "documentId", "locale" }`。書き込みがコミットされた後に送られます。出力は無視され、失敗はログに記録されます。エントリーのフィールドが必要な場合は、`verdin_content` で読み取ってください（`read` の機能が必要です）。

### ルート

入力:

```json
{
  "method": "GET",
  "path": "/stats",
  "query": "page=2&sort=title",
  "headers": { "accept": "application/json", "user-agent": "curl/8.7.1" },
  "body": "",
  "actor": { "kind": "public" }
}
```

| フィールド | 説明 |
| --- | --- |
| `method` | HTTP メソッド。 |
| `path` | `/api/plugins/<name>` の後のパス。`/` で始まります（プラグインのルートでは `/`）。 |
| `query` | `?` を除いた生のクエリ文字列（ない場合は空）。 |
| `headers` | `content-type`、`accept`、`user-agent`、`accept-language` のうち、存在するものだけ。 |
| `body` | 文字列としてのリクエストボディ（無効な UTF-8 は置き換えられます）。 |
| `actor` | 呼び出し元: `{ "kind": "public" }`、`{ "kind": "token", "id": 3 }`（API トークン）、`{ "kind": "user", "id": 12 }`（ログイン済みのエンドユーザー）。 |

無効なトークンを含む `Authorization` ヘッダーは、プラグインが呼び出される前に 401 で拒否されます。公開アクセスと API トークンの権限は適用されないので、`actor` を自分で確認してください。

出力:

| フィールド | デフォルト | 説明 |
| --- | --- | --- |
| `status` | `200` | HTTP ステータス。 |
| `headers` | なし | レスポンスヘッダー。`content-type`、`cache-control`、`location`、`etag`、`last-modified`、`content-disposition` だけが保持されます。 |
| `body` | 空 | 文字列はそのまま送られます（`content-type` を設定しない限り `text/plain`）。その他の JSON 値は `application/json` として送られます。 |

無効なプラグイン、不明なプラグイン、`[routes]` のないプラグインは 404 を返します。失敗した呼び出しは `{ "data": null, "error": { "status": 502, "name": "PluginError", … } }` 付きの 502 を返します。ルートはコンテンツ API の `[server].body_limit` と `[server].request_timeout_secs` を共有します。

### ジョブ

入力: `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`。実行が予定されていた時刻です。出力は無視され、失敗はログに記録されます。ジョブはプラグインがオンの間だけ、`[plugins].run_jobs = true` のインスタンスでだけ実行されます。サーバーが停止していた間に逃した実行は、後から行われません。

### 起動関数

入力: `{ "reason": "start" | "enabled" | "settings" }`:

| `reason` | タイミング |
| --- | --- |
| `start` | プラグインがオンの状態でサーバーが起動した。 |
| `enabled` | プラグインがオンに切り替えられた（ここで、または別のインスタンスで切り替えられ、ここで反映された）。 |
| `settings` | オンの間に設定が変更された（ここで保存された、または別のインスタンスから反映された）。 |

出力: `{ "error": "message" }` は失敗として数えられ、それ以外（`{}`、空）は成功として扱われます。失敗（トラップ、タイムアウト、`{ error }`）はプラグインのログとサーバーのログに記録されます。プラグインはオンのままで、関数は次の起動、切り替え、設定の変更のときにもう一度実行されます。

関数はサーバーが起動した後にバックグラウンドで実行されるので、その間もリクエストは処理されます。専用のモジュールのインスタンスで `[startup].timeout_ms` の制限で実行されるので、遅いシード投入がプラグインのフックやルートを止めることはありません。この関数の書き込みで発火した after フックは、関数が返ってから実行されます（[プラグインによる書き込み](#プラグインによる書き込み)を参照）。モジュールのメモリはプラグインの通常のインスタンスとは共有されません。状態は `verdin_kv_set` かコンテンツに保存してください。

インスタンスが複数ある場合、起動関数を実行するのは `[plugins].run_jobs = true` のインスタンスだけです（[スケーリングの助言](/ja/deploy/scaling/)に従っていれば 1 つ）。共有のデータベースに対して動作するので、1 回で十分です。もう一度実行されても害がないように書いてください。シード投入するものは、作成する前に探します。

### GraphQL フィールド

入力: `{ "args": …, "actor": … }`。`args` はフィールドの `args` 引数（任意の JSON、または `null`）、`actor` はルートと同じです。出力がフィールドの値になります。失敗した場合やプラグインが無効な場合は、コード `PLUGIN_ERROR` の GraphQL エラーを返します。ルートと同様に、アクセスの確認はプラグインが行います。

## ホスト関数

`extism:host/user` 名前空間（Rust では `extern "ExtismHost"`）からインポートします。JSON を文字列として受け取り、返します。`extism-pdk` の `Json<Value>` が変換を行います。

| 関数 | 入力 | 出力 |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | なし |
| `verdin_content` | コンテンツのリクエスト（下記） | 結果、または `{ "error": "…" }` |
| `verdin_kv_get` | プレーンな文字列としてのキー | 保存された JSON 値、または `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | なし |
| `verdin_config` | なし | 宣言したデフォルトで補完された設定オブジェクト |
| `verdin_public_permissions` | `{ "op": "get" }` または `{ "op": "set", "permissions": [...] }` | `{ "permissions": [...] }`、または `{ "error": "…" }` |

サーバーが持たないホスト関数（古い Verdin）をインポートするモジュールは読み込めません。その関数へのすべての呼び出しは、サーバーのログに `unknown import` で失敗します。

### `verdin_log`

サーバーのログ（プラグイン名付き）と、**設定 → プラグイン → ログ**にあるプラグインのログに書き込みます。その他のレベルは `info` とみなされます。プラグインのログは、直近の 200 件のメッセージを、それぞれ 2,000 文字で切り詰めてメモリに保持します。

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| フィールド | 使う操作 | 説明 |
| --- | --- | --- |
| `op` | すべて | `findMany`、`findOne`、`create`、`update`、`delete`、`publish`、`unpublish` のいずれか。 |
| `uid` | すべて | コンテンツタイプ。機能に含まれている必要があります。 |
| `documentId` | `findOne`、`update`、`delete`、`publish`、`unpublish` | ドキュメント。 |
| `query` | `findMany`、`findOne` | JSON オブジェクトとしての REST API のパラメーター: `filters`、`sort`、`fields`、`populate`、`pagination`、`status`。 |
| `data` | `create`、`update` | 書き込むフィールド。REST リクエストの `data` と同じです。 |
| `status` | `create`、`update` | `"draft"` は下書きを保存します。それ以外の場合、`?status=draft` なしの REST の書き込みと同様に公開されます。 |
| `locale` | すべて | 読み書きするロケール。 |

結果:

| `op` | 結果 |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }`（見つからない場合は `null`） |
| `create`、`update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

機能の範囲外の呼び出し、不明な操作、バリデーションエラー、存在しないドキュメントの場合は、代わりに `{ "error": "…" }` を返します。読み取りは、クエリで `"status": "draft"` を指定しない限り公開バージョンを返します。

#### プラグインによる書き込み

`verdin_content` を通じた書き込みは、すべてのプラグインの **before** フックをスキップするので、プラグインがそこで自分の変更によってループすることはなく、before フックに置いたルール（デフォルト値、チェック）はそれらの書き込みには適用されません。それ以外はすべて適用されます。バリデーション、レビューの段階、Webhook、履歴、監査ログ、そして書き込んだプラグイン自身を含むすべてのプラグインの **after** フックです。

プラグインの書き込みで発火した after フックは、書き込みの内側では実行されません。キューに入れられ、プラグインの呼び出し（ルート、ジョブ、GraphQL リゾルバー、フック、起動関数）が返ってプラグインのインスタンスを解放した後、ルートのレスポンスが送られる前に実行されます。そのため、プラグインは自分が after フックを持つ型に書き込むことができ、複数のプラグインをまたぐ連鎖も動作します。

- 書き込みを行うフックはさらにフックを発火させますが、**最大 `4` 階層**までです（REST や GraphQL からの書き込みが 1 階層目）。それより深いフックはスキップされ、プラグインのログに警告が記録されます。これにより、監視している型に書き込むフックが無限にループすることを防ぎます。
- ホスト関数（`verdin_content`、`verdin_public_permissions`、キーバリューストア）は、呼び出しの制限時間で停止してモジュールにエラーを返します。呼び出し元は、ビジー状態のプラグインを最大で制限時間に 10 秒を加えた時間だけ待ちます。止まった呼び出しが、プラグインやグレースフルな停止を永遠に止めることはありません。

### `verdin_kv_get` と `verdin_kv_set`

プラグインごとのキーバリューストアで、Verdin のデータベースにあり、すべてのインスタンスで共有されます。キーは 1〜255 バイト、値は任意の JSON です。`null` を設定するとキーが削除されます。`kv` の機能がない場合、読み取りは `null` を返し、書き込みは無視されます。

### `verdin_config`

**設定 → プラグイン**で保存された設定を、宣言した各設定の `default` で欠けたキーを補完して返します。何も保存されていない場合は `{}` です。

### `verdin_public_permissions`

公開ロールのコンテンツ API の権限を読み取り、または置き換えます。**設定 → 公開アクセス**で編集できるものです。`public_permissions` の機能が必要で、ない場合はすべての呼び出しが `{ "error": "…" }` を返します。

```json
{ "op": "set", "permissions": [
  { "subject": "api::article", "action": "find" },
  { "subject": "api::article", "action": "findOne" },
  { "subject": "api::comment", "action": "create" }
] }
```

| `op` | 効果 |
| --- | --- |
| `get` | 何もしません。現在の権限を返します。 |
| `set` | 公開の権限を**すべて** `permissions` で置き換えます（空のリストならすべて削除します）。 |

どちらも、ソートされた `{ "permissions": [{ "subject", "action" }, …] }` を返します。`subject` は、コンテンツタイプの UID、`plugin::upload`（メディアライブラリ）、`plugin::users-permissions.user`（コンテンツ API 越しのエンドユーザー）、`plugin::i18n.locale`（`find` のみ）のいずれかです。`action` は `find`、`findOne`、`create`、`update`、`delete`、`publish`、`readDrafts` のいずれかです（最後の 2 つは、アップロードとエンドユーザーには適用されません）。管理画面の権限グリッドと同じように確認されます。不明な subject や action、または適用されないものは `{ "error": "…" }` を返し、何も変更しません。すべての `set` はサーバーのログに記録されます。

### HTTP

`http` にホストを登録したら、Extism の HTTP サポート（Rust では `extism_pdk::http::request`）を使ってください。他のホストへのリクエストは失敗します。

## 管理画面の拡張ポイント

管理パネルは、有効なプラグインの拡張をサーバーに問い合わせ、各 `admin.script` を ES モジュールとして `/admin/plugins/<name>/<script>`（`[admin].path` 配下）から一度だけインポートします。プラグインがオンの間、プラグインの `admin/` ディレクトリ配下のファイルが `X-Content-Type-Options: nosniff` と `Cache-Control: no-cache` 付きでそこから提供されます。モジュールはマニフェストが指定したカスタム要素を定義する必要があり、3 秒以内に定義されない要素は省かれます。

### ウィジェット

各 `[[admin.widgets]]` エントリーは、管理者がダッシュボードに追加できるウィジェットの種類です。要素は `context` プロパティを受け取ります。

| プロパティ | 説明 |
| --- | --- |
| `apiBase` | `/api` のような、コンテンツ API のベース。 |
| `adminApiBase` | `/admin/api` のような、Admin API のベース。 |
| `fetch(path, init)` | ログイン中の管理者の認証情報付きの `fetch`。相対パスは `adminApiBase` を基準に解決されます。どちらかのベース配下のパスと絶対 URL はそのまま使われます。 |

```js title="plugins/slugs/admin/index.js"
class SlugStats extends HTMLElement {
  set context(context) {
    // Admin API, with the admin's session.
    context.fetch('auth/me').then((response) => response.json())
      .then(({ data }) => { this.textContent = `Hello ${data.firstname ?? data.email}`; });
    // The plugin's own route, on the content API: sent without the admin's session.
    context.fetch(`${context.apiBase}/plugins/slugs/stats`).then((response) => response.json())
      .then((stats) => { this.title = JSON.stringify(stats); });
  }
}
customElements.define('slugs-stats', SlugStats);
```

`context.fetch` が管理者のセッションを送るのは、Admin API へのリクエストだけです。`context.apiBase` 配下のパス（プラグインのルートを含むコンテンツ API）には、コンテンツ API が管理者のセッションを受け付けないのでセッションなしで送られ、公開ロールの権限で応答されます。0.10 より前はそこにもセッションを送っていたため、それらのリクエストは失敗していました。0.9 向けに書かれた、素の `fetch` を呼び出すウィジェットは引き続き動作します。

### カスタムフィールド

各 `[[admin.fields]]` エントリーは、属性が `"customField": "plugin::<name>.<id>"` で使えるフィールドです。属性の `type` は、フィールドが値を保存する方法と一致している必要があります。**コンテンツタイプビルダー**で選べます。要素は次を受け取ります。

| プロパティ | 説明 |
| --- | --- |
| `value` | 現在の値。 |
| `disabled` | 編集がオフかどうか。 |
| `attribute` | スキーマにある属性の定義。 |
| `locale` | 編集中のロケール。 |

新しい値は、`detail` にその値を入れた `change` イベントで知らせます（`detail` がない場合は、要素自身の `value` プロパティを通じて）。プラグインがオフの場合や要素がない場合、エディターは保存用の型に対応する通常の入力欄を表示します。[属性の型](/ja/reference/attribute-types/)を参照してください。

## ランタイムと制限

| 制限 | 値 |
| --- | --- |
| 1 回の呼び出しの時間 | `[limits].timeout_ms`、デフォルトは 5,000 ms（起動関数は `[startup].timeout_ms`、デフォルトは 30,000 ms） |
| メモリ | `[limits].memory_mb`、デフォルトは 64 MB |
| 並行性 | プラグインごとに一度に 1 つの呼び出し。呼び出しは互いを待ちます（起動関数はそれらと並行して実行されます） |
| モジュールのインスタンス | プラグインごとに 1 つ。初回使用時に作られ、呼び出しが失敗すると作り直されます（メモリは失われます）。起動関数は実行のたびに新しいものを使います |
| ログ | プラグインごとに 200 件、各 2,000 文字、メモリ内 |
| KV のキー | 1〜255 バイト |
| ルートのリクエストヘッダー | `content-type`、`accept`、`user-agent`、`accept-language` |
| ルートのレスポンスヘッダー | `content-type`、`cache-control`、`location`、`etag`、`last-modified`、`content-disposition` |

マニフェストやモジュールの変更は再起動後に反映され、切り替えと設定はすぐに反映されます。プラグインの管理には `plugins.manage` が必要です（[権限のリファレンス](/ja/reference/permissions/)を参照）。

## メトリクス

[`[metrics]`](/ja/deploy/monitoring/) をオンにすると、`/_metrics` はエクスポート関数に到達したすべての呼び出しを報告します。

| メトリクス | 型 | ラベル | 意味 |
| --- | --- | --- | --- |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`、`kind`、`function` | プラグインの関数にかかった時間。バケットは 5 ms から 10 s まで。 |
| `verdin_plugin_call_errors_total` | counter | `plugin`、`kind`、`function` | 失敗した呼び出し。トラップ、タイムアウト、JSON ではない出力、または起動関数の `{ error }`。 |

`kind` は `hook`、`route`、`job`、`startup`、`graphql` のいずれかです。`{ error }` で書き込みを拒否する before フックは、答えを返したので失敗には数えられません。モジュールがエクスポートしていない関数の呼び出しは記録されないので、ラベルの種類はインストールされたプラグインの範囲に収まります。シリーズはプラグインの最初の呼び出しの後に現れます。各インスタンスは自分の呼び出しだけを数えます。
