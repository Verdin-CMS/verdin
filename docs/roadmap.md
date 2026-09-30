# Verdin roadmap

Releases so far and what comes next, grouped by release. The order is tentative and driven by feedback;
everything lands in the open source edition (there is no paid tier).

Legend: **S** small (days), **M** medium (1–2 weeks), **L** large (weeks).

## 0.2 — Media, GraphQL and editing

| Item | Size | Notes |
|---|---|---|
| Runtime features ✅ | M | Settings → Features, switched live; API documentation with Scalar |
| **GraphQL** ✅ | L | Feature switch; `async-graphql` dynamic schema generated from content types (queries, `_connection`, mutations, Strapi v5 shapes), same permissions as REST, filters/pagination/sort compatible with Strapi's GraphQL plugin, depth and complexity limits |
| **Media library** ✅ | L | `media` attribute type (single/multiple, allowed types), `vd_files` + folders, upload API (`POST /api/upload`, Strapi-compatible response), image metadata, thumbnails and responsive formats (`image` crate, generated on upload, WebP/AVIF), focal point, alt text and captions, drag-and-drop library in the admin with grid/list views, search and folders, picker dialog in forms |
| Upload providers ✅ | M | Local disk (default) and S3-compatible (AWS, R2, B2, RustFS) through `object_store`, size limits and MIME sniffing. Next: signed URLs for private buckets, WebP/AVIF variants |
| **Blocks editor** ✅ | L | Strapi `blocks` JSON format, TipTap-based editor in the admin (headings, lists, quotes, code, images from the media library, links) |
| Markdown preview ✅ | S | Split view for `richtext` fields |
| Relations and media inside components ✅ | M | `oneWay`/`manyWay` relations and media in components and dynamic zones, stored as references, checked on write, resolved on populate |
| Field-level permissions ✅ | M | Per-role readable/writable fields in the admin and for API tokens |
| TypeScript types & SDK ✅ | M | `verdin types` generates TS interfaces for every content type; small typed REST client (`@verdin/client`) |
| Schema file watcher ✅ | S | `verdin dev` reloads when schema files change on disk |

## 0.3 — Content operations

| Item | Size | Notes |
|---|---|---|
| **Content i18n** ✅ | L | Locales management, per-type and per-field localization (the `locale` column already exists), `?locale=` in the API, locale switcher and "fill from another locale" in the editor |
| **Webhooks** ✅ | M | Event bus (entry create/update/delete/publish/unpublish, media events), signed deliveries (HMAC), retries with backoff, delivery log in the admin |
| **Strapi importer** ✅ | L | `verdin import strapi` reads a Strapi v4/v5 project (schemas, components) and its database or a transfer export (data, relations, media) |
| Content history ✅ | M | Versions of every document with diff and restore |
| Bulk actions ✅ | S | Publish, unpublish and delete many entries from the list |
| List view settings ✅ | S | Choose columns, default sort and page size per type |

## 0.4 — End users

| Item | Size | Notes |
|---|---|---|
| End users ✅ | L | The `users-permissions` equivalent: registration, email confirmation, password reset, JWT, roles for the content API, OAuth providers (Google, GitHub, …) |
| Email providers ✅ | M | SMTP and API providers (Resend, Postmark; SES later) for end-user and admin emails |
| Rate limiting & caching for the content API ✅ | M | Per-token limits, ETags, optional in-memory response cache |

## 0.5 — Extensibility

| Item | Size | Notes |
|---|---|---|
| **WASM plugins** ✅ | L | Extism-based: Document Service hooks (before/after create, update, publish…), custom routes, scheduled jobs; capability-based permissions |
| **Plugin widgets and fields** ✅ | M | Plugins ship Web Components loaded into the admin: dashboard widgets and custom field types; settings are edited as JSON (settings pages later) |
| Custom fields ✅ | M | Declared by plugins: storage type and admin input (server-side validation by plugins through before hooks) |
| Widget notifications ✅ | S | Badge in the sidebar (an email digest can come later) |
| Chart widgets ✅ | S | Entries created per day/week, published vs drafts (needs an aggregation endpoint) |

## 0.6 — Governance

