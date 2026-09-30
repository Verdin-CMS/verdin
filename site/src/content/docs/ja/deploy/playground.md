---
title: ホスト型プレイグラウンド
description: Verdin の公開デモを実行します。デモ用のコンテンツとデモアカウントを持つ SQLite 上のブログのサンプルを、1 時間ごとに消去して再びシードします。deploy/playground を使います。
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground) は、公開デモ用のコンテナをビルドします。SQLite 上の[ブログのサンプル](https://github.com/verdin-cms/verdin/tree/main/examples/blog)に、公開済みの記事がいくつかと、訪問者がサインインできるデモアカウントが付きます。1 時間ごとにデータベースを破棄して、最初からやり直します。コンテナにはボリューム、データベースサーバー、ユーザーが用意するシークレットは不要です。どこにホストするかは自由で、公開 HTTPS アドレスで 1 つのコンテナを実行できるプラットフォームならどれでも動きます。

スクリプトは、2026-09-30 にローカルのビルドに対して実行しました（リセットのサイクルを 3 回）。イメージはビルドしましたが、公開済みのリリースからは実行していません。

## 訪問者が得られるもの

- `/admin/` の管理パネル。**demo@example.com** / **verdin-demo-1234** でサインインした状態です。このアカウントは **Editor** ロールで、コンテンツの作成、編集、公開、削除とメディアのアップロードはできますが、ユーザー、ロール、API トークン、Webhook、設定の管理はできません。
- REST（`/api/articles?populate=*`）と GraphQL による、記事、カテゴリー、タグ、ホームページの公開読み取りアクセス。
- 公開済みの記事 2 件、下書き 1 件、カテゴリー 2 件、タグ 2 件、ホームページ。

Super Admin も存在しますが、誰も知らないランダムなパスワードが設定されています。

## 仕組み

`run.sh` は次をループします。

1. `/var/lib/verdin-playground`（データベース、アップロード、検索インデックス、画像キャッシュ）を削除し、新しいシークレットを生成します。これにより、前のサイクルのセッションは終了します。
2. `verdin start --migrate` を起動し、`/_ready` を待ちます。
3. `seed.sh` を実行します。CLI と Admin API でアカウントを作成し、公開読み取りアクセスを開き、コンテンツを作成します。
4. `PLAYGROUND_RESET_SECONDS`（3600）だけ待ってからサーバーを停止し、最初からやり直します。サーバーが自分で停止した場合は、すぐにやり直します。

設定（`deploy/playground/verdin.toml`）は、アップロードを 2 MB に制限し、匿名のリクエストをアドレスごとに 1 分あたり 300 件にレート制限し、Webhook の配信をプライベートアドレスに向けさせず、検索を有効にします。

## ビルドして実行する

リポジトリのルートから:

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

イメージは、`curl` と `jq`（スクリプトにはシェルが必要ですが、公式イメージにはありません）を入れた Alpine に、`ghcr.io/verdin-cms/verdin` からコピーした静的なバイナリを載せたものです。リリースを選ぶには、`--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>` を渡します。`tmpfs` はデータをメモリに保持します。なくても、データはコンテナのファイルシステムに置かれるので、動作します。

| 変数 | デフォルト | 内容 |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | リセットの間隔。 |
| `PLAYGROUND_EMAIL`、`PLAYGROUND_PASSWORD` | `demo@example.com`、`verdin-demo-1234` | デモアカウント。 |
| `VERDIN_SERVER__PUBLIC_URL` | | プレイグラウンドの公開アドレス。 |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | プラットフォームのプロキシの範囲。レート制限が訪問者ごとに適用されるようにします。 |

## ホストする

インスタンスはちょうど 1 つだけ実行し（データベースがローカルにあるため）、動かし続け（ゼロへのスケールダウンは不可。リセットのタイマーはプロセスの中にあります）、前面に HTTPS を置いてください。`start` モードでは、管理パネルのセッション Cookie が `Secure` なので、サインインには HTTPS が必要です。誰でも最大 1 時間、コンテンツを書き込み、画像をアップロードできるので、そこへリンクするページにはリセットのスケジュールを案内し、Cookie を共有する他のものとは別のドメインでインスタンスを動かしてください。
