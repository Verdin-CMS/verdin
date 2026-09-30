//! Query execution on a pool, a dedicated connection or a transaction.
//!
//! Statements are written with `?` placeholders; they are rewritten to `$n` for PostgreSQL.
//!
//! Callers must only build SQL text from identifiers that come from the validated schema;
//! every value goes through [`SqlValue`]. That contract is why statements are wrapped in
//! `AssertSqlSafe`.

use sqlx::pool::PoolConnection;
use sqlx::{AssertSqlSafe, MySql, Postgres, Sqlite, Transaction};
use tracing::Instrument;

use crate::value::{ColumnKind, SqlValue, bind_values, decode_rows};
use crate::{Database, Flavor, Pool, Result, WriteGuard, WriteLock, write_guard};

pub(crate) enum ConnInner {
    Postgres(PoolConnection<Postgres>),
    MySql(PoolConnection<MySql>),
    Sqlite(PoolConnection<Sqlite>),
}

/// A connection held for a unit of work (e.g. a migration run), so that session state
/// such as advisory locks stays on one connection.
pub struct Conn {
    pub(crate) inner: ConnInner,
    pub(crate) flavor: Flavor,
}

pub(crate) enum TxInner {
    Postgres(Transaction<'static, Postgres>),
    MySql(Transaction<'static, MySql>),
    Sqlite(Transaction<'static, Sqlite>),
}

/// A transaction. Dropped without [`Tx::commit`], it rolls back.
pub struct Tx {
    inner: TxInner,
    flavor: Flavor,
    /// Held until the transaction ends (declared after `inner`, so dropped after it).
    _write: Option<WriteGuard>,
}

/// Pool-level queries: each call checks out a connection for one statement.
pub struct PoolQueries<'a> {
    inner: &'a Pool,
    flavor: Flavor,
    write_lock: Option<&'a WriteLock>,
}

macro_rules! run_execute {
    ($backend:ident, $flavor:expr, $exec:expr, $sql:expr, $params:expr) => {
        if $params.is_empty() {
            sqlx::raw_sql(AssertSqlSafe($sql)).execute($exec).await?.rows_affected()
        } else {
            let sql = placeholders($flavor, $sql);
            bind_values!($backend, sqlx::query(AssertSqlSafe(sql.as_str())), $params)
                .execute($exec)
                .await?
                .rows_affected()
        }
    };
}

macro_rules! run_fetch_all {
    ($backend:ident, $flavor:expr, $exec:expr, $sql:expr, $params:expr, $kinds:expr) => {{
        let sql = placeholders($flavor, $sql);
        let rows = bind_values!($backend, sqlx::query(AssertSqlSafe(sql.as_str())), $params)
            .fetch_all($exec)
            .await?;
        decode_rows!($backend, rows, $kinds)
    }};
}

macro_rules! run_has_rows {
    ($backend:ident, $flavor:expr, $exec:expr, $sql:expr, $params:expr) => {{
        let sql = placeholders($flavor, $sql);
        bind_values!($backend, sqlx::query(AssertSqlSafe(sql.as_str())), $params)
            .fetch_optional($exec)
            .await?
            .is_some()
    }};
}

macro_rules! run_insert_id {
    (postgres, $exec:expr, $sql:expr, $params:expr) => {{
        use sqlx::Row;
        let sql = placeholders(Flavor::Postgres, &format!("{} RETURNING id", $sql));
        let row = bind_values!(postgres, sqlx::query(AssertSqlSafe(sql.as_str())), $params)
            .fetch_one($exec)
            .await?;
        row.try_get::<i64, _>(0)?
    }};
    (mysql, $exec:expr, $sql:expr, $params:expr) => {{
        let result =
            bind_values!(mysql, sqlx::query(AssertSqlSafe($sql)), $params).execute($exec).await?;
        i64::try_from(result.last_insert_id()).unwrap_or(i64::MAX)
    }};
    (sqlite, $exec:expr, $sql:expr, $params:expr) => {{
        bind_values!(sqlite, sqlx::query(AssertSqlSafe($sql)), $params)
            .execute($exec)
            .await?
            .last_insert_rowid()
    }};
}

/// A span for one statement: its SQL text, never the bound values. At `debug`, so that
/// it costs nothing unless traces are exported (`[telemetry]`) or asked for in the log,
/// and only inside another span (a request): startup and background polls would
/// otherwise make one trace per statement.
pub(crate) fn query_span(flavor: Flavor, sql: &str) -> tracing::Span {
    if tracing::Span::current().is_none() {
        return tracing::Span::none();
    }
    tracing::debug_span!(
        "db.query",
        otel.name = sql.split_whitespace().next().unwrap_or("SQL"),
        otel.kind = "client",
        db.system.name = flavor.otel_system(),
        db.query.text = sql,
    )
}

/// Implements the query methods for an executor whose `inner` field is a `$enum` with
/// `Postgres`/`MySql`/`Sqlite` variants. `$exec` turns the matched `$h` into a sqlx executor.
macro_rules! executor {
    ($ty:ident $(<$lt:lifetime>)?, $enum:ident, |$h:ident| $exec:expr) => {
        impl $(<$lt>)? $ty $(<$lt>)? {
            pub fn flavor(&self) -> Flavor {
                self.flavor
            }

            /// Runs one statement. Without parameters the simple (unprepared) protocol is
            /// used, which is what DDL and session statements need.
            pub async fn execute(&mut self, sql: &str, params: &[SqlValue]) -> Result<u64> {
                let _write = self.write_permit().await?;
                let span = query_span(self.flavor, sql);
                async {
                    Ok(match &mut self.inner {
                        $enum::Postgres($h) => run_execute!(postgres, Flavor::Postgres, $exec, sql, params),
                        $enum::MySql($h) => run_execute!(mysql, Flavor::MySql, $exec, sql, params),
                        $enum::Sqlite($h) => run_execute!(sqlite, Flavor::Sqlite, $exec, sql, params),
                    })
                }
                .instrument(span)
                .await
            }

            /// Runs a query and decodes every row column-by-column with `kinds`.
            pub async fn fetch_all(
                &mut self,
                sql: &str,
                params: &[SqlValue],
                kinds: &[ColumnKind],
            ) -> Result<Vec<Vec<SqlValue>>> {
                let span = query_span(self.flavor, sql);
                async {
                    Ok(match &mut self.inner {
                        $enum::Postgres($h) => run_fetch_all!(postgres, Flavor::Postgres, $exec, sql, params, kinds),
                        $enum::MySql($h) => run_fetch_all!(mysql, Flavor::MySql, $exec, sql, params, kinds),
                        $enum::Sqlite($h) => run_fetch_all!(sqlite, Flavor::Sqlite, $exec, sql, params, kinds),
                    })
                }
                .instrument(span)
                .await
            }

            /// Whether a query returns at least one row (no column is decoded).
            pub async fn has_rows(&mut self, sql: &str, params: &[SqlValue]) -> Result<bool> {
                let span = query_span(self.flavor, sql);
                async {
                    Ok(match &mut self.inner {
                        $enum::Postgres($h) => run_has_rows!(postgres, Flavor::Postgres, $exec, sql, params),
                        $enum::MySql($h) => run_has_rows!(mysql, Flavor::MySql, $exec, sql, params),
                        $enum::Sqlite($h) => run_has_rows!(sqlite, Flavor::Sqlite, $exec, sql, params),
                    })
                }
                .instrument(span)
                .await
            }

            /// Runs an `INSERT` into a table whose primary key is `id` and returns the new
            /// id. Uses `RETURNING` where available and `LAST_INSERT_ID()` on MySQL/MariaDB.
            pub async fn insert_returning_id(&mut self, sql: &str, params: &[SqlValue]) -> Result<i64> {
                let _write = self.write_permit().await?;
                let span = query_span(self.flavor, sql);
                async {
                    Ok(match &mut self.inner {
                        $enum::Postgres($h) => run_insert_id!(postgres, $exec, sql, params),
                        $enum::MySql($h) => run_insert_id!(mysql, $exec, sql, params),
                        $enum::Sqlite($h) => run_insert_id!(sqlite, $exec, sql, params),
                    })
                }
                .instrument(span)
                .await
            }
        }
    };
}

executor!(Conn, ConnInner, |conn| &mut **conn);
executor!(Tx, TxInner, |tx| &mut **tx);
executor!(PoolQueries<'a>, Pool, |pool| pool);

// Writes on a dedicated connection are the caller's business (migrations run alone), and
// a transaction took the write lock when it began: only single statements on the pool wait.
impl Conn {
    async fn write_permit(&self) -> Result<Option<WriteGuard>> {
        Ok(None)
    }
}

impl Tx {
    async fn write_permit(&self) -> Result<Option<WriteGuard>> {
        Ok(None)
    }
}

impl PoolQueries<'_> {
    async fn write_permit(&self) -> Result<Option<WriteGuard>> {
        write_guard(self.write_lock).await
    }
}

impl Tx {
    pub async fn commit(self) -> Result<()> {
        let span = query_span(self.flavor, "COMMIT");
        async {
            match self.inner {
                TxInner::Postgres(tx) => tx.commit().await?,
                TxInner::MySql(tx) => tx.commit().await?,
                TxInner::Sqlite(tx) => tx.commit().await?,
            }
            Ok(())
        }
        .instrument(span)
        .await
    }

    pub async fn rollback(self) -> Result<()> {
        let span = query_span(self.flavor, "ROLLBACK");
        async {
            match self.inner {
                TxInner::Postgres(tx) => tx.rollback().await?,
                TxInner::MySql(tx) => tx.rollback().await?,
                TxInner::Sqlite(tx) => tx.rollback().await?,
            }
            Ok(())
        }
        .instrument(span)
        .await
    }
}

impl Database {
    /// Checks out a dedicated connection from the pool.
    pub async fn acquire(&self) -> Result<Conn> {
        let inner = match &self.pool {
            Pool::Postgres(pool) => ConnInner::Postgres(pool.acquire().await?),
            Pool::MySql(pool) => ConnInner::MySql(pool.acquire().await?),
            Pool::Sqlite(pool) => ConnInner::Sqlite(pool.acquire().await?),
        };
        Ok(Conn { inner, flavor: self.flavor })
    }

    /// Begins a transaction. On SQLite it queues for the write lock (first come, first served)
    /// and then takes SQLite's own up front (`BEGIN IMMEDIATE`), so that concurrent writers
    /// wait in order instead of failing. The transaction holds both until it ends, so a
    /// caller holding one must write through it, not through [`Database::queries`].
    pub async fn begin(&self) -> Result<Tx> {
        let write = write_guard(self.write_lock.as_ref()).await?;
        let inner = match &self.pool {
            Pool::Postgres(pool) => TxInner::Postgres(pool.begin().await?),
            Pool::MySql(pool) => TxInner::MySql(pool.begin().await?),
            Pool::Sqlite(pool) => TxInner::Sqlite(pool.begin_with("BEGIN IMMEDIATE").await?),
        };
        Ok(Tx { inner, flavor: self.flavor, _write: write })
    }

    /// Single-statement queries on the pool. On SQLite, `execute` and
    /// `insert_returning_id` queue for the write lock like [`Database::begin`]; reads do not.
    pub fn queries(&self) -> PoolQueries<'_> {
        PoolQueries { inner: &self.pool, flavor: self.flavor, write_lock: self.write_lock.as_ref() }
    }
}

/// Rewrites `?` placeholders to `$1, $2, …` for PostgreSQL, leaving quoted literals and
/// identifiers intact.
fn placeholders(flavor: Flavor, sql: &str) -> String {
    if flavor != Flavor::Postgres {
        return sql.to_owned();
    }
    let mut out = String::with_capacity(sql.len() + 8);
    let mut index = 0;
    let mut quote: Option<char> = None;
    for c in sql.chars() {
        match (quote, c) {
            (Some(open), c) if c == open => quote = None,
            (Some(_), _) => {}
            (None, '\'' | '"') => quote = Some(c),
            (None, '?') => {
                index += 1;
                out.push('$');
                out.push_str(&index.to_string());
                continue;
            }
            (None, _) => {}
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{Flavor, placeholders};

    #[test]
    fn rewrites_placeholders_outside_quotes() {
        assert_eq!(
            placeholders(Flavor::Postgres, r#"SELECT '?' , "a?" FROM t WHERE a = ? AND b = ?"#),
            r#"SELECT '?' , "a?" FROM t WHERE a = $1 AND b = $2"#
        );
        assert_eq!(placeholders(Flavor::MySql, "a = ?"), "a = ?");
    }
}
