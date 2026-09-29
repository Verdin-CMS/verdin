# Changelog

All notable changes to Verdin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (0.x: minor versions may break).

## [Unreleased]

## [0.10.0] - 2026-09-29

Modern documentation and admin polish. The documentation moved from `docs/` to a site of
its own, rewritten and checked against the code; the admin panel's largest screens were
split up and gained accessibility and tests. No database migration.

### Documentation

- **A documentation site**, published to GitHub Pages on every push to `main`
  (<https://verdin-cms.github.io/verdin/>): Get started (quickstart, Astro and Next.js
  tutorials), Concepts, Guides, Extending, API reference, Reference, Deploy & operate,
  Migrate & upgrade and Internals. It has its own look, code tabs, diagrams, an API
  playground on the example project, Open Graph cards, `llms.txt`, and pages in 18
  languages.
- The permissions reference is generated from the code, and CI checks that the command
  line reference covers every command and flag.
- The user guides and the design document that were in `docs/` are pages of the site now;
  `docs/` keeps the roadmap and the translation guide. `SECURITY.md` says how to report
  a vulnerability.

### Added

- `verdin healthcheck` asks `/_health` on the loopback interface; the Docker image uses it
  as its `HEALTHCHECK`.
- GraphQL: localized types have a `locale` field, and `delete…` mutations take `locale`.
- Admin panel: page titles for every screen, a "Skip to content" link, focus moved to the
  page heading after navigation (announced to screen readers), subtle view transitions
  (off with reduced motion), one entry picker for relations, polymorphic relations and
  menu items, pagination controls on audit logs, webhook deliveries, end users and form
  submissions, and the rich-text editors loaded only when a field needs them.

### Changed

- **CDN**: content API responses carry the cache tags of every type they can populate, so
  purging a related type also refreshes them.
- **Docker image**: uploads (`/app/public/uploads` links to `/data/uploads`), the image
  transformation cache and the search index live in `/data`, so the S3 upload provider can
  be set with environment variables alone.
- **Webhooks**: `review-workflows.updateEntryStage` carries the singular name in `model`
  and the uid in `uid`, like entry events (`model` held the uid).
- Relation fields link entries through a dialog (**Link an entry**) that searches every
  text field of the target type, in the entry's locale for localized targets.
- `verdin types` emits `Collections` and `Singles` as type aliases, so
  `createClient<VerdinSchema>` type-checks; regenerate your types.
- `verdin new` adds `public/uploads/` to the project's `.gitignore`.
- The admin panel's editor, content-type builder, content list and media library were split
  into smaller components with one state service each, and settings pages load through
  Angular resources; behaviour is unchanged.

### Fixed

- Two-factor sign-ins are audited once the second factor is accepted, with the admin (the
  password step was recorded without one).
- Invitations say they were not emailed when the email provider is `log`.
- Plugin widgets' `context.fetch` sends content API requests without the admin session,
  which the content API refused.
- The end-user roles page says that signed-in users get only their role's permissions.

## [0.9.1] - 2026-09-29

A hardening release from a full audit of 0.9.0. Upgrading is recommended for every
installation; its migration (one table, two columns) runs on start.

### Security

- **Super Admins**: only a Super Admin can create, edit, delete, re-invite or reset the
  second factor of a Super Admin, or grant that role. Re-inviting an account that has
  signed in is refused, and accepting an invitation goes through the second factor.
- **SSO**: its settings need a Super Admin; `defaultRoles` and `roleMap` cannot grant
  Super Admin; the provider's `email_verified` must be true (unless
  `trustUnverifiedEmail`); the second factor applies unless the provider is trusted
  for it (`providerMfa`); the issuer and token endpoint must be public `https` URLs.
- **Rights on related types**: `populate`, relation filters and relation sorts reach
  only the types (and fields) the caller may read, on REST, GraphQL, MCP and the admin
  API; polymorphic relations and references skip the others.
- **History** applies per-locale permissions.
- **Sign-in**: failed attempts count across the password and second-factor steps and are
  counted atomically, so a correct password no longer resets the counter; password
  confirmations are limited too. End users' accounts now lock after repeated wrong
  passwords as well (`failed_logins`, `locked_until` on `vd_users`).
