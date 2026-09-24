# Verdin roadmap

What is left after 0.1, grouped by release. The order is tentative and driven by feedback;
everything lands in the open source edition (there is no paid tier).

Legend: **S** small (days), **M** medium (1–2 weeks), **L** large (weeks).

## 0.2 — Media, GraphQL and editing

| Item | Size | Notes |
|---|---|---|
| Runtime features ✅ | M | Settings → Features, switched live; API documentation with Scalar |
| **GraphQL** | L | Feature switch; `async-graphql` dynamic schema generated from content types (queries, `_connection`, mutations, Strapi v5 shapes), same permissions as REST, filters/pagination/sort compatible with Strapi's GraphQL plugin, depth and complexity limits |
| **Media library** ✅ | L | `media` attribute type (single/multiple, allowed types), `vd_files` + folders, upload API (`POST /api/upload`, Strapi-compatible response), image metadata, thumbnails and responsive formats (`image` crate, generated on upload, WebP/AVIF), focal point, alt text and captions, drag-and-drop library in the admin with grid/list views, search and folders, picker dialog in forms |
| Upload providers ✅ | M | Local disk (default) and S3-compatible (AWS, R2, B2, RustFS) through `object_store`, size limits and MIME sniffing. Next: signed URLs for private buckets, WebP/AVIF variants, media inside components |
| **Blocks editor** | L | Strapi `blocks` JSON format, TipTap-based editor in the admin (headings, lists, quotes, code, images from the media library, links) |
| Markdown preview | S | Split view for `richtext` fields |
| Relations and media inside components | M | Links from component JSON to documents and files, populate |
| Field-level permissions | M | Per-role readable/writable fields in the admin and for API tokens |
| TypeScript types & SDK | M | `verdin types` generates TS interfaces for every content type; small typed REST client (`@verdin/client`) |
| Schema file watcher | S | `verdin dev` reloads when schema files change on disk |

## 0.3 — Content operations

| Item | Size | Notes |
|---|---|---|
| **Content i18n** | L | Locales management, per-type and per-field localization (the `locale` column already exists), `?locale=` in the API, locale switcher and "fill from another locale" in the editor |
| **Webhooks** | M | Event bus (entry create/update/delete/publish/unpublish, media events), signed deliveries (HMAC), retries with backoff, delivery log in the admin |
| **Strapi importer** | L | `verdin import strapi` reads a Strapi v4/v5 project (schemas, components) and its database or a transfer export (data, relations, media) |
| Content history | M | Versions of every document with diff and restore |
| Bulk actions | S | Publish, unpublish and delete many entries from the list |
| List view settings | S | Choose columns, default sort and page size per type |

## 0.4 — End users

| Item | Size | Notes |
|---|---|---|
| End users | L | The `users-permissions` equivalent: registration, email confirmation, password reset, JWT, roles for the content API, OAuth providers (Google, GitHub, …) |
| Email providers | M | SMTP and API providers (Resend, SES, Postmark) for end-user and admin emails |
| Rate limiting & caching for the content API | M | Per-token limits, ETags, optional in-memory response cache |

## 0.5 — Extensibility

| Item | Size | Notes |
|---|---|---|
| **WASM plugins** | L | Extism-based: Document Service hooks (before/after create, update, publish…), custom routes, scheduled jobs; capability-based permissions |
| **Plugin widgets and fields** | M | Plugins ship Web Components loaded into the admin: dashboard widgets (next to the built-in counter, list, recent activity, poll, note, links and system widgets), custom field types, settings pages |
| Custom fields | M | Declared by plugins: storage type, validation, admin input |
| Widget notifications | S | Badge in the sidebar and optional email digest for "not seen yet" widgets |
| Chart widgets | S | Entries created per day/week, published vs drafts (needs an aggregation endpoint) |

## 0.6+ — Governance and scale

| Item | Size | Notes |
|---|---|---|
| SSO / OIDC | M | Admin login through any OpenID Connect provider, group-to-role mapping |
| Audit logs | M | Who did what and when, filterable in the admin, retention settings |
| Review workflows | L | Configurable stages per content type, assignees, stage permissions |
| Releases & scheduling | M | Group entries into a release, publish/unpublish at a date |
| Preview | M | Configurable preview URLs per content type, draft tokens |
| Documentation site | M | Astro Starlight at verdin.dev: guides, API reference generated from OpenAPI, migration guide from Strapi |
| Admin RTL languages | S | Arabic, Hebrew, Persian (the layout already uses logical properties) |
| Horizontal scaling notes | S | Multiple instances behind a load balancer (sessions are in the database already), health checks |

## Continuous

- More admin languages (Traditional Chinese, Vietnamese, Indonesian, Czech, Swedish…) —
  contributions welcome, see [translating.md](translating.md).
- Performance: query batching, prepared statement cache, benchmarks against Strapi.
- Accessibility audits of the admin (keyboard navigation, screen readers).
