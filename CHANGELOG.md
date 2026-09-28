# Changelog

All notable changes to Verdin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (0.x: minor versions may break).

## [Unreleased]

### Added

- **`password` attributes**: hashed with Argon2id on write and never returned, filtered
  or sorted. `verdin import strapi` imports them, keeping Strapi's bcrypt hashes.
- Webhook events `releases.publish` and `review-workflows.updateEntryStage`.
- REST query options from Strapi v5: `populate[tags][count]=true`,
  `hasPublishedVersion=true|false`, sorting by a to-one relation's field
  (`sort=author.name:asc`), filters on repeatable components
  (`filters[links][url][$contains]=…`) and on dynamic zones by `__component`.
- Duplicate entries: `POST /admin/api/content/{uid}/{documentId}/clone` creates a draft
  with the entry's content. Unique and uid fields and one-to-one / one-to-many relations
  are left out and listed in `meta.leftOut`.

### Changed

- The HTTP API tests of `verdin-api` build into one binary, which saves about 2.7 GB in
  `target/` per build.

## [0.7.1] - 2026-09-28

### Security

- The plugin runtime moves from Wasmtime 43 to Wasmtime 48 (LTS). This fixes
  RUSTSEC-2026-0222 (stores could mix up type indices between engines) and
  RUSTSEC-2026-0269 (filesystem sandbox escape through trailing slashes), and drops the
  unmaintained crates that came with Wasmtime 43. No Extism release ships Wasmtime 48
  yet, so Extism comes from its main branch, pinned to a commit. Existing plugins keep
  working without a rebuild.

### Changed

- The minimum Rust version is now 1.95, which Wasmtime 48 requires.

## [0.7.0] - 2026-09-28

### Added

- **Review workflows** (the `review` feature, permission `workflows.manage`). Stages
  per content type, with the roles allowed to move entries into each stage. Entries can
  be assigned to an admin. A workflow can also require a stage to publish, which is
  enforced on every API. The admin shows stages in the editor and the list, and the
  entries assigned to you on the home page. See
  [docs/review-workflows.md](docs/review-workflows.md).
- **Right-to-left admin languages**: Arabic, Hebrew and Persian (18 languages in all).
- **Documentation site** in `site/` (Astro Starlight), built from `docs/`, with a
  configuration reference and an API reference generated from OpenAPI.
- **Several instances.** Each instance reads the settings changed by the others every
  `[server].sync_interval_secs`. Set `[plugins].run_jobs = false` on all instances but
  one. Each day's digest is claimed in the database, so it is sent once. See
  [docs/scaling.md](docs/scaling.md).

### Fixed

- Schemas from Strapi 5.17+ with conditional fields (`conditions`) failed to load. The
  conditions are now kept, but the admin does not apply them yet.
- Plugins writing content through the host skipped every before-write hook. They now
  skip only the plugins' own hooks.

## [0.6.0] - 2026-09-28

### Added

- **SSO for admins** (the `sso` feature): sign-in through OpenID Connect providers with
  PKCE, a signed state and a nonce. Accounts can be created on first sign-in, with roles
  mapped from a groups claim. Client secrets come from `VERDIN_SSO_<ID>_SECRET`. See
  [docs/sso.md](docs/sso.md).
- **Audit logs** (the `audit` feature, on by default, permission `audit.read`). They
  record content and media changes from every API, admin actions and sign-ins, and keep
  them for `[audit].retention_days`. Read them in `GET /admin/api/audit-logs` with
  filters.
- **Releases** (the `releases` feature, permission `releases.manage`): entries published
  or unpublished together, now or at a scheduled date, with a result for each action.
- **Preview** (the `preview` feature): URL templates per content type, and signed
  short-lived tokens (`x-verdin-preview`) that read one draft through the content API.
- **Plugin settings forms**: plugins declare `[[settings]]` fields (types, options,
  defaults, bounds). The admin shows a form, and the server validates the values.
- **Unseen digest**: an opt-in daily email of unseen changes (preference
  `digest: "daily"`), sent at `[digest].hour_utc`.

See [docs/governance.md](docs/governance.md) for audit logs, releases, preview and the
digest.

### Fixed

- Settings → Features listed plugins as "planned for 0.5" although they shipped.

## [0.5.0] - 2026-09-25

### Added

