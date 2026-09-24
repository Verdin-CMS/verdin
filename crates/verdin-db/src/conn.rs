//! A single pooled connection with a tiny, backend-neutral query surface.
//!
//! Statements are written with `?` placeholders; they are rewritten to `$n` for PostgreSQL.
//! Results are decoded according to caller-supplied [`Kind`]s (schema-driven decoding),
//! never according to the type the driver reports.
//!
//! Callers must only build SQL text from identifiers that come from the validated schema;
//! every value goes through [`Param`]. That contract is why statements are wrapped in
//! `AssertSqlSafe`.

use sqlx::pool::PoolConnection;
use sqlx::{AssertSqlSafe, MySql, Postgres, Row, Sqlite};

use crate::{Flavor, Result};

/// A bound statement parameter. `NULL`s are written literally in SQL.
#[derive(Debug, Clone, PartialEq)]
pub enum Param {
    Int(i64),
    Text(String),
}

impl From<i64> for Param {
    fn from(value: i64) -> Self {
        Param::Int(value)
    }
}

impl From<&str> for Param {
    fn from(value: &str) -> Self {
        Param::Text(value.to_owned())
    }
}

impl From<String> for Param {
    fn from(value: String) -> Self {
        Param::Text(value)
    }
}

/// How to decode a result column.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Int,
    Text,
}

/// A decoded result value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Int(i64),
    Text(String),
}

impl Value {
    pub fn as_int(&self) -> Option<i64> {
        match self {
            Value::Int(value) => Some(*value),
            _ => None,
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        match self {
            Value::Text(value) => Some(value),
            _ => None,
        }
    }

    pub fn into_text(self) -> Option<String> {
        match self {
            Value::Text(value) => Some(value),
            _ => None,
        }
    }
}

pub(crate) enum Inner {
    Postgres(PoolConnection<Postgres>),
    MySql(PoolConnection<MySql>),
    Sqlite(PoolConnection<Sqlite>),
}

/// A connection held for the duration of a unit of work (e.g. a migration run),
/// so that session state such as advisory locks or `BEGIN` stays on one connection.
pub struct Conn {
    pub(crate) inner: Inner,
    pub(crate) flavor: Flavor,
}

macro_rules! bind_params {
    ($query:expr, $params:expr) => {{
        let mut query = $query;
        for param in $params {
            query = match param {
                Param::Int(value) => query.bind(*value),
                Param::Text(value) => query.bind(value.as_str()),
            };
        }
        query
    }};
}

macro_rules! decode_rows {
    ($rows:expr, $kinds:expr) => {{
        let mut out = Vec::with_capacity($rows.len());
        for row in &$rows {
            let mut values = Vec::with_capacity($kinds.len());
            for (index, kind) in $kinds.iter().enumerate() {
                let value = match kind {
                    Kind::Int => {
                        row.try_get::<Option<i64>, _>(index)?.map_or(Value::Null, Value::Int)
                    }
                    Kind::Text => {
                        row.try_get::<Option<String>, _>(index)?.map_or(Value::Null, Value::Text)
                    }
                };
                values.push(value);
            }
            out.push(values);
        }
        out
    }};
}

impl Conn {
    pub fn flavor(&self) -> Flavor {
        self.flavor
    }

    /// Runs one statement. Without parameters the simple (unprepared) protocol is used,
    /// which is what DDL and session statements (`BEGIN`, `COMMIT`) need.
    pub async fn execute(&mut self, sql: &str, params: &[Param]) -> Result<u64> {
        if params.is_empty() {
            let affected = match &mut self.inner {
                Inner::Postgres(conn) => {
                    sqlx::raw_sql(AssertSqlSafe(sql)).execute(&mut **conn).await?.rows_affected()
                }
                Inner::MySql(conn) => {
                    sqlx::raw_sql(AssertSqlSafe(sql)).execute(&mut **conn).await?.rows_affected()
                }
                Inner::Sqlite(conn) => {
                    sqlx::raw_sql(AssertSqlSafe(sql)).execute(&mut **conn).await?.rows_affected()
                }
            };
            return Ok(affected);
        }
        let affected = match &mut self.inner {
            Inner::Postgres(conn) => {
                let sql = postgres_placeholders(sql);
                bind_params!(sqlx::query(AssertSqlSafe(sql.as_str())), params)
                    .execute(&mut **conn)
                    .await?
                    .rows_affected()
            }
            Inner::MySql(conn) => bind_params!(sqlx::query(AssertSqlSafe(sql)), params)
                .execute(&mut **conn)
                .await?
                .rows_affected(),
            Inner::Sqlite(conn) => bind_params!(sqlx::query(AssertSqlSafe(sql)), params)
                .execute(&mut **conn)
                .await?
                .rows_affected(),
        };
        Ok(affected)
    }

