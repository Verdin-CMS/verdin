use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use clap::{Args, Parser, Subcommand, ValueEnum};
use tracing_subscriber::EnvFilter;
use verdin_db::{ConnectOptions, Database};
use verdin_migrate::{ApplyOptions, DbModel, Plan, Renames, Risk, Status};
use verdin_schema::Schema;

use crate::app::{self, AppContext, Mode, check_config, ensure_migrated};
use crate::config::{Config, LogConfig, LogFormat};
use crate::new::Engine;

#[derive(Debug, Parser)]
#[command(name = "verdin", version, about = "Open source headless CMS")]
pub struct Cli {
    /// Path to the project configuration file.
    #[arg(long, short, global = true, default_value = "verdin.toml", env = "VERDIN_CONFIG")]
    pub config: PathBuf,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Create a new project directory with a configuration, an empty schema and fresh secrets.
    New {
        /// Directory to create.
        dir: PathBuf,
        /// Database the generated `.env` points at.
        #[arg(long, value_enum, default_value_t = Engine::Sqlite)]
        database: Engine,
    },
    /// Start the server in production mode.
    Start {
        /// Apply pending safe migrations before starting.
        #[arg(long)]
        migrate: bool,
    },
    /// Start in development mode: safe migrations apply automatically and the admin's
    /// content-type builder can edit the schema files.
    Dev,
    /// Inspect the content schema.
    #[command(subcommand)]
    Schema(SchemaCommand),
    /// Plan and apply database migrations.
    #[command(subcommand)]
    Migrate(MigrateCommand),
    /// Manage admin users.
    #[command(subcommand)]
    Admin(AdminCommand),
    /// Print freshly generated secrets for VERDIN_ADMIN_JWT_SECRET and VERDIN_TOKEN_PEPPER.
    Secrets,
    /// Print version information.
    Version,
}

