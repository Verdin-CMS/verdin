---
title: 本番環境のチェックリスト
description: Verdin のプロジェクトが実際のトラフィックを受ける前に設定すべきこと。シークレット、データベース、マイグレーション、URL、プロキシ、Cookie、CORS、メディアストレージ、メール、バックアップ、監視を扱います。
sidebar:
  order: 1
---

Verdin のプロジェクトを実際のユーザーに公開する前に、このリストを確認してください。各項目から、それを説明するページにリンクしています。プラットフォームごとのページ（[Docker](/ja/deploy/docker/)、[Fly.io](/ja/deploy/fly/)、[Render](/ja/deploy/render/)、[Railway](/ja/deploy/railway/)、[Kubernetes](/ja/deploy/kubernetes/)）では、可能な範囲でこれらの設定を適用しています。

## 本番用のサーバーを実行する

- [ ] **`verdin dev` ではなく `verdin start` を使います。** `dev` では、コンテンツタイプビルダーがスキーマファイルを書き換え、変更のたびにマイグレーションが適用され、ローカルでの作業のために Cookie と Webhook のルールが緩められます。スキーマは開発環境で変更し、ファイルをコミットして、デプロイしてください。
- [ ] **デプロイ時にマイグレーションを適用します。** データベースがスキーマに追いついていないと、`verdin start` は実行を拒否します。`verdin start --migrate` は、保留中の*安全な*ステップを先に適用します（これが Docker イメージのデフォルトのコマンドです）。risky や destructive なステップ（型の変更、新しい一意制約、カラムの削除）には `verdin migrate apply --allow risky|destructive` が必要で、あなたが一度だけ実行します。[スキーマのマイグレーション](/ja/concepts/schema-migrations/)を参照してください。
- [ ] **スキーマをサーバーと一緒に届けます。** `schema/` ディレクトリを読み取り専用でマウントするか、イメージに組み込んで、実行されるものがコミットしたものと一致するようにします。

## シークレット

- [ ] **必須の 2 つのシークレットを一度だけ生成します。** `verdin secrets` で生成し、プラットフォームのシークレットストアに保管します。`VERDIN_ADMIN_JWT_SECRET` はセッショントークンに署名し、`VERDIN_TOKEN_PEPPER` は API トークンやその他の保存されたシークレットのハッシュの鍵になります。どちらかがないか 32 バイトより短いと、`verdin start` は失敗します。シークレットは環境変数からだけ読み込まれ、`verdin.toml` からは読み込まれません。
- [ ] **値を変えないようにします。** `VERDIN_TOKEN_PEPPER` を変えると、すべての API トークンが使えなくなり、管理者の認証アプリのコードとリカバリーコードも使えなくなります。`VERDIN_ADMIN_JWT_SECRET` を変えると、管理者とエンドユーザーの有効期間の短いアクセストークン、開いているプレビューのリンク、進行中の OAuth ログインが無効になります（管理パネルと、リフレッシュトークンを使うクライアントは、自動でトークンを更新します）。プロジェクトのすべてのインスタンスで同じ値が必要です。
- [ ] 使っている他のシークレットも環境変数に入れます: `VERDIN_EMAIL_SMTP_PASSWORD` または `VERDIN_EMAIL_API_KEY`、`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`、`VERDIN_METRICS_TOKEN`、`VERDIN_SSO_<ID>_SECRET`、`VERDIN_IMAGE_SECRET`。完全な一覧は[設定のリファレンス](/ja/reference/configuration/)にあります。

## データベース

- [ ] **エンジンを選びます。** 一般的な選択肢は PostgreSQL（14 以降）で、[複数のインスタンス](/ja/deploy/scaling/)を実行するならこれを選んでください。MySQL 8.4 以降と MariaDB 10.11 以降も同じように動きます。SQLite は、永続ディスクを持つ単一のインスタンスに向いています。
- [ ] **`VERDIN_DATABASE_URL` を設定します**: `postgres://…`、`mysql://…`（MySQL と MariaDB）、または `sqlite:///data/verdin.db`。TLS が必要な PostgreSQL サーバーでは `?sslmode=require` を付けてください。
- [ ] **プールのサイズを決めます。** 各インスタンスは最大 `[database].pool_max`（10）個の接続を開きます。`インスタンス数 × pool_max` をサーバーの接続数の上限より小さく保ってください。