- **WASM plugins** (Extism): before/after write hooks (change or refuse data), routes under
  `/api/plugins/{name}`, cron jobs, key-value storage, settings and logs; capabilities per
  plugin (content types read/written, HTTP hosts, storage) and time and memory limits;
  Settings → Plugins (`plugins.manage`). See [docs/plugins.md](docs/plugins.md).
- **Plugin widgets and custom fields**: Web Components shipped by plugins, loaded by the
  admin; attributes with `customField: "plugin::{plugin}.{field}"` (Strapi-compatible;
  kept by `verdin import strapi`).
- Chart widgets (entries created and published per day or week,
  `GET /admin/api/content/{uid}/stats`).
- Unseen badges in the sidebar (`GET /admin/api/engagement/unseen`).
- Document Service before-write hooks (`DocumentHook`).

## [0.4.0] - 2026-09-25

### Added

- **End users** (the `users` feature, Settings → End users): Strapi v5 compatible
  `/api/auth/local/register`, `/api/auth/local`, email confirmation, forgot/reset/change
  password and `/api/users/me`; roles with content API grants; JWTs revoked on password
  change and block; OAuth sign-in (GitHub, Google, any OAuth 2 provider) with signed,
  cookie-bound state; accounts, roles and settings in the admin (`endusers.manage`). See
  [docs/end-users.md](docs/end-users.md).
- **Email** (`[email]`): SMTP, Resend, Postmark and a log provider; secrets from the
  environment; test emails from Settings → Features. Mailpit in the development compose
  file.
- Content API traffic controls: rate limits per IP (`[api].public_rate_limit`) and per
  token or end user (`[api].token_rate_limit`), `ETag`s with `304 Not Modified`, and an
  optional in-memory cache of anonymous reads (`[api].cache_ttl_secs`) emptied on every
  change.
- `verdin import strapi` imports end users (bcrypt passwords keep working), custom roles
  and the public/authenticated permissions.

### Changed

- `auth`, `users` and `connect` are reserved route names for content types.

## [0.3.0] - 2026-09-25

### Added

- **Webhooks** (Settings → Webhooks): entry and media events, per content type filters,
  custom headers, HMAC-SHA256 signatures, a durable delivery queue with retries and
  backoff, a delivery log with manual retry, test deliveries, SSRF protection in
  production (`[webhooks]` settings); `webhooks.manage` permission. See
  [docs/webhooks.md](docs/webhooks.md).
- **Content history**: a version of the document after every create, save, publish,
  unpublish and discarded draft, from any API. Browse the versions from the editor and
  restore one as the draft: fields that no longer exist are skipped, and references to
  deleted entries or files are dropped and reported. Newest `[history].max_versions`
  versions (50) are kept per document.
- **Content internationalization**: locales (Settings → Internationalization,
  `locales.manage`), localized content types and shared fields
  (`pluginOptions.i18n.localized`), one version per locale with its own draft and
  published version, `?locale=` on the REST and admin APIs and a `locale` argument in
  GraphQL, locale-aware relations and filters, a locale switcher and "fill from another
  locale" in the editor. See [docs/i18n.md](docs/i18n.md).
- **`verdin import strapi`**: imports a Strapi v4/v5 export (`strapi export --no-encrypt`,
  `.tar.gz`, `.tar` or directory): schema files, locales, media library, entries (drafts,
  published versions, locales), relations and media, including inside components; writes a
  Strapi → Verdin id map. See [docs/importing-from-strapi.md](docs/importing-from-strapi.md).
- Admin: bulk publish, unpublish and delete from the content list, with progress and a
  summary of failures.
- Admin: list view settings per content type and user (visible columns and their order,
  default sort and page size).

### Changed

- Attribute names follow Strapi's rule (a letter, then letters, digits and underscores:
  `kit_man`, `SEO`) instead of camelCase only; names that map to the same column are refused.
- `regex` options accept JavaScript-like patterns (look-around, backreferences), with a
  backtracking limit.

### Fixed

- Writes made through GraphQL did not reach document listeners (for example "not seen yet" marks).

## [0.2.0] - 2026-09-25

### Added

- **Media library**: `media` attribute type (single or multiple, `allowedTypes`), uploads
  with MIME sniffing and responsive image formats, folders, focal points, local and
  S3-compatible storage (AWS, R2, B2, RustFS), Strapi-compatible `/api/upload` routes and
  `plugin::upload` grants, admin media permissions.
