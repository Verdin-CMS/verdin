---
title: Strapi との互換性
description: Verdin が対応している、一部対応している、対応していない Strapi v5 の機能と API。REST、GraphQL、ユーザーと権限、アップロード、i18n、下書きと公開、コードによる拡張、管理パネル、Enterprise の機能を扱います。
sidebar:
  order: 2
---

Verdin は Strapi v5 のコンテンツモデルとコンテンツ API を保っているので、フロントエンドとコンテンツを移行できます（[Strapi からの移行](/ja/migrate/from-strapi/)を参照）。ただし、Strapi の*コードベース*をそのまま置き換えるものではありません。JavaScript のランタイムはないので、独自のコードは WebAssembly のプラグインとして作り直します。このページでは、Verdin 0.10.0 時点での各領域とその状況を一覧にします。

**対応**は Strapi v5 と同じように動きます（違いは備考に記載）。**一部対応**はよくあるケースをカバーし、欠けているものを備考に記載します。**非対応**には対応するものがありません。

## コンテンツモデル

| 機能 | 状況 | 備考 |
| --- | --- | --- |
| コレクションタイプとシングルタイプ | 対応 | Strapi に近い JSON のスキーマファイル（`schema/content-types/*.json`）。[コンテンツモデル](/ja/concepts/content-model/)を参照してください。 |
| スカラーの属性の型 | 対応 | `string`、`text`、`richtext`（Markdown）、`blocks`、`email`、`uid`、`integer`、`biginteger`、`float`、`decimal`、`boolean`、`date`、`time`、`datetime`、`enumeration`、`json`、`password`。Strapi の `timestamp` は `datetime` としてインポートされます。 |
| コンポーネントとダイナミックゾーン | 対応 | コンポーネント内のメディアと `oneWay`/`manyWay` のリレーションを含みます。 |
| リレーション | 対応 | 一対一・一対多・多対一・多対多、一方向と多方向、そしてポリモーフィックな `morphToOne`、`morphToMany`、`morphOne`、`morphMany`。 |
| メディアフィールド | 対応 | 単一または複数、`allowedTypes`。 |
| `unique` | 一部対応 | `text`、`richtext`、`blocks`、`json` の属性では使えません。 |
| 条件付きフィールド（`conditions`） | 対応 | Strapi 5.17 の JSON Logic の条件。非表示のフィールドは必須になりません。 |
| カスタムフィールド | 一部対応 | `customField` 属性は動きます。管理画面の入力欄は、Strapi の React のプラグインではなく Verdin の[プラグイン](/ja/extending/plugins/)から提供されます。 |
| コンテンツタイプビルダー | 対応 | Strapi と同様に、開発モード（`verdin dev`）でのみ使えます。 |

## REST API

| 機能 | 状況 | 備考 |
| --- | --- | --- |
| CRUD のルート | 対応 | `GET`/`POST /api/{pluralName}`、`GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`、シングルタイプは `/api/{singularName}`。レスポンスは `data` と `meta` を持ち、エラーは Strapi の `error` オブジェクトです。 |
| `filters` | 対応 | Strapi のすべての演算子: `$eq`、`$eqi`、`$ne`、`$nei`、`$lt`、`$lte`、`$gt`、`$gte`、`$in`、`$notIn`、`$contains`、`$notContains`、`$containsi`、`$notContainsi`、`$null`、`$notNull`、`$between`、`$startsWith(i)`、`$endsWith(i)`、`$and`、`$or`、`$not`。リレーション、コンポーネント、繰り返し可能なコンポーネント、ダイナミックゾーン（`__component`）を介しても使えます。 |
| `sort` | 対応 | 複数のフィールド、`:asc`/`:desc`、対一リレーションのフィールド（`author.name:asc`）。 |
| `pagination` | 対応 | `page`/`pageSize` または `start`/`limit`、`withCount`。`pageSize` の上限は `[api].max_page_size`（100）です。 |
| `fields` | 対応 | |
| `populate` | 対応 | `*`、リスト、ネストしたオブジェクト、ダイナミックゾーン用の `on`、`count`。深さは最大 5、リレーションごとに populate されるエントリーは最大 1,000 件。 |
| `status` | 対応 | `published`（デフォルト）または `draft`。下書きを読むには `readDrafts` の権限が必要です。 |
| `locale` | 対応 | 下の i18n を参照してください。 |
| `hasPublishedVersion` | 対応 | |
| `_q` による全文検索 | 対応 | Strapi と同様に、テキストフィールドに対する `$containsi`。`[search]` で関連度順の検索。 |
| リレーションの書き込み | 対応 | ID、`connect` / `disconnect` / `set`、`position`（`before`、`after`、`start`、`end`）付き。 |
| 公開、非公開、下書きの破棄 | 対応 | Strapi v5 と同様に、`?status=draft` でない限り書き込みは公開します。Verdin は `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}` を追加しています。 |
| Strapi v4 のレスポンス形式と `publicationState` | 非対応 | Verdin は v5 だけを話します: フラットな属性、`documentId`、`status`。 |
| OpenAPI ドキュメント | 一部対応 | ドキュメントプラグインの `/documentation` の代わりに、`/api/_openapi.json`（デフォルトではトークンのみ）と、`/api/docs` のインタラクティブなリファレンス。 |

