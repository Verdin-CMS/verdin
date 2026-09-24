# Verdin

Open source headless CMS written in Rust. Inspired by Strapi, shipped as a single binary,
running on PostgreSQL, MySQL, MariaDB and SQLite. 100% free — there is no enterprise edition.

> **Status:** early development (milestones M0–M2: schema, migrations and the content REST API). See [docs/architecture.md](docs/architecture.md).

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
export VERDIN_DATABASE_URL=sqlite://examples/blog/data/blog.db
cargo run -- -c examples/blog/verdin.toml schema check
cargo run -- -c examples/blog/verdin.toml migrate plan
cargo run -- -c examples/blog/verdin.toml migrate apply
cargo run -- -c examples/blog/verdin.toml start
curl localhost:1337/_ready
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

### Content API

Strapi v5 compatible REST under `/api`, plus an OpenAPI document at `/api/_openapi.json`.
Until permissions land (M4) it is closed; set `VERDIN_API__OPEN_ACCESS=true` to try it.

```sh
curl -XPOST localhost:1337/api/articles -H 'content-type: application/json' \
  -d '{"data":{"title":"Hello","slug":"hello"}}'
curl -g 'localhost:1337/api/articles?filters[title][$containsi]=hello&sort=createdAt:desc&populate=*'
curl -XPUT 'localhost:1337/api/articles/<documentId>?status=draft' -H 'content-type: application/json' \
  -d '{"data":{"title":"Draft edit"}}'
curl -XPOST localhost:1337/api/articles/<documentId>/actions/publish
```

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
open_access = false  # development only, until permissions (M4)

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
