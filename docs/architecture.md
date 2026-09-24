# Verdin — Architecture (MVP)

> Status: draft v0.5 · 2026-09-24 (M0–M3 implemented)
> Verdin is an open source headless CMS written in Rust, inspired by Strapi v5.
> Everything is free software: there is no "Enterprise" edition and no paid features.

---

## 1. Vision

Verdin aims to deliver the Strapi experience (visual content modeling, generated REST API, admin panel) with:

- **A single binary** (`verdin`) containing the server, the CLI and the embedded admin panel. No `node_modules` in production.
- **Millisecond startup and a small memory footprint.**
- **Real multi-database support from day one**: PostgreSQL, MySQL, MariaDB and SQLite, all covered by the same test suite.
- **Schema as code**: content types are JSON files you version in git.
- **A REST API compatible with Strapi v5** wherever reasonable, so existing frontends migrate with minimal changes.
- **Everything free**: SSO, audit logs, review workflows, releases — when they land, they land for everyone.

### 1.1 MVP goals (v0.1)

1. Define content types (collection types and single types) and components in schema files.
2. Generate and apply database migrations automatically from schema changes.
3. Content REST API: CRUD, filters, sorting, pagination, field selection and `populate`.
4. Relations, components and dynamic zones.
5. Draft & publish.
6. Admin users, basic roles, API tokens and public permissions.
7. Admin panel in Angular + spartan/ui: login, content manager, content-type builder (dev mode only) and settings.
8. Automatically generated OpenAPI.

### 1.2 Out of the MVP (planned)

Media library and upload providers, content i18n, GraphQL, webhooks, WASM plugins, end users (the `users-permissions` equivalent), SSO/OIDC, audit logs, review workflows, releases, content history, blocks editor and a Strapi importer. See §17.

### 1.3 Non-goals

- Compatibility with Strapi (JS) plugins. The plugin system will be WASM-based.
- Binary compatibility with Strapi's database. Migration is done through an importer.
- Frontend rendering: Verdin is headless.

---

## 2. Design principles

1. **The schema is the source of truth.** The database, validation, REST API, OpenAPI and admin forms are all derived from it.
2. **No SQL identifier ever comes from a request.** Tables and columns come only from the validated schema; every value is a bound parameter.
3. **Dialects are first-class citizens.** No "works on Postgres, we'll fix MySQL later". Every feature is tested on all four engines.
4. **Secure by default.** The content API is closed until permissions are granted, `private` fields are never exposed, depth and size limits are always on.
5. **Destructive operations are explicit.** Dropping columns or tables requires confirmation; it never happens implicitly.
6. **No global magic.** Services are injected through `axum` state; no singletons.

---

## 3. Overview

```
                ┌────────────────────────────── verdin (binary) ────────────────────────────────┐
                │                                                                               │
 Frontends ───▶ │  /api/*  Content API (REST)  ─┐                                               │
                │                               │                                               │
 Admin SPA ───▶ │  /admin/api/*  Admin API ─────┼──▶  Document Service ──▶  Query Engine ──▶ DB  │──▶ PostgreSQL
 (embedded)     │  /admin/*  Angular assets     │        │     │               (sea-query)     │    MySQL
                │                               │        │     └─ Validation (schema)          │    MariaDB
                │  Auth / RBAC middleware ──────┘        └─ Event bus (lifecycles)             │    SQLite
                │                                                                               │
                │  Schema Registry ◀── schema/*.json ──▶ Migration Engine (diff + plan + apply)  │
                └───────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Tech stack

### 4.1 Backend (Rust, edition 2024)

| Area | Choice | Why |
|---|---|---|
| Runtime | `tokio` | De facto standard |
| HTTP | `axum` + `tower` + `tower-http` | Ergonomic, mature middleware (CORS, compression, timeouts, limits) |
| SQL driver | `sqlx` (postgres, mysql, sqlite) | Async, pooling, TLS; MySQL and MariaDB share one driver |
| SQL building | Own per-dialect builders: DDL in `verdin-migrate`, DML in `verdin-query` / `verdin-content` | Tables are dynamic (defined by the schema), so SQL is built at runtime. Exact control is needed anyway (`jsonb`, `datetime(3)`, binary collations, typed NULLs on PostgreSQL, SQLite text formats). No ORM, no `sea-query` |
| Serialization | `serde`, `serde_json` | — |
| Query strings | `serde_qs` | Strapi-style bracket notation (`filters[title][$eq]=…`) |
| Schema validation | Rust types + strict `serde` (`deny_unknown_fields`) | Clear errors when loading the schema |
| Decimals | `rust_decimal` | No precision loss inside the server |
| Dates | `time` | — |
| Document IDs | `ulid` | Sortable, 26 chars, portable |
| OpenAPI | `utoipa` (static routes) + custom generator (per-content-type routes) | — |
| Auth | `jsonwebtoken`, `argon2`, `sha2`/`hmac`, `rand` | — |
| Configuration | `figment` (TOML + env) | Layering and per-environment overrides |
| CLI | `clap` | — |
| Logs & tracing | `tracing`, `tracing-subscriber` (JSON in production) | — |
| Rate limiting | `tower_governor` | Login and sensitive endpoints |
| Admin embedding | `rust-embed` | Admin shipped inside the binary |
| File watching (dev) | `notify` | Schema reload |
| Errors | `thiserror` (libraries), `anyhow` (binary) | — |
| Tests | `cargo nextest`, `insta` (snapshots), optional `testcontainers` | — |

### 4.2 Admin (Angular)

| Area | Choice |
|---|---|
| Framework | Angular ≥ 21: standalone, zoneless, signals |
| UI | spartan/ui (brain + helm) on Tailwind CSS v4 |
| Icons | `@ng-icons` with Lucide |
| State | NgRx Signal Store |
| Forms | Signal Forms (`@angular/forms/signals`) |
| Tables | `@tanstack/angular-table` + spartan helm table |
| API client | Types generated with `openapi-typescript` from the Admin API OpenAPI + a thin `HttpClient` wrapper |
| UI i18n | Transloco (runtime language loading, works with a single embedded build) |
| Markdown | `marked` + `DOMPurify` (preview) |
| Tests | Vitest + Playwright (e2e against the binary on SQLite) |

### 4.3 Documentation & website

Astro + Starlight in `website/` (post-MVP). This document will move there as an "Internals" section.

---

## 5. Repository layout

```
verdin/
├── Cargo.toml                 # workspace
├── crates/
│   ├── verdin-schema/         # schema model, parser, validation, registry
│   ├── verdin-db/             # dialects, pool, type mapping, introspection
│   ├── verdin-migrate/        # snapshot, diff, plan, journaled execution
│   ├── verdin-query/          # query params → AST → SQL (filters, sort, populate)
│   ├── verdin-content/        # Document Service, data validation, draft/publish, event bus
│   ├── verdin-auth/           # admin users, sessions, API tokens, RBAC
│   ├── verdin-api/            # axum routers: content API, admin API, OpenAPI
│   ├── verdin-testkit/        # test helpers (a fresh database per test); not published
│   └── verdin/                # binary: config, bootstrap, CLI, embedded admin
├── admin/                     # Angular + spartan
├── website/                   # Astro Starlight (post-MVP)
├── sdk/ts/                    # generated TS client (post-MVP)
├── examples/blog/             # example app
├── tests/conformance/         # REST suite run against all 4 dialects
├── docker/compose.dev.yml     # postgres 17, mysql 8.4, mariadb 10.11 and 11.4
└── docs/                      # design documents (this file)
```

Dependency rule: `schema` ← `db` ← `migrate`/`query` ← `content` ← `auth` ← `api` ← `verdin`. No cycles.

---

## 6. User project

```
my-site/
├── verdin.toml
├── .env                       # secrets (never commit)
├── schema/
│   ├── content-types/
│   │   ├── article.json
│   │   └── homepage.json
│   └── components/
│       └── shared/
│           └── seo.json
└── data/                      # sqlite (if used); uploads later
```

### 6.1 `verdin.toml`

```toml
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://cms.example.com"