## URL、プロキシ、Cookie

- [ ] **HTTPS で提供します。** Verdin はプレーンな HTTP を話すので、リバースプロキシ、ロードバランサー、またはプラットフォームのエッジで TLS を終端してください。
- [ ] **`[server].public_url`**（`VERDIN_SERVER__PUBLIC_URL`）を、`https://cms.example.com` のような、ブラウザーが使うアドレスに設定します。メール内のリンク、SSO のコールバック、日次ダイジェスト、パスキーがこれに依存し、パスキーはそのホストに結び付けられます。
- [ ] **`[server].trusted_proxies`** に、リバースプロキシのアドレス（IP または CIDR 範囲）を設定します。そうして初めて、Verdin は `X-Forwarded-For` からクライアントのアドレスを読みます。設定しないと、プロキシの背後にいるすべてのクライアントが、レート制限と監査ログで 1 つのアドレスを共有します。
- [ ] **セキュア Cookie をオンのままにします。** `verdin start` では、管理画面のリフレッシュ Cookie はデフォルトで `Secure` です。`[admin].secure_cookies` は未設定のままにしてください。本番環境で `false` に設定すると、起動時に警告がログに出ます。

## API

- [ ] **公開に必要なものだけを許可します。** コンテンツ API は、公開の権限（**設定 → 公開アクセス**）を許可するか API トークンを作成するまで閉じています。[権限](/ja/concepts/permissions/)を参照してください。
- [ ] 他のオリジンのブラウザーがコンテンツ API や GraphQL を呼び出す場合は、**`[api].cors_origins` を設定します**。例: `["https://www.example.com"]`。設定しないと、ブラウザーから呼び出せるのは同じオリジンのページだけです。Admin API はクロスオリジンのリクエストには一切応答しません。
- [ ] 匿名のトラフィックに対する**レート制限を検討します**: `[api].public_rate_limit` と `[api].token_rate_limit`（1 分あたりのリクエスト数。デフォルトの `0` は無制限）。

## メディア

- [ ] **再デプロイ後も残る場所にアップロードを保存します。** デフォルトのローカルプロバイダーはディスクに書き込むので、永続ボリュームを与えるか、S3 プロバイダー（AWS S3、Cloudflare R2、Backblaze B2、MinIO、Tigris など）を使ってください。ディスクが一時的なプラットフォームや、インスタンスが複数ある場合は S3 を使います。[メディア](/ja/concepts/media/)を参照してください。

## メール

- [ ] **実際のプロバイダーを設定します。** デフォルトの `[email].provider = "log"` はメールをログに書き出し、`verdin start` はそれについて警告します。招待、パスワード再設定、エンドユーザーの確認、コメントのメンション、ダイジェストには、`smtp`、`resend`、`postmark` のいずれかと、プロバイダーが受け付けるアドレスを設定した `[email].from` が必要です。

## バックアップと監視

- [ ] **データベースとメディアストレージを**定期的に**バックアップ**し、リストアを試してください。[バックアップ](/ja/deploy/backups/)を参照してください。
- [ ] **ヘルスチェックを `/_ready` に**、生存確認を `/_health` に向けます。
- [ ] **ログを JSON で出力し**（`[log].format = "json"`、Docker イメージのデフォルト）、標準エラー出力を収集します。
- [ ] Prometheus を使う場合は、`VERDIN_METRICS_TOKEN` を設定して **`/_metrics` をスクレイプします**。[監視](/ja/deploy/monitoring/)を参照してください。

## 公開の前に

- [ ] 最初の起動の直後に、自分で最初の管理者を登録してください。管理者が存在するまでは、`/admin/` に到達できる誰もが Super Admin として登録できます。コマンドラインから `verdin admin create --email …` で作成することもできます。
- [ ] [セキュリティモデル](/ja/deploy/security/)を確認し、Super Admin の[二段階認証](/ja/guides/auth/two-factor/)をオンにしてください。
