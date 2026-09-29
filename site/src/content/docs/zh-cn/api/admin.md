---
title: "管理 API"
description: "Verdin 管理后台背后的 API，可用于自动化：登录、会话、约定以及主要的路由分组。"
sidebar:
  order: 4
  label: "管理"
---

管理后台是管理 API 的一个客户端，该 API 位于 `{admin.path}/api` 下（默认为 `/admin/api`）。管理后台能做的一切，脚本也能做：创建管理员和 API 令牌、配置 webhook 和功能、管理语言区域，或者处理草稿和发布计划。本页介绍如何进行身份验证，并列出各个路由分组。

:::caution[稳定性]
在 Verdin 1.0 之前，管理 API 不提供稳定性保证：路由和请求体可能在次版本中变化，更新日志也不会列出每一处变更。读写内容时，请优先使用 [REST](/zh-cn/api/rest/) 或 [GraphQL](/zh-cn/api/graphql/) API，并配合 [API 令牌](/zh-cn/guides/auth/api-tokens/)。所有 API 的稳定性约定计划在 1.0 中推出。
:::

## 登录

管理 API 目前还没有 API 令牌：脚本以管理员用户身份登录，最好使用一个角色只允许脚本所需操作的账户。

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

之后的每个请求都要带上访问令牌：

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| 凭据 | 有效期 | 位置 |
| --- | --- | --- |
| 访问令牌（JWT） | 15 分钟 | 响应体。以 `Authorization: Bearer …` 的形式发送。 |
| 刷新令牌 | 30 天 | `verdin_refresh` cookie（`HttpOnly`、`SameSite=Strict`、路径 `/admin/api/auth`，在 `verdin start` 下为 `Secure`）。 |

要获取新的访问令牌，请带上该 cookie 和 `X-Verdin-CSRF` 请求头（任意值）调用 `POST /admin/api/auth/refresh`。它的响应与登录相同，并会轮换刷新令牌：请保存新的 cookie，因为再次出示已使用过的刷新令牌会结束整个会话。带上同样的请求头调用 `POST /admin/api/auth/logout` 即可结束会话。

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **双因素认证。** 对于设置了第二因素的账户，登录会返回 `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`。使用 `POST /admin/api/auth/login/two-factor` 和 `{ "twoFactorToken": "…", "code": "123456" }`（TOTP 或恢复码）完成登录。参见[双因素认证](/zh-cn/guides/auth/two-factor/)。
- **速率限制。** 登录和注册按客户端 IP 受 `[admin].auth_rate_limit` 限制（默认每分钟 20 次）；刷新的额度更大。
- **失败。** 凭据错误、账户不存在和账户被锁定都会返回 `400 Invalid credentials`。连续五次输错密码会将账户锁定 15 分钟。
- **第一个管理员。** 在全新实例上，`POST /admin/api/auth/register-first-admin` 会创建 Super Admin；它只在还没有任何管理员时可用。`verdin admin create` 在命令行中完成同样的操作。

## 约定

