---
title: "Admin API"
description: "自動化のための、Verdin の管理パネルを支える API。ログイン、セッション、規約、主なルートグループを説明します。"
sidebar:
  order: 4
  label: "Admin"
---

管理パネルは Admin API のクライアントで、Admin API は `{admin.path}/api`（デフォルトは `/admin/api`）で提供されます。パネルでできることはすべてスクリプトからも実行できます。管理者や API トークンの作成、Webhook や機能の設定、ロケールの管理、下書きやリリースの操作などです。このページでは認証方法を説明し、ルートグループを一覧にします。

:::caution[安定性]
Admin API は Verdin 1.0 まで安定性が保証されません。マイナーリリースでルートやボディが変わることがあり、チェンジログにもすべての変更が載るわけではありません。コンテンツの読み書きには、[API トークン](/ja/guides/auth/api-tokens/)を使った [REST](/ja/api/rest/) または [GraphQL](/ja/api/graphql/) API を使ってください。すべての API の安定性に関する取り決めは 1.0 で予定しています。
:::

## ログイン

Admin API にはまだ API トークンがありません。スクリプトは管理者ユーザーとしてログインします。そのスクリプトに必要な操作だけを許可するロールのユーザーが理想です。

```sh title="Terminal"
curl -s -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@example.com","password":"…"}'
```

```json
{
  "data": {
    "user": { "id": 3, "email": "bot@example.com", "…": "…" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresAt": "2026-09-29T10:15:00.000Z"
  }
}
```

以降のすべてのリクエストでアクセストークンを送ります。

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| 認証情報 | 有効期間 | 場所 |
| --- | --- | --- |
| アクセストークン（JWT） | 15 分 | レスポンスボディ。`Authorization: Bearer …` として送ります。 |
| リフレッシュトークン | 30 日 | `verdin_refresh` Cookie（`HttpOnly`、`SameSite=Strict`、パス `/admin/api/auth`、`verdin start` では `Secure`）。 |

新しいアクセストークンを得るには、Cookie と `X-Verdin-CSRF` ヘッダー（値は任意）を付けて `POST /admin/api/auth/refresh` を呼びます。ログインと同じ形で応答し、リフレッシュトークンをローテーションします。使用済みのリフレッシュトークンを再び送るとセッション全体が終了するので、新しい Cookie を保存してください。同じヘッダーを付けた `POST /admin/api/auth/logout` でセッションを終了します。

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **二段階認証。** 第二要素を設定したアカウントでは、ログインは `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }` を返します。`POST /admin/api/auth/login/two-factor` に `{ "twoFactorToken": "…", "code": "123456" }`（TOTP またはリカバリーコード）を送って完了します。[二段階認証](/ja/guides/auth/two-factor/)を参照してください。
- **レート制限。** ログインと登録は、クライアント IP ごとに `[admin].auth_rate_limit`（デフォルトは 1 分あたり 20 回）で制限されます。リフレッシュの上限はそれより大きくなっています。
- **失敗。** 認証情報の誤り、存在しないアカウント、ロックされたアカウントは、いずれも `400 Invalid credentials` を返します。パスワードを 5 回間違えると、アカウントは 15 分間ロックされます。
- **最初の管理者。** 新しいインスタンスでは、`POST /admin/api/auth/register-first-admin` が Super Admin を作成します。管理者が 1 人もいない間だけ使えます。コマンドラインからは `verdin admin create` で同じことができます。

## 規約