    /// Runs a query and decodes every row column-by-column with `kinds`.
    pub async fn fetch_all(
        &mut self,
        sql: &str,
        params: &[Param],
        kinds: &[Kind],
    ) -> Result<Vec<Vec<Value>>> {
        let rows = match &mut self.inner {
            Inner::Postgres(conn) => {
                let sql = postgres_placeholders(sql);
                let rows = bind_params!(sqlx::query(AssertSqlSafe(sql.as_str())), params)
                    .fetch_all(&mut **conn)
                    .await?;
                decode_rows!(rows, kinds)
            }
            Inner::MySql(conn) => {
                let rows = bind_params!(sqlx::query(AssertSqlSafe(sql)), params)
                    .fetch_all(&mut **conn)
                    .await?;
                decode_rows!(rows, kinds)
            }
            Inner::Sqlite(conn) => {
                let rows = bind_params!(sqlx::query(AssertSqlSafe(sql)), params)
                    .fetch_all(&mut **conn)
                    .await?;
                decode_rows!(rows, kinds)
            }
        };
        Ok(rows)
    }

    /// Whether a query returns at least one row (no column is decoded).
    pub async fn has_rows(&mut self, sql: &str, params: &[Param]) -> Result<bool> {
        let found = match &mut self.inner {
            Inner::Postgres(conn) => {
                let sql = postgres_placeholders(sql);
                bind_params!(sqlx::query(AssertSqlSafe(sql.as_str())), params)
                    .fetch_optional(&mut **conn)
                    .await?
                    .is_some()
            }
            Inner::MySql(conn) => bind_params!(sqlx::query(AssertSqlSafe(sql)), params)
                .fetch_optional(&mut **conn)
                .await?
                .is_some(),
            Inner::Sqlite(conn) => bind_params!(sqlx::query(AssertSqlSafe(sql)), params)
                .fetch_optional(&mut **conn)
                .await?
                .is_some(),
        };
        Ok(found)
    }

    /// Runs an `INSERT` into a table whose primary key is `id` and returns the new id.
    /// Uses `RETURNING` where available and `LAST_INSERT_ID()` on MySQL.
    pub async fn insert_returning_id(&mut self, sql: &str, params: &[Param]) -> Result<i64> {
        let id = match &mut self.inner {
            Inner::Postgres(conn) => {
                let sql = postgres_placeholders(&format!("{sql} RETURNING id"));
                let row = bind_params!(sqlx::query(AssertSqlSafe(sql.as_str())), params)
                    .fetch_one(&mut **conn)
                    .await?;
                row.try_get::<i64, _>(0)?
            }
            Inner::MySql(conn) => {
                let result = bind_params!(sqlx::query(AssertSqlSafe(sql)), params)
                    .execute(&mut **conn)
                    .await?;
                i64::try_from(result.last_insert_id()).unwrap_or(i64::MAX)
            }
            Inner::Sqlite(conn) => bind_params!(sqlx::query(AssertSqlSafe(sql)), params)
                .execute(&mut **conn)
                .await?
                .last_insert_rowid(),
        };
        Ok(id)
    }
}

/// Rewrites `?` placeholders to `$1, $2, …`, leaving quoted literals and identifiers intact.
fn postgres_placeholders(sql: &str) -> String {
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
    use super::postgres_placeholders;

    #[test]
    fn rewrites_placeholders_outside_quotes() {
        assert_eq!(
            postgres_placeholders(r#"SELECT '?' , "a?" FROM t WHERE a = ? AND b = ?"#),
            r#"SELECT '?' , "a?" FROM t WHERE a = $1 AND b = $2"#
        );
    }
}
