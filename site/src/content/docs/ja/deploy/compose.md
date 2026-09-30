---
title: 本番環境での Docker Compose
description: 1 台のサーバー向けの本番用 Compose のレシピです。Verdin、PostgreSQL、自動 HTTPS の Caddy と、S3 互換のメディア用の任意の RustFS を使います。
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) は、1 台のサーバー向けのすぐに使える構成です。Verdin と PostgreSQL をプライベートネットワークに置き、前面に Caddy を置いて、証明書の取得と更新を自動で行います。オーバーライドファイルを使うと、同じホスト上の S3 互換ストアである RustFS をメディア用に追加できます。これらのファイルが使うイメージは [Docker](/ja/deploy/docker/) で説明しています。

ファイルは 2026-09-30 に `docker compose config` と `caddy validate` で確認しました。

## ファイル

| ファイル | 内容 |
| --- | --- |
| `compose.yaml` | `verdin`、`db`（PostgreSQL 17）、`caddy`。ポートを公開するのは Caddy だけです（80、443、HTTP/3 用の 443/udp）。 |
| `compose.s3.yaml` | `rustfs` と、公開読み取りの `media` バケットを作る 1 回限りのジョブを追加し、Verdin のアップロードプロバイダーをそれに切り替えます。 |
| `Caddyfile` | `$VERDIN_DOMAIN` の TLS、圧縮、`/media/*` を RustFS へ、それ以外を Verdin へ。 |
| `.env.example` | Compose が読む変数。ドメイン、ACME のメールアドレス、イメージのタグ、パスワード。 |

## セットアップ

前提: Docker のあるサーバー、そのサーバーを指すドメインの DNS レコード、開放された 80 番と 443 番のポート。

1. ディレクトリをサーバーにコピーし、`.env` を埋めます。

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. コミット済みのスキーマを `schema/`（`content-types/` と `components/`）に置きます。`/app/schema` に読み取り専用でマウントされます。
3. 起動します。

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. `https://<your domain>/admin/` を開き、最初の管理者を登録します。

`.env` と `verdin.env` はバージョン管理に含めず、バックアップを取ってください。`VERDIN_TOKEN_PEPPER` が新しくなると、すべての API トークンが無効になります。

## S3 のメディア

デフォルトでは、アップロードは `verdin-data` ボリュームに保存されます。代わりに RustFS に保存するには:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

ファイルは、Caddy が `https://<your domain>/media/<key>` で提供します。AWS S3、Cloudflare R2、その他のプロバイダーを使う場合は、RustFS のサービスを含めず、`VERDIN_UPLOAD__PROVIDER__*` 変数と `AWS_*` の認証情報をそのプロバイダーの値に設定してください（[ストレージ](/ja/internals/storage/)を参照）。既存のサイトを切り替えてもファイルは移動しません。新しいアップロードが新しいプロバイダーに保存されます。

## 注意点

- **クライアントのアドレス。** Verdin は、Caddy が唯一のプロキシである Compose のネットワーク（`172.30.0.0/24`、`compose.yaml` で固定）からの `X-Forwarded-For` を信頼します。その範囲が手元のネットワークと衝突する場合は、両方を変更してください。
- **リアルタイム。** Caddy は `text/event-stream` のレスポンスをバッファリングせずにストリーミングするので、[リアルタイムのイベント](/ja/guides/frontend/realtime/)はそのまま動作します。
- **アップグレード。** `.env` の `VERDIN_VERSION` を変更し、`docker compose pull && docker compose up -d` を実行します。先に[アップグレード](/ja/migrate/upgrading/)を読んでください。
- **バックアップ。** PostgreSQL をダンプし、`verdin-data` ボリューム（またはバケット）を保管してください。[バックアップ](/ja/deploy/backups/)を参照してください。
- **管理コマンド。** イメージにシェルはありません。`docker compose exec verdin verdin admin create --email you@example.com` を使います。
