# Verdin

Open source headless CMS written in Rust. Inspired by Strapi, shipped as a single binary,
running on PostgreSQL, MySQL, MariaDB and SQLite. 100% free — there is no enterprise edition.

> **Status:** early development (milestone M0). See [docs/architecture.md](docs/architecture.md).

## Development

Requirements: Rust (stable, ≥ 1.88) and Docker.

```sh
# Start the database matrix (PostgreSQL 14/17, MySQL 8.4, MariaDB 10.11/11.4)
docker compose -f docker/compose.dev.yml up -d --wait

# Run the tests (in-memory SQLite by default)
cargo test --workspace

# Run them against a specific engine
VERDIN_TEST_DATABASE_URL=mysql://verdin:verdin@localhost:3314/verdin \
VERDIN_TEST_EXPECT_FLAVOR=mariadb \
cargo test --workspace

# Run the server
VERDIN_DATABASE_URL=sqlite://data/verdin.db cargo run -- start
curl localhost:1337/_health
curl localhost:1337/_ready
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
