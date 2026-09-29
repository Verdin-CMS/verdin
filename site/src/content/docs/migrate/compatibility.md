---
title: Strapi compatibility
description: Which Strapi v5 features and APIs Verdin supports, supports in part or does not support — REST, GraphQL, users and permissions, uploads, i18n, draft and publish, code extensions, the admin panel and Enterprise features.
sidebar:
  order: 2
---

Verdin keeps Strapi v5's content model and content APIs so that frontends and content
can move over (see [Migrating from Strapi](/migrate/from-strapi/)). It is not a drop-in
replacement for a Strapi *codebase*: there is no JavaScript runtime, so custom code is
rebuilt as WebAssembly plugins. This page lists each area with its status, as of
Verdin 0.9.1.

**Supported** works as in Strapi v5 (differences noted). **Partial** covers the common
cases; the note says what is missing. **Not supported** has no equivalent.

## Content model

| Feature | Status | Notes |
| --- | --- | --- |
| Collection types and single types | Supported | JSON schema files close to Strapi's (`schema/content-types/*.json`). See [Content model](/concepts/content-model/). |
| Scalar attribute types | Supported | `string`, `text`, `richtext` (Markdown), `blocks`, `email`, `uid`, `integer`, `biginteger`, `float`, `decimal`, `boolean`, `date`, `time`, `datetime`, `enumeration`, `json`, `password`. Strapi's `timestamp` is imported as `datetime`. |
| Components and dynamic zones | Supported | Including media and `oneWay`/`manyWay` relations inside components. |
| Relations | Supported | One/many-to-one/many, one-way and many-way, and polymorphic `morphToOne`, `morphToMany`, `morphOne`, `morphMany`. |
| Media fields | Supported | Single or multiple, `allowedTypes`. |
| `unique` | Partial | Not on `text`, `richtext`, `blocks` and `json` attributes. |
| Conditional fields (`conditions`) | Supported | Strapi 5.17's JSON Logic conditions; hidden fields are not required. |
| Custom fields | Partial | `customField` attributes work; the admin input comes from a Verdin [plugin](/extending/plugins/), not from Strapi's React plugins. |
| Content-type builder | Supported | In development mode (`verdin dev`) only, like Strapi. |

## REST API

