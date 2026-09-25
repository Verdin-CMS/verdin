# Verdin

Open source headless CMS written in Rust. Inspired by Strapi, shipped as a single binary,
running on PostgreSQL, MySQL, MariaDB and SQLite. 100% free — there is no enterprise edition.

> **Status:** 0.1 — first release. See the [changelog](CHANGELOG.md), the
> [architecture](docs/architecture.md) and the [roadmap](docs/roadmap.md).

## Quick start

With Docker (SQLite in a volume, content-type builder enabled):

```sh
docker run --rm ghcr.io/verdin-cms/verdin secrets > verdin.env
docker run -p 1337:1337 --env-file verdin.env -v verdin-data:/data ghcr.io/verdin-cms/verdin dev
```

Open <http://localhost:1337/admin/>, create the first admin, model a type in the
**Content-type builder**, add an entry, and allow `find` in **Settings → Public access**:

```sh
curl localhost:1337/api/articles
```

`dev` lets the builder edit the schema (stored in the volume under `/data/schema`); for
production mount your versioned schema and run the default `start --migrate`:

```sh
docker run -p 1337:1337 --env-file verdin.env \
  -e VERDIN_DATABASE_URL=postgres://user:pass@db:5432/verdin \
  -v ./schema:/data/schema:ro ghcr.io/verdin-cms/verdin
```

