//! `verdin new`: scaffolds a project directory.

use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail};
use clap::ValueEnum;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Engine {
    Sqlite,
    Postgres,
    Mysql,
    Mariadb,
}

impl Engine {
    fn database_url(self, name: &str) -> String {
        match self {
            Self::Sqlite => "sqlite://data/verdin.db".into(),
            Self::Postgres => format!("postgres://verdin:change-me@localhost:5432/{name}"),
            Self::Mysql | Self::Mariadb => {
                format!("mysql://verdin:change-me@localhost:3306/{name}")
            }
        }
    }
}

const CONFIG: &str = r#"# Verdin project configuration. Every key can be overridden from the environment
# with VERDIN_<SECTION>__<KEY> (e.g. VERDIN_SERVER__PORT=8080). Secrets and the
# database URL live in the environment (see .env), never in this file.

[server]
port = 1337
# public_url = "https://cms.example.com"

[api]
prefix = "/api"
default_page_size = 25
max_page_size = 100

[admin]
path = "/admin"
# Refresh cookies are `Secure` in `verdin start` and not in `verdin dev` (plain HTTP).
# secure_cookies = true
"#;

const GITIGNORE: &str = ".env\ndata/\n*.db\n*.db-*\n";

/// Creates the project in `dir`, which must not exist or be empty.
pub fn scaffold(dir: &Path, engine: Engine) -> Result<()> {
    if dir.exists() && fs::read_dir(dir)?.next().is_some() {
        bail!("{} already exists and is not empty", dir.display());
    }
    let name = dir
        .file_name()
        .and_then(|name| name.to_str())
        .map(database_name)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "verdin".into());

    let write = |path: &str, contents: &str| {
        let path = dir.join(path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, contents).with_context(|| format!("writing {}", path.display()))
    };
    write("verdin.toml", CONFIG)?;
    write(".gitignore", GITIGNORE)?;
    write(
        ".env",
        &format!(
            "# Local secrets: keep this file out of version control.\n\
             VERDIN_DATABASE_URL={}\n\
             VERDIN_ADMIN_JWT_SECRET={}\n\
             VERDIN_TOKEN_PEPPER={}\n",
            engine.database_url(&name),
            verdin_auth::crypto::random_token(),
            verdin_auth::crypto::random_token(),
        ),
    )?;
    write("schema/content-types/.gitkeep", "")?;
    write("schema/components/.gitkeep", "")?;
    if engine == Engine::Sqlite {
        fs::create_dir_all(dir.join("data"))?;
    }
    restrict(&dir.join(".env"))?;
    Ok(())
}

/// A database name derived from the directory name: lowercase ASCII, digits and `_`.
fn database_name(dir: &str) -> String {
    dir.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_owned()
}

#[cfg(unix)]
fn restrict(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaffolds_a_project() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("My Site");
        scaffold(&dir, Engine::Postgres).unwrap();
        let env = fs::read_to_string(dir.join(".env")).unwrap();
        assert!(
            env.contains("VERDIN_DATABASE_URL=postgres://verdin:change-me@localhost:5432/my_site")
        );
        let secret = env.lines().find_map(|line| line.strip_prefix("VERDIN_ADMIN_JWT_SECRET="));
        assert!(secret.unwrap().len() >= 32);
        assert!(dir.join("schema/content-types").is_dir());
        crate::config::Config::load(&dir.join("verdin.toml")).unwrap();

        let error = scaffold(&dir, Engine::Sqlite).unwrap_err();
        assert!(error.to_string().contains("not empty"));
    }
}