| Feature | Status | Notes |
| --- | --- | --- |
| CRUD routes | Supported | `GET`/`POST /api/{pluralName}`, `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`, single types at `/api/{singularName}`. Responses carry `data` and `meta`, errors Strapi's `error` object. |
| `filters` | Supported | Every Strapi operator: `$eq`, `$eqi`, `$ne`, `$nei`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$notIn`, `$contains`, `$notContains`, `$containsi`, `$notContainsi`, `$null`, `$notNull`, `$between`, `$startsWith(i)`, `$endsWith(i)`, `$and`, `$or`, `$not`; through relations, components, repeatable components and dynamic zones (`__component`). |
| `sort` | Supported | Several fields, `:asc`/`:desc`, and a to-one relation's field (`author.name:asc`). |
| `pagination` | Supported | `page`/`pageSize` or `start`/`limit`, `withCount`. `pageSize` is capped at `[api].max_page_size` (100). |
| `fields` | Supported | |
| `populate` | Supported | `*`, lists, nested objects, `on` for dynamic zones, `count`. Depth up to 5; at most 1,000 populated entries per relation. |
| `status` | Supported | `published` (default) or `draft`; reading drafts needs the `readDrafts` permission. |
| `locale` | Supported | See i18n below. |
| `hasPublishedVersion` | Supported | |
| `_q` full-text search | Supported | `$containsi` over text fields, like Strapi; ranked search with `[search]`. |
| Relation writes | Supported | IDs, `connect` / `disconnect` / `set`, with `position` (`before`, `after`, `start`, `end`). |
| Publish, unpublish, discard draft | Supported | Writes publish unless `?status=draft`, as in Strapi v5. Verdin adds `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}`. |
| Strapi v4 response format and `publicationState` | Not supported | Verdin speaks v5 only: flat attributes, `documentId`, `status`. |
| OpenAPI document | Partial | At `/api/_openapi.json` (token-only by default) and an interactive reference at `/api/docs`, instead of the documentation plugin's `/documentation`. |

## GraphQL

| Feature | Status | Notes |
| --- | --- | --- |
| Queries | Supported | `articles`, `articles_connection` with `pageInfo`, `article(documentId)`, single types; `filters`, `sort`, `pagination`, `status`, `locale`. Off until you turn on **Settings → Features → GraphQL**. |
| Mutations | Supported | `create…`, `update…`, `delete…` with `status` and `locale`. |
| Components, dynamic zones, media | Supported | Dynamic zones as unions, media as `UploadFile`. |
| Polymorphic relations | Partial | Returned as JSON, not as typed unions. |
| Shadow CRUD (disable operations per type) | Supported | The feature's `disabled` setting. |
| Custom resolvers and schema extensions | Partial | Root fields resolved by plugins (`[[graphql]]` in `plugin.toml`); no `extensionService`. |
| Users & Permissions mutations (`login`, `register`, `me`…) | Not supported | Use the REST routes. |
| Upload and i18n queries/mutations (`uploadFiles`, `i18NLocales`…) | Not supported | Use the REST routes and the admin panel. |
| Limits, GraphiQL | Supported | `maxDepth`, `maxComplexity`, introspection and playground switches. |

## Users & Permissions (end users)

Turn on **Settings → Features → Users & permissions**. See [End users](/guides/auth/end-users/).

| Feature | Status | Notes |
| --- | --- | --- |
| `POST /api/auth/local`, `/auth/local/register` | Supported | Same request and response shapes. |
| Email confirmation, forgot/reset/change password | Supported | `/auth/email-confirmation`, `/auth/send-email-confirmation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`. |
| Refresh tokens | Supported | `jwtManagement: "refresh"`, `/auth/refresh`, `/auth/logout`. |
| `/api/users`, `/users/me`, `/users/count` | Supported | Plain JSON, permissions on `plugin::users-permissions.user`. |
| OAuth providers | Partial | GitHub, Google, Microsoft, Discord, Facebook, GitLab, LinkedIn and any OAuth 2 provider; not every Strapi preset. |
| Roles and permissions routes (`/api/users-permissions/roles`, `/permissions`) | Not supported | Manage roles in **Settings → End users**. |
| Imported users | Supported | Bcrypt hashes keep working; they are re-hashed with Argon2id at sign-in. |

## Media library and upload API

| Feature | Status | Notes |
| --- | --- | --- |
| `POST /api/upload` | Supported | Multipart `files` and `fileInfo`; `?id=` updates a file's information, or replaces the file when one is sent. |
| Linking on upload (`ref`, `refId`, `field`) | Not supported | Upload, then set the media field with the file id. |
| `GET /api/upload/files`, `/files/{id}`, `DELETE /files/{id}` | Partial | Listing takes `pagination[page]`, `pagination[pageSize]`, `sort` and `filters[name][$containsi]` only. |
| Responsive formats, breakpoints | Supported | `thumbnail` plus `[upload].breakpoints`. |
| Folders, focal points, alt text, captions | Supported | |
| Upload providers | Partial | Local disk and S3-compatible storage (AWS, R2, B2, MinIO, Tigris…). No Cloudinary or other provider packages. |
| Image transformations | Verdin only | `/uploads/<file>?preset=…` and signed URLs (local provider). |

## Internationalization

| Feature | Status | Notes |
| --- | --- | --- |
| Localized types and non-localized fields | Supported | `pluginOptions.i18n.localized`, per attribute too. |
| `?locale=` on REST, `locale` in GraphQL | Supported | An unknown locale is a `400`. |
| `localizations` in responses | Not supported | Read another locale with the same `documentId` and `?locale=`. |
| `GET /api/i18n/locales` | Not supported | Locales are managed in the admin (**Settings → Internationalization**). |

## Draft and publish

| Feature | Status | Notes |
| --- | --- | --- |
| Draft and published versions per document | Supported | Per locale. See [Draft and publish](/concepts/draft-and-publish/). |
| Discard draft | Supported | |
| Scheduled publishing | Supported | Through [Releases](/guides/content/releases/). |

## Server customization

| Strapi | Status | Verdin |
| --- | --- | --- |
| Lifecycle hooks, Document Service middlewares | Partial | Before/after hooks in WebAssembly plugins, which can change or refuse a write. No JavaScript. |
| Custom controllers, services, routes | Partial | Plugin routes under `/api/plugins/<name>/`. |
| Policies and middlewares | Not supported | Permissions and rate limits are built in. |
| Cron tasks | Partial | Plugin jobs. |
| Document Service / Entity Service in JavaScript | Not supported | No JavaScript runtime. |
| npm plugins from the Strapi marketplace | Not supported | |
| Webhooks | Supported | Signed, retried and logged; `entry.draft-discard` is `entry.discard-draft`. See [Webhooks](/guides/integrations/webhooks/). |
| API tokens (read-only, full access, custom) | Supported | Same kinds, optional expiry, regeneration. |
| Transfer tokens, `strapi transfer` | Not supported | Use `verdin export` and `verdin import verdin`. |
| `strapi export` files | Supported (import) | `verdin import strapi`; encrypted exports are not read. |
| `config/*.js`, `.env` | Partial | `verdin.toml` and environment variables. |
| TypeScript types | Supported | `verdin types`. |
| Email providers | Partial | SMTP, Resend and Postmark. |

## Admin panel

| Feature | Status | Notes |
| --- | --- | --- |
| Content manager, media library, content-type builder | Supported | An Angular panel of its own, not Strapi's React admin. |
| Admin users, roles, custom roles | Supported | Super Admin, Editor and Author built in, plus custom roles. |
| Field-level and locale permissions | Supported | |
| RBAC conditions | Partial | The built-in `is-creator` condition only; no custom conditions. |
| Admin customization (`src/admin/app`) | Partial | Logo, favicon, title, accent color and texts in `[admin.branding]`; widgets and custom fields from plugins. No custom pages, injection zones or React extensions. |
| Admin API (`/admin/…`) | Not supported | Verdin's admin API is its own; do not build on Strapi's. |
| Edit view and list view configuration | Supported | |

## Enterprise features

Everything in Verdin is open source; these are Enterprise or paid features in Strapi.

| Strapi feature | Status | Notes |
| --- | --- | --- |
| SSO | Partial | OpenID Connect providers, with group-to-role mapping. No SAML or other passport strategies. See [Single sign-on](/guides/auth/sso/). |
| Audit logs | Supported | See [Audit logs](/guides/content/audit-logs/). |
| Review workflows | Supported | Roles per stage limit who moves entries *into* a stage, and a required publish stage applies to every API. See [Review workflows](/guides/content/review-workflows/). |
| Releases | Supported | Scheduled or immediate. |
| Content history | Supported | `[history].max_versions` versions per document. |
| Preview and live preview | Supported | Preview URLs with short-lived tokens, side-by-side preview and [visual editing](/guides/frontend/visual-editing/). |
| Custom admin roles | Supported | No limit on their number. |
