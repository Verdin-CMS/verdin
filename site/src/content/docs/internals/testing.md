---
title: Testing
description: How Verdin is tested, from Rust unit tests to the conformance suite that runs on six databases, the admin panel's unit and Playwright tests, and the CI jobs that gate every change.
sidebar:
  order: 7
---

This page explains the test suites, how to run each one locally, and what CI checks on every pull request. The rule behind all of it: a feature is not done until it passes on every supported database.

## Rust tests

Run everything with:

```sh title="Terminal"
cargo test --workspace
```

Without configuration, the tests use SQLite. There are three kinds:

| Kind | Where | What |
|---|---|---|
| Unit tests | `#[cfg(test)]` modules in each crate | Schema parsing and validation, naming, diff and plan, query parsing, SQL generation per dialect, value encoding, input validation |
| Crate integration tests | `crates/*/tests/` | Connecting and flavor detection (`verdin-db`), applying migrations (`verdin-migrate`), auth flows (`verdin-auth`), GraphQL, plugins, S3 storage |
| API tests | `crates/verdin-api/tests/api/` | HTTP requests against the content API and the admin API, including the conformance suite |

**DDL snapshots.** `crates/verdin-migrate/tests/sql_snapshots.rs` renders the DDL of a sample schema for every dialect and compares it with the [`insta`](https://insta.rs) snapshots in `crates/verdin-migrate/tests/snapshots/`. When you change DDL on purpose, review and accept the new snapshots with `cargo insta review` (from `cargo-insta`) and commit them.

**API tests** live in one test binary (`tests/api/main.rs`, one module per area) to keep link times and `target/` size down. The harness in `tests/api/common/mod.rs` builds the content API at `/api` and the admin API at `/admin/api` over a fresh, migrated database per test. Requests carry a full-access API token unless the test passes another one, or none.

## The six-database matrix

Every test that touches a database reads `VERDIN_TEST_DATABASE_URL` and defaults to in-memory SQLite. `verdin-testkit` gives each test a database of its own: a temporary SQLite file, or a fresh `vd_test_…` database created on the server and dropped afterwards.

CI runs the whole workspace once per engine:

| Engine | Image |
|---|---|
| SQLite | bundled |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

These are the [minimum versions](/internals/database/#minimum-versions) plus the newest ones Verdin is tested on. CI also sets `VERDIN_TEST_EXPECT_FLAVOR` so that `crates/verdin-db/tests/connect.rs` asserts the engine was detected correctly (MariaDB is reached with a `mysql://` URL and must still be detected as MariaDB).

To run the matrix locally, start the databases with Docker:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

Then run the tests against each engine. Tests create a database per test, so on MySQL and MariaDB they connect as `root`:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

The ports map to PostgreSQL 14 and 17, MySQL 8.4, and MariaDB 10.11 and 11.4. The same compose file starts RustFS (S3-compatible storage on port 9000) and Mailpit (SMTP on port 1025, inbox on port 8025) for media and email work.

## Conformance suite

`crates/verdin-api/tests/api/conformance.rs` sends the same HTTP requests to the content API on every engine and checks the responses: create, read, update and delete round trips, input validation, draft and publish, filters and their text-matching rules, sorting and pagination, field types and populate, unique values, single types, content API access rules, the OpenAPI document, and filters on component fields. Other modules in `tests/api/` (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…) cover their areas the same way, so the whole `verdin-api` test binary is effectively the conformance suite.

When you fix a dialect difference, add the case here: the test that passes on PostgreSQL and fails on MySQL is exactly the one the suite exists to catch.

## Admin panel tests

**Unit tests** are `*.spec.ts` files next to the code in `admin/src/app`, run with Vitest through Angular's unit-test builder in jsdom. They cover the pure models: form model conversion, field rules, list filters and views, permissions, the ICU transpiler, the week start, and more.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**End-to-end tests** are Playwright specs in `admin/e2e/`. `e2e/serve.sh` creates a throwaway project (with a sample WebAssembly plugin), and starts `verdin dev` on port 1393 on SQLite, serving the admin from `admin/dist/admin/browser`. Tests run one at a time in Chromium with an English UI.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

The specs cover sign-in and two-factor, the entry editor, polymorphic relations, review workflows, team and governance features, mentions, import and export, edit views and unsaved-changes guards.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request. All Rust jobs build with `RUSTFLAGS=-D warnings`.

| Job | Checks |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (licenses and advisories) |
| `test (sqlite)` | `cargo test --workspace` on in-memory SQLite |
| `test (…)` | `cargo test --workspace` on PostgreSQL 14 and 17, MySQL 8.4, MariaDB 10.11 and 11.4, one job each, as Docker services |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` against a RustFS container |
| `admin` | Prettier check, `npm run i18n:check`, `npm audit --audit-level=high`, unit tests, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | `packages/client` has the same version as the workspace, then type check, tests and build |
| `site` | `npm audit`, and the documentation build, which fails on any broken internal link |

Failed Playwright runs upload their traces as an artifact, kept for seven days.