- ボディとレスポンスは JSON です。レスポンスは結果を `data` で包みます（`{ "data": … }`）。コンテンツのルートは REST API と同様に `meta` も返します。
- コンテンツのルートは REST API と同様に `{ "data": { … } }` 形式のボディを受け取ります。設定のルートはプレーンな JSON オブジェクトを受け取ります。
- エラーは [REST のエラー形式](/ja/api/rest/#エラー)です。無効になっている機能のルートは `404` を返します。ロールで二段階認証が必須の管理者は、設定を済ませるまで `403 TwoFactorRequiredError` を受け取ります。
- 各ルートは管理者の[権限](/ja/concepts/permissions/)を確認します。コンテンツのルートはその型に対するコンテンツ操作を、設定のルートはそれぞれの設定操作を確認します。
- Admin API はクロスオリジンのリクエストには一切応答しません。他のサイトのページからではなく、サーバーやスクリプトから呼び出してください。
- 成功した変更は[監査ログ](/ja/guides/content/audit-logs/)に記録されます。

## 一覧

設定の一覧は `page`（1 から）と `pageSize` でページ分割されます。レスポンスにはそのページの行と件数が含まれます。

```json
{ "data": [ … ], "meta": { "pagination": { "page": 2, "pageSize": 25, "total": 60, "pageCount": 3 } } }
```

| 一覧 | デフォルトのページサイズ（最大） | 順序 | その他のパラメーター |
| --- | --- | --- | --- |
| `GET /users`、`GET /roles`、`GET /api-tokens` | 25（100） | 古い順 | |
| `GET /webhooks` | 25（100） | 古い順 | `meta.events` に、Webhook が購読できるイベントが入ります |
| `GET /webhooks/{id}/deliveries` | 25（100） | 新しい順 | |
| `GET /releases` | 25（100） | 新しい順 | `status`（`pending`、`running`、`done`、`failed`） |
| `GET /site/redirects` | 25（100） | ソース順 | `search` はソースまたは宛先に一致します |
| `GET /site/menus`、`GET /site/forms` | 25（100） | 名前順 | |
| `GET /site/forms/{id}/submissions` | 25（100） | 新しい順 | |
| `GET /deploy/targets` | 25（100） | 古い順 | |
| `GET /deploy/deployments` | 25（100） | 新しい順 | `targetId`。`limit` は `pageSize` の非推奨のエイリアスです |
| `GET /end-users` | 25（100） | 新しい順 | `search` はユーザー名またはメールアドレスに一致します |
| `GET /audit-logs` | 50（200） | 新しい順 | [監査ログ](/ja/guides/content/audit-logs/)を参照 |

最大値より大きい `pageSize` は最大値に下げられます。一覧全体を読むには、`page` が `pageCount` に達するまでページをリクエストしてください。

```sh title="Terminal"
curl 'https://cms.example.com/admin/api/site/redirects?page=1&pageSize=100' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

コンテンツのルートは REST API と同様に、`pagination[page]` と `pagination[pageSize]` でページ分割します。

## ルートグループ

パスは `/admin/api` からの相対パスです。ルーターは [`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs) と、その隣にある `*_admin.rs` モジュールにあります。