#[derive(Debug, Subcommand)]
pub enum AdminCommand {
    /// Create a Super Admin. The password is read from VERDIN_ADMIN_PASSWORD or stdin.
    Create {
        #[arg(long)]
        email: String,
    },
    /// Set a user's password, unlock the account and end its sessions.
    /// The password is read from VERDIN_ADMIN_PASSWORD or stdin.
    ResetPassword {
        #[arg(long)]
        email: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum SchemaCommand {
    /// Validate the schema files.
    Check,
}

#[derive(Debug, Subcommand)]
pub enum MigrateCommand {
    /// Show the steps and SQL needed to match the schema.
    Plan(RenameArgs),
    /// Apply pending migration steps.
    Apply {
        #[command(flatten)]
        renames: RenameArgs,
        /// Highest risk level to allow.
        #[arg(long, value_enum, default_value_t = Allow::Safe)]
        allow: Allow,
    },
}

#[derive(Debug, Args)]
pub struct RenameArgs {
    /// Rename a table instead of dropping and creating it.
    #[arg(long = "rename-table", value_name = "OLD=NEW")]
    tables: Vec<String>,
    /// Rename a column instead of dropping and adding it.
    #[arg(long = "rename-column", value_name = "TABLE.OLD=NEW")]
    columns: Vec<String>,
}

impl RenameArgs {
    fn parse(&self) -> Result<Renames> {
        let mut renames = Renames::default();
        for spec in &self.tables {
            renames.add_table(spec)?;
        }
        for spec in &self.columns {
            renames.add_column(spec)?;
        }
        Ok(renames)
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum Allow {
    /// Only changes that cannot lose data or fail on existing rows.
    Safe,
    /// Also type changes and new unique constraints.
    Risky,
    /// Also dropping columns and tables.
    Destructive,
}

impl From<Allow> for Risk {
    fn from(allow: Allow) -> Self {
        match allow {
            Allow::Safe => Risk::Safe,
            Allow::Risky => Risk::Risky,
            Allow::Destructive => Risk::Destructive,
        }
    }
}

/// A project on disk: its configuration and where its files live.
struct Project {
    config: Config,
    root: PathBuf,
}

impl Project {
    fn load(config_path: &Path) -> Result<Self> {
        let config = Config::load(config_path)
            .with_context(|| format!("loading {}", config_path.display()))?;
        let root = config_path.parent().map(Path::to_path_buf).unwrap_or_default();
        Ok(Self { config, root })
    }

    fn schema(&self) -> Result<Schema> {
        let path = self.root.join(&self.config.schema.path);
        Ok(Schema::load_dir(&path)?)
    }

    async fn database(&self) -> Result<Database> {
        let url = self
            .config
            .database
            .url
            .as_deref()
            .context("no database configured: set VERDIN_DATABASE_URL or [database].url")?;
        let url = resolve_sqlite_path(url, &self.root);
        let options =
            ConnectOptions { max_connections: self.config.database.pool_max, ..Default::default() };
        Database::connect(&url, &options).await.context("connecting to database")
    }

    /// Authentication, from the secrets in the environment (never in `verdin.toml`).
    fn auth(&self, db: &Database) -> Result<verdin_auth::AuthService> {
        let read = |name: &str| {
            std::env::var(name).with_context(|| {
                format!("{name} is not set (generate secrets with `verdin secrets`)")
            })
        };
        let config = verdin_auth::AuthConfig::new(
            &read("VERDIN_ADMIN_JWT_SECRET")?,
            &read("VERDIN_TOKEN_PEPPER")?,
        )?;
        Ok(verdin_auth::AuthService::new(db.clone(), config))
    }

    /// A database whose platform tables are up to date, for commands that need them.
    async fn migrated_database(&self) -> Result<(Database, Schema)> {
        let schema = self.schema()?;
        let db = self.database().await?;
        let desired = verdin_migrate::derive_model(&schema);
        if !matches!(
            verdin_migrate::status(&db, &desired, &Renames::default()).await?,
            Status::UpToDate
        ) {
            bail!("the database is behind the schema; run `verdin migrate apply` first");
        }
        Ok((db, schema))
    }
}

pub async fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Command::Version => {
            println!("verdin {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        Command::Secrets => {
            println!("VERDIN_ADMIN_JWT_SECRET={}", verdin_auth::crypto::random_token());
            println!("VERDIN_TOKEN_PEPPER={}", verdin_auth::crypto::random_token());
            return Ok(());
        }
        Command::New { dir, database } => {
            crate::new::scaffold(&dir, database)?;
            println!("created {}", dir.display());
            println!("\n  cd {}\n  verdin dev\n", dir.display());
            println!("then open http://localhost:1337/admin/ to register the first admin");
            return Ok(());
        }
        _ => {}
    }
    load_dotenv(&cli.config)?;
    let project = Project::load(&cli.config)?;
    init_logging(&project.config.log);

    match cli.command {
        Command::Version | Command::Secrets | Command::New { .. } => unreachable!("handled above"),
        Command::Admin(command) => admin(project, command).await,
        Command::Start { migrate } => start(project, Mode::Production, migrate).await,
        Command::Dev => start(project, Mode::Development, true).await,
        Command::Schema(SchemaCommand::Check) => {
            let schema = project.schema()?;
            println!(
                "schema ok: {} content types, {} components",
                schema.content_types.len(),
                schema.components.len()
            );
            Ok(())
        }
        Command::Migrate(MigrateCommand::Plan(renames)) => {
            let desired = verdin_migrate::derive_model(&project.schema()?);
            let db = project.database().await?;
            let status = verdin_migrate::status(&db, &desired, &renames.parse()?).await;
            db.close().await;
            print_status(&status?);
            Ok(())
        }
        Command::Migrate(MigrateCommand::Apply { renames, allow }) => {
            let desired = verdin_migrate::derive_model(&project.schema()?);
            let db = project.database().await?;
            let result = migrate(&db, &desired, &renames.parse()?, allow.into()).await;
            db.close().await;
            result
        }
    }
}

async fn admin(project: Project, command: AdminCommand) -> Result<()> {
    let (db, _) = project.migrated_database().await?;
    let auth = project.auth(&db)?;
    auth.bootstrap().await?;
    let password = match std::env::var("VERDIN_ADMIN_PASSWORD") {
        Ok(password) => password,
        Err(_) => {
            eprint!("password: ");
            let mut line = String::new();
            std::io::stdin().read_line(&mut line).context("reading the password from stdin")?;
            line.trim_end_matches(['\r', '\n']).to_owned()
        }
    };
    let result = match command {
        AdminCommand::Create { email } => {
            let user = auth.create_super_admin(&email, &password).await?;
            println!("created Super Admin {} (id {})", user.email, user.id);
            Ok(())
        }
        AdminCommand::ResetPassword { email } => {
            auth.reset_password(&email, &password).await?;
            println!("password updated; existing sessions were revoked");
            Ok(())
        }
    };
    db.close().await;
    result
}

async fn migrate(db: &Database, desired: &DbModel, renames: &Renames, allow: Risk) -> Result<()> {
    let report = verdin_migrate::apply(db, desired, renames, ApplyOptions { allow }).await?;
    match (report.applied_steps, report.resumed_from) {
        (0, None) => println!("database is up to date"),
        (steps, None) => println!("applied {steps} step{}", plural(steps)),
        (steps, Some(from)) => {
            println!(
                "resumed interrupted migration at step {}; applied {steps} step{}",
                from + 1,
                plural(steps)
            );
        }
    }
    Ok(())
}

async fn start(project: Project, mode: Mode, migrate: bool) -> Result<()> {
    check_config(&project.config)?;
    let schema = project.schema()?;
    let db = project.database().await?;
    ensure_migrated(&db, &schema, migrate || mode == Mode::Development).await?;

    let admin = &project.config.admin;
    if mode == Mode::Production && admin.secure_cookies == Some(false) {
        tracing::warn!("[admin].secure_cookies is off: refresh cookies may travel over plain HTTP");
    }
    let auth = project.auth(&db)?;
    auth.bootstrap().await.context("creating built-in roles")?;
    if !auth.has_admin().await? {
        tracing::info!(url = %format!("{}/", admin.path), "no admin yet: open the admin panel to register the first one");
    }
    let context = AppContext { config: project.config, root: project.root, db, auth, mode };
    app::serve(context, schema, shutdown_signal()).await
}

fn print_status(status: &Status) {
    match status {
        Status::UpToDate => println!("database is up to date"),
        Status::Pending(plan) => print_plan(plan, 0),
        Status::Interrupted { plan, done, error } => {
            println!("interrupted migration: {done} of {} steps applied", plan.steps.len());
            if let Some(error) = error {
                println!("last error: {error}");
            }
            println!("fix the cause and run `verdin migrate apply` to resume\n");
            print_plan(plan, *done);
        }
    }
}

fn print_plan(plan: &Plan, done: usize) {
    for (index, step) in plan.steps.iter().enumerate() {
        let marker = if index < done { " (done)" } else { "" };
        println!("{:>3}. [{}] {}{marker}", index + 1, step.risk.as_str(), step.description);
        for statement in &step.statements {
            for line in statement.lines() {
                println!("       {line}");
            }
        }
    }
    if let Some(risk) = plan.max_risk().filter(|risk| *risk > Risk::Safe) {
        println!("\nrequires: verdin migrate apply --allow {}", risk.as_str());
    }
    if !plan.hints.is_empty() {
        println!("\npossible renames (pass them to keep the data):");
        for hint in &plan.hints {
            println!("  {hint}");
        }
    }
}

/// Relative SQLite paths are relative to the project, not to the working directory.
fn resolve_sqlite_path(url: &str, root: &Path) -> String {
    let Some(rest) = url.strip_prefix("sqlite://") else { return url.to_owned() };
    let (path, query) =
        rest.split_once('?').map_or((rest, None), |(path, query)| (path, Some(query)));
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with(':')
        || root.as_os_str().is_empty()
    {
        return url.to_owned();
    }
    let joined = root.join(path);
    match query {
        Some(query) => format!("sqlite://{}?{query}", joined.display()),
        None => format!("sqlite://{}", joined.display()),
    }
}

/// Loads `.env` next to the configuration file; variables already set win.
fn load_dotenv(config_path: &Path) -> Result<()> {
    let dir = config_path.parent().filter(|dir| !dir.as_os_str().is_empty());
    let path = dir.unwrap_or(Path::new(".")).join(".env");
    match dotenvy::from_path(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.not_found() => Ok(()),
        Err(error) => Err(error).with_context(|| format!("reading {}", path.display())),
    }
}

fn plural(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}

fn init_logging(config: &LogConfig) {
    let default_level = config.level.as_deref().unwrap_or("info");
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_level));
    let builder = tracing_subscriber::fmt().with_env_filter(filter).with_writer(std::io::stderr);
    match config.format {
        LogFormat::Json => builder.json().init(),
        LogFormat::Pretty => builder.init(),
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.expect("install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutdown signal received");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_sqlite_paths() {
        let root = Path::new("site");
        assert_eq!(resolve_sqlite_path("sqlite://data/a.db", root), "sqlite://site/data/a.db");
        assert_eq!(
            resolve_sqlite_path("sqlite://a.db?mode=rwc", root),
            "sqlite://site/a.db?mode=rwc"
        );
        assert_eq!(resolve_sqlite_path("sqlite:///abs/a.db", root), "sqlite:///abs/a.db");
        assert_eq!(resolve_sqlite_path("sqlite::memory:", root), "sqlite::memory:");
        assert_eq!(resolve_sqlite_path("sqlite://a.db", Path::new("")), "sqlite://a.db");
        assert_eq!(resolve_sqlite_path("postgres://h/db", root), "postgres://h/db");
    }
}
