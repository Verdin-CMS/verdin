//! Configuration: built-in defaults ← `verdin.toml` ← environment.
//!
//! Environment overrides use `VERDIN_<SECTION>__<KEY>` (e.g. `VERDIN_SERVER__PORT=8080`).
//! `VERDIN_DATABASE_URL` is accepted as a shorthand for `database.url`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use figment::Figment;
use figment::providers::{Env, Format, Toml};
use serde::{Deserialize, Deserializer};

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub schema: SchemaConfig,
    pub api: ApiConfig,
    pub admin: AdminConfig,
    pub log: LogConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub public_url: Option<String>,
    #[serde(deserialize_with = "deserialize_byte_size")]
    pub body_limit: usize,
    pub request_timeout_secs: u64,
}

impl ServerConfig {
    pub fn request_timeout(&self) -> Duration {
        Duration::from_secs(self.request_timeout_secs)
    }
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".into(),
            port: 1337,
            public_url: None,
            body_limit: 1024 * 1024,
            request_timeout_secs: 30,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DatabaseConfig {
    pub url: Option<String>,
    pub pool_max: u32,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self { url: None, pool_max: 10 }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ApiConfig {
    /// Path the content API is served under.
    pub prefix: String,
    pub default_page_size: u64,
    pub max_page_size: u64,
    /// Serialize decimals as strings (exact) instead of numbers (Strapi-compatible).
    pub decimal_as_string: bool,
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            prefix: "/api".into(),
            default_page_size: 25,
            max_page_size: 100,
            decimal_as_string: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AdminConfig {
    /// Path the admin panel is served under; its API lives at `{path}/api`.
    pub path: String,
    /// Mark the refresh cookie `Secure`. Only disable for plain-HTTP local development.
    pub secure_cookies: bool,
    /// Login, registration and refresh attempts per client IP per minute.
    pub auth_rate_limit: u32,
    /// Serve the admin panel from this directory (relative to the configuration file)
    /// instead of the copy embedded in the binary.
    pub assets_dir: Option<PathBuf>,
}

impl Default for AdminConfig {
    fn default() -> Self {
        Self { path: "/admin".into(), secure_cookies: true, auth_rate_limit: 20, assets_dir: None }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SchemaConfig {
    /// Schema directory, relative to the configuration file.
    pub path: PathBuf,
}

impl Default for SchemaConfig {
    fn default() -> Self {
        Self { path: PathBuf::from("schema") }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LogConfig {
    pub format: LogFormat,
    /// Default filter; `RUST_LOG` takes precedence when set.
    pub level: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogFormat {
    #[default]
    Pretty,
    Json,
}

impl Config {
    /// Loads `path` if it exists (it is optional), then applies environment overrides.
    pub fn load(path: &Path) -> Result<Self, Box<figment::Error>> {
        Figment::new()
            .merge(Toml::file(path))
            .merge(Env::prefixed("VERDIN_").filter(|key| key.as_str().contains("__")).split("__"))
            .merge(Env::raw().only(&["VERDIN_DATABASE_URL"]).map(|_| "database.url".into()))
            .extract()
            .map_err(Box::new)
    }
}

/// Accepts either a plain number of bytes or a string such as `"512kb"` or `"1mb"`.
fn deserialize_byte_size<'de, D: Deserializer<'de>>(deserializer: D) -> Result<usize, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Raw {
        Bytes(usize),
        Text(String),
    }

    match Raw::deserialize(deserializer)? {
        Raw::Bytes(bytes) => Ok(bytes),
        Raw::Text(text) => parse_byte_size(&text)
            .ok_or_else(|| serde::de::Error::custom(format!("invalid byte size `{text}`"))),
    }
}

fn parse_byte_size(text: &str) -> Option<usize> {
    let text = text.trim().to_ascii_lowercase();
    let split = text.find(|c: char| !c.is_ascii_digit()).unwrap_or(text.len());
    let (number, unit) = text.split_at(split);
    let number: usize = number.parse().ok()?;
    let multiplier = match unit.trim() {
        "" | "b" => 1,
        "kb" => 1024,
        "mb" => 1024 * 1024,
        "gb" => 1024 * 1024 * 1024,
        _ => return None,
    };
    number.checked_mul(multiplier)
}

#[cfg(test)]
#[allow(clippy::result_large_err)] // figment::Jail closures return figment::Error
mod tests {
    use super::*;
    use figment::Jail;

    #[test]
    fn parses_byte_sizes() {
        assert_eq!(parse_byte_size("1mb"), Some(1024 * 1024));
        assert_eq!(parse_byte_size("512 KB"), Some(512 * 1024));
        assert_eq!(parse_byte_size("42"), Some(42));
        assert_eq!(parse_byte_size("1tb"), None);
        assert_eq!(parse_byte_size("mb"), None);
    }

    #[test]
    fn defaults_without_file() {
        Jail::expect_with(|_jail| {
            let config = Config::load(Path::new("missing.toml")).unwrap();
            assert_eq!(config.server.port, 1337);
            assert_eq!(config.database.url, None);
            assert_eq!(config.log.format, LogFormat::Pretty);
            Ok(())
        });
    }

    #[test]
    fn file_then_env_overrides() {
        Jail::expect_with(|jail| {
            jail.create_file(
                "verdin.toml",
                r#"
                [server]
                port = 4000
                body_limit = "2mb"

                [database]
                url = "sqlite://from-file.db"
                "#,
            )?;
            jail.set_env("VERDIN_SERVER__PORT", "5000");
            jail.set_env("VERDIN_DATABASE_URL", "postgres://from-env");
            jail.set_env("VERDIN_ADMIN_JWT_SECRET", "ignored-by-config");

            let config = Config::load(Path::new("verdin.toml")).unwrap();
            assert_eq!(config.server.port, 5000);
            assert_eq!(config.server.body_limit, 2 * 1024 * 1024);
            assert_eq!(config.database.url.as_deref(), Some("postgres://from-env"));
            Ok(())
        });
    }

    #[test]
    fn rejects_unknown_keys() {
        Jail::expect_with(|jail| {
            jail.create_file("verdin.toml", "[server]\nprot = 1\n")?;
            assert!(Config::load(Path::new("verdin.toml")).is_err());
            Ok(())
        });
    }
}
