use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use axum::extract::{DefaultBodyLimit, State};
use axum::routing::{delete, get, post};
use axum::Router;
use clap::{Parser, Subcommand};

mod auth;
mod config;
mod db;
mod error;
mod events;
mod faces;
mod guest;
mod importer;
mod models_fetch;
mod photos;
mod pipeline;
mod relay;
mod util;

pub struct AppState {
    pub pool: sqlx::SqlitePool,
    pub cfg: config::Config,
    pub face_engine: OnceLock<faces::EngineState>,
    pub queue: pipeline::Queue,
}

pub type SharedState = Arc<AppState>;

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
    /// Run the HTTP server (default when no subcommand is given)
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
    /// Run the public tunnel relay: lets a photographer's box (behind NAT)
    /// serve guests through /t/{id}/ without renting any cloud disk
    Relay {
        #[arg(long, env = "PORT", default_value_t = 9000)]
        port: u16,
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
    let cfg = config::Config::load(cli.data_dir)?;
    match cli.cmd.unwrap_or(Cmd::Serve {
        port: 8080,
        import_dir: None,
        event: None,
    }) {
        Cmd::FetchModels => {
            models_fetch::fetch_models(&cfg.models_dir())?;
        }
        Cmd::Relay { port } => relay::run_relay(port).await?,
        Cmd::Serve {
            port,
            import_dir,
            event,
        } => serve(cfg, port, import_dir, event).await?,
    }
    Ok(())
}

async fn serve(
    cfg: config::Config,
    port: u16,
    import_dir: Option<PathBuf>,
    import_event: Option<String>,
) -> anyhow::Result<()> {
    let pool = db::init_pool(&cfg).await?;
    let state: SharedState = Arc::new(AppState {
        pool,
        cfg,
        face_engine: OnceLock::new(),
        queue: pipeline::Queue::new(),
    });

    // Face models are heavy (~200 MB) — load in the background so the API starts instantly.
    {
        let st = state.clone();
        tokio::spawn(async move {
            let dir = st.cfg.models_dir();
            let dir_display = dir.display().to_string();
            let res = tokio::task::spawn_blocking(move || faces::FaceEngine::load(&dir))
                .await
                .unwrap_or_else(|e| Err(anyhow::anyhow!("join error: {e}")));
            match res {
                Ok(Some(engine)) => {
                    tracing::info!("face engine ready — selfie search enabled");
                    let _ = st.face_engine.set(faces::EngineState::Ready(Arc::new(engine)));
                    // Re-queue photos that were waiting for the engine.
                    if let Ok(r) = sqlx::query(
                        "UPDATE photos SET face_status='queued' WHERE face_status='unavailable'",
                    )
                    .execute(&st.pool)
                    .await
                    {
                        if r.rows_affected() > 0 {
                            tracing::info!("re-queued {} photos for face indexing", r.rows_affected());
                        }
                    }
                }
                Ok(None) => {
                    tracing::warn!(
                        "face models not found at {dir_display} — face search disabled \
                         (run `wedsync-server fetch-models` to enable, then restart)"
                    );
                    let _ = st.face_engine.set(faces::EngineState::Unavailable);
                    let _ = sqlx::query(
                        "UPDATE photos SET face_status='unavailable' WHERE face_status='queued' \
                         AND event_id IN (SELECT id FROM events WHERE face_enabled=1)",
                    )
                    .execute(&st.pool)
                    .await;
                }
                Err(e) => {
                    tracing::error!("failed to load face models: {e:#}");
                    let _ = st.face_engine.set(faces::EngineState::Unavailable);
                }
            }
            st.queue.notify();
        });
    }

    pipeline::start(state.clone());

    // Local disk mode: the server itself reads a folder on the photographer's machine.
    if let Some(dir) = import_dir {
        let dir = dir.canonicalize().unwrap_or(dir);
        anyhow::ensure!(dir.is_dir(), "--import-dir {} ไม่ใช่โฟลเดอร์", dir.display());
        let event_id = importer::resolve_or_create_event(&state, &import_event, &dir).await?;
        importer::start(state.clone(), dir.clone(), event_id);
    }

    let routes = Router::new()
        .route("/api/health", get(|| async { axum::Json(serde_json::json!({"ok": true})) }))
        .route("/api/meta", get(get_meta))
        .route("/api/auth/status", get(auth::status))
        .route("/api/auth/setup", post(auth::setup))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .route("/api/agent/login", post(auth::agent_login))
        .route("/api/events", get(events::list).post(events::create))
        .route(
            "/api/events/{id}",
            get(events::get_one).patch(events::update).delete(events::delete),
        )
        .route("/api/events/{id}/token", post(events::regen_token))
        .route("/api/events/{id}/qr.png", get(events::qr_png))
        .route("/api/events/{id}/photos", get(photos::list_admin).post(photos::upload))
        .route("/api/events/{id}/download.zip", get(photos::download_zip))
        .route("/api/photos/{id}", delete(photos::delete_one))
        .route("/api/photos/{id}/file", get(photos::serve_file))
        .route("/api/g/{slug}/info", get(guest::info))
        .route("/api/g/{slug}/unlock", post(guest::unlock))
        .route("/api/g/{slug}/summary", get(guest::summary))
        .route("/api/g/{slug}/photos", get(guest::photos))
        .route("/api/g/{slug}/faces/search", post(guest::face_search))
        .route("/api/g/{slug}/faces/download", post(guest::face_download_zip));

    let spa = tower_http::services::ServeDir::new(&state.cfg.web_dist)
        .not_found_service(tower_http::services::ServeFile::new(
            state.cfg.web_dist.join("index.html"),
        ));

    let app = routes
        .fallback_service(spa)
        .layer(DefaultBodyLimit::max(400 * 1024 * 1024))
        .with_state(state.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!();
    println!("  ◉ CameraSync server v{}", env!("CARGO_PKG_VERSION"));
    println!("  ────────────────────────────────────────────");
    println!("  API      http://localhost:{port}/api/health");
    println!("  Admin UI http://localhost:{port}/admin  (dev: http://localhost:5173/admin)");
    println!("  Data     {}", state.cfg.data_dir.display());
    if !state.cfg.web_dist.exists() {
        println!("  ⚠ frontend build not found at {} — run `npm run build` in web/ (dev mode: `npm run dev`)", state.cfg.web_dist.display());
    }
    println!();
    tracing::info!("listening on {addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
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
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

async fn get_meta(State(st): State<SharedState>) -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "face_ready": matches!(st.face_engine.get(), Some(faces::EngineState::Ready(_))),
    }))
}
