//! CameraSync server library — used by the `wedsync-server` binary and the
//! Tauri desktop app (which embeds the whole server on the photographer's
//! own machine).

pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod events;
pub mod faces;
pub mod guest;
pub mod importer;
pub mod models_fetch;
pub mod photos;
pub mod pipeline;
pub mod relay;
pub mod util;

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use axum::extract::State;

/// Run the full photo-drive server (API + pipeline + SPA) on the
/// photographer's machine. Own disk, always on.
pub async fn run_server(
    data_dir: PathBuf,
    port: u16,
    import_dir: Option<PathBuf>,
    import_event: Option<String>,
) -> anyhow::Result<()> {
    let cfg = config::Config::load(data_dir, true)?;
    let pool = db::init_pool(&cfg).await?;
    let state: Arc<AppState> = Arc::new(AppState {
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

    if let Some(dir) = import_dir {
        let dir = dir.canonicalize().unwrap_or(dir);
        anyhow::ensure!(dir.is_dir(), "--import-dir {} ไม่ใช่โฟลเดอร์", dir.display());
        let event_id = importer::resolve_or_create_event(&state, &import_event, &dir).await?;
        importer::start(state.clone(), dir.clone(), event_id);
    }

    serve_http(state.clone(), port).await
}

pub struct AppState {
    pub pool: sqlx::SqlitePool,
    pub cfg: config::Config,
    pub face_engine: OnceLock<faces::EngineState>,
    pub queue: pipeline::Queue,
}

pub type SharedState = Arc<AppState>;

async fn serve_http(state: SharedState, port: u16) -> anyhow::Result<()> {
    use axum::extract::DefaultBodyLimit;
    use axum::routing::{delete, get, post};

    let routes = axum::Router::new()
        .route("/api/health", get(|| async { axum::Json(serde_json::json!({"ok": true})) }))
        .route("/api/meta", get(get_meta))
        .route("/api/manifest", get(events::manifest))
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

    let routes = routes
        .nest_service("/assets", tower_http::services::ServeDir::new(state.cfg.web_dist.join("assets")))
        .route("/favicon.svg", get(serve_favicon))
        .fallback(get(spa_index));

    let app = routes
        .layer(DefaultBodyLimit::max(400 * 1024 * 1024))
        .with_state(state.clone());

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!();
    println!("  ◉ CameraSync server v{}", env!("CARGO_PKG_VERSION"));
    println!("  ────────────────────────────────────────────");
    println!("  API      http://localhost:{port}/api/health");
    println!("  Admin UI http://localhost:{port}/admin");
    println!("  Data     {}", state.cfg.data_dir.display());
    if !state.cfg.web_dist.exists() {
        println!(
            "  ⚠ frontend build not found at {} — run `npm run build` in web/ (dev mode: `npm run dev`)",
            state.cfg.web_dist.display()
        );
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

/// SPA fallback — always 200 + index.html so client routes work anywhere
/// (including through the hub tunnel).
async fn spa_index(State(st): State<SharedState>) -> axum::response::Response {
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    match tokio::fs::read(st.cfg.web_dist.join("index.html")).await {
        Ok(bytes) => axum::response::Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "text/html; charset=utf-8")
            .body(axum::body::Body::from(bytes))
            .expect("static response"),
        Err(_) => (
            StatusCode::NOT_FOUND,
            "frontend build not found — run `npm run build` in web/",
        )
            .into_response(),
    }
}

async fn serve_favicon(State(st): State<SharedState>) -> axum::response::Response {
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    match tokio::fs::read(st.cfg.web_dist.join("favicon.svg")).await {
        Ok(bytes) => axum::response::Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "image/svg+xml")
            .body(axum::body::Body::from(bytes))
            .expect("static response"),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
