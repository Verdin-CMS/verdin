---
title: Render
description: Blueprint を使って Verdin を Render にデプロイします。リポジトリからビルドする Docker の Web サービス、Render の PostgreSQL データベース、S3 互換ストレージまたはディスク上のメディアで構成します。
sidebar:
  order: 5
---

このページでは、Blueprint（`render.yaml`）を使って Verdin のプロジェクトを [Render](https://render.com) にデプロイします。リポジトリ内の小さな Dockerfile からビルドする Web サービスと、Render の PostgreSQL データベースで構成します。Render のファイルシステムは一時的なので、メディアは S3 互換ストレージに置きます。インスタンスが 1 つなら永続ディスクにも置けます。

:::note
Blueprint の形式は 2026-09-29 に [Render の Blueprint のリファレンス](https://render.com/docs/blueprint-spec)と照合しましたが、実際の Render アカウントにデプロイしてはいません。`# yours` の印が付いた値は、自分の値に置き換えてください。
:::

前提条件: Render が読める Git リポジトリにある Verdin のプロジェクト（`schema/` を含む）。

## 1. Dockerfile と設定を追加する

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337

[schema]
path = "schema"

[log]
format = "json"

[upload]
# Cloudflare R2 as an example; any S3-compatible service works.
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

`.env` はリポジトリにもイメージにも入れないでください（`.dockerignore`）。

## 2. `render.yaml` を書く

```yaml title="render.yaml"
services:
  - type: web
    name: verdin
    runtime: docker
    repo: https://github.com/<you>/<your-project>   # yours
    branch: main
    dockerfilePath: ./Dockerfile
    region: frankfurt                               # yours
    healthCheckPath: /_ready
    envVars:
      - key: VERDIN_DATABASE_URL
        fromDatabase:
          name: verdin-db
          property: connectionString
      - key: VERDIN_ADMIN_JWT_SECRET
        generateValue: true
      - key: VERDIN_TOKEN_PEPPER
        generateValue: true
      - key: VERDIN_SERVER__PUBLIC_URL
        value: https://verdin.onrender.com          # yours: the service URL or your domain
      - key: AWS_ACCESS_KEY_ID
        sync: false                                 # asked for when you create the Blueprint
      - key: AWS_SECRET_ACCESS_KEY
        sync: false

databases:
  - name: verdin-db
    databaseName: verdin
    user: verdin
    region: frankfurt                               # yours: the same region
    postgresMajorVersion: "17"
```

インスタンスの種類を選ぶには、サービスとデータベースに `plan` を追加します（Render の料金ページを参照）。指定しない場合、Render はデフォルトを使います。

`generateValue: true` は、Blueprint を最初に適用したときに各シークレットを一度だけ作成し、その後も保持します。再生成しないでください。新しい `VERDIN_TOKEN_PEPPER` にすると、すべての API トークンが使えなくなります。

## 3. デプロイする

1. Render のダッシュボードで、リポジトリから **Blueprint** を作成し、`sync: false` の変数に値を入力します。
2. 最初のデプロイが終わるのを待ちます。イメージのデフォルトのコマンド `start --migrate` は、最初の起動でテーブルを作成し、その後のデプロイでは安全なマイグレーションを適用します。
3. `https://<service>.onrender.com/admin/` を開いて、最初の管理者を登録します。

Render はインスタンスを停止する前に `SIGTERM` を送ります。Verdin はそれを受けて処理を終え、終了します。

## バリエーション: ディスク上のメディア

単一のインスタンスなら、S3 の代わりに Render の永続ディスクにアップロードを保存できます。`verdin.toml` でローカルプロバイダーを設定します。

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

そして、サービスにディスクを追加します。

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

ディスクを使うと、Render ではサービスを複数のインスタンスにスケールできず、デプロイでは新しいインスタンスが起動する前に古いインスタンスが停止するので、デプロイのたびに短いダウンタイムが発生します。Render のデータベースを使いたくない場合は、同じディスクに SQLite のデータベース（`sqlite:///data/verdin.db`）を置くこともできます。イメージのユーザー（uid `65532`）がディスクに書き込めることを確認してください。起動が `/data` の権限エラーで失敗する場合は、`Dockerfile` に `USER root` を追加します。

## クライアントのアドレス

サービスの前には Render のプロキシがあります。このガイドではそのアドレス範囲を検証していないので、`[server].trusted_proxies` は空のままにしています。その場合、レート制限ではすべての訪問者が同じアドレスとして数えられるので、プロキシの範囲を調べて信頼しない限り、`[api].public_rate_limit` は `0` のままにしてください。
