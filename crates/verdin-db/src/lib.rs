//! Database connectivity for Verdin.
//!
//! Wraps one `sqlx` pool per backend and detects the concrete server flavor, so that
//! MySQL and MariaDB (which share a driver) can be told apart by the dialect layer.

mod conn;
pub mod value;
mod version;

use std::str::FromStr;
use std::time::Duration;

use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{MySqlPool, PgPool, SqlitePool};

pub use conn::{Conn, PoolQueries, Tx};
pub use value::{ColumnKind, SqlValue};
pub use version::Version;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("unsupported database url scheme `{0}` (expected postgres, mysql, mariadb or sqlite)")]
    UnsupportedScheme(String),
    #[error("invalid database url: {0}")]
    InvalidUrl(String),
    #[error("{flavor} {found} is not supported (minimum {minimum})")]
    UnsupportedVersion { flavor: Flavor, found: Version, minimum: Version },
    #[error("could not parse server version `{0}`")]
    UnparsableVersion(String),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

/// Where a unique constraint was violated, as far as the backend reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UniqueViolation {
    /// PostgreSQL, MySQL and MariaDB name the index.
    Index(String),
    /// SQLite lists the columns (`table.column`).
    Columns(Vec<String>),
}

impl DbError {
    /// Details of a unique constraint violation, if that is what this error is.
    pub fn unique_violation(&self) -> Option<UniqueViolation> {
        let DbError::Sqlx(sqlx::Error::Database(error)) = self else { return None };
        if !error.is_unique_violation() {
            return None;
        }
        if let Some(constraint) = error.constraint() {
            return Some(UniqueViolation::Index(constraint.to_owned()));
        }
        let message = error.message();
        // MySQL: "Duplicate entry 'x' for key 'articles.articles_slug_uq'" (MariaDB omits the table).
        if let Some((_, key)) = message.rsplit_once("for key '") {
            let key = key.trim_end_matches('\'').rsplit('.').next().unwrap_or(key);
            return Some(UniqueViolation::Index(key.to_owned()));
        }
        // SQLite: "UNIQUE constraint failed: articles.slug, articles.locale, …"
        if let Some((_, columns)) = message.split_once("constraint failed: ") {
            return Some(UniqueViolation::Columns(
                columns.split(", ").map(|column| column.trim().to_owned()).collect(),
            ));
        }
        Some(UniqueViolation::Columns(Vec::new()))
    }
}

pub type Result<T> = std::result::Result<T, DbError>;

/// Concrete database server. MySQL and MariaDB share the `Pool::MySql` driver.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flavor {
    Postgres,
    MySql,
    MariaDb,
    Sqlite,
}

impl Flavor {
    pub fn minimum_version(self) -> Version {
        match self {
            Flavor::Postgres => Version::new(14, 0),
            Flavor::MySql => Version::new(8, 4),
            Flavor::MariaDb => Version::new(10, 11),
            Flavor::Sqlite => Version::new(3, 35),
        }
    }

    /// Whether DDL statements take part in transactions. MySQL and MariaDB commit
    /// implicitly on every DDL statement.
    pub fn transactional_ddl(self) -> bool {
        matches!(self, Flavor::Postgres | Flavor::Sqlite)
    }

    pub fn is_mysql_family(self) -> bool {
        matches!(self, Flavor::MySql | Flavor::MariaDb)
    }

    /// Quotes an identifier. Identifiers must come from the validated schema
    /// (`^[a-z_][a-z0-9_]*$`), so they never contain quote characters.
    pub fn quote(self, identifier: &str) -> String {
        debug_assert!(!identifier.contains(['"', '`']), "identifiers are validated upstream");
        if self.is_mysql_family() { format!("`{identifier}`") } else { format!("\"{identifier}\"") }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Flavor::Postgres => "postgres",
            Flavor::MySql => "mysql",
            Flavor::MariaDb => "mariadb",
            Flavor::Sqlite => "sqlite",
        }
    }
}

impl std::fmt::Display for Flavor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone)]
pub enum Pool {
    Postgres(PgPool),
    MySql(MySqlPool),
    Sqlite(SqlitePool),
}

#[derive(Debug, Clone)]
pub struct ConnectOptions {
    pub max_connections: u32,
    pub acquire_timeout: Duration,
}

impl Default for ConnectOptions {
    fn default() -> Self {
        Self { max_connections: 10, acquire_timeout: Duration::from_secs(10) }
    }
}

/// A connected database with its detected flavor and server version.
#[derive(Debug, Clone)]
pub struct Database {
    pool: Pool,
    flavor: Flavor,
    version: Version,
}