[database]
# url is read from VERDIN_DATABASE_URL when not set here
# postgres://…  |  mysql://…  (also used for MariaDB)  |  sqlite://data/verdin.db
pool_max = 10

[api]
prefix = "/api"
default_page_size = 25
max_page_size = 100
max_populate_depth = 5
decimal_as_string = false

[admin]
enabled = true
path = "/admin"

[security]
cors_origins = ["https://www.example.com"]
body_limit = "1mb"
```

Secrets come from the environment only: `VERDIN_DATABASE_URL`, `VERDIN_ADMIN_JWT_SECRET`, `VERDIN_TOKEN_PEPPER`. In `start` mode the server refuses to boot if they are missing.

---

## 7. Content model

### 7.1 Schema format

Close to Strapi's `schema.json` to ease migration:

```json
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "collectionName": "articles",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title":    { "type": "string", "required": true, "maxLength": 200 },
    "slug":     { "type": "uid", "targetField": "title", "required": true },
    "body":     { "type": "richtext" },
    "views":    { "type": "integer", "default": 0, "min": 0 },
    "price":    { "type": "decimal", "precision": 10, "scale": 2 },
    "stage":    { "type": "enumeration", "enum": ["idea", "review", "final"] },
    "internal": { "type": "text", "private": true },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags":     { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo":      { "type": "component", "component": "shared.seo", "repeatable": false },
    "blocks":   { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

Content type UID: `api::article`. The Strapi form `api::article.article` is accepted as an alias by the importer.

### 7.2 MVP attribute types

| Type | Options | Postgres | MySQL / MariaDB | SQLite |
|---|---|---|---|---|
| `string`, `email` | `maxLength` (≤ 255), `minLength`, `regex` (string), `unique` | `varchar(255)` | `varchar(255)` | `text` |
| `text`, `richtext` | `maxLength` | `text` | `longtext` | `text` |
| `uid` | `targetField`, implicitly `unique` | `varchar(255)` | `varchar(255)` | `text` |
| `integer` | `min`, `max` | `integer` | `int` | `integer` |
| `biginteger` | — | `bigint` | `bigint` | `integer` |
| `float` | — | `double precision` | `double` | `real` |
| `decimal` | `precision`, `scale` | `numeric(p,s)` | `decimal(p,s)` | `text` |
| `boolean` | — | `boolean` | `tinyint(1)` | `integer` |
| `date` | — | `date` | `date` | `text` (ISO) |
| `time` | — | `time(3)` | `time(3)` | `text` |
| `datetime` | — | `timestamptz(3)` | `datetime(3)` (UTC) | `text` (ISO UTC) |
| `enumeration` | `enum` | `varchar(255)` | `varchar(255)` | `text` |
| `json` | — | `jsonb` | `json` | `text` |
| `relation` | see §8.4 | link table | link table | link table |
| `component`, `dynamiczone` | see §8.5 | `jsonb` | `json` | `text` |

Common options: `required`, `default`, `private`, `unique` (where applicable), `configurable`.

Notes:
- `string`, `email`, `uid` and `enumeration` are always `varchar(255)`: MySQL counts `varchar` bytes against its 65,535-byte row limit, so longer values belong in `text`. A type may have at most 60 such attributes.
- `enumeration` does not use MySQL's native `ENUM`: altering it is expensive and not portable. Values are validated in the application.
- **Every attribute column is nullable.** As in Strapi v5, drafts may be incomplete, so `required` is enforced when publishing, not by the database. Adding a required attribute is therefore a safe migration.
- `decimal` is stored exactly (`rust_decimal`) and serialized as a **JSON number** by default, matching Strapi, so existing frontends keep working. Projects that need values beyond double precision (> 15 significant digits) set `api.decimal_as_string = true`.
- `richtext` in the MVP is Markdown. The `blocks` type (structured JSON, TipTap editor) comes later.

---

## 8. Storage

### 8.1 Naming conventions

- Content tables: `collectionName` (defaults to `snake_case(pluralName)`).
- System tables: `vd_` prefix (`vd_admin_users`, `vd_schema_snapshots`…).
- Relation tables: `{source_table}_{field}_lnk`.
- Identifiers are capped at **60 characters** (PG allows 63, MySQL 64). Longer names are truncated with a deterministic 8-char hash suffix.
- Valid identifiers match `^[a-z][a-z0-9_]*$`, and every identifier is quoted in generated SQL, so SQL reserved words are harmless.
- Attribute names are camelCase (`^[a-z][a-zA-Z0-9]*$`, ≤ 50 chars); columns are their snake_case form. Names used by the API or by system columns are reserved: `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy` (and `id` inside components).

### 8.2 System columns on every content type

```sql
id             BIGINT       PK autoincrement
document_id    CHAR(26)     NOT NULL        -- ULID, stable across draft/published/locales
locale         VARCHAR(16)  NOT NULL DEFAULT ''   -- '' = not localized (ready for i18n)
publication_state SMALLINT  NOT NULL        -- 0 = draft, 1 = published
published_at   <datetime>   NULL
created_at     <datetime>   NOT NULL
updated_at     <datetime>   NOT NULL
created_by_id  BIGINT       NULL            -- vd_admin_users.id
updated_by_id  BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

`locale = ''` is used instead of `NULL` because NULLs never collide in unique indexes on any dialect, which would break uniqueness.

`unique` attributes (and every `uid`) get a unique index on `(column, locale, publication_state)`: a draft and its published version share values, while two published documents cannot. The database enforces it, race-free.

### 8.3 Draft & publish

Same conceptual model as Strapi v5:
- A **document** (`document_id`) has at most one `publication_state=0` (draft) row and one `publication_state=1` (published) row per locale.
- Edits always target the draft row.
- **Publish** copies the draft row onto the published row (upsert on `(document_id, locale, publication_state=1)`) in one transaction, including the row's own relation links.
- **Unpublish** deletes the published row. **Discard draft** replaces the draft with a copy of the published row.
- Content types without `draftAndPublish` only ever have a `publication_state=1` row.
- The content API serves `published` by default; `?status=draft` requires a dedicated permission.

### 8.4 Relations: linked by `document_id`

**Key difference from Strapi.** Strapi links rows (row ids) and has to rewrite relations on publish. Verdin stores a relation as *source row → target document*:

```sql
-- articles_category_lnk
id                  BIGINT   PK autoincrement
source_id           BIGINT   NOT NULL  REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL  -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                     -- to-one kinds only (oneToOne, manyToOne, oneWay)
INDEX  (target_document_id)
```

- The target is resolved at query time: `JOIN categories c ON c.document_id = lnk.target_document_id AND c.publication_state = :current_state AND c.locale = :locale`.
  - A published article only sees published categories; if a category is unpublished it "disappears" from the published article without touching any link.
  - Publishing only copies the row's own links.
- Only the **owning** side (`inversedBy`) stores the relation. The inverse side (`mappedBy`) queries the same table in reverse. No duplicated tables.
- Supported kinds: `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay`. "At most one target" is a unique index on `source_id`. "A target belongs to one source document" (`oneToOne`, `oneToMany`) cannot be an index, because a draft and its published version legitimately share targets; the Document Service enforces it by *moving* the target: linking it removes the links other documents' rows hold to it, in the same state (Strapi's behaviour).
- Only the owning side is writable. Writing a `mappedBy` side is a validation error that names the owning attribute.
- Deleting a document removes the links pointing at it in the same transaction; its own links go with its rows (`ON DELETE CASCADE`, which also covers unpublishing).
- No FK on `target_document_id` (it is not unique in the target table). Integrity is enforced by the Document Service, which also rejects links to documents that do not exist.
- Migrations run with SQLite's `foreign_keys` off, so table rebuilds do not cascade into link tables. Renaming a table renames its link tables with it.

### 8.5 Components and dynamic zones: a JSON column

A component is a reusable group of fields (e.g. `shared.seo` = metaTitle + metaDescription) embedded inside a document. A dynamic zone is a list mixing several component kinds (e.g. a page body made of hero, quote and gallery blocks).

Strapi stores each component in its own table with polymorphic link tables, which multiplies joins and makes versioning painful. Verdin stores them **in a JSON column** on the document row:

```json
// "seo" column
{ "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (dynamic zone)
[
  { "__component": "blocks.hero",  "id": "01J…", "title": "…" },
  { "__component": "blocks.quote", "id": "01J…", "text": "…", "author": "…" }
]
```

- Strict validation against the component schema on every write.
- Publish and discard copy the JSON as-is (free).
- **Relations inside components** (planned) will be stored as `document_id`s inside the JSON and resolved by the populate engine with batched queries. Until then writing them is a validation error.
- **Trade-off**: filtering on component fields needs dialect-specific JSON functions (`->>` on PG, `JSON_EXTRACT`/`JSON_VALUE` on MySQL/MariaDB, `json_extract` on SQLite). In the MVP only scalar fields of **non-repeatable** components are filterable. Repeatable components and dynamic zones are not filterable in v0.1 (in practice, filtering by them is rare).

### 8.6 MVP system tables

`vd_schema_snapshots`, `vd_migrations_journal`, `vd_admin_users`, `vd_admin_roles`, `vd_admin_permissions`, `vd_admin_user_roles`, `vd_sessions` (refresh tokens), `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions`.

---

## 9. Multi-dialect database layer

### 9.1 Minimum versions

| Engine | Minimum | Reason |
|---|---|---|
| PostgreSQL | 14 | Supported versions |
| MySQL | 8.4 LTS | 8.0 end of life since April 2026 |
| MariaDB | 10.11 LTS | `INSERT … RETURNING` (≥10.5), usable JSON |
| SQLite | 3.35 | `RETURNING`, `DROP COLUMN` (bundled through `libsqlite3-sys`) |

### 9.2 Abstraction

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }   // MariaDB detected via SELECT VERSION()

pub trait Dialect {
    fn column_type(&self, attr: &Attribute) -> ColumnType;
    fn supports_returning(&self) -> bool;          // MySQL: false
    fn transactional_ddl(&self) -> bool;           // MySQL/MariaDB: false
    fn case_insensitive_like(&self, col: Expr, pat: Expr) -> SimpleExpr;
    fn case_sensitive_like(&self, col: Expr, pat: Expr) -> SimpleExpr;
    fn json_extract_text(&self, col: Expr, path: &[&str]) -> SimpleExpr;
    // …
}
```

- Queries are built with `sea-query` and executed on the matching backend through `sea-query-binder`.
- **Schema-driven decoding**: every column is decoded according to its declared attribute type, not the type reported by the driver. This fixes at the root that MariaDB returns `JSON` as `LONGTEXT`, MySQL returns booleans as `TINYINT`, and SQLite returns dates as text.

### 9.3 Dialect differences handled explicitly

| Topic | Postgres | MySQL 8.4 | MariaDB | SQLite | Strategy |
|---|---|---|---|---|---|
| `RETURNING` | yes | **no** | yes (INSERT/DELETE) | yes | `insert_returning_id()`: on MySQL, `LAST_INSERT_ID()` + SELECT on the same connection |
| Transactional DDL | yes | **no** (implicit commit) | **no** | yes | Step journal (§10.4) |
| JSON | `jsonb` | `json` | alias of `LONGTEXT` + `JSON_VALID` | text | Schema-driven decoding |
| Booleans | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | Schema-driven decoding |
| Datetime | `timestamptz` | `datetime(3)` | `datetime(3)` | ISO text | Always store UTC; `SET time_zone = '+00:00'` on every new MySQL/MariaDB connection |
| Charset | UTF-8 | `utf8mb4` | `utf8mb4` | UTF-8 | Explicit charset on table creation |
| Collation | — | `utf8mb4_0900_ai_ci` | `utf8mb4_uca1400_ai_ci` (available since 10.10) | `BINARY` | Explicit per table |
| `$contains` (case-sensitive) | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | same | `GLOB`/`instr` | Dialect method |
| `$containsi` | `ILIKE` | `LIKE` (ci collation) | same | `LIKE` (ASCII) + `lower()` | Dialect method; documented that SQLite is only case-insensitive for ASCII |
| Upsert | `ON CONFLICT` | `ON DUPLICATE KEY UPDATE` | same | `ON CONFLICT` | `sea-query` |
| `ALTER COLUMN` | full | full | full | **limited** | SQLite: table rebuild (create new → copy → drop → rename) |
| Index length | — | 3072 bytes (DYNAMIC) | same | — | `varchar(255)` utf8mb4 = 1020 bytes OK; `text` cannot be unique-indexed |
| `FOR UPDATE` | yes | yes | yes | no (DB lock) | Omitted on SQLite |

---

## 10. Schema migration engine

### 10.1 Flow

```
schema/*.json ──parse+validate──▶ Schema ──derive──▶ DbModel (desired)
vd_schema_snapshots (last applied) ─────────────────▶ DbModel (current)
                 diff(current, desired) ──▶ Vec<Change> ──plan(dialect)──▶ Vec<Step> ──apply──▶ DB
```

The snapshot stores the **physical model** (tables, columns, indexes), not the schema. When a later Verdin version derives more tables from the same schema (link tables in M3), the diff creates them naturally.

The diff is computed **against the stored snapshot**, not against database introspection. It is deterministic and avoids introspection differences between dialects. Introspection will back a future `verdin migrate check` that detects drift (manual changes in the database).

Changes that render to identical DDL on a dialect (e.g. `integer` → `biginteger` on SQLite) produce no step.

### 10.2 Change categories

- **Safe**: create table, add nullable or defaulted column, add index, widen `varchar`, add an enum value.
- **Risky**: change column type (with conversion), add `required` without default to a table with rows, shrink a length, add `unique` (may fail on duplicates). Executed after a pre-check (e.g. `SELECT COUNT(*) … WHERE col IS NULL`).
- **Destructive**: drop column, drop table, remove an enum value that is in use.

**Renames**: a removed attribute plus a new one of the same type is *proposed* as a rename (`verdin migrate plan` prints `--rename-column articles.title=headline`); the user passes it explicitly to `migrate apply` (and, later, confirms it in the content-type builder). It is never inferred silently. Table renames work the same way with `--rename-table old=new`.

### 10.3 Modes

- `verdin dev` (M2+): watches `schema/`. Safe changes are applied automatically; risky and destructive ones ask for confirmation (interactive CLI or a dialog in the admin).
- `verdin start` (production): the schema is read-only. If migrations are pending the server **does not start**, unless run with `--migrate` (safe changes only).
- `verdin migrate plan` prints the steps, their risk and the exact SQL for the dialect. `verdin migrate apply [--allow safe|risky|destructive]` runs them; steps above the allowed risk abort the run before anything executes.

### 10.4 Execution that survives non-transactional DDL

MySQL and MariaDB implicitly commit on every DDL statement, so a failure halfway leaves the database in an intermediate state. Strategy:

1. Take the migration lock (`pg_advisory_lock` / `GET_LOCK` scoped to the database; `BEGIN IMMEDIATE` on SQLite) on a dedicated connection.
2. Run every pre-check before the first DDL statement (duplicates before a unique index, NULLs before `NOT NULL`, rows before a `NOT NULL` column without default).
3. Record the full plan in `vd_migrations_journal` (plan hash + steps). On MySQL/MariaDB every step is a single statement.
4. Execute step by step, recording progress after each one.
5. After a failure, the journal stays `running` with the error. The next `apply` recomputes the plan; if its hash matches, it **resumes** from the failed step (single DDL statements are atomic on MySQL 8 / MariaDB, so the failed step simply runs again). If the schema changed meanwhile, it refuses and asks to restore the schema the plan came from.
6. The new snapshot and the journal completion are committed together once every step has completed.

On PostgreSQL and SQLite the whole plan and the snapshot run in a single transaction: a failure rolls everything back.

---

## 11. Document Service

The single internal API for reading and writing content. Used by the content API, the admin API and, later, plugins.

```rust
pub struct DocumentService { /* pool, registry, dialect, events */ }

impl DocumentService {
    pub async fn find_many(&self, uid: &ContentTypeUid, q: &Query, ctx: &Ctx) -> Result<Page<Document>>;
    pub async fn find_one(&self, uid: &ContentTypeUid, doc_id: &DocumentId, q: &Query, ctx: &Ctx) -> Result<Option<Document>>;
    pub async fn create(&self, uid: &ContentTypeUid, data: Value, opts: WriteOpts, ctx: &Ctx) -> Result<Document>;
    pub async fn update(&self, uid: &ContentTypeUid, doc_id: &DocumentId, data: Value, opts: WriteOpts, ctx: &Ctx) -> Result<Document>;
    pub async fn delete(&self, uid: &ContentTypeUid, doc_id: &DocumentId, ctx: &Ctx) -> Result<()>;
    pub async fn publish(&self, uid: &ContentTypeUid, doc_id: &DocumentId, ctx: &Ctx) -> Result<Document>;
    pub async fn unpublish(&self, uid: &ContentTypeUid, doc_id: &DocumentId, ctx: &Ctx) -> Result<()>;
    pub async fn discard_draft(&self, uid: &ContentTypeUid, doc_id: &DocumentId, ctx: &Ctx) -> Result<Document>;
    pub async fn count(&self, uid: &ContentTypeUid, q: &Query, ctx: &Ctx) -> Result<u64>;
}
```

- `Ctx` carries the actor (admin user, API token or public) and the resolved permissions. Permission filtering (e.g. the "only my entries" condition) is injected into the query, not applied afterwards.
- **Validation** in two layers: schema types and constraints (`min`/`max`, `regex`, enum, cardinality; `required` on publish and on writes to types without draft & publish), then uniqueness (`unique`, `uid`) enforced by the scoped unique indexes and reported as a `ValidationError`. Errors use the `ValidationError` format with the field path (`seo.metaTitle`, `blocks[2].text`).
- `uid`: slug generation from `targetField` and an availability endpoint (used by the admin).
- **Event bus**:
  - *before* hooks: synchronous, ordered, can modify data or abort the operation (`BeforeCreate`, `BeforeUpdate`… traits).
  - *after* events: `tokio::sync::broadcast`, never block the response. Foundation for webhooks and plugins.

---

## 12. Content API (REST)

### 12.1 Routes

Collection type `article` (plural `articles`):

```
GET    /api/articles                    list
GET    /api/articles/:documentId        detail
POST   /api/articles                    create   body: { "data": { … } }
PUT    /api/articles/:documentId        update   body: { "data": { … } }
DELETE /api/articles/:documentId        delete
```

Single type `homepage`:

```
GET    /api/homepage
PUT    /api/homepage
DELETE /api/homepage
```

Publishing from the content API: `POST /api/articles/:documentId/actions/publish|unpublish|discard-draft` (dedicated permission). Strapi does not offer this over REST.

Write semantics (Strapi v5):
- `POST` / `PUT` on a draft & publish type write the draft **and publish it**, unless `?status=draft` is passed. `PUT` is a partial update.
- `required` is enforced whenever a version becomes published (and on every write for types without draft & publish), including required attributes inside components and dynamic zones. A failed publish rolls the whole request back.
- `POST` answers `201`, `DELETE` answers `204` with no body and removes every version of the document.
- Single types answer `405` to `POST`; their first `PUT` creates the document.
- Unknown keys, system fields (`id`, `documentId`, timestamps) and relation fields (until M3) in `data` are validation errors.

### 12.2 Parameters (Strapi v5 compatible)

| Parameter | Example |
|---|---|
| `filters` | `filters[title][$containsi]=rust&filters[$or][0][views][$gt]=10` |
| `sort` | `sort=title:asc&sort[1]=createdAt:desc` |
| `fields` | `fields[0]=title&fields[1]=slug` |
| `populate` | `populate=*`, `populate[category][fields][0]=name`, `populate[blocks][on][blocks.hero][fields][0]=title` |
| `pagination` | `pagination[page]=2&pagination[pageSize]=25` or `pagination[start]=0&pagination[limit]=25`, `pagination[withCount]=false` |
| `status` | `published` (default) \| `draft` |
| `locale` | reserved (post-MVP i18n) |

Operators: `$eq $eqi $ne $nei $lt $lte $gt $gte $in $notIn $contains $notContains $containsi $notContainsi $startsWith $startsWithi $endsWith $endsWithi $null $notNull $between $and $or $not`.

**Limits** (configurable): `pageSize ≤ 100`, `populate` depth ≤ 5, filter nesting ≤ 10, ≤ 100 conditions, query string ≤ 16 KB. Every field name in `filters`, `sort`, `fields` and `populate` is validated against the schema; unknown or `private` fields return `400`.

Pipeline: `query string → serde_qs → typed AST (verdin-query) → validation against schema and permissions → SQL (sea-query)`. `populate` is resolved with **batched queries** per level (one per relation, `WHERE … IN (…)`), not cascading joins. This avoids cartesian explosions and N+1 queries.

### 12.3 Responses

```json
// list
{ "data": [ { "id": 12, "documentId": "01J9Z…", "title": "…", "createdAt": "…", "updatedAt": "…", "publishedAt": "…" } ],
  "meta": { "pagination": { "page": 1, "pageSize": 25, "pageCount": 4, "total": 87 } } }

// error
{ "data": null,
  "error": { "status": 400, "name": "ValidationError", "message": "…", "details": { "errors": [ { "path": ["title"], "message": "required" } ] } } }
```

- Flat format like Strapi v5 (no `attributes` wrapper). Field names are camelCase in the API and snake_case in the database; the mapping comes from the schema.
- Components and dynamic zones are returned only when populated (`populate=*`, `populate=seo`, `populate[seo]=true`). A populated component is returned whole, nested components included (Strapi requires populating each level). Every component item has an `id` unique within its attribute.
- Values: `biginteger` as strings, `decimal` as numbers (rounded half away from zero to their scale, like the databases), `date` `YYYY-MM-DD`, `time` `HH:MM:SS.mmm`, `datetime` `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC).
- Text filter semantics are the same on every engine: `$eq`, `$ne`, `$in`, `$contains`, `$startsWith`, `$endsWith` are exact (binary collation on MySQL/MariaDB, whose default collations ignore case and accents); the `…i` variants ignore case (and accents on MySQL/MariaDB; SQLite only folds ASCII). `ORDER BY` puts NULLs last in both directions and always ends with `id` for stable pagination.
- Relations are returned only when populated: `populate=category`, `populate=*` (one level), or `populate[category][fields][0]=name&populate[category][populate][…]&populate[category][filters][…]&populate[category][sort]=…`, nested up to `max_populate_depth` (5). Each level is one batched query per relation (`IN (…)`, chunked). A to-one relation is an object or `null`; a to-many one is an array in link order (or in `sort` order).
- Related documents are resolved in the version being read: published documents see published targets, drafts see drafts (types without draft & publish always show their only version). Unpublishing a target hides it without touching links.
- Filtering through relations: `filters[category][name][$eq]=News`, `filters[category][$null]=true`, nested (`filters[articles][tags][label][$eq]=rust`), on either side, as `EXISTS` subqueries (no duplicate rows).
- Relation input (owning side): `"documentId"`, `{ "documentId": … }`, `[…]` (set), `null` (clear), or `{ "connect": […], "disconnect": […] }` / `{ "set": […] }` where `connect` items may carry `position: { before | after: documentId } | { start: true } | { end: true }`. Connecting a to-one relation replaces its target.
- Not yet: filtering on fields of components, relations inside components.
- `private` fields and internal system columns (`state`, `created_by_id`…) never appear in the content API.

### 12.4 OpenAPI

`GET /api/_openapi.json` (OpenAPI 3.1) is generated at startup from the registry: one path and one schema per content type, plus the shared parameters. `verdin openapi > openapi.json` exports it. `verdin types --lang ts` generates TS types for the content (right after the MVP).

---

## 13. Admin API

Prefix `/admin/api`. Requires an admin session. Resources:

```
POST /auth/register-first-admin        (only when no admin exists)
POST /auth/login | /auth/refresh | /auth/logout
GET  /auth/me

GET  /content-types                    schemas + UI metadata (field order, labels)
GET  /components
PUT  /content-types/:uid               (dev mode only) writes schema/*.json
POST /schema/plan | /schema/apply      (dev mode only)

GET|POST|PUT|DELETE /content/:uid[/:documentId]      typed proxy to the Document Service
POST /content/:uid/:documentId/actions/publish|unpublish|discard
GET  /content/:uid/uid-available?field=slug&value=…

CRUD /users, /roles, /api-tokens, /public-permissions
GET  /system/info                      version, dialect, mode
```

UI metadata (list columns, visible fields, form layout) lives in `schema/content-types/<name>.ui.json`, separate from the data schema. It is the equivalent of Strapi's "configure the view", but versionable.

---

## 14. Authentication & permissions

### 14.1 Admins

- Passwords hashed with **argon2id** (m = 19 MiB, t = 2, p = 1; OWASP parameters), transparently rehashed when parameters change.
- First start with no admins: the admin panel shows the super admin registration. Alternative: `verdin admin create`.
- Session:
  - **Access token**: HS256 JWT, 15 min, kept in SPA memory (never in `localStorage`).
  - **Refresh token**: opaque 256-bit token, 30 days, in an `HttpOnly; Secure; SameSite=Strict; Path=/admin/api/auth` cookie. Stored as SHA-256 in `vd_sessions`.
  - Rotated on every refresh with **reuse detection**: a token that was already rotated revokes its whole session family.
- Rate limiting and progressive lockout on login. Generic error messages (no user enumeration).

### 14.2 Content API

Until M4, `[api].open_access = true` opens the whole content API (with a warning at startup); without it every request is answered `403`. It exists for development and tests only.

- **Public**: no access by default. Per-type, per-action permissions (`find`, `findOne`, `create`, `update`, `delete`) are granted in settings.
- **API tokens**: `read-only`, `full-access` and `custom` (per-type, per-action) kinds, with optional expiry. Shown once, stored as HMAC-SHA256 with `VERDIN_TOKEN_PEPPER`. Sent as `Authorization: Bearer <token>`.

### 14.3 Admin RBAC (MVP)

- Permission = `action × subject (+ conditions)`. Content actions: `read`, `create`, `update`, `delete`, `publish`. Settings actions: `users.manage`, `roles.manage`, `tokens.manage`, `schema.manage`.
- Built-in roles:
  - **Super Admin**: everything; not editable.
  - **Editor**: all content.
  - **Author**: creates content and reads, edits or deletes only their own entries (`is-creator` condition), cannot publish.
- Custom roles: yes, in the MVP (per type and action). Field-level permissions arrive in v0.2.
- Conditions compile to SQL clauses (`created_by_id = :actor`) that the Document Service adds to the query.

---

## 15. Admin panel (Angular + spartan)

### 15.1 Structure

```
admin/src/app/
├── core/          # auth (interceptor, silent refresh), generated API client, config, i18n
├── shared/ui/     # helm components generated by @spartan-ng/cli (owned by the project)
├── features/
│   ├── auth/            # login, first admin
│   ├── content/         # document lists and editor
│   ├── builder/         # content-type builder (dev mode only)
│   └── settings/        # users, roles, API tokens, public permissions
└── fields/        # dynamic field registry
```

### 15.2 Schema-driven dynamic forms

- `GET /admin/api/content-types` returns the schema and layout; the editor builds the form at runtime with **Signal Forms**: the document model is a `signal<Record<string, unknown>>`, and the form tree plus its validators are derived from the schema.
- **Field registry**: `Map<AttributeType, Type<FieldComponent>>` (`string` → input, `richtext` → Markdown editor, `relation` → combobox with paginated search, `component` → nested fieldset, `dynamiczone` → reorderable list with a component picker…). Adding a field type means registering a component. This is the future entry point for UI plugins.
- Client-side validation derived from the schema (instant feedback). The server remains the authority; its errors (`details.errors[].path`) are mapped back onto the matching field.
- Explicit save with dirty tracking, a leave-page warning on unsaved changes, and Publish / Unpublish / Discard buttons depending on the state.

### 15.3 Lists

TanStack Table + helm table. Server-side pagination, sorting and filters, mirrored in the URL (shareable links). Columns configurable through `*.ui.json`.

### 15.4 Content-type builder

Visible only when the server runs in `dev` mode. It edits the schema and calls `/schema/plan`, which shows the diff and the steps (destructive ones flagged). On confirmation it writes `schema/*.json` and applies the plan. Since the output is files, the flow ends in a git commit.

### 15.5 Build & distribution

- `ng build` → `admin/dist/browser`, embedded in the binary with `rust-embed` (`embed-admin` feature, on for releases).
- In development the server proxies `/admin/*` to `ng serve` (port 4200) or serves from disk.
- Runtime config (base path, dev/prod mode) is injected into `index.html` by the server, so changing `admin.path` never requires rebuilding the admin.

---

## 16. Cross-cutting concerns

### 16.1 CLI

```
verdin new <dir> [--db postgres|mysql|mariadb|sqlite]   create a project
verdin dev                                               server + schema watch + builder enabled
verdin start [--migrate[=all]]                           production
verdin migrate plan|apply|check
verdin admin create|reset-password
verdin openapi
verdin version
```

### 16.2 Observability

- `tracing` with a propagated `request_id` (`x-request-id` header). JSON logs in production, human-readable in dev.
- `GET /_health` (liveness) and `GET /_ready` (database reachable, no pending migrations).
- Prometheus metrics: post-MVP.

### 16.3 Security checklist (MVP)

- SQL identifiers only from the validated schema; values always bound.
- Explicit CORS allow-list. Default `body_limit` of 1 MB.
- Security headers on the admin (strict CSP, `X-Frame-Options: DENY`, `Referrer-Policy`).
- Rate limiting on `/admin/api/auth/*`.
- Query limits (§12.2) to prevent DoS through expensive queries.
- Mandatory secrets in `start` mode; boot fails if they are missing or weak (< 32 bytes).
- `cargo deny` (licenses and advisories) and `cargo audit` in CI; `npm audit` for the admin.

### 16.4 Testing & CI

- Unit tests per crate (schema parser, diff, query AST, per-dialect SQL generation with `insta` snapshots).
- **Conformance suite** (`tests/conformance`): the same HTTP tests against PostgreSQL 14 and 17, MySQL 8.4, MariaDB 10.11 and 11.4, and SQLite. A feature is not done until it passes on all of them.
- GitHub Actions CI: dialect matrix with Docker services, `clippy -D warnings`, `rustfmt`, `cargo deny`, admin build, Playwright e2e against the binary on SQLite.

### 16.5 License

**MIT OR Apache-2.0** (the Rust ecosystem convention) across the repository. No Strapi code is copied: design ideas and API shape are not copyrightable, and Strapi's `ee/` code has its own license and is not used as reference.

---

## 17. Roadmap

### MVP (v0.1)

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 Skeleton** ✅ | Workspace, CI, config, `verdin start` with `/_health`, connection to all 4 engines, `docker/compose.dev.yml` | Green CI across the matrix |
| **M1 Schema + migrations** ✅ | Parser and validation, type mapping, snapshot, diff, plan, journaled apply (scalars, components and dynamic zones as JSON) | Create, alter and drop types on all 4 engines; resume after failure on MySQL |
| **M2 Document Service + REST** ✅ | CRUD, filters, sort, pagination, fields, draft/publish, components/dynamic zones, OpenAPI | Conformance suite green on all engines |
| **M3 Relations & components** ✅ | `_lnk` tables, 6 relation kinds, JSON components and dynamic zones, batched `populate`, relation filters | Populate and publish conformance on all engines. Component filters and relations inside components moved to M6 |
| **M4 Auth** | Admins, first admin, JWT + rotating refresh, roles, API tokens, public permissions | Security tests (refresh reuse, enumeration, rate limit) |
| **M5 Admin** | Login, lists, dynamic editor, content-type builder (dev), settings | Playwright e2e of "create type → create content → publish → read over API" |
| **M6 Release 0.1** | Binaries (macOS arm64/x64, Linux x64/arm64 musl, Windows), Docker image, `examples/blog`, README | `docker run` to first content in < 2 min |

### After the MVP (tentative order)

1. **v0.2**: media library (local and S3 providers through `object_store`, thumbnails with `image`), field-level permissions, TS content types, `blocks` editor (TipTap).
2. **v0.3**: content i18n (the `locale` column already exists), webhooks on the event bus, **Strapi v4/v5 importer** (schemas + data).
3. **v0.4**: GraphQL (`async-graphql`), end users (registration, login, OAuth providers).
4. **v0.5**: **WASM plugins** (Extism): Document Service hooks, custom routes and UI fields (Web Components loaded into the admin).
5. **v0.6+**: SSO/OIDC, audit logs, content history, review workflows, scheduled releases, Astro Starlight documentation site.

---

## 18. Decision log

| # | Decision | Outcome | Rationale |
|---|---|---|---|
| 1 | Components: JSON vs tables | **JSON column** (§8.5) | Fewer joins, trivial publish/versioning, simpler migrations. Filtering on repeatable components is rare; can be added later with JSON functions |
| 2 | `decimal` JSON encoding | **number** by default, `api.decimal_as_string` opt-in | Strapi compatibility maximises adoption; exact values available when needed |
| 3 | Admin forms | **Signal Forms** | Fits a signals-first, zoneless admin; dynamic form trees derived from the schema |
| 4 | Language | **English** for code, docs and commits | Open source reach |
| 5 | Strapi REST compatibility | **Same parameters and response shape**; Verdin-only extensions under `actions/` | Frontends migrate with minimal changes |
| 6 | Admin JWT algorithm | HS256 | Single secret, simple; EdDSA if external verifiers ever appear |
| 7 | Document IDs | ULID (26 chars) | Sortable and portable; Strapi's own ids are opaque 24-char strings, clients never parse them |
| 8 | Snapshot content | Physical model, not schema | Later versions can derive new tables from an unchanged schema |
| 9 | Attribute nullability | Always nullable; `required` checked on publish | Drafts may be incomplete (Strapi v5 behaviour); adding required fields is safe |
| 10 | `unique` enforcement | Unique index on `(column, locale, publication_state)` | Race-free; drafts and their published version share values |
| 11 | State column name | `publication_state` | `state` is a common attribute name |
| 12 | Reserved SQL words | Always quote identifiers | No arbitrary blocklist of attribute names |
| 13 | DML building | Own builder instead of `sea-query` | Per-dialect details dominate (typed NULLs, collations, SQLite formats); one less abstraction |
| 14 | Writes without `?status=draft` | Publish (Strapi v5 REST behaviour) | Drop-in compatibility for existing clients |
| 15 | Text comparison | Exact by default on every engine; `…i` operators for case-insensitive | Same results on MySQL as on PostgreSQL |
| 16 | Temporary access control | `[api].open_access` switch, closed by default | Secure by default until M4 permissions |
| 17 | "Target belongs to one document" | Enforced by moving the target, per state | A unique index would forbid a draft and its published version sharing a target |
| 18 | Inverse (`mappedBy`) sides | Read-only | Writing through them is ambiguous with draft & publish (which owner version?) |
| 19 | Link positions | Renumbered 1..n on each write | No float exhaustion; lists are small |
| 20 | Link table rows | Keep an `id` primary key | Uniform tables for the migration engine and SQLite rebuilds |