- 请求体和响应均为 JSON。响应把结果包裹在 `data` 中（`{ "data": … }`）；与 REST API 一样，内容路由还会返回 `meta`。
- 与 REST API 一样，内容路由接受 `{ "data": { … } }` 形式的请求体。设置类路由接受普通的 JSON 对象。
- 错误采用 [REST 错误格式](/zh-cn/api/rest/#错误)。已关闭的功能的路由返回 `404`。如果管理员的角色要求双因素认证，在完成设置之前会收到 `403 TwoFactorRequiredError`。
- 每个路由都会检查管理员的[权限](/zh-cn/concepts/permissions/)：内容路由检查该类型上的内容操作，设置类路由检查对应的设置操作。
- 管理 API 从不响应跨源请求：请从服务器或脚本调用它，而不要从其他网站的页面调用。
- 成功的变更会记录在[审计日志](/zh-cn/guides/content/audit-logs/)中。

## 路由分组

路径相对于 `/admin/api`。路由器位于 [`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs) 及其旁边的 `*_admin.rs` 模块中。

| 分组 | 路由 | 权限 |
| --- | --- | --- |
| 登录与账户 | `GET /auth/status`、`POST /auth/login`、`/auth/refresh`、`/auth/logout`、`GET /auth/me`、`GET\|PUT /users/me`、`GET /auth/sessions`、`DELETE /auth/sessions/{id}`，以及 `/auth/*` 下的邀请和密码重置 | 已登录（登录相关路由是公开的） |
| 双因素 | `/auth/two-factor/*`、`POST /auth/login/two-factor`、`POST /auth/login/passkey/options`、`DELETE /users/{id}/two-factor` | 已登录；重置其他管理员需要 `users.manage` |
| SSO | `GET /auth/sso`、`GET /auth/sso/{id}`、`GET /auth/sso/{id}/callback` | 公开 |
| 管理员用户 | `GET\|POST /users`、`GET\|PUT\|DELETE /users/{id}`、`POST /users/{id}/invite` | `users.manage` |
| 角色与公开访问 | `GET\|POST /roles`、`GET\|PUT\|DELETE /roles/{id}`、`GET\|PUT /public-permissions` | `roles.manage` |
| API 令牌 | `GET\|POST /api-tokens`、`GET\|PUT\|DELETE /api-tokens/{id}`、`POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Schema | `GET /content-types`、`GET /components`、`GET\|PUT\|DELETE /content-types/{uid}/edit-view`；`GET /schema`、`POST /schema/plan`、`POST /schema/apply` 仅在 `verdin dev` 中可用 | 已登录；编辑视图需要 `views.manage`；构建器需要 `schema.manage` |
| 内容 | `GET\|POST /content/{uid}`、`GET\|PUT\|DELETE /content/{uid}/{documentId}`、`POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`、`POST …/clone`、`GET …/locales`、`GET …/usage`、`GET /content/{uid}/uid-available`、`GET /content/{uid}/stats` | `{uid}` 上的内容操作 |
| 导入与导出 | `GET /content/{uid}/export`、`POST /content/{uid}/import` | `{uid}` 上的内容操作 |
| 历史 | `GET /history/{uid}/{documentId}`、`GET /history/versions/{id}`、`POST /history/versions/{id}/restore` | 该类型上的内容操作 |
| 发布计划 | `GET\|POST /releases`、`GET\|PUT\|DELETE /releases/{id}`、`POST /releases/{id}/actions`、`DELETE /releases/{id}/actions/{actionId}`、`POST /releases/{id}/publish` | `releases.manage` |
| 审核工作流 | `GET\|POST /review-workflows`、`GET\|PUT\|DELETE /review-workflows/{id}`、`GET\|PUT /content/{uid}/{documentId}/review`、`GET /review/*` | 配置需要 `workflows.manage` |
| 媒体 | `POST /upload`、`POST /upload/from-url`、`GET /upload/files`、`GET\|PUT\|DELETE /upload/files/{id}`、`POST /upload/files/{id}/replace`、`GET /upload/files/{id}/usage`、`/upload/folders…` | `media.*` |
| 语言区域 | `GET\|POST /i18n/locales`、`PUT\|DELETE /i18n/locales/{code}` | 修改需要 `locales.manage` |
| Webhook | `GET\|POST /webhooks`、`GET\|PUT\|DELETE /webhooks/{id}`、`POST\|DELETE /webhooks/{id}/secret`、`POST /webhooks/{id}/trigger`、`GET /webhooks/{id}/deliveries`、`POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| 终端用户 | `GET\|POST /end-users`、`GET\|PUT\|DELETE /end-users/{id}`、`GET\|POST /end-user-roles`、`PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| 功能 | `GET /features`、`PUT /features/{id}`、`POST /email/test` | 修改需要 `features.manage` |
| 插件 | `GET /plugins`、`GET /plugins/extensions`、`PUT /plugins/{name}`、`GET /plugins/{name}/logs` | `plugins.manage` |
| 部署与 CDN | `/deploy/targets…`、`GET /deploy/deployments`、`GET /deploy/cdn`、`POST /deploy/cdn/purge` | `deploy.manage`；触发部署需要 `deploy.trigger` |
| 站点 | `/site/redirects…`、`/site/menus…`、`/site/forms…` 以及表单提交 | `site.manage` |
| 协作 | `/comments…`、`/tasks…`、`/engagement/*`、`/polls…` | 对该条目所属类型的读取权限 |
| 实时 | `GET /events`、`GET\|POST /presence` | 参见[实时 API](/zh-cn/api/realtime/#管理后台事件流) |
| AI | `GET /ai`、`POST /ai/translate`、`/ai/alt-text`、`/ai/summarize`、`/ai/seo` | 参见 [AI 操作](/zh-cn/guides/integrations/ai-actions/) |
| 审计日志 | `GET /audit-logs` | `audit.read` |
| 系统 | `GET /system/info`（版本、数据库和运行模式） | 已登录 |

## 内容路由

内容路由与 REST API 运行同一个 Document Service，但遵循管理后台的规则：

- `{uid}` 是内容类型的 UID，例如 `api::article`。
- 读取默认返回**草稿**，除非传入 `status=published`。它们接受 REST 的[查询参数](/zh-cn/api/rest/#查询参数)，另外还支持 `unseen=true`，用于获取管理员自上次变更以来尚未打开过的文档。
- 写入只保存草稿。发布始终是一个显式操作。
- 写入会把该管理员记录为创建者或最后编辑者。管理员角色中关于字段、语言区域和 `is-creator` 的限制同样适用于读取和写入。

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