impl Database {
    /// Connects to `url`, detects the server flavor and rejects unsupported versions.
    ///
    /// Accepted schemes: `postgres://`, `postgresql://`, `mysql://`, `mariadb://`
    /// (alias of `mysql://`) and `sqlite:`.
    pub async fn connect(url: &str, options: &ConnectOptions) -> Result<Self> {
        let scheme = url.split_once(':').map(|(scheme, _)| scheme).unwrap_or_default();
        let pool = match scheme {
            "postgres" | "postgresql" => {
                let connect = PgConnectOptions::from_str(url).map_err(invalid_url)?;
                let pool = PgPoolOptions::new()
                    .max_connections(options.max_connections)
                    .acquire_timeout(options.acquire_timeout)
                    .connect_with(connect)
                    .await?;
                Pool::Postgres(pool)
            }
            "mysql" | "mariadb" => {
                let url = url.replacen("mariadb:", "mysql:", 1);
                let connect = MySqlConnectOptions::from_str(&url)
                    .map_err(invalid_url)?
                    .charset("utf8mb4")
                    // Every timestamp is stored in UTC (docs/architecture.md §9.3).
                    .timezone(Some(String::from("+00:00")));
                let pool = MySqlPoolOptions::new()
                    .max_connections(options.max_connections)
                    .acquire_timeout(options.acquire_timeout)
                    .connect_with(connect)
                    .await?;
                Pool::MySql(pool)
            }
            "sqlite" => {
                let connect = SqliteConnectOptions::from_str(url)
                    .map_err(invalid_url)?
                    .create_if_missing(true)
                    .foreign_keys(true)
                    .journal_mode(SqliteJournalMode::Wal)
                    .busy_timeout(Duration::from_secs(5));
                // Every connection to an in-memory database opens a *different* database,
                // so in-memory pools are limited to a single connection.
                let in_memory = url.contains(":memory:") || url.contains("mode=memory");
                if !in_memory
                    && let Some(parent) = connect.get_filename().parent()
                    && !parent.as_os_str().is_empty()
                {
                    std::fs::create_dir_all(parent).map_err(|error| {
                        DbError::InvalidUrl(format!("cannot create {}: {error}", parent.display()))
                    })?;
                }
                let max_connections = if in_memory { 1 } else { options.max_connections };
                let pool = SqlitePoolOptions::new()
                    .max_connections(max_connections)
                    .acquire_timeout(options.acquire_timeout)
                    .connect_with(connect)
                    .await?;
                Pool::Sqlite(pool)
            }
            other => return Err(DbError::UnsupportedScheme(other.to_owned())),
        };

        let (flavor, version) = detect(&pool).await?;
        let minimum = flavor.minimum_version();
        if version < minimum {
            return Err(DbError::UnsupportedVersion { flavor, found: version, minimum });
        }
        tracing::info!(%flavor, %version, "connected to database");

        Ok(Self { pool, flavor, version })
    }

    pub fn pool(&self) -> &Pool {
        &self.pool
    }

    pub fn flavor(&self) -> Flavor {
        self.flavor
    }

    pub fn version(&self) -> Version {
        self.version
    }

    /// Round-trips a trivial query; used by readiness checks.
    pub async fn ping(&self) -> Result<()> {
        match &self.pool {
            Pool::Postgres(pool) => sqlx::query("SELECT 1").execute(pool).await.map(drop)?,
            Pool::MySql(pool) => sqlx::query("SELECT 1").execute(pool).await.map(drop)?,
            Pool::Sqlite(pool) => sqlx::query("SELECT 1").execute(pool).await.map(drop)?,
        }
        Ok(())
    }

    pub async fn close(&self) {
        match &self.pool {
            Pool::Postgres(pool) => pool.close().await,
            Pool::MySql(pool) => pool.close().await,
            Pool::Sqlite(pool) => pool.close().await,
        }
    }
}

async fn detect(pool: &Pool) -> Result<(Flavor, Version)> {
    let (flavor, raw) = match pool {
        Pool::Postgres(pool) => {
            let raw: String = sqlx::query_scalar("SHOW server_version").fetch_one(pool).await?;
            (Flavor::Postgres, raw)
        }
        Pool::MySql(pool) => {
            let raw: String = sqlx::query_scalar("SELECT VERSION()").fetch_one(pool).await?;
            let flavor = if raw.to_ascii_lowercase().contains("mariadb") {
                Flavor::MariaDb
            } else {
                Flavor::MySql
            };
            (flavor, raw)
        }
        Pool::Sqlite(pool) => {
            let raw: String = sqlx::query_scalar("SELECT sqlite_version()").fetch_one(pool).await?;
            (Flavor::Sqlite, raw)
        }
    };
    let version = Version::parse(&raw).ok_or(DbError::UnparsableVersion(raw))?;
    Ok((flavor, version))
}

fn invalid_url(error: sqlx::Error) -> DbError {
    DbError::InvalidUrl(error.to_string())
}