| グループ | ルート | 権限 |
| --- | --- | --- |
| ログインとアカウント | `GET /auth/status`、`POST /auth/login`、`/auth/refresh`、`/auth/logout`、`GET /auth/me`、`GET\|PUT /users/me`、`GET /auth/sessions`、`DELETE /auth/sessions/{id}`、`/auth/*` 配下の招待とパスワード再設定 | ログイン済み（ログイン用のルートは公開） |
| 二段階認証 | `/auth/two-factor/*`、`POST /auth/login/two-factor`、`POST /auth/login/passkey/options`、`DELETE /users/{id}/two-factor` | ログイン済み。他の管理者のリセットには `users.manage` |
| SSO | `GET /auth/sso`、`GET /auth/sso/{id}`、`GET /auth/sso/{id}/callback` | 公開 |
| 管理者ユーザー | `GET\|POST /users`、`GET\|PUT\|DELETE /users/{id}`、`POST /users/{id}/invite` | `users.manage` |
| ロールと公開アクセス | `GET\|POST /roles`、`GET\|PUT\|DELETE /roles/{id}`、`GET\|PUT /public-permissions` | `roles.manage` |
| API トークン | `GET\|POST /api-tokens`、`GET\|PUT\|DELETE /api-tokens/{id}`、`POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| スキーマ | `GET /content-types`、`GET /components`、`GET\|PUT\|DELETE /content-types/{uid}/edit-view`。`verdin dev` でのみ `GET /schema`、`POST /schema/plan`、`POST /schema/apply` | ログイン済み。編集ビューには `views.manage`、ビルダーには `schema.manage` |
| コンテンツ | `GET\|POST /content/{uid}`、`GET\|PUT\|DELETE /content/{uid}/{documentId}`、`POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`、`POST …/clone`、`GET …/locales`、`GET …/usage`、`GET /content/{uid}/uid-available`、`GET /content/{uid}/stats` | `{uid}` に対するコンテンツ操作 |
| インポートとエクスポート | `GET /content/{uid}/export`、`POST /content/{uid}/import` | `{uid}` に対するコンテンツ操作 |
| 履歴 | `GET /history/{uid}/{documentId}`、`GET /history/versions/{id}`、`POST /history/versions/{id}/restore` | その型に対するコンテンツ操作 |
| リリース | `GET\|POST /releases`、`GET\|PUT\|DELETE /releases/{id}`、`POST /releases/{id}/actions`、`DELETE /releases/{id}/actions/{actionId}`、`POST /releases/{id}/publish` | `releases.manage` |
| レビューワークフロー | `GET\|POST /review-workflows`、`GET\|PUT\|DELETE /review-workflows/{id}`、`GET\|PUT /content/{uid}/{documentId}/review`、`GET /review/*` | 設定には `workflows.manage` |
| メディア | `POST /upload`、`POST /upload/from-url`、`GET /upload/files`、`GET\|PUT\|DELETE /upload/files/{id}`、`POST /upload/files/{id}/replace`、`GET /upload/files/{id}/usage`、`/upload/folders…` | `media.*` |
| ロケール | `GET\|POST /i18n/locales`、`PUT\|DELETE /i18n/locales/{code}` | 変更には `locales.manage` |
| Webhook | `GET\|POST /webhooks`、`GET\|PUT\|DELETE /webhooks/{id}`、`POST\|DELETE /webhooks/{id}/secret`、`POST /webhooks/{id}/trigger`、`GET /webhooks/{id}/deliveries`、`POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| エンドユーザー | `GET\|POST /end-users`、`GET\|PUT\|DELETE /end-users/{id}`、`GET\|POST /end-user-roles`、`PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| 機能 | `GET /features`、`PUT /features/{id}`、`POST /email/test` | 変更には `features.manage` |
| プラグイン | `GET /plugins`、`GET /plugins/extensions`、`PUT /plugins/{name}`、`GET /plugins/{name}/logs` | `plugins.manage` |
| デプロイと CDN | `/deploy/targets…`、`GET /deploy/deployments`、`GET /deploy/cdn`、`POST /deploy/cdn/purge` | `deploy.manage`。実行には `deploy.trigger` |
| サイト | `/site/redirects…`、`/site/menus…`、`/site/forms…` とフォームの送信内容 | `site.manage` |
| コラボレーション | `/comments…`、`/tasks…`、`/engagement/*`、`/polls…` | エントリーの型に対する読み取り権限 |
| リアルタイム | `GET /events`、`GET\|POST /presence` | [リアルタイム API](/ja/api/realtime/#管理画面ストリーム) を参照 |
| AI | `GET /ai`、`POST /ai/translate`、`/ai/alt-text`、`/ai/summarize`、`/ai/seo` | [AI アクション](/ja/guides/integrations/ai-actions/)を参照 |
| 監査ログ | `GET /audit-logs` | `audit.read` |
| システム | `GET /system/info`（バージョン、データベース、モード） | ログイン済み |

## コンテンツのルート

コンテンツのルートは REST API と同じ Document Service を、管理者向けのルールで実行します。

- `{uid}` は `api::article` のような、コンテンツタイプの UID です。
- 読み取りは、`status=published` を渡さない限り**下書き**を返します。REST の[クエリパラメーター](/ja/api/rest/#クエリパラメーター)に加えて、最後の変更以降にその管理者が開いていないドキュメントを返す `unseen=true` を受け付けます。
- 書き込みは下書きだけを保存します。公開は常に明示的な操作です。
- 書き込みでは、その管理者が作成者または最終編集者として記録されます。管理者のロールによるフィールド、ロケール、`is-creator` の制限が読み取りと書き込みに適用されます。

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
