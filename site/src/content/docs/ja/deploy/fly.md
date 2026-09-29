---
title: Fly.io
description: 独自のイメージ、PostgreSQL、Tigris のオブジェクトストレージを使って Verdin を Fly.io にデプロイします。ボリューム上の SQLite を使う 1 台の Machine でも構成できます。
sidebar:
  order: 4
---

このページでは、公式イメージの上にビルドした小さなイメージとして、Verdin のプロジェクトを [Fly.io](https://fly.io) にデプロイします。推奨する構成では Machine に状態を持たせません。データベースには PostgreSQL、メディアには Tigris（Fly の S3 互換ストレージ）を使います。その後に、ボリューム上の SQLite を使うバリエーションを紹介します。

:::note
Fly の形式は 2026-09-29 に [Fly のドキュメント](https://docs.fly.io/reference/configuration/)と照合しましたが、この構成を実際の Fly アカウントで動かしてはいません。山かっこ内の値と `# yours` の印が付いた値は、自分の値に置き換えてください。
:::

前提条件: ログイン済みの [`flyctl`](https://docs.fly.io/flyctl/install/) と、`schema/` ディレクトリをコミットした Verdin のプロジェクト。

## 1. Dockerfile と設定を追加する

プロジェクトのディレクトリに、設定とスキーマを公式イメージにコピーする `Dockerfile` を追加します（[独自のイメージ](/ja/deploy/docker/)を参照）。

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

さらに Fly 用の `verdin.toml` を追加します。

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://my-verdin.fly.dev"       # yours: the app's URL or your domain

[schema]
path = "schema"

[log]
format = "json"

[upload]
provider = { name = "s3", bucket = "my-verdin-media",   # yours: the bucket name
             region = "auto", endpoint = "https://t3.storage.dev",
             public_url = "https://my-verdin-media.t3.tigrisfiles.io" }
```

`.env` がビルドコンテキストに入らないようにしてください。`.dockerignore` に追加します。

## 2. `fly.toml` を書く

```toml title="fly.toml"
app = "my-verdin"                # yours
primary_region = "fra"           # yours

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 1337
  force_https = true
  # Keep a Machine running: webhooks, scheduled releases, plugin jobs and the
  # daily digest run inside the server process.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "30s"
    interval = "15s"
    method = "GET"
    timeout = "5s"
    path = "/_ready"

[[vm]]
  memory = "512mb"               # adjust to your content and traffic
```

イメージのデフォルトのコマンド `start --migrate` が、各 Machine の起動時に安全なマイグレーションを適用するので、`release_command` は不要です（Fly は `release_command` をボリュームのない一時的な Machine で実行するので、いずれにせよ SQLite では動きません）。

## 3. アプリ、データベース、バケットを作成する

1. デプロイせずにアプリを作成します。`--ha=false` で 1 台の Machine から始めます。台数を増やす前に[複数のインスタンスの実行](/ja/deploy/scaling/)を読んでください。

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. PostgreSQL のデータベースを作成し（たとえば [Fly Managed Postgres](https://docs.fly.io/mpg/) や任意の PostgreSQL プロバイダーで）、接続 URL を控えておきます。

3. 公開の Tigris バケットを作成します。このコマンドは `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_ENDPOINT_URL_S3`、`BUCKET_NAME` をアプリのシークレットとして設定します。Verdin が読むのは最初の 2 つです。バケット名は `verdin.toml` に書いてください。

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Verdin のシークレットとデータベースの URL を設定します。

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. デプロイしてから `https://<app>.fly.dev/admin/` を開き、最初の管理者を登録します。

   ```sh frame="terminal"
   fly deploy
   ```

## クライアントのアドレスとレート制限

Fly のプロキシはクライアントを `X-Forwarded-For` に追加します。[Fly のリクエストヘッダーのドキュメント](https://docs.fly.io/networking/request-headers/)によれば、一番右のアドレスはアプリ自身の IP です。Verdin がクライアントを特定できるように、プロキシの範囲とアプリのアドレス（`fly ips list`）を信頼してください。

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

これは稼働中のアプリでは検証していません。確認が済むまでは `[api].public_rate_limit` を `0` のままにしてください。正しいプロキシが設定されていないと、すべての訪問者が同じアドレスとして数えられます。

## バリエーション: SQLite を使う 1 台の Machine

小さなプロジェクトなら、データベースとアップロードを Fly のボリュームに置くこともできます。

- `verdin.toml` の `[upload]` に `provider = { name = "local", dir = "/data/uploads" }` を設定し（デフォルトのディレクトリは `/app` からの相対パスで、サーバーは書き込めません）、`VERDIN_DATABASE_URL=sqlite:///data/verdin.db` をシークレットとして設定します。
- `/data` にボリュームをマウントします。

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Machine はちょうど 1 台だけ実行します（`fly scale count 1`）。ボリュームは 1 台の Machine にしか接続できず、SQLite は共有できません。
- Fly は root 所有のボリュームを作成しますが、イメージは uid `65532` で動きます。起動が `/data` の権限エラーで失敗する場合は、`Dockerfile` に `USER root` を追加してください。

ボリュームをバックアップしてください。Fly はボリュームのスナップショットを毎日保持し、`verdin export` を使えばポータブルなアーカイブが得られます（[バックアップ](/ja/deploy/backups/)を参照）。
