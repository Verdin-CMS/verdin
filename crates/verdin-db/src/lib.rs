//! Database connectivity for Verdin.
//!
//! Wraps one `sqlx` pool per backend and detects the concrete server flavor, so that
//! MySQL and MariaDB (which share a driver) can be told apart by the dialect layer.

mod version;

use std::str::FromStr;
use std::time::Duration;

use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{MySqlPool, PgPool, SqlitePool};

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
                let pool = SqlitePoolOptions::new()
                    .max_connections(options.max_connections)
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
