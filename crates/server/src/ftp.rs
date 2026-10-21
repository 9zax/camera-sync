//! Embedded FTP server — cameras that speak FTP (Canon/Nikon/Sony/Fujifilm
//! pro bodies have it built in) push photos straight into the photographer's
//! inbox folder; the existing import watcher picks them up like any other
//! file, so nothing downstream changes.
//!
//! Plain FTP on the LAN (no TLS in v1 — cameras sit on the wedding WiFi
//! anyway). Credentials are generated once and shown in the desktop app so
//! the photographer can type them into the camera's FTP settings.

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use libunftp::ServerBuilder;
use unftp_core::auth::{AuthenticationError, Authenticator, Credentials, Principal};
use unftp_sbe_fs::Filesystem;

use crate::util;

#[derive(Clone, serde::Serialize)]
pub struct FtpInfo {
    pub port: u16,
    pub user: String,
    pub pass: String,
    pub dir: String,
    /// which event currently receives camera photos
    pub target_slug: String,
    pub target_title: String,
}

static FTP_INFO: OnceLock<std::sync::RwLock<FtpInfo>> = OnceLock::new();
static FTP_ROOT: OnceLock<std::sync::RwLock<PathBuf>> = OnceLock::new();
static FTP_TARGET: OnceLock<std::sync::RwLock<(String, String, String)>> = OnceLock::new(); // (event_id, slug, dir)

fn root_lock() -> &'static std::sync::RwLock<PathBuf> {
    FTP_ROOT.get_or_init(|| std::sync::RwLock::new(PathBuf::new()))
}
fn target_lock() -> &'static std::sync::RwLock<(String, String, String)> {
    FTP_TARGET.get_or_init(|| std::sync::RwLock::new((String::new(), String::new(), String::new())))
}

/// What the desktop app shows: host:port + credentials + current target.
pub fn info() -> Option<FtpInfo> {
    FTP_INFO.get().map(|l| l.read().unwrap().clone())
}

fn update_info(slug: &str, title: &str) {
    if let Some(l) = FTP_INFO.get() {
        let mut info = l.write().unwrap();
        info.target_slug = slug.to_string();
        info.target_title = title.to_string();
    }
}

/// Current (event_id, slug, dir) receiving camera photos.
pub fn target() -> (String, String, String) {
    target_lock().read().unwrap().clone()
}

/// Point the FTP receiver at another event's watched folder.
pub fn set_target(event_id: &str, slug: &str, dir: &Path) {
    {
        let mut t = target_lock().write().unwrap();
        *t = (event_id.to_string(), slug.to_string(), dir.display().to_string());
    }
    {
        let mut r = root_lock().write().unwrap();
        *r = dir.to_path_buf();
    }
}

fn target_file(data_dir: &Path) -> PathBuf {
    data_dir.join("ftp-target.json")
}

fn persist_target(data_dir: &Path, event_id: &str) {
    let _ = std::fs::write(
        target_file(data_dir),
        serde_json::json!({ "event_id": event_id }).to_string(),
    );
}

/// All events the camera can be aimed at: every watched folder.
pub async fn target_options(st: &crate::SharedState) -> Vec<(String, String, String, String)> {
    // (event_id, slug, title, dir)
    sqlx::query_as(
        "SELECT e.id, e.slug, e.title, d.path FROM import_dirs d \
         JOIN events e ON e.id = d.event_id ORDER BY e.created_at DESC",
    )
    .fetch_all(&st.pool)
    .await
    .unwrap_or_default()
}

/// Restore the last chosen target (validated against import_dirs) or keep
/// the default inbox. Called once at startup.
pub async fn restore_target(st: &crate::SharedState, data_dir: &Path, default_dir: &Path) {
    let mut chosen: Option<(String, String, String)> = None; // (event_id, slug, dir)
    if let Ok(text) = std::fs::read_to_string(target_file(data_dir)) {
        if let Some(eid) = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v["event_id"].as_str().map(|s| s.to_string()))
        {
            let row: Option<(String, String)> = sqlx::query_as(
                "SELECT e.slug, d.path FROM import_dirs d JOIN events e ON e.id = d.event_id \
                 WHERE d.event_id = ?1",
            )
            .bind(&eid)
            .fetch_optional(&st.pool)
            .await
            .ok()
            .flatten();
            if let Some((slug, path)) = row {
                let p = PathBuf::from(&path);
                if p.is_dir() {
                    chosen = Some((eid, slug, p.display().to_string()));
                }
            }
        }
    }
    let (eid, slug, dir) = chosen.unwrap_or_else(|| (String::new(), String::new(), default_dir.display().to_string()));
    set_target(&eid, &slug, Path::new(&dir));
    let title = if slug.is_empty() {
        String::new()
    } else {
        sqlx::query_scalar::<_, String>("SELECT title FROM events WHERE slug = ?1")
            .bind(&slug)
            .fetch_one(&st.pool)
            .await
            .unwrap_or_else(|_| slug.clone())
    };
    update_info(&slug, &title);
}