With the binary ([releases](https://github.com/verdin-cms/verdin/releases)):

```sh
verdin new my-site            # verdin.toml, schema/, .env with fresh secrets, SQLite
cd my-site && verdin dev      # --database postgres|mysql|mariadb for other engines
```

## Development

Requirements: Rust (stable, ≥ 1.88) and Docker.

```sh
# Start the database matrix (PostgreSQL 14/17, MySQL 8.4, MariaDB 10.11/11.4)
docker compose -f docker/compose.dev.yml up -d --wait

# Run the tests (in-memory SQLite by default)
cargo test --workspace

# Run them against a specific engine (tests create a database per test: use root on MySQL/MariaDB)
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin \
VERDIN_TEST_EXPECT_FLAVOR=mariadb \
cargo test --workspace

# Try the example project
export VERDIN_DATABASE_URL=sqlite://data/blog.db   # relative to the project (examples/blog)
cargo run -- -c examples/blog/verdin.toml schema check
cargo run -- -c examples/blog/verdin.toml migrate plan
cargo run -- -c examples/blog/verdin.toml migrate apply
cargo run -- -c examples/blog/verdin.toml start
curl localhost:1337/_ready
```

### Admin panel

Angular + spartan/ui in `admin/`, served by the server under `/admin`.

```sh
cd admin && npm ci
npx ng build                                   # → admin/dist/admin/browser
cargo build -p verdin --features embed-admin   # embed it into the binary
# or serve it from disk: [admin] assets_dir = "../../admin/dist/admin/browser"

verdin dev              # development mode: content-type builder, safe auto-migrations
npx ng serve            # frontend work: http://localhost:4200/admin/ (proxies to :1337)
npx ng test --watch=false
npx playwright test     # end-to-end, needs `npx ng build` and `cargo build` first
```

### Schema and migrations

Content types live in `schema/content-types/<singularName>.json` and components in
`schema/components/<category>/<name>.json` (format: [docs/architecture.md §7](docs/architecture.md)).

```sh
verdin schema check                      # validate every schema file
verdin migrate plan                      # steps, risk level and exact SQL
verdin migrate apply                     # safe steps only
verdin migrate apply --allow risky       # also type changes and new unique constraints
verdin migrate apply --allow destructive # also dropped columns and tables
verdin migrate apply --rename-column articles.title=headline --rename-table posts=articles
verdin start --migrate                   # apply safe steps, then serve
```

`verdin start` refuses to run while the database is behind the schema.
On MySQL/MariaDB (no transactional DDL) an interrupted migration resumes from the
failed step on the next `migrate apply`.

### Admin, tokens and permissions

Secrets come from the environment only; generate them once:

```sh
eval "$(verdin secrets | sed 's/^/export /')"   # VERDIN_ADMIN_JWT_SECRET, VERDIN_TOKEN_PEPPER
verdin start --migrate
# register the first admin (only possible while none exists)
curl -XPOST localhost:1337/admin/api/auth/register-first-admin -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"a long password"}'
verdin admin create --email other@example.com          # password from VERDIN_ADMIN_PASSWORD or stdin
verdin admin reset-password --email you@example.com
```

The content API is closed until you grant public permissions or create API tokens
(`POST /admin/api/api-tokens`, `PUT /admin/api/public-permissions`). The refresh cookie
is `Secure` in `verdin start` and not in `verdin dev`; set `[admin].secure_cookies` to
override (e.g. `VERDIN_ADMIN__SECURE_COOKIES=false` to try `start` over plain HTTP).

### Content API

Strapi v5 compatible REST under `/api`, plus an OpenAPI document at `/api/_openapi.json`
(API tokens only by default). Make it public in **Settings → Features → API documentation**
to also get an interactive reference (Scalar) at `/api/docs`.

```sh
curl -XPOST localhost:1337/api/articles -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"data":{"title":"Hello","slug":"hello"}}'
curl -g 'localhost:1337/api/articles?filters[title][$containsi]=hello&sort=createdAt:desc&populate=*'
curl -XPUT 'localhost:1337/api/articles/<documentId>?status=draft' -H 'content-type: application/json' \
  -d '{"data":{"title":"Draft edit"}}'
curl -XPOST localhost:1337/api/articles/<documentId>/actions/publish

# Relations: write on the owning side, populate and filter through them
curl -XPUT localhost:1337/api/articles/<documentId> -H 'content-type: application/json' \
  -d '{"data":{"category":"<categoryId>","tags":{"connect":[{"documentId":"<tagId>","position":{"start":true}}]}}}'
curl -g 'localhost:1337/api/articles?filters[category][name][$eq]=News&populate[tags][fields][0]=label'
```

### GraphQL

Switch it on in **Settings → Features → GraphQL**: `POST /graphql` then serves a schema
generated from your content types, shaped like Strapi v5's GraphQL plugin and authorized
like the REST API (same tokens and public grants).

```graphql
query {
  articles(filters: { title: { containsi: "rust" } }, sort: ["publishedAt:desc"], pagination: { pageSize: 10 }) {
    documentId title
    category { name }
    cover { url formats }
    blocks { __typename ... on ComponentBlocksQuote { text } }
  }
  articles_connection { pageInfo { total pageCount } }
}
mutation { createArticle(data: { title: "Hello" }, status: DRAFT) { documentId } }
```

Settings: `playground` (GraphiQL on `GET /graphql`), `introspection`, `maxDepth`,
`maxComplexity`.

### TypeScript

`verdin types -o src/verdin-types.ts` writes interfaces for every content type and
component (responses and write inputs). [`@verdin/client`](packages/client) uses them for
a typed REST, upload and GraphQL client:

```ts
import { createClient } from '@verdin/client';
import type { VerdinSchema } from './verdin-types';

const verdin = createClient<VerdinSchema>({ url: 'http://localhost:1337', token: process.env.VERDIN_TOKEN });
const { data } = await verdin.collection('articles').find({ populate: { category: true } });
```

### Webhooks

**Settings → Webhooks** sends signed `POST` requests on entry and media events (create,
update, publish, unpublish, delete…), retries failed deliveries with backoff and keeps a
delivery log. Payloads, signature checks and settings: [docs/webhooks.md](docs/webhooks.md).

### Internationalization

Mark a content type as localized (`"pluginOptions": { "i18n": { "localized": true } }`) to
keep one version per locale, then read and write with `?locale=fr`. Locales are managed in
**Settings → Internationalization**; details in [docs/i18n.md](docs/i18n.md).

### Content history

Every change of a document is kept as a version (`[history].max_versions`, 50 by
default). Open **History** in the editor to compare versions and restore one as the
current draft.

### Rich text, components and field permissions

- `blocks` fields hold Strapi's rich text JSON and are edited with a blocks editor;
  `richtext` fields are Markdown with a live preview.
- Components and dynamic zones may contain media and `oneWay`/`manyWay` relations. Write
  file ids and `documentId`s, and read the files and documents back with `populate`.
- A role's content permission may list fields (`"fields": ["title", "slug"]`): the role
  then reads and writes only those. Edit the list per action in **Settings → Roles**.

Connection URLs for every engine are listed at the top of
[docker/compose.dev.yml](docker/compose.dev.yml).

### Configuration

Defaults ← `verdin.toml` ← environment. Environment overrides use
`VERDIN_<SECTION>__<KEY>` (for example `VERDIN_SERVER__PORT=8080`);
`VERDIN_DATABASE_URL` is a shorthand for `database.url`.

```toml
[server]
host = "0.0.0.0"
port = 1337
body_limit = "1mb"
request_timeout_secs = 30

[database]
url = "postgres://verdin:verdin@localhost:5417/verdin"
pool_max = 10

[api]
prefix = "/api"
default_page_size = 25
max_page_size = 100
decimal_as_string = false

[admin]
path = "/admin"
secure_cookies = true   # default: true in `start`, false in `dev`
auth_rate_limit = 20  # login/registration/refresh per IP per minute

[upload]
max_file_size = 209715200     # bytes (200 MB)
responsive_formats = true     # thumbnail + large/medium/small for raster images
provider = { name = "local", dir = "public/uploads" }   # served at /uploads
# provider = { name = "s3", bucket = "media", region = "auto",
#              endpoint = "https://<account>.r2.cloudflarestorage.com",
#              public_url = "https://media.example.com", path_style = false }
# S3 credentials: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY

[log]
format = "pretty" # or "json"
level = "info"    # RUST_LOG takes precedence
```

### Checks

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo deny check
```

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option.
