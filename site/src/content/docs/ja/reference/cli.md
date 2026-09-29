---
title: コマンドラインのリファレンス
description: verdin バイナリのすべてのコマンド、サブコマンド、フラグを、それが読むもの、書くもの、出力するものとともに説明します。
sidebar:
  order: 2
  label: コマンドライン
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` が唯一のバイナリです。プロジェクトの作成、サーバーの実行、マイグレーションの適用、管理者ユーザーの管理、コンテンツの出し入れを行います。このページでは、すべてのコマンドとフラグを一覧にします。

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| コマンド | 動作 |
| --- | --- |
| [`verdin new`](#verdin-new) | プロジェクトのディレクトリを作成します。 |
| [`verdin dev`](#verdin-dev) | 開発モードでサーバーを実行します。 |
| [`verdin start`](#verdin-start) | 本番モードでサーバーを実行します。 |
| [`verdin schema check`](#verdin-schema-check) | スキーマファイルを検証します。 |
| [`verdin migrate plan`](#verdin-migrate-plan) | マイグレーションのステップとその SQL を表示します。 |
| [`verdin migrate apply`](#verdin-migrate-apply) | マイグレーションのステップを適用します。 |
| [`verdin admin create`](#verdin-admin-create) | Super Admin を作成します。 |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | 管理者のパスワードを設定します。 |
| [`verdin types`](#verdin-types) | コンテンツ API の TypeScript の定義を生成します。 |
| [`verdin import strapi`](#verdin-import-strapi) | Strapi のエクスポートをインポートします。 |
| [`verdin import verdin`](#verdin-import-verdin) | Verdin のエクスポートをインポートします。 |
| [`verdin export`](#verdin-export) | プロジェクトを `.tar.gz` のアーカイブに書き出します。 |
| [`verdin healthcheck`](#verdin-healthcheck) | ローカルのサーバーが応答するか確認します。 |
| [`verdin secrets`](#verdin-secrets) | 新しいシークレットを出力します。 |
| [`verdin version`](#verdin-version) | バージョンを出力します。 |

## グローバルオプション

| オプション | デフォルト | 説明 |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | プロジェクトの設定ファイル。`VERDIN_CONFIG` からも読み込みます。プロジェクトのルートはこのファイルのディレクトリで、スキーマ、プラグイン、アップロード、SQLite の相対パスはそこを基準に解決されます。 |
| `-h, --help` | | コマンドのヘルプを出力します。 |
| `-V, --version` | | バージョンを出力します。 |

`verdin help <COMMAND>` は `--help` と同じヘルプを出力します。

`new`、`secrets`、`version` 以外のすべてのコマンドは、まずプロジェクトを読み込みます。

1. 設定ファイルの隣に `.env` ファイルがあれば読み込みます。環境ですでに設定されている変数が優先されます。
2. `verdin.toml`（任意）と `VERDIN_*` による上書きを読み込みます。[設定のリファレンス](/ja/reference/configuration/)を参照してください。
3. `[log]` と `RUST_LOG` に従って、標準エラー出力へのログ出力を始めます。

データベースを開くコマンドには、`VERDIN_DATABASE_URL` または `[database].url` が必要です。管理者のアカウントに触れるコマンドやサーバーを実行するコマンドには、`VERDIN_ADMIN_JWT_SECRET` と `VERDIN_TOKEN_PEPPER` も必要です。

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

`DIR` にプロジェクトを作成します。`DIR` は存在しないか、空である必要があります。

| ファイル | 内容 |
| --- | --- |
| `verdin.toml` | デフォルト値の `[server]`、`[api]`、`[admin]`。 |
| `.env` | `VERDIN_DATABASE_URL` と、新しい `VERDIN_ADMIN_JWT_SECRET` と `VERDIN_TOKEN_PEPPER`。あなただけが読めます（Unix ではモード `0600`）。 |
| `.gitignore` | `.env`、`data/`、SQLite のファイル、`.cache/`。 |
| `schema/content-types/`、`schema/components/` | 空のスキーマのディレクトリ。 |
| `data/` | SQLite のデータベース用（SQLite のみ）。 |

| 引数またはオプション | デフォルト | 説明 |
| --- | --- | --- |
| `<DIR>` | | 作成するディレクトリ。 |
| `--database <DATABASE>` | `sqlite` | `.env` が指すデータベース: `sqlite`、`postgres`、`mysql`、`mariadb`。 |

`sqlite` では URL は `sqlite://data/verdin.db` です。それ以外では、ユーザー `verdin`、パスワード `change-me`、ディレクトリにちなんだ名前（小文字の英字、数字、`_`）のデータベースを使うローカルサーバーの URL になります。起動する前に編集してください。

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