- **Rate limits behind proxies**: `[server] trusted_proxies` names the reverse proxies
  whose `X-Forwarded-For` is trusted; unknown bearer tokens are limited per address.
- **Passkeys**: spent challenges are kept in the database (`vd_spent_challenges`), so a
  challenge is answered once across instances; RSA keys must have 2048 to 8192 bits and
  a sane exponent.
- TOTP secrets are sealed with a MAC (older secrets still open); form submitters' IPs are
  hashed with a key derived from `VERDIN_TOKEN_PEPPER`; request logs hide secret-looking
  query parameters and deploy callback secrets; webhooks and fetches refuse IPv6
  addresses that embed private IPv4 ones (`::a.b.c.d`, 6to4, Teredo, `fec0::/10`).
- Private fields of components are no longer indexed by search (indexes are rebuilt on
  start).

### Added

- `[api] cors_origins`: browser origins allowed to call the content API and GraphQL
  (`["*"]` for any). There was no CORS support before.
- `beforeDiscardDraft` plugin hook; discarding a draft runs the before hooks.
- Expired sessions, one-time links and passkey challenges are pruned daily.
- Admin panel: leaving an entry or the content-type builder with unsaved changes asks
  first (also on locale switches, remote-change reloads and closing the tab);
  unpublishing and discarding a draft ask for confirmation; pages the admin may not
  open redirect home instead of loading forever; the users, tokens, roles and public
  permissions pages show loading and error states with a retry.

### Fixed

- JSON answers over 4 MB are served without an ETag instead of failing.
- Populated relations return at most 1000 entries per entry and relation; `count`
  populates read no fields.
- The admin export reads only the documents it exports; the sitemap is built at most
  every ten minutes.
- "Where used" no longer holds a write lock on SQLite.
- Huge `pagination[page]`/`pagination[start]` values give an empty page instead of an
  error.
- Mentions only notify admins who may read the entry (own-entries grants included);
  imports report database errors instead of a refusal.

## [0.9.0] - 2026-09-29

### Added

