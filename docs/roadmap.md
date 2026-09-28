# Verdin roadmap

What is left after 0.7, grouped by release. The order is tentative and driven by feedback;
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
| Email providers ✅ | M | SMTP and API providers (Resend, SES, Postmark) for end-user and admin emails |
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
| Horizontal scaling ✅ | S | Several instances behind a load balancer: settings synced between instances, releases, webhooks and the digest claimed in the database, plugin jobs on one instance ([scaling.md](scaling.md)) |
| Plugin runtime upgrade | M | Moved to 0.8 |

## 0.8 — Strapi parity

Gaps found by checking the code against Strapi v5 (up to 5.47): what a Strapi project needs
to move to Verdin without losing features.

| Item | Size | Notes |
|---|---|---|
| **Conditional fields** | M | `conditions.visible` on attributes (Strapi 5.17 JSON Logic format), evaluated in the editor and on write; 0.7 loads and keeps them without applying them |
| `password` attribute type | S | Hashed on write, always private; kept by `verdin import strapi` |
| Morph relations | L | `morphToOne`/`morphToMany`/`morphOne`/`morphMany`, API and populate only (Strapi has no admin UI for them either) |
| Populate gaps | S | Dynamic zone `on` fragments, `count: true`, filters on repeatable components and dynamic zones, sort by a relation's field, `hasPublishedVersion` |
| Edit view layout | M | Field order, width, label, description, placeholder, editable, main field of relations; honour `configurable: false` in the builder |
| Duplicate entry | S | Clone from the list and the editor (`POST …/actions/clone`), relations and media copied, unique fields cleared |
| Content list filters | M | Filter builder with several conditions on any field, relations included; locale column |
| Relations UI | S | Drag and drop reordering, open and edit the related entry in a side sheet |
| Side-by-side live preview | M | Preview in an iframe next to the form, refreshed on save; device widths |
| Admin invitations & password reset | S | Invite link with a token instead of setting a password, forgot-password email, own profile page (name, email, password) |
| Sessions & tokens | S | List and revoke own admin sessions; regenerate API tokens; scoped, owner-bound admin API tokens (Strapi 5.47) |
| RBAC | M | Per-locale permissions; conditions beyond `is-creator` (declared by plugins); "is owner" for end users |
| End users | S | Refresh tokens, `/api/users` CRUD with permissions, more OAuth presets (Microsoft, Discord, Facebook, Apple, Keycloak, Auth0), HTML email templates |
| Media library | M | Replace a file keeping its id, crop in the admin, upload from URL, PDF preview, signed URLs for private buckets, optimize originals |
| Webhook events | S | `releases.publish`, `review-workflows.updateEntryStage` (after 0.7) |
| Admin branding | S | Logo, favicon, accent colour and translation overrides in `[admin]` |
| GraphQL | M | Disable types or actions per content type (shadow CRUD), resolvers from plugins |
| Export / import / backup | M | `verdin export` / `verdin import` of Verdin's own format (schema, data, media), optional encryption; scheduled backups to S3; `verdin transfer` between instances with transfer tokens |
| **MCP server** | M | Content and schema tools for AI agents over Streamable HTTP, authorized with API tokens (Strapi 5.47, Sanity, Directus, Payload ship one) |
| Plugin runtime upgrade | M | Follow extism to a current wasmtime, or embed wasmtime directly (clears the `cargo deny` advisories on wasmtime 43) |

## 0.9 — Beyond Strapi

Features from other CMSs (Payload, Directus, Sanity, Contentful, Storyblok, PocketBase,
Hygraph) that fit Verdin best.

| Item | Size | Notes |
|---|---|---|
| **Realtime API** | M | SSE (and GraphQL subscriptions) on document events, filtered by the reader's permissions; PocketBase-style, fits the event bus |
| Document locking & presence | S | "Who is editing" avatars and a soft lock in the editor, over the realtime channel; the step before co-editing |
| **Visual editing** | M | Content source maps (stega) in preview responses and a small overlay script: click on the site, jump to the field |
| Comments & tasks | M | Threads on entries and fields, @mentions, assignable tasks; notifications and the digest; pairs with review workflows |
| Where used | S | Inverse references of an entry or file (relations, components, blocks), shown in the editor and the media library; warns before delete |
| Image transformations | M | `/uploads/…?w=&h=&fit=&format=&q=` with focal-point crops, signed presets and a disk cache |
| Full-text search | M | Tantivy index inside the binary, `?_q=` on the REST API and in the admin list; optional Meilisearch/Typesense sync plugin |
| 2FA for admins | S | TOTP and passkeys (WebAuthn), recovery codes, enforceable per role |
| CSV/JSON import & export | S | Per content type from the list, with field mapping and a dry run |
| Cross-field validation | S | Rules that compare fields (`endDate > startDate`) declared in the schema |
| Official plugins | S each | SEO fields + sitemap, redirects, nested pages and menus, form builder with submissions |
| AI actions | M | Translate a locale, alt text, summaries and SEO suggestions, with the key of the user's provider (Anthropic, OpenAI, local); off by default |
| Deploy & CDN hooks | S | "Deploy" button calling a build hook with its status; CDN purge (Cloudflare, Fastly, Vercel tags) on publish |
| Metrics | S | Prometheus `/_metrics` (requests, latency, queues, plugin time); optional Sentry reporting |

## Later

Large items worth doing once 0.9 lands:

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

## Continuous

- More admin languages (Traditional Chinese, Vietnamese, Indonesian, Czech, Swedish…) —
  contributions welcome, see [translating.md](translating.md).
- Performance: query batching, prepared statement cache, benchmarks against Strapi.
- Accessibility audits of the admin (keyboard navigation, screen readers).