開発モードでサーバーを実行します。`verdin start` との違いは次のとおりです。

- リスクレベルが `safe` の保留中のマイグレーションは起動時に適用されます。より危険なステップがあるとサーバーは止まります。[`verdin migrate plan`](#verdin-migrate-plan) で確認してください。
- 管理パネルの**コンテンツタイプビルダー**がスキーマファイルを編集し、サーバーがスキーマを再読み込みします。
- リフレッシュ Cookie に `Secure` が付かない（`[admin].secure_cookies` で指定しない限り）ので、プレーンな HTTP でログインできます。
- Webhook とデプロイのターゲットは、ループバックやプライベートなアドレスを呼び出せます（`[webhooks].allow_private_networks` で別の指定をしない限り）。

Ctrl+C または `SIGTERM` で停止します。

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

本番モードでサーバーを実行します。データベースがスキーマに追いついていないと起動を拒否するので、デプロイで、確認していないテーブルが変わることはありません。

| オプション | 説明 |
| --- | --- |
| `--migrate` | 起動前に、保留中の `safe` のマイグレーションのステップを適用します。risky と destructive のステップには引き続き `verdin migrate apply` が必要です。 |

待ち受けを始める前に設定を確認し（`[api].prefix` と `[admin].path` が `/api` のような形であること、ページサイズが整合していること、`[server].trusted_proxies` と `[api].cors_origins` が解析できること）、組み込みのロールを作成します。`[admin].secure_cookies` が `false` の場合や `[email].provider` が `log` の場合は警告をログに出します。まだ管理者がいない場合は管理パネルのアドレスをログに出し、最初の訪問者がそこで最初の Super Admin を登録します。

Ctrl+C または `SIGTERM` で停止します。

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

データベースに触れずに、スキーマファイル（`[schema].path`）を検証します。概要を出力するか、ファイルと属性のパス付きのエラーで失敗します。

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

デプロイの前に CI で使ってください。各属性が受け付けるものは[属性の型](/ja/reference/attribute-types/)を参照してください。

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

データベースをスキーマと比較し、何も変更せずに、`verdin migrate apply` が行うことを出力します。番号付きのステップで、それぞれにリスクレベルと SQL が付きます。何もすることがない場合は `database is up to date` と出力します。

| オプション | 説明 |
| --- | --- |
| `--rename-table <OLD=NEW>` | 一方を削除して他方を作成する代わりに、テーブル `OLD` を `NEW` に名前変更したものとして扱います（行を保ちます）。繰り返し指定できます。 |
| `--rename-column <TABLE.OLD=NEW>` | `TABLE` のカラム `OLD` を `NEW` に名前変更したものとして扱います（値を保ちます）。`TABLE` はテーブルの新しい名前です。繰り返し指定できます。 |

リスクレベル:

| レベル | 意味 |
| --- | --- |
| `safe` | データを失うことも、既存の行で失敗することもありません: 新しいテーブル、NULL 許容またはデフォルト値付きの新しいカラム、名前の変更、一意でないインデックス。 |
| `risky` | 既存の行で失敗したり、値を変換したりすることがあります: カラムの型の変更、NULL 許容でなくデフォルト値もない新しいカラム、既存のテーブルへの一意インデックス。 |
| `destructive` | カラムやテーブルを削除します。 |

`safe` を超えるステップがある場合、プランの最後に必要なフラグが示されます（`requires: verdin migrate apply --allow risky`）。削除されたカラムやテーブルが名前変更に見える場合は、渡すべき名前変更のフラグが一覧されます。前回のマイグレーションが中断された場合は、適用済みのステップの数と最後のエラーが表示されます。

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

[スキーマのマイグレーション](/ja/concepts/schema-migrations/)を参照してください。

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

プランを適用します。`verdin migrate plan` と同じ名前変更のオプションを受け付けるので、確認したときと同じものを渡してください。

| オプション | デフォルト | 説明 |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | 適用する最大のリスクレベル: `safe`、`risky`、`destructive`。それを超えるステップを含むプランは、何かを実行する前に拒否されます。 |
| `--rename-table <OLD=NEW>` | | `verdin migrate plan` と同じ。 |
| `--rename-column <TABLE.OLD=NEW>` | | `verdin migrate plan` と同じ。 |

`applied N steps` または `database is up to date` と出力します。中断（接続の切断、失敗したステップ）の後は、原因を直してもう一度実行してください。完了しなかったステップから再開します。

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Super Admin を作成します。パスワードは `VERDIN_ADMIN_PASSWORD` から、それが未設定なら標準入力から読み込みます。データベースはスキーマに対して最新である必要があります。

| オプション | 説明 |
| --- | --- |
| `--email <EMAIL>` | 新しい管理者のメールアドレス。 |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

まだブラウザーから到達できないサーバーの最初の管理者を作成するのに使ってください。そうでなければ、管理パネルの最初の訪問者が登録します。

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

管理者のパスワードを設定し、ログインの失敗によるアカウントのロックを解除し、そのすべてのセッションを終了します。パスワードは `verdin admin create` と同じ方法で読み込みます。

| オプション | 説明 |
| --- | --- |
| `--email <EMAIL>` | 管理者のメールアドレス。 |

第二要素は削除しません。**ユーザーの管理**を持つ管理者が**設定 → ユーザー**でリセットできます。

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

スキーマからコンテンツ API の TypeScript の定義（コンテンツタイプとコンポーネントごとに 1 つのインターフェース）を生成し、標準出力に出力します。データベースは不要です。

| オプション | 説明 |
| --- | --- |
| `-o, --out <OUT>` | 代わりにこのファイルに書き込みます。 |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

[型付きクライアント](/ja/guides/frontend/typed-client/)を参照してください。

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

`strapi export --no-encrypt` で作ったエクスポート（`.tar.gz`、`.tar`、または展開したディレクトリ）から、Strapi v4 または v5 のプロジェクトをインポートします。コンテンツタイプとコンポーネントをスキーマファイルとして書き込み、それからエントリー、ロケール、メディア、リレーション、フォルダーをインポートします。

| 引数またはオプション | 説明 |
| --- | --- |
| `<PATH>` | エクスポートのファイルまたはディレクトリ。 |
| `--schema-only` | スキーマファイルだけを書き込みます。 |
| `--force` | 既存のスキーマファイルを上書きし、すでにエントリーのあるコンテンツタイプにもインポートします。 |

書き込んだものとインポートしたものを、移行できなかったものについての警告とともに出力し、プロジェクトのルートに `strapi-id-map.json` を書き込みます。これは Strapi の ID と新しい Verdin の `documentId` やファイル ID の対応で、フロントエンドのリンクを直すのに使います。

[Strapi からの移行](/ja/migrate/from-strapi/)を参照してください。

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

`verdin export` が書き出したアーカイブ（スキーマファイル、ロケール、メディア、エントリー）をインポートします。

| 引数またはオプション | 説明 |
| --- | --- |
| `<PATH>` | `.tar.gz` のファイル。 |
| `--force` | 内容の異なるスキーマファイルを上書きし、すでにエントリーのあるコンテンツタイプにもインポートします。 |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

プロジェクトのスキーマ、コンテンツ、メディアを `.tar.gz` のアーカイブに書き出します。バックアップとして、または `verdin import verdin` で別のインスタンスにプロジェクトを移す手段として使えます。アーカイブには、すべてのエントリーのすべてのバージョン（下書き、公開バージョン、ロケール）がリレーションとともに入ります。管理者のアカウント、API トークン、設定は含まれません。

| 引数またはオプション | 説明 |
| --- | --- |
| `<OUTPUT>` | 書き出すアーカイブ。 |
| `--no-media` | メディアライブラリ（ファイル、フォルダー、エントリーからのそれらへのリンク）を除外します。 |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

[バックアップ](/ja/deploy/backups/)を参照してください。

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

このマシン上のサーバー（`127.0.0.1`、設定の `[server].port`）に `GET /_health` を問い合わせ、`200` が返ればステータス 0 で、そうでなければ理由を出力してステータス 1 で終了します。シェル、`curl`、HTTP クライアントが不要なので、Docker イメージはこれを `HEALTHCHECK` として使います。Compose や、コマンドを実行する任意のスーパーバイザーでも同じように使ってください。

| オプション | 説明 |
| --- | --- |
| `--port <PORT>` | `[server].port` の代わりにこのポートを確認します。 |

```text title="Terminal"
$ verdin healthcheck
ok
```

[監視](/ja/deploy/monitoring/)を参照してください。

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

`.env` ファイルやプラットフォームのシークレットストアにそのまま使える、新しい `VERDIN_ADMIN_JWT_SECRET` と `VERDIN_TOKEN_PEPPER` を出力します。プロジェクトは読み込みません。

`VERDIN_ADMIN_JWT_SECRET` を変更すると、管理者とエンドユーザーの有効期間の短いアクセストークン、開いているプレビューのリンク、進行中の OAuth ログインが無効になります。管理パネルと、リフレッシュトークンを使うクライアントは、自動で新しいトークンを取得します。`VERDIN_TOKEN_PEPPER` を変更すると、保存されたトークン（API トークンを含む）が無効になるので、使い始めたら変えないでください。

## `verdin version`

```text title="Terminal"
verdin version
```

`verdin --version` と同様に、`verdin` とバージョンを出力します。