- **Realtime events** over Server-Sent Events: `GET /api/_events` (the `realtime` feature)
  and `GET /admin/api/events`, each filtered by what the subscriber may read, and
  **presence** on entries (`/admin/api/presence`) with a soft lock for the first editor.
  See [Realtime events](https://verdin-cms.github.io/verdin/guides/frontend/realtime/).
- **Prometheus metrics** at `/_metrics` (`[metrics]`): requests and latency by area,
  webhook queue, realtime streams, uptime.
- **Cross-field validations**: `validations: [{ rule, message, field }]` in a content
  type, JSON Logic rules checked with `required` (`endDate >= startDate`). JSON Logic
  comparisons now also order strings (ISO dates), and arithmetic, `min`, `max` and
  `cat` are supported.
- **Where used**: `GET /admin/api/content/:uid/:documentId/usage` and
  `GET /admin/api/upload/files/:id/usage` list the versions referencing an entry
  (relations, polymorphic relations, relations in components) or a file (media fields
  and components, image blocks, rich text URLs), filtered by the admin's permissions.
- **Image transformations** at `/uploads/<file>?preset=…` or signed
  `?w=&h=&fit=&format=&q=&s=` (`[upload.transforms]`, `VERDIN_IMAGE_SECRET`): cover
  crops around the focal point, JPEG/PNG/WebP output, a disk cache dropped when the
  file changes.
- **Full-text search** with `_q` on the content and admin APIs: `$containsi` over the
  text fields (Strapi's behaviour), or, with `[search] enabled = true`, a Tantivy index
  that ranks results, ignores accents and matches the last word as a prefix.
- **Two-factor authentication for admins**: TOTP and passkeys (WebAuthn: ES256, EdDSA,
  RS256) with single-use recovery codes, a two-step sign-in, and roles that require it
  (`requireTwoFactor`).
- **CSV/JSON import and export** per content type in the admin API, with column mapping,
  upserts by `documentId` and a dry run that validates every row without writing.
- **Comments and tasks** on entries and fields (the `comments` feature): threads with
  @mentions and resolution, tasks with an assignee and due date, email notifications.
- **Deploys and CDN purges**: build hook targets behind a "Deploy" button with a
  provider status callback (`deploy.manage`, `deploy.trigger`), and `[cdn]` purges by
  cache tag on Cloudflare, Fastly or a webhook when content changes publicly.
- **Visual editing**: source maps hidden in the text of authenticated reads that send
  `X-Verdin-Stega: true`, and an overlay script (`/admin/api/visual-editing.js`) that
  jumps from the site to the field. See [Visual editing](https://verdin-cms.github.io/verdin/guides/frontend/visual-editing/).
- **AI actions** (the `ai` feature, off by default, and `[ai]`): translate an entry to
  another locale, alt text for images, summaries and SEO suggestions, with Anthropic,
  OpenAI or any OpenAI-compatible server.
- **Site features** (see [Site features](https://verdin-cms.github.io/verdin/guides/frontend/seo-and-sitemap/)): SEO settings
  with `/sitemap.xml` and a suggested `shared.seo` component, redirects for frontends
  (`/api/_redirects`), navigation menus with resolved entry links (`/api/_menus/{slug}`)
  and forms with validated, rate-limited submissions and email notifications
  (`/api/_forms/{slug}`). New admin permission `site.manage`.
- **Admin panel**: two-step sign-in with codes and passkeys, and a two-factor section in
  the profile; comments, tasks and presence in the editor, live list updates and a
  "My tasks" widget; "Used in" in the editor and the media library with delete
  warnings; CSV/JSON import (with a checked dry run) and export from the lists, and
  full-text search in them; AI translation, SEO, summary and alt text suggestions;
  visual editing from the preview; editable polymorphic relations in the editor and the
  builder; Settings → Deployments with a Deploy button, and pages for redirects, menus,
  forms and the SEO settings.
- New admin permissions `deploy.manage`, `deploy.trigger` and `site.manage` (Editors get
  `deploy.trigger` and `site.manage`).

### Changed

- The admin content list's search box searches every text field (`_q`) instead of the
  title.

## [0.8.0] - 2026-09-28

### Added

- **`password` attributes**: hashed with Argon2id on write and never returned, filtered
  or sorted. `verdin import strapi` imports them, keeping Strapi's bcrypt hashes.
- Webhook events `releases.publish` and `review-workflows.updateEntryStage`.
- REST query options from Strapi v5: `populate[tags][count]=true`,
  `hasPublishedVersion=true|false`, sorting by a to-one relation's field
  (`sort=author.name:asc`), filters on repeatable components
  (`filters[links][url][$contains]=…`) and on dynamic zones by `__component`.
- **Admin accounts**: invite admins without setting a password (`POST /users` without
  `password` returns `meta.inviteUrl` and emails it), accept the invitation, reset a
  forgotten password by email, edit one's own profile (`/users/me`), list and sign out
  one's sessions (`/auth/sessions`), and regenerate API tokens
  (`POST /api-tokens/{id}/regenerate`).
- **End users**: refresh tokens (`jwtManagement: "refresh"`, `POST /api/auth/refresh`
  and `/api/auth/logout`), the `/api/users` routes with role permissions on
  `plugin::users-permissions.user`, OAuth presets for Microsoft, Discord, Facebook,
  GitLab and LinkedIn, and HTML email templates.
- **Admin branding** in `[admin.branding]`: title, logo, favicon, accent color and text
  overrides per language.
- **Permissions per locale**: admin content permissions take an optional `locales` list
  (`{ "action": "content.update", "subject": "api::article", "locales": ["fr"] }`).
- **Conditional fields** (Strapi 5.17's `conditions.visible`, JSON Logic): hidden fields
  are not required.
- **Edit view layout** per content type (`/admin/api/content-types/{uid}/edit-view`,
  permission `views.manage`): field order and widths, labels, descriptions, placeholders,
  read-only fields and the field that names related entries.
- **GraphQL**: disable queries or mutations per content type (the feature's `disabled`
  setting, like Strapi's shadow CRUD), and root fields resolved by plugins
  (`[[graphql]]` in `plugin.toml`).
- **Media library**: replace a file keeping its id and links
  (`POST /admin/api/upload/files/{id}/replace`, and `POST /api/upload?id=` with a file,
  as in Strapi), upload from a URL (`POST /admin/api/upload/from-url`, public addresses
  only unless private networks are allowed), and `[upload].max_original_size` to scale
  down large originals.
- **MCP server** (the `mcp` feature): content tools for AI agents at `/mcp` (Streamable
  HTTP), authorized like the content API. See [MCP server](https://verdin-cms.github.io/verdin/guides/integrations/mcp/).
- **Backups**: `verdin export <file.tar.gz>` and `verdin import verdin <file.tar.gz>`
  move a project's schema, locales, media and every version of its entries. See
  [Backups](https://verdin-cms.github.io/verdin/deploy/backups/).
- Duplicate entries: `POST /admin/api/content/{uid}/{documentId}/clone` creates a draft
  with the entry's content. Unique and uid fields and one-to-one / one-to-many relations
  are left out and listed in `meta.leftOut`.
- **Polymorphic relations**: `morphToOne` and `morphToMany` link documents of any content
  type (`{ "__type": uid, "documentId": id }`), and `morphOne` / `morphMany` read them from
  the other side. They are populated in REST and GraphQL (as JSON), copied on publish,
  kept by history, duplicates and `verdin export`, and imported from Strapi.
- **Admin panel**: a filter builder in the content lists, drag-and-drop relations with
  editing in a side sheet, a side-by-side live preview with device widths, duplicate
  from the list and the editor, the edit view configurator, conditional fields in the
  editor and the builder, crop, replace, upload from URL and PDF preview in the media
  library, the profile page with sessions, invitations and password resets, and
  settings for the MCP server and GraphQL's disabled operations.

### Changed

- The HTTP API tests of `verdin-api` build into one binary, which saves about 2.7 GB in
  `target/` per build.

### Fixed

- Tables with foreign keys are created (and dropped) in dependency order at any depth,
  which PostgreSQL, MySQL and MariaDB need.

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
  [Review workflows](https://verdin-cms.github.io/verdin/guides/content/review-workflows/).
- **Right-to-left admin languages**: Arabic, Hebrew and Persian (18 languages in all).
- **Documentation site** in `site/` (Astro Starlight), built from `docs/`, with a
  configuration reference and an API reference generated from OpenAPI.
- **Several instances.** Each instance reads the settings changed by the others every
  `[server].sync_interval_secs`. Set `[plugins].run_jobs = false` on all instances but
  one. Each day's digest is claimed in the database, so it is sent once. See
  [Running several instances](https://verdin-cms.github.io/verdin/deploy/scaling/).

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
  [Single sign-on](https://verdin-cms.github.io/verdin/guides/auth/sso/).
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

See [Audit logs](https://verdin-cms.github.io/verdin/guides/content/audit-logs/) for audit logs, releases, preview and the
digest.

### Fixed

- Settings → Features listed plugins as "planned for 0.5" although they shipped.

## [0.5.0] - 2026-09-25

### Added

- **WASM plugins** (Extism): before/after write hooks (change or refuse data), routes under
  `/api/plugins/{name}`, cron jobs, key-value storage, settings and logs; capabilities per
  plugin (content types read/written, HTTP hosts, storage) and time and memory limits;
  Settings → Plugins (`plugins.manage`). See [Plugins](https://verdin-cms.github.io/verdin/extending/plugins/).
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
  [End users](https://verdin-cms.github.io/verdin/guides/auth/end-users/).
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
  [Webhooks](https://verdin-cms.github.io/verdin/guides/integrations/webhooks/).
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
  locale" in the editor. See [docs/i18n.md](https://verdin-cms.github.io/verdin/guides/content/localizing-content/).
- **`verdin import strapi`**: imports a Strapi v4/v5 export (`strapi export --no-encrypt`,
  `.tar.gz`, `.tar` or directory): schema files, locales, media library, entries (drafts,
  published versions, locales), relations and media, including inside components; writes a
  Strapi → Verdin id map. See [Migrating from Strapi](https://verdin-cms.github.io/verdin/migrate/from-strapi/).
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

First public release: the MVP described in [Architecture](https://verdin-cms.github.io/verdin/internals/overview/).

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
