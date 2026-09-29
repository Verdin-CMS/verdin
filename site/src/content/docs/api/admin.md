---
title: "Admin API"
description: "The API behind Verdin's admin panel, for automation: signing in, sessions, conventions and the main route groups."
sidebar:
  order: 4
  label: "Admin"
---

The admin panel is a client of the admin API, served under `{admin.path}/api`
(`/admin/api` by default). Everything the panel does, a script can do too: create admins
and API tokens, configure webhooks and features, manage locales, or work with drafts and
releases. This page explains how to authenticate and lists the route groups.

:::caution[Stability]
The admin API has no stability guarantee before Verdin 1.0: routes and bodies may change in
minor releases, and the changelog does not list every change. For reading and writing
content, prefer the [REST](/api/rest/) or [GraphQL](/api/graphql/) API with an
[API token](/guides/auth/api-tokens/). A stability contract for every API is planned for 1.0.
:::

## Signing in

The admin API has no API tokens yet: a script signs in as an admin user, ideally one whose
role allows only what the script needs.

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

Send the access token on every other request:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| Credential | Lifetime | Where |
| --- | --- | --- |
| Access token (JWT) | 15 minutes | The response body. Send it as `Authorization: Bearer …`. |
| Refresh token | 30 days | The `verdin_refresh` cookie (`HttpOnly`, `SameSite=Strict`, path `/admin/api/auth`, `Secure` under `verdin start`). |

To get a new access token, call `POST /admin/api/auth/refresh` with the cookie and an
`X-Verdin-CSRF` header (any value). It answers like a login and rotates the refresh token:
store the new cookie, because presenting a used refresh token again ends the whole session.
`POST /admin/api/auth/logout`, with the same header, ends the session.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **Two-factor authentication.** For an account with a second factor, the login answers
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  Complete it with `POST /admin/api/auth/login/two-factor` and
  `{ "twoFactorToken": "…", "code": "123456" }` (a TOTP or recovery code). See
  [Two-factor authentication](/guides/auth/two-factor/).
- **Rate limits.** Login and registration are limited per client IP by
  `[admin].auth_rate_limit` (20 per minute by default); refreshes have a larger budget.
- **Failures.** Wrong credentials, unknown accounts and locked accounts all answer
  `400 Invalid credentials`. Five wrong passwords lock the account for 15 minutes.
- **First admin.** On a fresh instance, `POST /admin/api/auth/register-first-admin` creates the
  Super Admin; it works only while no admin exists. `verdin admin create` does the same from
  the command line.

## Conventions

- Bodies and responses are JSON. Responses wrap their result in `data`
  (`{ "data": … }`); content routes also return `meta`, like the REST API.
- Content routes take `{ "data": { … } }` bodies, like the REST API. Settings routes take
  plain JSON objects.
- Errors have the [REST error shape](/api/rest/#errors). A route of a feature that is off
  answers `404`. An admin whose role requires two-factor authentication gets
  `403 TwoFactorRequiredError` until they set it up.
- Each route checks the admin's [permissions](/concepts/permissions/): content routes the
  content actions on the type, settings routes their settings action.
- The admin API never answers cross-origin requests: call it from a server or a script, not
  from another site's pages.
- Successful changes are recorded in the [audit log](/guides/content/audit-logs/).

## Route groups

Paths are relative to `/admin/api`. The routers are in
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
and the `*_admin.rs` modules next to it.

| Group | Routes | Permission |
| --- | --- | --- |
| Sign-in and account | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, invitations and password reset under `/auth/*` | Signed in (the sign-in routes are public) |
| Two-factor | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | Signed in; `users.manage` to reset another admin |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | Public |
| Admin users | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| Roles and public access | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| API tokens | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Schema | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; `GET /schema`, `POST /schema/plan`, `POST /schema/apply` in `verdin dev` only | Signed in; `views.manage` for edit views; `schema.manage` for the builder |
| Content | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | Content actions on `{uid}` |
| Import and export | `GET /content/{uid}/export`, `POST /content/{uid}/import` | Content actions on `{uid}` |
| History | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | Content actions on the type |
| Releases | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| Review workflows | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | `workflows.manage` to configure |
| Media | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| Locales | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` to change |
| Webhooks | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| End users | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| Features | `GET /features`, `PUT /features/{id}`, `POST /email/test` | `features.manage` to change |
| Plugins | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| Deploys and CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`; `deploy.trigger` to trigger |
| Site | `/site/redirects…`, `/site/menus…`, `/site/forms…` and form submissions | `site.manage` |
| Collaboration | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | Read access to the entry's type |
| Realtime | `GET /events`, `GET\|POST /presence` | See [Realtime API](/api/realtime/#admin-stream) |
| AI | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | See [AI actions](/guides/integrations/ai-actions/) |
| Audit logs | `GET /audit-logs` | `audit.read` |
| System | `GET /system/info` (version, database and mode) | Signed in |

## Content routes

The content routes run the same Document Service as the REST API, with admin rules:

- `{uid}` is the content type's UID, such as `api::article`.
- Reads return **drafts** unless you pass `status=published`. They take the REST
  [query parameters](/api/rest/#query-parameters), plus `unseen=true` for documents the admin
  has not opened since they last changed.
- Writes save the draft only. Publishing is always an explicit action.
- Writes record the admin as the creator or last editor. Field, locale and `is-creator`
  restrictions of the admin's roles apply to reads and writes.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
