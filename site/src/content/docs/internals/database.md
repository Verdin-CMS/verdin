---
title: Database layer
description: How Verdin talks to PostgreSQL, MySQL, MariaDB and SQLite through one connection type, a Flavor enum and its own SQL builders, and how it handles each dialect's differences.
sidebar:
  order: 3
---

This page explains how Verdin supports four database engines with one code path: the `verdin-db` crate that connects and executes, the SQL builders that branch on the engine, and the dialect differences they handle. Read it before you write SQL anywhere in the server. How tables are laid out is in [storage](/internals/storage/).

## Minimum versions

`Database::connect` detects the engine and its version and refuses to start below these minimums (`Flavor::minimum_version` in `crates/verdin-db/src/lib.rs`):

| Engine | Minimum | Reason |
|---|---|---|
| PostgreSQL | 14 | Oldest version still supported upstream |
| MySQL | 8.4 LTS | 8.0 reached end of life in April 2026 |
| MariaDB | 10.11 LTS | Oldest current long-term release; `utf8mb4_uca1400_ai_ci` collation, usable JSON |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`; the library is compiled into the binary |

CI runs every test against PostgreSQL 14 and 17, MySQL 8.4, MariaDB 10.11 and 11.4, and SQLite. See [testing](/internals/testing/).

## Connecting

`verdin-db` wraps one `sqlx` pool per backend:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- URL schemes: `postgres://` or `postgresql://`, `mysql://`, `mariadb://` (an alias of `mysql://`) and `sqlite:`. MySQL and MariaDB share the `sqlx` MySQL driver; the flavor comes from `SELECT VERSION()`, which contains `MariaDB` on MariaDB.
- MySQL and MariaDB connections use `utf8mb4` and set the session time zone to `+00:00`, so every timestamp is stored in UTC.
- SQLite connections turn on foreign keys, use WAL journaling and a 5-second busy timeout, and create the database file (and its folder) if missing. In-memory databases get a single connection, because each connection to `:memory:` would open a different database.
- `ConnectOptions` sets the pool size (`[database].pool_max`, 10 by default) and the time to wait for a free connection (10 seconds).

`Flavor` carries the few facts the rest of the code branches on: `transactional_ddl()` (PostgreSQL and SQLite), `is_mysql_family()`, `quote(identifier)` (backticks on MySQL and MariaDB, double quotes elsewhere) and `minimum_version()`.

There is no dialect trait. Code that builds SQL checks the `Flavor` where the engines differ.

## Executing statements

Three executors share the same methods (`execute`, `fetch_all`, `has_rows`, `insert_returning_id`):

| Executor | Use |
|---|---|
| `db.queries()` | One statement on any pooled connection |
| `db.acquire()` → `Conn` | Several statements on one connection, such as a migration run holding a lock |
| `db.begin()` → `Tx` | A transaction; dropped without `commit()`, it rolls back |

Statements are written with `?` placeholders, rewritten to `$1, $2…` for PostgreSQL. Values are `SqlValue`s, always bound as parameters. The SQL text itself may only contain identifiers that come from the validated schema, which is why it is passed to `sqlx` as `AssertSqlSafe`.

**Schema-driven decoding.** A read passes the `ColumnKind` of each selected column, and values are decoded by that kind, not by the type the driver reports. This is what makes MariaDB's `JSON` (really `LONGTEXT`), MySQL's `TINYINT(1)` booleans and SQLite's text dates and decimals come back the same way on every engine. See `crates/verdin-db/src/value.rs`.

**Inserted ids.** `insert_returning_id` appends `RETURNING id` on PostgreSQL, and reads the id the driver reports after the insert on MySQL, MariaDB (`LAST_INSERT_ID`) and SQLite (`last_insert_rowid`).

**Unique violations.** `DbError::unique_violation()` extracts the index name (PostgreSQL, MySQL, MariaDB) or the column list (SQLite) from the driver error, so the Document Service can report a `ValidationError` on the right attribute.

## SQL builders

Verdin builds SQL with its own small builders instead of an ORM or `sea-query`, because tables only exist at runtime (they come from the schema) and because the per-dialect details dominate: typed NULLs, collations, JSON functions and SQLite's text formats.

