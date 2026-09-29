---
title: Railway
description: リポジトリの Dockerfile から Verdin を Railway にデプロイします。Railway の PostgreSQL を使い、メディアは S3 互換ストレージかボリュームに置きます。
sidebar:
  order: 6
---

このページでは、Verdin のプロジェクトを [Railway](https://railway.com) にデプロイします。リポジトリ内の小さな Dockerfile からビルドするサービス、Railway の PostgreSQL データベース、そして S3 互換ストレージ（単一のインスタンスならボリューム）上のメディアで構成します。

:::note
Railway の設定は 2026-09-29 に [Railway のドキュメント](https://docs.railway.com/reference/config-as-code)と照合しましたが、この構成を実際の Railway アカウントにデプロイしてはいません。`# yours` の印が付いた値と山かっこ内の値は、自分の値に置き換えてください。
:::

## 1. Dockerfile、設定、`railway.json` を追加する

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
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

```json title="railway.json"
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/_ready",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

起動コマンドは不要です。イメージは `start --migrate` を実行し、提供を始める前に安全なマイグレーションを適用します。`.env` はリポジトリに入れないでください。

## 2. プロジェクトを作成する

1. Railway で、GitHub のリポジトリからプロジェクトを作成します。Railway は `railway.json` を見つけて Dockerfile をビルドします。
2. プロジェクトに **PostgreSQL** データベースを追加します。
3. Verdin サービスの **Variables** に次を追加します。

   | 変数 | 値 |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}`（データベースサービスのプライベート URL。自分のデータベースサービスの名前を使ってください） |
   | `VERDIN_ADMIN_JWT_SECRET` | `verdin secrets` の出力から |
   | `VERDIN_TOKEN_PEPPER` | `verdin secrets` の出力から |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY` | S3 の認証情報 |

   2 つのシークレットはローカルで生成します。

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. サービスのネットワーク設定で **Generate Domain** をクリックし、ターゲットポートを `1337` に設定します。Verdin は `[server].port` で待ち受け、Railway の `PORT` 変数は読みません。
5. デプロイし、`https://<your-domain>/admin/` を開いて最初の管理者を登録します。

## バリエーション: ボリューム上のメディアや SQLite

単一のインスタンスなら、アップロード、さらにはデータベースも、`/data` にマウントした Railway のボリュームに置けます。

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

PostgreSQL を使わない場合は `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` を設定します。次の点に注意してください。

- ボリュームを持つサービスはレプリカを持てず、再デプロイのたびに短いダウンタイムが発生します。
- Railway は root 所有のボリュームをマウントしますが、イメージは uid `65532` で動きます。サーバーがボリュームに書き込めるように、サービスの変数 `RAILWAY_RUN_UID=0` を設定してください。

## クライアントのアドレス

サービスの前には Railway のエッジプロキシがあります。このガイドではそのアドレス範囲を検証していないので、`[server].trusted_proxies` は空のままです。その場合、レート制限ではすべての訪問者が同じアドレスとして数えられるので、プロキシの範囲を調べて信頼しない限り、`[api].public_rate_limit` は `0` のままにしてください。