| Item | Size | Notes |
|---|---|---|
| SSO / OIDC ✅ | M | Admin login through any OpenID Connect provider (PKCE, state and nonce checks), group-to-role mapping, accounts created on first sign-in |
| Audit logs ✅ | M | Who did what and when (content, media and admin actions), filterable in the admin, retention settings |
| Releases & scheduling ✅ | M | Group entries into a release, publish/unpublish together now or at a date |
| Preview ✅ | M | Preview URL templates per content type, signed short-lived tokens that read one draft |
| Plugin settings forms ✅ | S | Plugins declare their settings (`[[settings]]`): the admin shows a form, the server validates |
| Unseen digest ✅ | S | Opt-in daily email of the changes an admin has not seen |

## 0.7 — Workflows and scale

| Item | Size | Notes |
|---|---|---|
| Review workflows ✅ | L | Configurable stages per content type, assignees, stage permissions |
| Documentation site ✅ | M | Astro Starlight at verdin.dev: guides, API reference generated from OpenAPI, migration guide from Strapi |
| Admin RTL languages ✅ | S | Arabic, Hebrew, Persian (the layout already uses logical properties) |
| Horizontal scaling ✅ | S | Several instances behind a load balancer: settings synced between instances, releases, webhooks and the digest claimed in the database, plugin jobs on one instance ([scaling.md](https://verdin-cms.github.io/verdin/deploy/scaling/)) |
| Plugin runtime upgrade | M | Moved to 0.8 |

## 0.8 — Strapi parity

Gaps found by checking the code against Strapi v5 (up to 5.47): what a Strapi project needs
to move to Verdin without losing features.

| Item | Size | Notes |
|---|---|---|
| **Conditional fields** ✅ | M | `conditions.visible` on attributes (Strapi 5.17 JSON Logic format), evaluated in the editor and on write; 0.7 loads and keeps them without applying them |
| `password` attribute type ✅ | S | Hashed on write, always private; kept by `verdin import strapi` |
| Morph relations ✅ | L | `morphToOne`/`morphToMany`/`morphOne`/`morphMany`, API and populate only (Strapi has no admin UI for them either) |
| Populate gaps ✅ | S | Dynamic zone `on` fragments, `count: true`, filters on repeatable components and dynamic zones, sort by a relation's field, `hasPublishedVersion` |
| Edit view layout ✅ | M | Field order, width, label, description, placeholder, editable, main field of relations; honour `configurable: false` in the builder |
| Duplicate entry ✅ | S | Clone from the list and the editor (`POST …/actions/clone`), relations and media copied, unique fields cleared |
| Content list filters ✅ | M | Filter builder with several conditions on any field, relations included; locale column |
| Relations UI ✅ | S | Drag and drop reordering, open and edit the related entry in a side sheet |
| Side-by-side live preview ✅ | M | Preview in an iframe next to the form, refreshed on save; device widths |
| Admin invitations & password reset ✅ | S | Invite link with a token instead of setting a password, forgot-password email, own profile page (name, email, password) |
| Sessions & tokens ✅ | S | List and revoke own admin sessions; regenerate API tokens (owner-bound admin API tokens moved to Later) |
| RBAC ✅ | M | Per-locale permissions (conditions declared by plugins and "is owner" for end users moved to Later) |
| End users ✅ | S | Refresh tokens, `/api/users` CRUD with permissions, more OAuth presets (Microsoft, Discord, Facebook, Apple, Keycloak, Auth0), HTML email templates |
| Media library ✅ | M | Replace a file keeping its id, crop in the admin, upload from URL, PDF preview, scale down large originals (signed URLs for private buckets moved to Later) |
| Webhook events ✅ | S | `releases.publish`, `review-workflows.updateEntryStage` (after 0.7) |
| Admin branding ✅ | S | Logo, favicon, accent colour and translation overrides in `[admin]` |
| GraphQL ✅ | M | Disable types or actions per content type (shadow CRUD), resolvers from plugins |
| Export / import ✅ | M | `verdin export` / `verdin import verdin` of Verdin's own format (schema, data, media); encryption, scheduled backups to S3 and `verdin transfer` moved to Later |
| **MCP server** ✅ | M | Content and schema tools for AI agents over Streamable HTTP, authorized with API tokens (Strapi 5.47, Sanity, Directus, Payload ship one) |
| Plugin runtime upgrade ✅ | M | Wasmtime 48 LTS through Extism's main branch (0.7.1); move back to an Extism release once one ships it |

## 0.9 — Beyond Strapi

Features from other CMSs (Payload, Directus, Sanity, Contentful, Storyblok, PocketBase,
Hygraph) that fit Verdin best.

| Item | Size | Notes |
|---|---|---|
| **Realtime API** ✅ | M | SSE on document and media events, filtered by the reader's permissions; the admin's stream names who made a change (GraphQL subscriptions moved to Later) |
| Document locking & presence ✅ | S | "Who is editing" avatars and a soft lock in the editor, changes by others offered as a reload, live list updates |
| **Visual editing** ✅ | M | Content source maps (stega) in authenticated reads and an overlay script: click on the site, jump to the field in the admin's preview or a new tab |
| Comments & tasks ✅ | M | Threads on entries and fields, @mentions, resolution, assignable tasks with due dates, email notifications, a "My tasks" dashboard widget (tasks in the digest moved to Later) |
| Polymorphic relations in the admin ✅ | M | Editable `morphToOne`/`morphToMany` links with a picker across content types; `morph*` attributes in the builder; inverse sides read-only, as in the API |
| Where used ✅ | S | Inverse references of an entry or file (relations, components, blocks, rich text), in the editor and the media library; warns before deleting |
| Image transformations ✅ | M | `/uploads/…?w=&h=&fit=&format=&q=` with focal-point crops, presets, signed URLs and a disk cache (local provider; AVIF output later) |
| Full-text search ✅ | M | Tantivy index inside the binary, `?_q=` on the REST and admin APIs and in the admin lists (Meilisearch/Typesense sync moved to Later) |
| 2FA for admins ✅ | S | TOTP, passkeys (WebAuthn), recovery codes, enforceable per role |
| CSV/JSON import & export ✅ | S | Per content type from the list, with column mapping, upserts and a dry run |
| Cross-field validation ✅ | S | Rules that compare fields (`endDate > startDate`) declared in the schema; JSON Logic, checked with `required` |
| Official plugins ✅ | S each | SEO settings + sitemap, redirects, menus, form builder with submissions, as built-in features |
| AI actions ✅ | M | Translate a locale, alt text, summaries and SEO suggestions, with the installation's provider (Anthropic, OpenAI, OpenAI-compatible); off by default |
| Deploy & CDN hooks ✅ | S | "Deploy" button calling build hooks with their status; CDN purge by tag (Cloudflare, Fastly, webhook — Vercel through it) on publish |
| Metrics ✅ | S | Prometheus `/_metrics` (requests, latency, webhook queue, realtime streams); plugin time and Sentry reporting moved to Later |

## 0.9.1 — Hardening ✅

Released 2026-09-29, from the audit after 0.9.0 (security findings are tracked privately until they ship).

| Item | Size | Notes |
|---|---|---|
| Security hardening ✅ | M | Authorization, sign-in and throttling fixes from the audit (details in the changelog) |
| Rate limits behind proxies ✅ | S | Trusted-proxy `X-Forwarded-For`, bounded limiter maps |
| CORS ✅ | S | Configurable allow-list for the content API (browser frontends on other origins) |
| Bounded work ✅ | S | Large responses, exports, populated to-many relations, the sitemap (cached) and "where used" without long locks |
| Multi-instance correctness ✅ | M | Shared state for one-time challenges; an outbox for webhooks and events |
| Admin safety ✅ | S | Unsaved-changes guard, confirmations for unpublish and discard, permission- and feature-aware route guards, loading and error states on every settings page |
| `@verdin/client` 0.9.x on npm | S | The version follows the workspace (checked in CI); publishing waits for an `NPM_TOKEN` secret in the repository |
| Docs corrections ✅ | S | Sample `verdin.toml`, admin API and CLI references, statuses that are out of date |

## 0.10 — Modern docs and admin polish ✅

Released 2026-09-29.

| Item | Size | Notes |
|---|---|---|
| **Modern docs site** ✅ | L | Own visual identity (copper and verdigris, Anybody / Atkinson Hyperlegible / Martian Mono, logo), landing page with quickstart tabs, "from Strapi in three commands" and a nameplate of facts read from the repository; code tabs; Mermaid diagrams in the site's colors; API playground (Scalar) on the example project; `llms.txt`; Open Graph cards for every page; last-updated dates; published to GitHub Pages on every push to `main` |
| Docs information architecture ✅ | M | Get started (introduction, quickstart, Astro and Next.js tutorials, project structure) · Concepts · Guides (content, frontend, authentication, integrations) · Extending (overview, tutorial, reference) · API reference (REST, GraphQL, playground, admin, realtime, webhooks) · Reference (configuration, CLI checked in CI, permissions generated from the code, attribute types) · Deploy & operate (checklist, security, Docker, Fly, Render, Railway, Kubernetes, scaling, backups, monitoring) · Migrate & upgrade (from Strapi, compatibility matrix, upgrade notes) · Internals (split out of `architecture.md`, which moved to the site) |
| Docs in more languages ✅ | L | Every page in the admin's 17 languages besides English (right-to-left for Arabic, Persian and Hebrew); the generated permissions reference and the project pages stay in English |
| Admin modernization ✅ | M | Editor, builder, content list and media library split into components with one state service each; one entry picker and one content documents service; settings pages on Angular resources; `@defer` for the rich-text editors; route titles, focus management, a skip link and live announcements; shared pagination on long lists; view transitions |
| Admin test coverage ✅ | M | Component tests for the editor, builder, content list and media library; end-to-end tests for deployments, redirects, menus, forms, webhooks, end users, multi-admin presence and the app shell |
| Fixes from the docs review ✅ | S | CDN tags cover populated types; `verdin healthcheck` and an image `HEALTHCHECK`; S3 by environment variables in Docker; GraphQL `locale`; consistent webhook `model`; audited two-factor sign-ins; honest invitation emails with the `log` provider; plugin widgets' `context.fetch` on the content API; `SECURITY.md`; `verdin types` emits aliases the client accepts |

Left for later: a real domain for the docs, preview deployments for pull requests,
pagination on the admin endpoints that still return every row (users, API tokens, roles,
webhooks, releases, redirects, forms, menus, deploy targets) and paging deployments past
the latest 50.

## Road to 1.0

Each release has one theme; together they cover what a production 1.0 needs. Sizes add up
to roughly one to two months per release. The order follows the risk for people running
Verdin today: operating it first, then keeping data safe, then extending it, then the
editorial features, then freezing the surfaces.

## 0.11 — Operations at scale

Running several instances and operating them day to day, and the fixes found by moving a
real Strapi 5.55 project to Verdin 0.10 (same content through `verdin import strapi`, same
machine, SQLite).

| Item | Size | Notes |
|---|---|---|
| **`decimal` on SQLite** | S | Stored as text, so `sort` and `$gt`/`$lt`/`$between` compare strings (`sort=precio:desc` gives `8, 6, 25, 12, 10`; `precio[$gt]=9` gives nothing). Compare and sort as numbers (`CAST(… AS REAL)` for top-level columns, component values, relation sorts, GraphQL and the admin's list filters), with tests on the three cases above |
| `decimal` output | S | Whole values as `25` instead of `25.0`, as Strapi returns them (strict clients read a different type); `decimal_as_string` unchanged |
| SQLite write fairness | S | With 20 concurrent writers the p99 is 97 ms against Strapi's 73 ms: writers retry on `busy_timeout` in no order. Queue writes in order on one writer connection (`BEGIN IMMEDIATE`) so the tail follows the queue |
| Strapi i18n responses | S | `localizations` in entries of localized types and a public `GET /api/i18n/locales`, as in Strapi v5 |
| Plugin startup hook | S | A function run once when the plugin loads, for what Strapi projects do in `bootstrap` (seeding, locking down the public role); plugins only have scheduled jobs today |
| Porting Strapi custom code | S | A guide with a worked example plugin: controllers and custom routes to plugin routes, lifecycles to `before*`/`after*` hooks, `bootstrap` to the startup hook, admin widgets to plugin widgets, custom forms to Forms |
| **Shared event bus** | M | Realtime events, presence, cache invalidation and search updates across instances: Postgres `LISTEN/NOTIFY`, a polling table for MySQL/MariaDB/SQLite, Redis or NATS optional |
| Observability | S | OpenTelemetry traces with database spans, plugin call times in the metrics, optional Sentry error reporting, Grafana dashboards |
| Packaging | M | Helm chart, a production Compose recipe, Homebrew / apt / winget / `cargo binstall` / an install script, one-click deploys (Railway, Render, Fly, DigitalOcean, Coolify) |
| Pagination everywhere | S | Admin endpoints that still return every row (users, API tokens, roles, webhooks, releases, redirects, forms, menus, deploy targets) and deployments past the latest 50 |
| Docs hosting | S | A real domain, preview deployments for pull requests, and a hosted playground (an ephemeral SQLite instance reset hourly) |

## 0.12 — Data safety

Nothing is lost, and every project can move in and out.

| Item | Size | Notes |
|---|---|---|
| **Complete backups** | M | Encrypted exports; admins, roles, API tokens, webhooks, workflows and settings in exports; scheduled backups to S3; a documented restore drill |
| `verdin transfer` | M | Copy schema, content and media between running instances with transfer tokens |
| SQLite edge mode | M | Litestream-style WAL replication to S3 and read-only replicas: cheap high availability and point-in-time restore |
| Upgrade path | M | `verdin upgrade check` (pending migrations, deprecated settings, plugin ABI), a rollback story, upgrade guides per release |
| **Strapi import completeness** | M | Admins, RBAC and API tokens, webhooks, review workflows and releases, history, `unique` (the porting guide for custom code comes in 0.11) |
| Signed URLs for private buckets | S | Every file URL in responses signed for a short time |

## 0.13 — Extensibility and developer experience

A plugin ecosystem that can last past 1.0.

| Item | Size | Notes |
|---|---|---|
| **Plugin SDK** | M | Versioned host ABI (`abi = 1`), a plugin development kit crate and package, Extism on a released version |
| Plugin registry | M | `verdin plugin install`, a signed index, admin pages, editor panels and list actions from plugins |
| Access rules from plugins | S | RBAC conditions declared by plugins; "is owner" for end users |
| Scoped admin API tokens | S | Owner-bound tokens with a subset of the owner's permissions (Strapi 5.47) |
| Webhooks to queues | S | SQS, NATS, Kafka, Redis Streams and Pub/Sub as delivery targets |
| Remote fields | M | Data from external REST or GraphQL APIs through plugins (Hygraph-style federation) |
| Search engines | S | Meilisearch / Typesense sync as a plugin, for sites that already run one |
| **Typed SDKs 2.0** | M | Populate-aware result types in `@verdin/client`; clients for Rust, Go, Python, Dart and Swift from OpenAPI |
| Developer tools | S | JSON Schema for schema files, a VS Code extension, `verdin tui` |

## 0.14 — Editorial and localization

The admin panel for teams that publish every day, in many languages.

| Item | Size | Notes |
|---|---|---|
| **Localization workflows** | M | Per-locale review, "outdated translation" flags, translation queues |
| TMS connectors | M | XLIFF export and import, Crowdin, Lokalise, Phrase |
| **Collaborative editing** | L | Yjs in the blocks editor, cursors of the other admins |
| Content observability | S | Stale content, broken links, missing alt text and unused media dashboards, built on "where used" |
| Digest and realtime | S | Open tasks and mentions in the daily digest; GraphQL subscriptions over the realtime events |
| Guided tour | S | A first-run tour for new admins |

## 0.15 — Release candidate

Freeze the surfaces and prove them. Only fixes and the items below.

| Item | Size | Notes |
|---|---|---|
| **Stability contract** | S | Which surfaces are semver-stable (REST, GraphQL, admin API, schema files, `verdin.toml`, CLI, plugin ABI, export format); deprecation policy with `Deprecation` / `Sunset` headers; supported-versions and LTS policy |
| **Security program** | M | Fuzzing of the query parser and the importers, an external review, signed releases (cosign), SBOM and provenance |
| Benchmarks | M | Published numbers against Strapi (reads, populate, GraphQL, writes, cold start, memory), gated in CI |
| Performance | M | Query batching, a prepared statement cache, fixes from the benchmarks |
| Accessibility audit | M | WCAG 2.2 AA for the admin panel, keyboard and screen reader passes |

## 1.0 — Stable

Released when 0.15 has had no breaking change for a month and every surface in the
stability contract has its reference page and tests. From then on, breaking changes wait
for 2.0 and deprecated behaviour keeps working for at least one minor release.

## After 1.0

Larger features, in 1.x minor releases, ranked by value:

| Feature | Size | Notes |
|---|---|---|
| Environments | L | Clone schema and content into a staging environment, migrate, then swap (Contentful aliases); schema migrations as code |
| Flows | L | Visual automations from triggers (events, cron, webhook, button) to operations (condition, transform, request, email, plugin call), à la Directus Flows |
| Multi-tenancy | L | Several sites in one instance with row-level policies (Directus policies, Payload tenants) |
| Semantic search | M | Embeddings in pgvector or sqlite-vec, hybrid with full-text search |
| AI content modeling | M | Content types from a description, URL or design; MCP schema tools; bulk AI edits with a dry-run diff |
| A/B variants and personalization | L | Field-level variants by audience, with an SDK helper |

## Continuous

- More admin and documentation languages (Traditional Chinese, Vietnamese, Indonesian,
  Czech, Swedish…) — contributions welcome, see [translating.md](translating.md).
- Performance and benchmarks against Strapi, release after release.
- Accessibility audits of the admin (keyboard navigation, screen readers).
