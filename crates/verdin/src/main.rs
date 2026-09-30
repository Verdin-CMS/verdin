use clap::Parser;
use verdin::cli::{self, Cli};

fn main() -> anyhow::Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
    let result = runtime.block_on(cli::run(Cli::parse()));
    // A blocking task that is still running (a stuck plugin host call, say) must not keep
    // the process alive after the server stopped: dropping the runtime would wait for it.
    runtime.shutdown_timeout(std::time::Duration::from_secs(5));
    result
}