- Admin: media library page (folders, drag & drop uploads with progress, grid/list views,
  search and type filters, bulk move/delete, file details with focal point, alt text and
  caption), media picker and media fields in the editor, media field type in the builder,
  media permissions in roles, and a media library row in public access and API tokens.
- **Settings → Features**: switch optional features on and off at runtime (the app is
  rebuilt in place, no restart), with the roadmap's upcoming features listed;
  `features.manage` permission.
- **GraphQL** feature: `/graphql` with a schema generated from the content types (Strapi v5
  shapes: collections, `_connection` with `pageInfo`, single types, create/update/delete
  mutations, components, dynamic zones as unions, relations with their own filters, media
  as `UploadFile`), the REST API's permissions and query validation, depth and complexity
  limits, optional GraphiQL.
- Document events: every write is announced to listeners after it commits, whatever API
  made it (the base for webhooks).
- **API documentation** feature: the OpenAPI document plus an embedded Scalar reference at
  `/api/docs` when made public (off by default: the document stays token-only).
- **Blocks** attribute type: Strapi's rich text JSON (headings, paragraphs, lists, quotes,
  code, images, links), validated on write (links must be `http(s)`, `mailto:` or relative);
  TipTap-based blocks editor in the admin and a `blocks` field type in the builder.
- Markdown preview for `richtext` fields (sanitized with DOMPurify).
- **Relations and media inside components** and dynamic zones (`oneWay`/`manyWay` relations,
  single or multiple media): stored as references in the component JSON, checked on write
  (existence, allowed media types) and resolved on `populate` in the requested version.
- **Field-level permissions**: content permissions may list the fields a role can read and
  write; enforced in the content API, GraphQL and the admin, and editable per role.
- **`verdin types`**: TypeScript definitions of every content type and component, their
  write inputs and a route map.
- **`@verdin/client`**: small typed client (REST documents, uploads, GraphQL) that uses
  the generated types.
- `verdin dev` reloads the schema when files change on disk.
- `vd_settings` table; built-in roles of existing installations receive new permissions once.

### Changed

- Admin translations moved to Transloco with flat JSON catalogs and ICU MessageFormat
  (FormatJS), ready for Weblate; see `docs/translating.md`.
- Body size limits and timeouts apply per API router (uploads have their own limits).
- The admin CSP allows images and video from a remote media library's origin.

### Fixed

- The admin panel used `/api` as the content API base even with another `[api].prefix`.

## [0.1.0] - 2026-09-24

First public release: the MVP described in [docs/architecture.md](docs/architecture.md).

### Added

- **Single binary** `verdin` with the admin panel embedded; Docker image (distroless, ~70 MB)
  and release binaries for macOS (arm64, x64), Linux (x64, arm64, musl) and Windows.
- **Databases**: PostgreSQL ≥ 14, MySQL ≥ 8.4, MariaDB ≥ 10.11 and SQLite, all covered by the
  same test suite.
- **Schema as code**: content types and components as JSON files (Strapi-like format);
  `verdin schema check`.
- **Migrations** derived from the schema: plan with risk levels and exact SQL, explicit
  renames, journaled and resumable on MySQL/MariaDB, transactional elsewhere.
- **Content REST API**, Strapi v5 compatible: CRUD, filters (including relation and component
  fields), sort, pagination, field selection, `populate`, draft & publish, OpenAPI document.
- **Relations** (one/many-to-one/many, one/many-way), **components** and **dynamic zones**.
- **Authentication**: admin users, rotating refresh cookies with reuse detection, lockout,
  rate limits, roles (Super Admin, Editor, Author), API tokens (read-only, full access,
  custom), public permissions.
- **Admin panel** (Angular + spartan/ui): content manager with schema-driven forms,
  content-type builder in development mode, users, roles, API tokens and public access;
  customizable dashboard with widgets (counters and lists with field conditions, "not seen
  yet" inboxes, recent activity, polls, notes, quick links, system), votes on any entry;
  dark mode; 15 languages; locale-aware calendar
  (first day of the week follows the region, or your choice).
- **CLI**: `verdin new`, `dev`, `start`, `migrate plan|apply`, `admin create|reset-password`,
  `secrets`.
