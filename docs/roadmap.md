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

## 0.9.1 — Hardening

From the audit after 0.9.0 (security findings are tracked privately until they ship).

| Item | Size | Notes |
|---|---|---|
| Security hardening | M | Authorization, sign-in and throttling fixes from the audit (details published with the release) |
| Rate limits behind proxies | S | Trusted-proxy `X-Forwarded-For`, bounded limiter maps |
| CORS | S | Configurable allow-list for the content API (browser frontends on other origins) |
| Bounded work | S | Large responses, exports, populated to-many relations, the sitemap (cached) and "where used" without long locks |
| Multi-instance correctness | M | Shared state for one-time challenges; an outbox for webhooks and events |
| Admin safety | S | Unsaved-changes guard, confirmations for unpublish and discard, permission- and feature-aware route guards, loading and error states on every settings page |
| `@verdin/client` 0.9.x on npm | S | The client follows the workspace version (checked in CI) |
| Docs corrections | S | Sample `verdin.toml`, admin API and CLI references, statuses that are out of date |

## 0.10 — Modern docs and admin polish

| Item | Size | Notes |
|---|---|---|
| **Modern docs site** | L | Redesigned with the **frontend-designer**: its own visual identity (logo, colors, type), a landing page with a terminal quickstart, "Strapi to Verdin in 3 commands" and footprint numbers; code tabs (Docker / binary, REST / GraphQL / client), diagrams (Mermaid or D2), an API playground (Scalar), `llms.txt`, Open Graph images, last-updated dates, deployed with previews on a real domain |
| Docs information architecture | M | Get started (quickstart, tutorial: a blog with Astro / Next.js) · Concepts (content model, draft & publish, relations, permissions, migrations) · Guides (content, frontend, auth, integrations) · Extending (plugins tutorial and reference) · API reference (REST, GraphQL, admin, realtime, webhooks) · Reference (configuration, CLI and permissions generated from the code) · Deploy & operate (production checklist, security, Docker, Fly, Render, Railway, Kubernetes, backups, monitoring) · Migrate & upgrade (from Strapi, compatibility matrix, upgrade guides) · Internals for contributors (split out of `architecture.md`) |
| Docs in more languages | M | Starlight locales, starting with Getting started in es, fr, de and zh |
| Admin modernization | M | Split the largest components (editor, builder, lists, media library), one entry picker and one content API service, `httpResource` loaders, `@defer` for the rich-text editors, route titles, focus management and a skip link, pagination on long lists, view transitions |
| Admin test coverage | M | Component tests for the editor, builder and lists; end-to-end tests for deployments, redirects, menus, forms, webhooks, end users and multi-admin presence |

## Toward 1.0

What a production 1.0 needs beyond features:

| Item | Size | Notes |
|---|---|---|
| Stability contract | S | Which surfaces are semver-stable (REST, GraphQL, admin API, schema files, `verdin.toml`, CLI, plugin ABI, export format), deprecation policy with `Deprecation`/`Sunset` headers, LTS and supported-versions policy |
| Upgrade path | M | Upgrade guides per release, `verdin upgrade check`, rollback story |
| Plugin SDK | M | Versioned host ABI (`abi = 1`), a PDK crate/package, Extism on a released version |
| Benchmarks | M | Published numbers against Strapi (reads, populate, GraphQL, writes, cold start, memory), gated in CI |
| Security program | M | `SECURITY.md` and disclosure process, fuzzing of the query parser, an external review, signed releases (cosign), SBOM and provenance |
| Complete backups | M | Encryption, scheduled S3 backups, `verdin transfer`, admins/roles/tokens/webhooks/workflows in exports, a documented restore drill |
| Shared event bus | M | Realtime, presence, caches and search across instances (Postgres `LISTEN/NOTIFY`, a polling table, or Redis/NATS) |
| Observability | S | OpenTelemetry traces with DB spans, plugin call times, Sentry, Grafana dashboards |
| Packaging | M | Helm chart, production Compose recipe, Homebrew / apt / winget / `cargo binstall` / install script, one-click deploys (Railway, Render, Fly, DigitalOcean, Coolify) |
| Strapi import completeness | M | End users and roles, admins/RBAC/tokens, webhooks, workflows and releases, history, `unique`, and a porting guide for lifecycles and cron tasks |
| Accessibility audit | M | WCAG 2.2 AA for the admin |

## Ideas

Beyond the roadmap, ranked by value for Verdin's single binary:

| Idea | Size | Notes |
|---|---|---|
| SQLite edge mode | M | Litestream-style WAL replication to S3 and read-only replicas: cheap HA and point-in-time restore |
| Webhooks to queues | S | SQS, NATS, Kafka, Redis Streams, Pub/Sub as delivery targets |
| Content observability | S | Stale content, broken links, missing alt text, unused media dashboards, built on "where used" |
| Typed SDKs 2.0 | M | Populate-aware result types; clients for Rust, Go, Python, Dart, Swift from OpenAPI |
| AI content modeling | M | Content types from a description, URL or design; MCP schema tools; bulk AI edits with a dry-run diff |
| Localization workflows | M | Per-locale review, "outdated translation" flags, XLIFF, translation queues |
| A/B variants and personalization | L | Field-level variants by audience with an SDK helper |
| Hosted playground | S | An ephemeral SQLite instance reset hourly; `llms.txt` and agent skills |
| Developer tools | S | JSON Schema for schema files, a VS Code extension, `verdin tui` |

## Later

Large items worth doing after the 0.9 releases:

- Collaborative editing (Yjs) in the blocks editor.
- Environments: clone schema and content into a staging environment, migrate, then swap
  (Contentful aliases); schema migrations as code.
- Flows: visual automations from triggers (events, cron, webhook, button) to operations
  (condition, transform, request, email, plugin call), à la Directus Flows.
- Multi-tenancy / multi-site with row-level policies (Directus policies, Payload tenants).
- Semantic search (pgvector, sqlite-vec).
- Remote fields: data from external REST/GraphQL APIs through plugins (Hygraph federation).
- Plugin registry and `verdin plugin install`; admin pages, editor panels and list actions
  from plugins.
- TMS connectors (XLIFF export/import, Crowdin, Lokalise, Phrase).
- Guided tour for first-time admins.
- Signed URLs for private buckets (every file URL in responses signed for a short time).
- Scoped, owner-bound admin API tokens (Strapi 5.47).
- Plugin call times in the metrics, and optional Sentry error reporting.
- GraphQL subscriptions over the realtime events.
- Open tasks and mentions in the daily digest.
- Meilisearch / Typesense sync, as a plugin, for sites that already run one.
- RBAC conditions declared by plugins, and "is owner" for end users.
- Encrypted exports, scheduled backups to S3, and `verdin transfer` between running
  instances with transfer tokens.

## Continuous

- More admin languages (Traditional Chinese, Vietnamese, Indonesian, Czech, Swedish…) —
  contributions welcome, see [translating.md](translating.md).
- Performance: query batching, prepared statement cache, benchmarks against Strapi.
- Accessibility audits of the admin (keyboard navigation, screen readers).
