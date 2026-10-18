use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "wedsync-server",
    version,
    about = "CameraSync server — wedding photo drive: live sync from the photographer, QR guest gallery, selfie face search"
)]
struct Cli {
    /// Data directory (database, originals, thumbnails, models)
    #[arg(long, env = "WEDSYNC_DATA", default_value = "./data")]
    data_dir: PathBuf,

    #[command(subcommand)]
    cmd: Option<Cmd>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Run the photo-drive server on this machine (default)
    Serve {
        #[arg(long, env = "PORT", default_value_t = 8080)]
        port: u16,
        /// Watch a local folder and ingest its photos straight into an event
        /// (the server reads the photographer's own disk — no upload step)
        #[arg(long, env = "WEDSYNC_IMPORT_DIR")]
        import_dir: Option<PathBuf>,
        /// Event id/slug for --import-dir (omit to create a new event named after the folder)
        #[arg(long, env = "WEDSYNC_EVENT")]
        event: Option<String>,
    },
    /// Run the public hub/relay: accounts + tunnels + guest URLs (/e/{slug}).
    /// Shuttles HTTP to connected photographer machines — stores ZERO photos.
    Hub {
        #[arg(long, env = "PORT", default_value_t = 9000)]
        port: u16,
        /// Hub data directory (accounts only — no media directories are created)
        #[arg(long, env = "WEDSYNC_HUB_DATA", default_value = "./hub-data")]
        data_dir: PathBuf,
    },
    /// Download the face recognition models (InsightFace buffalo_l, ~280 MB, one time)
    FetchModels,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn,tower_http=warn".into()),
        )
        .init();

    let cli = Cli::parse();
    match cli.cmd.unwrap_or(Cmd::Serve {
        port: 8080,
        import_dir: None,
        event: None,
    }) {
        Cmd::FetchModels => {
            let cfg = wedsync_server::config::Config::load(cli.data_dir, true)?;
            wedsync_server::models_fetch::fetch_models(&cfg.models_dir())?;
        }
        Cmd::Hub { port, data_dir } => wedsync_server::relay::run_hub(port, data_dir).await?,
        Cmd::Serve {
            port,
            import_dir,
            event,
        } => {
            wedsync_server::run_server(cli.data_dir, port, import_dir, event).await?;
        }
    }
    Ok(())
}
