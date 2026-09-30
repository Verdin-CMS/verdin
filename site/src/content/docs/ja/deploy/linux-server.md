---
title: Linux サーバー
description: Debian または Ubuntu のサーバーで、.deb パッケージから Verdin を実行します。systemd のサービス、verdin システムユーザー、/var/lib/verdin の状態を使い、リバースプロキシの背後に置きます。
sidebar:
  order: 3
---

このページでは、コンテナを使わずに、Debian または Ubuntu のサーバー上で、各リリースに添付される `.deb` パッケージから Verdin を直接実行します。他のディストリビューションでも、[インストールスクリプト](/ja/start/installation/)で入れたバイナリと、[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb) のファイルを手でコピーすれば、同じ構成で動きます。

パッケージは 2026-09-30 に `cargo deb` でビルドして内容を確認しましたが、このガイドのために実際のサーバーにインストールしてはいません。

## パッケージがインストールするもの

| パス | 内容 |
| --- | --- |
| `/usr/bin/verdin` | バイナリ（静的。管理パネルを組み込み）。 |
| `/etc/verdin/verdin.toml` | 設定（conffile。アップグレードしても編集内容は保持されます）。 |
| `/etc/verdin/verdin.env` | 初回インストール時に、モード `0640` で作成されます。新しい `VERDIN_ADMIN_JWT_SECRET` と `VERDIN_TOKEN_PEPPER`、そして `VERDIN_DATABASE_URL`（デフォルトは SQLite）が入ります。 |
| `/var/lib/verdin/` | `verdin` システムユーザーのホーム。SQLite のデータベース、`schema/`、`uploads/`、検索インデックス、画像キャッシュ。 |
| `/usr/lib/systemd/system/verdin.service` | サービス。インストールされますが、有効化はされません。 |

サービスは、`verdin` ユーザーとして `verdin -c /etc/verdin/verdin.toml start --migrate` を実行します。systemd のサンドボックス（読み取り専用のシステム、プライベートな `/tmp`、新しい権限の禁止）が適用され、書き込めるのは `/var/lib/verdin` だけです。`127.0.0.1:1337` で待ち受けます。

## 1. インストール

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

ARM のサーバーでは、ファイル名を `arm64` にしてください。

## 2. 設定

1. コミット済みのスキーマを、`verdin` が所有する `/var/lib/verdin/schema/`（`content-types/` と `components/`）にコピーします。

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. PostgreSQL、MySQL、MariaDB を使う場合は、`/etc/verdin/verdin.env` の `VERDIN_DATABASE_URL` を編集します。2 つのシークレットは保持してください。`VERDIN_TOKEN_PEPPER` が新しくなると、すべての API トークンが無効になります。
3. `/etc/verdin/verdin.toml` で、`[server].public_url` をブラウザーが使うアドレスに設定し、リバースプロキシが同じマシンで動く場合は `trusted_proxies = ["127.0.0.1"]` を設定します。その他のキーはすべて[設定のリファレンス](/ja/reference/configuration/)にあります。

## 3. 起動

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

初回の起動でテーブルが作成されます。最初の管理者はコマンドラインから作成します（サービスの環境ファイルにデータベースの URL があります）。

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

または、プロキシ経由で管理パネルを開き、そこで登録します。

## 4. 前面にリバースプロキシを置く

Verdin は、ループバックインターフェースで平文の HTTP を提供します。証明書の取得と更新を自動で行う Caddy を使う場合:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx でも動作します。リアルタイムのイベントが遅延しないように、`/api/_events` ではバッファリングをオフにしてください（`proxy_buffering off;`）。

## アップグレードと削除

- **アップグレード:** 次のリリースの `.deb` を `apt install ./verdin_….deb` でインストールします。サービスが動いていた場合は再起動され、`start --migrate` が安全なマイグレーションを適用します。先に[アップグレード](/ja/migrate/upgrading/)を読んでください。
- **削除:** `apt remove verdin` はサービスを停止しますが、データと設定は残します。`apt purge verdin` は `/etc/verdin/verdin.env`（シークレット）も削除します。`verdin` ユーザーと `/var/lib/verdin` は、パッケージによって削除されることはありません。[バックアップ](/ja/deploy/backups/)を取ってから、自分で削除してください。