## GraphQL

| 機能 | 状況 | 備考 |
| --- | --- | --- |
| クエリ | 対応 | `articles`、`pageInfo` 付きの `articles_connection`、`article(documentId)`、シングルタイプ。`filters`、`sort`、`pagination`、`status`、`locale`。**設定 → 機能 → GraphQL**をオンにするまでオフです。 |
| ミューテーション | 対応 | `status` と `locale` 付きの `create…`、`update…`、`delete…`。 |
| コンポーネント、ダイナミックゾーン、メディア | 対応 | ダイナミックゾーンはユニオン、メディアは `UploadFile`。 |
| ポリモーフィックリレーション | 一部対応 | 型付きのユニオンではなく JSON として返されます。 |
| Shadow CRUD（型ごとの操作の無効化） | 対応 | 機能の `disabled` の設定。 |
| 独自のリゾルバーとスキーマの拡張 | 一部対応 | プラグインが解決するルートのフィールド（`plugin.toml` の `[[graphql]]`）。`extensionService` はありません。 |
| Users & Permissions のミューテーション（`login`、`register`、`me` など） | 非対応 | REST のルートを使ってください。 |
| アップロードと i18n のクエリ・ミューテーション（`uploadFiles`、`i18NLocales` など） | 非対応 | REST のルートと管理パネルを使ってください。 |
| 制限、GraphiQL | 対応 | `maxDepth`、`maxComplexity`、イントロスペクションとプレイグラウンドの切り替え。 |

## Users & Permissions（エンドユーザー）

**設定 → 機能 → ユーザーと権限**をオンにします。[エンドユーザー](/ja/guides/auth/end-users/)を参照してください。

| 機能 | 状況 | 備考 |
| --- | --- | --- |
| `POST /api/auth/local`、`/auth/local/register` | 対応 | リクエストとレスポンスの形は同じです。 |
| メール確認、パスワードの再設定・変更 | 対応 | `/auth/email-confirmation`、`/auth/send-email-confirmation`、`/auth/forgot-password`、`/auth/reset-password`、`/auth/change-password`。 |
| リフレッシュトークン | 対応 | `jwtManagement: "refresh"`、`/auth/refresh`、`/auth/logout`。 |
| `/api/users`、`/users/me`、`/users/count` | 対応 | プレーンな JSON。権限は `plugin::users-permissions.user` に対して。 |
| OAuth プロバイダー | 一部対応 | GitHub、Google、Microsoft、Discord、Facebook、GitLab、LinkedIn と任意の OAuth 2 プロバイダー。Strapi のすべてのプリセットではありません。 |
| ロールと権限のルート（`/api/users-permissions/roles`、`/permissions`） | 非対応 | ロールは**設定 → エンドユーザー**で管理します。 |
| インポートしたユーザー | 対応 | bcrypt のハッシュは引き続き使え、ログイン時に Argon2id で再ハッシュされます。 |

## メディアライブラリとアップロード API

| 機能 | 状況 | 備考 |
| --- | --- | --- |
| `POST /api/upload` | 対応 | マルチパートの `files` と `fileInfo`。`?id=` はファイルの情報を更新し、ファイルが送られればそれを置き換えます。 |
| アップロード時のリンク（`ref`、`refId`、`field`） | 非対応 | アップロードしてから、ファイル ID でメディアフィールドを設定してください。 |
| `GET /api/upload/files`、`/files/{id}`、`DELETE /files/{id}` | 一部対応 | 一覧が受け付けるのは `pagination[page]`、`pagination[pageSize]`、`sort`、`filters[name][$containsi]` だけです。 |
| レスポンシブなフォーマット、ブレークポイント | 対応 | `thumbnail` と `[upload].breakpoints`。 |
| フォルダー、フォーカルポイント、代替テキスト、キャプション | 対応 | |
| アップロードプロバイダー | 一部対応 | ローカルのディスクと S3 互換ストレージ（AWS、R2、B2、MinIO、Tigris など）。Cloudinary などのプロバイダーパッケージはありません。 |
| 画像の変換 | Verdin 独自 | `/uploads/<file>?preset=…` と署名付きの URL（ローカルプロバイダー）。 |

## 国際化

