use clap::Parser;
use verdin::cli::{self, Cli};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    cli::run(Cli::parse()).await
}
