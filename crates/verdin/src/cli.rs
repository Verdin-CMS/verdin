use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use clap::{Args, Parser, Subcommand, ValueEnum};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;
use verdin_db::{ConnectOptions, Database};
use verdin_migrate::{ApplyOptions, DbModel, Plan, Renames, Risk, Status};
use verdin_schema::Schema;

use crate::config::{Config, LogConfig, LogFormat};
use crate::server::{self, AppState};

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
    /// Start the server in production mode.
    Start {
        /// Apply pending safe migrations before starting.
        #[arg(long)]
        migrate: bool,
    },
    /// Inspect the content schema.
    #[command(subcommand)]
    Schema(SchemaCommand),
    /// Plan and apply database migrations.
    #[command(subcommand)]
    Migrate(MigrateCommand),
    /// Print version information.
    Version,
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
        let options =
            ConnectOptions { max_connections: self.config.database.pool_max, ..Default::default() };
        Database::connect(url, &options).await.context("connecting to database")
    }
}

pub async fn run(cli: Cli) -> Result<()> {
    if let Command::Version = cli.command {
        println!("verdin {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let project = Project::load(&cli.config)?;
    init_logging(&project.config.log);

    match cli.command {
        Command::Version => unreachable!("handled above"),
        Command::Start { migrate } => start(project, migrate).await,
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

async fn start(project: Project, migrate: bool) -> Result<()> {
    let schema = project.schema()?;
    let desired = verdin_migrate::derive_model(&schema);
    let db = project.database().await?;

    match verdin_migrate::status(&db, &desired, &Renames::default()).await? {
        Status::UpToDate => {}
        Status::Pending(_) if migrate => {
            let report =
                verdin_migrate::apply(&db, &desired, &Renames::default(), ApplyOptions::default())
                    .await?;
            tracing::info!(steps = report.applied_steps, "applied migrations");
        }
        Status::Pending(plan) => bail!(
            "the database is {} step{} behind the schema; run `verdin migrate plan` to review \
             and `verdin migrate apply`, or start with --migrate to apply safe steps",
            plan.steps.len(),
            plural(plan.steps.len())
        ),
        Status::Interrupted { .. } => {
            bail!(
                "a migration was interrupted; run `verdin migrate plan` and `verdin migrate apply`"
            )
        }
    }

    let api = &project.config.api;
    if !api.prefix.starts_with('/') || api.prefix.len() < 2 || api.prefix.ends_with('/') {
        bail!("[api].prefix must look like `/api` (got `{}`)", api.prefix);
    }
    if api.default_page_size == 0 || api.default_page_size > api.max_page_size {
        bail!("[api].default_page_size must be between 1 and max_page_size");
    }
    if api.open_access {
        tracing::warn!("[api].open_access is on: anyone can read and write all content");
    }
    let content_api = verdin_api::router(
        db.clone(),
        verdin_content::Registry::new(schema),
        verdin_api::ApiConfig {
            limits: verdin_query::Limits {
                default_page_size: api.default_page_size,
                max_page_size: api.max_page_size,
                ..Default::default()
            },
            output: verdin_content::OutputOptions { decimal_as_string: api.decimal_as_string },
            open_access: api.open_access,
        },
        &api.prefix,
    );
    let app = server::router(
        AppState { db: db.clone() },
        &project.config.server,
        &api.prefix,
        content_api,
    );
    let address = format!("{}:{}", project.config.server.host, project.config.server.port);
    let listener =
        TcpListener::bind(&address).await.with_context(|| format!("binding {address}"))?;
    tracing::info!(%address, version = env!("CARGO_PKG_VERSION"), "verdin listening");

    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;
    db.close().await;
    tracing::info!("verdin stopped");
    Ok(())
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