| 機能 | 状況 | 備考 |
| --- | --- | --- |
| 多言語化された型と多言語化されないフィールド | 対応 | `pluginOptions.i18n.localized`。属性ごとにも指定できます。 |
| REST の `?locale=`、GraphQL の `locale` | 対応 | 不明なロケールは `400` です。 |
| レスポンスの `localizations` | 非対応 | 同じ `documentId` と `?locale=` で別のロケールを読んでください。 |
| `GET /api/i18n/locales` | 非対応 | ロケールは管理画面（**設定 → 国際化**）で管理します。 |

## 下書きと公開

| 機能 | 状況 | 備考 |
| --- | --- | --- |
| ドキュメントごとの下書きと公開バージョン | 対応 | ロケールごと。[下書きと公開](/ja/concepts/draft-and-publish/)を参照してください。 |
| 下書きの破棄 | 対応 | |
| 予約公開 | 対応 | [リリース](/ja/guides/content/releases/)を通じて。 |

## サーバーのカスタマイズ

| Strapi | 状況 | Verdin |
| --- | --- | --- |
| ライフサイクルフック、Document Service のミドルウェア | 一部対応 | WebAssembly のプラグインの before/after フック。書き込みを変更したり拒否したりできます。JavaScript はありません。 |
| 独自のコントローラー、サービス、ルート | 一部対応 | `/api/plugins/<name>/` 配下のプラグインのルート。 |
| ポリシーとミドルウェア | 非対応 | 権限とレート制限は組み込まれています。 |
| cron のタスク | 一部対応 | プラグインのジョブ。 |
| JavaScript の Document Service / Entity Service | 非対応 | JavaScript のランタイムはありません。 |
| Strapi のマーケットプレイスの npm のプラグイン | 非対応 | |
| Webhook | 対応 | 署名、再試行、ログ付き。`entry.draft-discard` は `entry.discard-draft` です。[Webhook](/ja/guides/integrations/webhooks/) を参照してください。 |
| API トークン（読み取り専用、フルアクセス、カスタム） | 対応 | 同じ種類、任意の有効期限、再生成。 |
| 転送トークン、`strapi transfer` | 非対応 | `verdin export` と `verdin import verdin` を使ってください。 |
| `strapi export` のファイル | 対応（インポート） | `verdin import strapi`。暗号化されたエクスポートは読めません。 |
| `config/*.js`、`.env` | 一部対応 | `verdin.toml` と環境変数。 |
| TypeScript の型 | 対応 | `verdin types`。 |
| メールのプロバイダー | 一部対応 | SMTP、Resend、Postmark。 |

## 管理パネル

| 機能 | 状況 | 備考 |
| --- | --- | --- |
| コンテンツマネージャー、メディアライブラリ、コンテンツタイプビルダー | 対応 | Strapi の React の管理画面ではなく、独自の Angular のパネルです。 |
| 管理者ユーザー、ロール、カスタムロール | 対応 | Super Admin、Editor、Author が組み込まれており、カスタムロールも作れます。 |
| フィールド単位とロケールの権限 | 対応 | |
| RBAC の条件 | 一部対応 | 組み込みの `is-creator` の条件だけで、独自の条件はありません。 |
| 管理画面のカスタマイズ（`src/admin/app`） | 一部対応 | `[admin.branding]` でロゴ、ファビコン、タイトル、アクセントカラー、テキスト。プラグインによるウィジェットとカスタムフィールド。独自のページ、インジェクションゾーン、React の拡張はありません。 |
| Admin API（`/admin/…`） | 非対応 | Verdin の Admin API は独自のものです。Strapi のものを前提にしないでください。 |
| 編集ビューと一覧ビューの設定 | 対応 | |

## Enterprise の機能

Verdin ではすべてがオープンソースです。以下は Strapi では Enterprise または有料の機能です。

| Strapi の機能 | 状況 | 備考 |
| --- | --- | --- |
| SSO | 一部対応 | グループからロールへのマッピング付きの OpenID Connect プロバイダー。SAML などの passport のストラテジーはありません。[シングルサインオン](/ja/guides/auth/sso/)を参照してください。 |
| 監査ログ | 対応 | [監査ログ](/ja/guides/content/audit-logs/)を参照してください。 |
| レビューワークフロー | 対応 | 段階ごとのロールが、その段階*へ*エントリーを移動できる人を制限し、公開に必要な段階はすべての API に適用されます。[レビューワークフロー](/ja/guides/content/review-workflows/)を参照してください。 |
| リリース | 対応 | 予約または即時。 |
| コンテンツ履歴 | 対応 | ドキュメントごとに `[history].max_versions` 個のバージョン。 |
| プレビューとライブプレビュー | 対応 | 有効期間の短いトークンによるプレビューの URL、左右に並べたプレビュー、[ビジュアル編集](/ja/guides/frontend/visual-editing/)。 |
| カスタムの管理者ロール | 対応 | 数に制限はありません。 |