| Crate | Builds |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | DDL: column types, `CREATE TABLE`, `ALTER TABLE`, indexes, SQLite table rebuilds |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | `WHERE` clauses for filters (including relation `EXISTS` subqueries and JSON paths) and `ORDER BY` |
| `verdin-content` (`service.rs`) | Reads, inserts, updates, deletes, link table writes and batched populate queries |

A builder pushes SQL text and `ident()` names (quoted for the flavor) and collects parameters with `param()`, so building SQL and binding values happen in one place.

### Column types per dialect

| Model type | PostgreSQL | MySQL / MariaDB | SQLite |
|---|---|---|---|
| id | `bigint` identity | `bigint AUTO_INCREMENT` | `integer PRIMARY KEY AUTOINCREMENT` |
| integer, bigint, smallint | `integer`, `bigint`, `smallint` | `int`, `bigint`, `smallint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| char, varchar | `char(n)`, `varchar(n)` | `char(n)`, `varchar(n)` | `text` |
| text | `text` | `longtext` | `text` |
| date, time, datetime | `date`, `time(3)`, `timestamptz(3)` | `date`, `time(3)`, `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

SQLite stores dates and times as fixed-format text, so text order matches chronological order. It stores decimals as text too, so nothing is rounded when they are saved. Text order is not numeric order for decimals, so filters and sorts on a decimal cast the column to `REAL` on SQLite. Those comparisons are exact to about 15 significant digits, and the values returned are still exact. Which attribute maps to which model type is in [attribute types](/reference/attribute-types/).

MySQL and MariaDB tables are created with `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` and an accent- and case-insensitive collation: `utf8mb4_0900_ai_ci` on MySQL, `utf8mb4_uca1400_ai_ci` on MariaDB.

## Dialect differences

| Topic | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | How Verdin handles it |
|---|---|---|---|---|---|
| Inserted id | `RETURNING` | no `RETURNING` | driver id | driver id | `insert_returning_id()` |
| Transactional DDL | yes | no (implicit commit) | no | yes | Step journal on MySQL and MariaDB (see [migrations](/internals/migrations/)) |
| JSON | `jsonb` | `json` | alias of `LONGTEXT` | text | Schema-driven decoding |
| Booleans | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | Schema-driven decoding |
| Datetime | `timestamptz` | `datetime(3)` | `datetime(3)` | ISO text | Always UTC; MySQL-family sessions use time zone `+00:00` |
| Charset and collation | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, binary | Set explicitly per table |
| Exact text match (`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | same | `=` | Same results on every engine |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | same | `instr()` / `substr()` | SQLite's `LIKE` ignores ASCII case, so it is not used for case-sensitive matches |
| `$containsi` and other `…i` operators | `ILIKE` | `LIKE` (insensitive collation) | same | `LIKE` | SQLite only folds ASCII case |
| JSON path filters | `#>>` | `JSON_VALUE` | same | `json_extract` | Per-dialect operand |
| JSON array filters | `jsonb_array_elements` | `JSON_TABLE` | same | `json_each` | `EXISTS` over the items |
| `ALTER COLUMN` | full | `MODIFY COLUMN` | same | not supported | SQLite: rebuild the table (create, copy, drop, rename) |
| Row locks | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | none | Omitted on SQLite, whose write transactions lock the database |
| Unique text index length | — | 3,072 bytes | same | — | `varchar(255)` in `utf8mb4` is 1,020 bytes; `text` cannot be unique |
| Row size | — | 65,535 bytes | same | — | At most 60 `string`, `email`, `uid` or `enumeration` attributes per type |

`LIKE` patterns escape `%`, `_` and the escape character itself (`!`) in user input. MySQL and MariaDB's default collations ignore case and accents, which is why exact operators add a binary collation: `$eq` means the same thing on MySQL as on PostgreSQL. With JSON paths, `JSON_VALUE` returns a binary-collated string, so case-insensitive operators there compare `LOWER()` on both sides.

`ORDER BY` puts NULLs last in both directions and always ends with `id`, so pagination is stable on every engine.
