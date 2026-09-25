# Changelog

All notable changes to Verdin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (0.x: minor versions may break).

## [Unreleased]

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
- Admin: bulk publish, unpublish and delete from the content list, with progress and a
  summary of failures.
- Admin: list view settings per content type and user (visible columns and their order,
  default sort and page size).

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
