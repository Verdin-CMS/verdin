use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;
use verdin_db::{ConnectOptions, Database};

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
    Start,
    /// Print version information.
    Version,
}

pub async fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Command::Version => {
            println!("verdin {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Command::Start => {
            let config = Config::load(&cli.config)
                .with_context(|| format!("loading {}", cli.config.display()))?;
            init_logging(&config.log);
            start(config).await
        }
    }
}

async fn start(config: Config) -> Result<()> {
    let url = config
        .database
        .url
        .as_deref()
        .context("no database configured: set VERDIN_DATABASE_URL or [database].url")?;
    let options =
        ConnectOptions { max_connections: config.database.pool_max, ..Default::default() };
    let db = Database::connect(url, &options).await.context("connecting to database")?;

    let app = server::router(AppState { db: db.clone() }, &config.server);
    let address = format!("{}:{}", config.server.host, config.server.port);
    let listener =
        TcpListener::bind(&address).await.with_context(|| format!("binding {address}"))?;
    tracing::info!(%address, version = env!("CARGO_PKG_VERSION"), "verdin listening");

    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;
    db.close().await;
    tracing::info!("verdin stopped");
    Ok(())
}

fn init_logging(config: &LogConfig) {
    let default_level = config.level.as_deref().unwrap_or("info");
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_level));
    let builder = tracing_subscriber::fmt().with_env_filter(filter);
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