#[derive(serde::Serialize, serde::Deserialize)]
struct FtpCreds {
    user: String,
    pass: String,
}

fn load_or_create_creds(data_dir: &Path) -> anyhow::Result<FtpCreds> {
    let path = data_dir.join("ftp-creds.json");
    if let Ok(s) = std::fs::read_to_string(&path) {
        if let Ok(c) = serde_json::from_str::<FtpCreds>(&s) {
            if !c.user.is_empty() && !c.pass.is_empty() {
                return Ok(c);
            }
        }
    }
    let creds = FtpCreds {
        user: "camera".into(),
        pass: crate::util::random_suffix(10).to_uppercase(),
    };
    std::fs::create_dir_all(data_dir)?;
    std::fs::write(&path, serde_json::to_vec_pretty(&creds)?)?;
    Ok(creds)
}

#[derive(Debug)]
struct CameraAuth {
    user: String,
    pass: String,
}

#[async_trait::async_trait]
impl Authenticator for CameraAuth {
    async fn authenticate(&self, username: &str, creds: &Credentials) -> Result<Principal, AuthenticationError> {
        let ok = username.eq_ignore_ascii_case(&self.user)
            && creds
                .password
                .as_deref()
                .map_or(false, |p| p.eq_ignore_ascii_case(&self.pass));
        if ok {
            Ok(Principal { username: username.to_string() })
        } else {
            Err(AuthenticationError::BadPassword)
        }
    }

    async fn cert_auth_sufficient(&self, _username: &str) -> bool {
        false
    }
}

/// Run the FTP server forever. `root` is the watched import folder — files
/// land there and the importer does the rest. Set FTP_OFF=1 to disable.
pub async fn run(data_dir: PathBuf, root: PathBuf, port: u16) -> anyhow::Result<()> {
    if std::env::var("FTP_OFF").map_or(false, |v| v == "1" || v == "true") {
        tracing::info!("FTP receiver disabled (FTP_OFF)");
        return Ok(());
    }
    let creds = load_or_create_creds(&data_dir)?;
    std::fs::create_dir_all(&root)?;
    let root_for_info = root.display().to_string();
    *root_lock().write().unwrap() = root.clone();
    *target_lock().write().unwrap() = (String::new(), String::new(), root_for_info.clone());
    let auth = Arc::new(CameraAuth { user: creds.user.clone(), pass: creds.pass.clone() });
    let server = ServerBuilder::with_authenticator(
        Box::new(move || {
            let current = root_lock().read().unwrap().clone();
            Filesystem::new(&current).expect("ftp root exists")
        }),
        auth,
    )
    .passive_ports(50100..=50200)
    .build()?;
    let _ = FTP_INFO.set(std::sync::RwLock::new(FtpInfo {
        port,
        user: creds.user,
        pass: creds.pass,
        dir: root_for_info,
        target_slug: String::new(),
        target_title: String::new(),
    }));
    let lan = crate::util::lan_ip().unwrap_or_else(|| "0.0.0.0".into());
    println!("  ◉ กล้องส่งรูปเข้าได้ผ่าน FTP: {lan}:{port} (โฟลเดอร์รับ: {})", root.display());
    server.listen(format!("0.0.0.0:{port}")).await?;
    Ok(())
}

// ---- HTTP: choose which event receives camera photos ----

/// GET /api/ftp/target — current target + every event folder we can aim at.
pub async fn get_target_route(
    State(st): axum::extract::State<crate::SharedState>,
) -> axum::response::Response {
    let options = target_options(&st).await;
    let (event_id, slug, dir) = target();
    let info = info();
    axum::Json(serde_json::json!({
        "event_id": event_id,
        "slug": slug,
        "dir": dir,
        "target_title": info.as_ref().map(|i| i.target_title.clone()).unwrap_or_default(),
        "options": options
            .iter()
            .map(|(eid, s, t, d)| serde_json::json!({ "event_id": eid, "slug": s, "title": t, "dir": d }))
            .collect::<Vec<_>>(),
    }))
    .into_response()
}

#[derive(serde::Deserialize)]
pub struct SetTargetReq {
    pub event_id: String,
}

/// POST /api/ftp/target — aim the camera receiver at another event's folder.
/// Admin-session OR machine-token (the hub's /r/line action path).
pub async fn set_target_route(
    State(st): axum::extract::State<crate::SharedState>,
    headers: axum::http::HeaderMap,
    Json(req): axum::Json<SetTargetReq>,
) -> axum::response::Response {
    let admin_ok = crate::auth::is_admin_request(&st, &headers).await;
    let machine_ok = headers
        .get("x-machine-token")
        .and_then(|v| v.to_str().ok())
        .map_or(false, |g| {
            crate::util::token_matches(g, &crate::util::machine_token(&st.cfg.data_dir))
        });
    if !admin_ok && !machine_ok {
        return crate::error::AppError::Unauthorized("ต้องเข้าสู่ระบบแอดมิน หรือใช้ machine token".into())
            .into_response();
    }
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT e.slug, d.path FROM import_dirs d JOIN events e ON e.id = d.event_id WHERE d.event_id = ?1",
    )
    .bind(&req.event_id)
    .fetch_optional(&st.pool)
    .await
    .ok()
    .flatten();
    let Some((slug, path)) = row else {
        return crate::error::AppError::bad("ไม่พบโฟลเดอร์ของงานนี้").into_response();
    };
    let dir = std::path::PathBuf::from(&path);
    if !dir.is_dir() {
        return crate::error::AppError::bad("โฟลเดอร์งานนี้ถูกลบไปแล้ว").into_response();
    }
    let title: String = sqlx::query_scalar("SELECT title FROM events WHERE id = ?1")
        .bind(&req.event_id)
        .fetch_one(&st.pool)
        .await
        .unwrap_or_else(|_| slug.clone());
    set_target(&req.event_id, &slug, &dir);
    persist_target(&st.cfg.data_dir, &req.event_id);
    update_info(&slug, &title);
    println!("  ◉ ปลายทาง FTP ถูกเปลี่ยนเป็นงาน: {title} ({slug})");
    axum::Json(serde_json::json!({ "ok": true, "slug": slug, "title": title })).into_response()
}

use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;

/// Machine-token path (hub /r/line): aim by slug instead of event id.
pub async fn machine_set_target_by_slug(
    State(st): axum::extract::State<crate::SharedState>,
    axum::extract::Path(slug): axum::extract::Path<String>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    let given = headers
        .get("x-machine-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !crate::util::token_matches(given, &crate::util::machine_token(&st.cfg.data_dir)) {
        return crate::error::AppError::Unauthorized("machine token ไม่ถูกต้อง".into()).into_response();
    }
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT e.id, d.path FROM import_dirs d JOIN events e ON e.id = d.event_id WHERE e.slug = ?1",
    )
    .bind(&slug)
    .fetch_optional(&st.pool)
    .await
    .ok()
    .flatten();
    let Some((event_id, path)) = row else {
        return crate::error::AppError::bad("งานนี้ยังไม่มีโฟลเดอร์รับรูป").into_response();
    };
    let dir = std::path::PathBuf::from(&path);
    if !dir.is_dir() {
        return crate::error::AppError::bad("โฟลเดอร์งานนี้ถูกลบไปแล้ว").into_response();
    }
    let title: String = sqlx::query_scalar("SELECT title FROM events WHERE id = ?1")
        .bind(&event_id)
        .fetch_one(&st.pool)
        .await
        .unwrap_or_else(|_| slug.clone());
    set_target(&event_id, &slug, &dir);
    persist_target(&st.cfg.data_dir, &event_id);
    update_info(&slug, &title);
    println!("  ◉ ปลายทาง FTP ถูกเปลี่ยนเป็นงาน: {title} ({slug}) [จากมือถือ]");
    axum::Json(serde_json::json!({ "ok": true, "slug": slug, "title": title })).into_response()
}

/// Machine-token read of the current target (lets /r/line/me badge it).
pub async fn machine_get_target(
    State(_st): axum::extract::State<crate::SharedState>,
) -> axum::response::Response {
    let (event_id, slug, dir) = target();
    let title = info().map(|i| i.target_title).unwrap_or_default();
    axum::Json(serde_json::json!({ "event_id": event_id, "slug": slug, "title": title, "dir": dir }))
        .into_response()
}

/// Validate + aim the receiver at an event's folder (shared by the HTTP
/// route, the machine-token route and the desktop app).
pub async fn apply_target(st: &crate::SharedState, event_id: &str) -> Result<(String, String), crate::error::AppError> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT e.slug, d.path FROM import_dirs d JOIN events e ON e.id = d.event_id WHERE d.event_id = ?1",
    )
    .bind(event_id)
    .fetch_optional(&st.pool)
    .await
    .map_err(crate::error::AppError::from)?;
    let Some((slug, path)) = row else {
        return Err(crate::error::AppError::bad("ไม่พบโฟลเดอร์ของงานนี้"));
    };
    let dir = std::path::PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(crate::error::AppError::bad("โฟลเดอร์งานนี้ถูกลบไปแล้ว"));
    }
    let title: String = sqlx::query_scalar("SELECT title FROM events WHERE id = ?1")
        .bind(event_id)
        .fetch_one(&st.pool)
        .await
        .unwrap_or_else(|_| slug.clone());
    set_target(event_id, &slug, &dir);
    persist_target(&st.cfg.data_dir, event_id);
    update_info(&slug, &title);
    println!("  ◉ ปลายทาง FTP → {title} ({slug})");
    Ok((slug, title))
}
