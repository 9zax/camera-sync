//! CameraSync Hub ("ระบบเรา" ที่ deploy บน server จริง)
//!
//! Hub-and-spoke model:
//! - ช่างภาพรัน desktop app (server + disk อยู่เครื่องเขา) แล้ว auth เข้า hub
//! - Hub เก็บแค่บัญชี + ตาราง slug→tunnel — **ไม่มีการเก็บไฟล์ภาพบน hub เด็ดขาด**
//!   (ไม่มีโค้ดสายใดเขียน bytes ลงดิสก์ มีแค่ HTTP ผ่านหน่วยความจำชั่วคราว)
//! - ลูกค้าเปิด https://hub/e/{slug}/ → hub หา tunnel ของเครื่องช่างภาพที่มีงานนั้น
//!   แล้ว proxy ทุกอย่าง (รวม face search) ไปยังเครื่องนั้นแบบ realtime
//! - รองรับ legacy: /t/{id}/… (ไม่ต้องมีบัญชี) และ LAN ตรง (ไม่ผ่าน hub เลย)

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use futures_util::SinkExt;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot, Mutex};

pub const TUNNEL_COOKIE: &str = "cs_tunnel";

#[derive(Serialize, Deserialize, Clone)]
pub struct ReqMsg {
    pub id: String,
    pub method: String,
    /// path + query, always starting with "/"
    pub path: String,
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>, // base64
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RespMsg {
    pub id: String,
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String, // base64
    #[serde(default)]
    pub error: Option<String>,
}

type Job = (ReqMsg, oneshot::Sender<Result<RespMsg, String>>);

pub struct HubState {
    db: sqlx::SqlitePool,
    /// installer files served from /download/{file} (app installers, never photos)
    downloads_dir: std::path::PathBuf,
    /// tunnel_id → (connection key, outbound job channel). A new connection
    /// for the same id replaces the old one; the old task's cleanup checks
    /// the key and leaves the fresh registration alone.
    tunnels: Mutex<HashMap<String, (u64, mpsc::Sender<Job>)>>,
    /// event slug → tunnel_id (announced by each machine on connect)
    slug_map: Mutex<HashMap<String, String>>,
    /// LINE Login pending handshakes: state → result
    line_pending: Mutex<HashMap<String, LinePending>>,
    counter: AtomicU64,
}

#[derive(Clone)]
struct LinePending {
    created: i64,
    done: Option<(String, String)>, // (machine token, tunnel_id)
}

pub type SharedHub = Arc<HubState>;

const HOP_HEADERS: &[&str] = &[
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "upgrade",
    "keep-alive",
    "proxy-authorization",
    "te",
];

/// Run the hub. `data_dir` holds only accounts/registry — media directories
/// are deliberately NOT created and no image bytes are ever written.
/// Upsert the system admin from HUB_ADMIN_USER / HUB_ADMIN_PASS so the
/// operator can watch every photographer's account from /r/admin.
async fn ensure_system_admin(db: &sqlx::SqlitePool) {
    let (Some(user), Some(pass)) = (
        std::env::var("HUB_ADMIN_USER").ok().filter(|v| !v.trim().is_empty()),
        std::env::var("HUB_ADMIN_PASS").ok().filter(|v| !v.trim().is_empty()),
    ) else {
        return;
    };
    let hash = match crate::auth::hash_password(pass.trim()) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("admin bootstrap: hash failed: {e}");
            return;
        }
    };
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT id FROM users WHERE username=?1")
            .bind(&user)
            .fetch_optional(db)
            .await
            .ok()
            .flatten();
    match existing {
        Some((id,)) => {
            let _ = sqlx::query("UPDATE users SET password_hash=?1, is_admin=1 WHERE id=?2")
                .bind(&hash)
                .bind(&id)
                .execute(db)
                .await;
        }
        None => {
            let _ = sqlx::query(
                "INSERT INTO users(id, username, password_hash, is_admin, created_at) VALUES (?1,?2,?3,1,?4)",
            )
            .bind(crate::util::new_id())
            .bind(user.trim())
            .bind(&hash)
            .bind(crate::util::now_ms())
            .execute(db)
            .await;
        }
    }
    println!("◉ system admin ready (HUB_ADMIN_USER)");
}

pub async fn run_hub(port: u16, data_dir: PathBuf) -> anyhow::Result<()> {
    let cfg = crate::config::Config::load(data_dir.clone(), false)?;
    let db = crate::db::init_pool(&cfg).await?;
    ensure_system_admin(&db).await;
    let downloads_dir = data_dir.join("downloads");
    tokio::fs::create_dir_all(&downloads_dir).await.ok();
    let state: SharedHub = Arc::new(HubState {
        db,
        downloads_dir,
        tunnels: Mutex::new(HashMap::new()),
        slug_map: Mutex::new(HashMap::new()),
        line_pending: Mutex::new(HashMap::new()),
        counter: AtomicU64::new(1),
    });

    let app = Router::new()
        .route("/", get(landing))
        .route("/index.html", get(landing))
        .route("/download/{file}", get(download_file))
        .route("/r/register", post(register))
        .route("/r/login", post(login))
        .route("/r/line/begin", get(line_begin))
        .route("/r/line/login", get(line_login_redirect))
        .route("/r/line/callback", get(line_callback))
        .route("/r/line/poll", get(line_poll))
        .route("/r/line/start", get(line_web_start))
        .route("/r/line/me", get(line_me_page))
        .route("/r/admin", get(admin_page))
        .route("/r/admin/login", post(admin_login))
        .route("/r/admin/logout", post(admin_logout))
        .route("/r/line/slugs", get(line_my_slugs))
        .route("/r/qr/{slug}", get(line_qr_png))
        .route("/r/connect/{id}", get(ws_connect))
        .route("/t/{id}/{*rest}", any(tunnel_entry))
        .route("/e/{slug}", any(guest_entry))
        .route("/e/{slug}/", any(guest_entry))
        .route("/e/{slug}/{*rest}", any(guest_entry))
        .fallback(hub_fallback)
        .layer(axum::extract::DefaultBodyLimit::max(400 * 1024 * 1024))
        .with_state(state.clone());

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!();
    println!("  ◉ CameraSync hub — accounts + tunnels, ZERO photo storage");
    println!("  ────────────────────────────────────────────");
    println!("  listening  http://0.0.0.0:{port}");
    println!("  guests     http://<host>:{port}/e/{{event-slug}}/");
    println!("  machines   wedsync tunnel --relay ws://<host>:{port} --user/--pass");
    println!("  data dir   {} (accounts only — no media dirs)", cfg.data_dir.display());
    println!();
    tracing::info!("hub listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

// ---------- public landing + app download ----------

async fn landing() -> Response {
    axum::response::Html(include_str!("../landing.html")).into_response()
}

#[derive(Deserialize)]
struct DownloadPath {
    file: String,
}

/// Serve installer files from `<data_dir>/downloads/` (app installers only —
/// never photos; the hub has no media storage by design).
async fn download_file(
    State(st): State<SharedHub>,
    Path(p): Path<DownloadPath>,
) -> Response {
    let safe: String = p
        .file
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect();
    if safe.is_empty() || safe.starts_with('.') || safe.contains("..") {
        return crate::error::AppError::bad("ชื่อไฟล์ไม่ถูกต้อง").into_response();
    }
    // official releases live on GitHub — redirect when configured, so the
    // hub never carries installer bandwidth itself
    if safe.eq_ignore_ascii_case("CameraSync.dmg") {
        if let Ok(url) = std::env::var("CAMERASYNC_DMG_URL") {
            if url.starts_with("https://") {
                return axum::response::Redirect::temporary(&url).into_response();
            }
        }
    }
    let path = st
        .downloads_dir
        .join(&safe);
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let mut resp = Response::builder()
                .status(StatusCode::OK)
                .header(axum::http::header::CONTENT_TYPE, "application/octet-stream")
                .body(axum::body::Body::from(bytes))
                .expect("static response");
            if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"{safe}\"")) {
                resp.headers_mut()
                    .insert(axum::http::header::CONTENT_DISPOSITION, v);
            }
            resp
        }
        Err(_) => crate::error::AppError::not_found(
            "ยังไม่มีไฟล์ติดตั้งสำหรับดาวน์โหลด — ติดต่อแอดมิน หรือใช้บัญชี username/password จากแอดมินก่อน",
        )
        .into_response(),
    }
}

/// Web-based LINE login start (landing page button): create a pending state
/// and redirect straight to LINE. The desktop app uses /r/line/begin instead.
async fn line_web_start(
    State(st): State<SharedHub>,
    headers: HeaderMap,
) -> Response {
    let Some((id, _secret)) = line_config() else {
        return crate::error::AppError::ServiceUnavailable(
            "ระบบล็อกอินด้วย LINE ยังไม่เปิดใช้งาน — ใช้บัญชี username/password ที่ได้จากแอดมินได้เลย".into(),
        )
        .into_response();
    };
    let state_key = crate::util::random_token()[..24].to_string();
    st.line_pending.lock().await.insert(
        state_key.clone(),
        LinePending {
            created: crate::util::now_ms(),
            done: None,
        },
    );
    let redirect_uri = format!("{}/r/line/callback", hub_base_url(&headers));
    let authorize = format!(
        "https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id={id}&redirect_uri={}&state={state_key}&scope=profile%20openid",
        pct_encode(&redirect_uri)
    );
    (StatusCode::FOUND, [("Location", authorize)]).into_response()
}

// ---------- accounts ----------

#[derive(Deserialize)]
struct Credentials {
    username: String,
    password: String,
}

fn tunnel_id_for(username: &str) -> String {
    format!("u-{}", crate::util::slugify(username))
}

async fn register(
    State(st): State<SharedHub>,
    Json(req): Json<Credentials>,
) -> Response {
    match register_inner(st, req).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => e.into_response(),
    }
}

async fn register_inner(
    st: SharedHub,
    req: Credentials,
) -> Result<serde_json::Value, crate::error::AppError> {
    if req.username.trim().len() < 3 {
        return Err(crate::error::AppError::bad("username ต้องยาวอย่างน้อย 3 ตัวอักษร"));
    }
    if req.password.len() < 6 {
        return Err(crate::error::AppError::bad("password ต้องยาวอย่างน้อย 6 ตัวอักษร"));
    }
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM users WHERE username=?1")
        .bind(req.username.trim())
        .fetch_optional(&st.db)
        .await
        .map_err(crate::error::AppError::from)?;
    if exists.is_some() {
        return Err(crate::error::AppError::Conflict("username นี้ถูกใช้แล้ว".into()));
    }
    let hash = crate::auth::hash_password(&req.password).map_err(crate::error::AppError::from)?;
    sqlx::query("INSERT INTO users(id, username, password_hash, created_at) VALUES (?1,?2,?3,?4)")
        .bind(crate::util::new_id())
        .bind(req.username.trim())
        .bind(&hash)
        .bind(crate::util::now_ms())
        .execute(&st.db)
        .await
        .map_err(crate::error::AppError::from)?;
    Ok(serde_json::json!({
        "ok": true,
        "tunnel_id": tunnel_id_for(&req.username),
        "message": "ลงทะเบียนสำเร็จ — ใช้ username/password นี้ล็อกอินจาก desktop app",
    }))
}

async fn login(State(st): State<SharedHub>, Json(req): Json<Credentials>) -> Response {
    match login_inner(st, req).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => e.into_response(),
    }
}

async fn login_inner(
    st: SharedHub,
    req: Credentials,
) -> Result<serde_json::Value, crate::error::AppError> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE username=?1")
            .bind(req.username.trim())
            .fetch_optional(&st.db)
            .await
            .map_err(crate::error::AppError::from)?;
    let Some((user_id, hash)) = row else {
        return Err(crate::error::AppError::Unauthorized("invalid username or password".into()));
    };
    if !crate::auth::verify_password(&hash, &req.password) {
        return Err(crate::error::AppError::Unauthorized("invalid username or password".into()));
    }
    let token = crate::util::random_token();
    let ttl = 90 * 24 * 3600 * 1000i64;
    sqlx::query("INSERT INTO sessions(token, user_id, kind, expires_at) VALUES (?1,?2,'machine',?3)")
        .bind(&token)
        .bind(&user_id)
        .bind(crate::util::now_ms() + ttl)
        .execute(&st.db)
        .await
        .map_err(crate::error::AppError::from)?;
    Ok(serde_json::json!({
        "token": token,
        "tunnel_id": tunnel_id_for(&req.username),
        "expires_in_ms": ttl,
    }))
}

async fn session_user(st: &SharedHub, token: &str) -> Option<String> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT u.username FROM sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.token=?1 AND s.expires_at > ?2 AND s.kind='machine'",
    )
    .bind(token)
    .bind(crate::util::now_ms())
    .fetch_optional(&st.db)
    .await
    .ok()
    .flatten();
    row.map(|(u,)| u)
}

/// Browser session (cookie `cs_hub`, kind='web') issued by LINE login.
async fn web_session_user(st: &SharedHub, headers: &HeaderMap) -> Option<String> {
    let token = crate::util::parse_cookies(headers).get("cs_hub")?.to_string();
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT u.username FROM sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.token=?1 AND s.expires_at > ?2 AND s.kind='web'",
    )
    .bind(&token)
    .bind(crate::util::now_ms())
    .fetch_optional(&st.db)
    .await
    .ok()
    .flatten();
    row.map(|(u,)| u)
}

/// Slugs announced by this account's machine(s), newest tunnel first.
async fn my_slugs(st: &SharedHub, username: &str) -> Vec<String> {
    let mine = tunnel_id_for(username);
    let map = st.slug_map.lock().await;
    let mut slugs: Vec<String> = map
        .iter()
        .filter(|(_, t)| *t == &mine)
        .map(|(s, _)| s.clone())
        .collect();
    slugs.sort();
    slugs
}

#[derive(Deserialize)]
struct SlugPath {
    slug: String,
}

/// QR PNG of the public guest link — no auth (the slug is the guest secret).

// ---------- system admin: watch every photographer ----------

async fn is_admin_session(st: &SharedHub, headers: &HeaderMap) -> Option<String> {
    let username = web_session_user(st, headers).await?;
    let admin: Option<(i64,)> = sqlx::query_as(
        "SELECT is_admin FROM users WHERE username=?1",
    )
    .bind(&username)
    .fetch_optional(&st.db)
    .await
    .ok()
    .flatten();
    admin.filter(|(a,)| *a == 1).map(|_| username)
}

#[derive(Deserialize)]
struct AdminLoginReq {
    username: String,
    password: String,
}

async fn admin_login(State(st): State<SharedHub>, Json(req): Json<AdminLoginReq>) -> Response {
    let row: Option<(String, String, i64)> = sqlx::query_as(
        "SELECT id, password_hash, is_admin FROM users WHERE username=?1",
    )
    .bind(req.username.trim())
    .fetch_optional(&st.db)
    .await
    .ok()
    .flatten();
    let Some((user_id, hash, is_admin)) = row else {
        return crate::error::AppError::Unauthorized("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง".into()).into_response();
    };
    if is_admin != 1 || !crate::auth::verify_password(&hash, &req.password) {
        return crate::error::AppError::Unauthorized("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง".into()).into_response();
    }
    let token = crate::util::random_token();
    let _ = sqlx::query("INSERT INTO sessions(token, user_id, kind, expires_at) VALUES (?1,?2,'web',?3)")
        .bind(&token)
        .bind(&user_id)
        .bind(crate::util::now_ms() + 12 * 3600 * 1000)
        .execute(&st.db)
        .await;
    let mut res = axum::response::Redirect::to("/r/admin").into_response();
    if let Ok(v) = axum::http::HeaderValue::from_str(&format!(
        "cs_hub={token}; Path=/; SameSite=Lax; Max-Age={}",
        12 * 3600
    )) {
        res.headers_mut().append(axum::http::header::SET_COOKIE, v);
    }
    res
}

async fn admin_logout() -> Response {
    let mut res = axum::response::Redirect::to("/r/admin").into_response();
    if let Ok(v) = axum::http::HeaderValue::from_str("cs_hub=; Path=/; SameSite=Lax; Max-Age=0") {
        res.headers_mut().append(axum::http::header::SET_COOKIE, v);
    }
    res
}

fn admin_shell(body: &str, refresh: bool) -> String {
    format!(
        r##"<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>แอดมินระบบ — CameraSync</title>
<link href="https://fonts.googleapis.com/css2?family=Anuphan:wght@300;400;500;600&family=Kanit:wght@200;300;400;500&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:Anuphan,"Noto Sans Thai",system-ui,sans-serif;background:oklch(7% .006 95);color:oklch(88% 0 0);line-height:1.7}}
.wrap{{max-width:1000px;margin:0 auto;padding:0 20px}}
header{{display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid oklch(78% 0 0/.16)}}
.brand h1{{font-family:Kanit,sans-serif;font-size:17px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:oklch(91% 0 0)}}
.kicker{{display:inline-flex;align-items:center;gap:10px;font-family:"Roboto Mono",monospace;font-size:.68rem;font-weight:500;letter-spacing:.24em;text-transform:uppercase;color:oklch(84% .19 80.46)}}
.kicker::before,.kicker::after{{content:"";width:30px;height:1px;background:oklch(74% .09 82/.6)}}
h2.title{{font-family:Kanit,"Noto Sans Thai",sans-serif;font-size:clamp(24px,4vw,34px);font-weight:300;margin:18px 0 6px;color:oklch(91% 0 0)}}
h2.title b{{font-weight:400;color:oklch(84% .19 80.46)}}
table{{width:100%;border-collapse:collapse;margin-top:22px;font-size:13px}}
th{{font-family:"Roboto Mono",monospace;font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;color:oklch(62% 0 0);text-align:left;padding:10px 10px;border-bottom:1px solid oklch(78% 0 0/.22)}}
td{{padding:12px 10px;border-bottom:1px solid oklch(78% 0 0/.1);vertical-align:top}}
.on{{color:oklch(70% .12 188);font-weight:600}}
.off{{color:oklch(62% 0 0)}}
.slug{{font-family:ui-monospace,monospace;font-size:11px;color:oklch(72% 0 0);word-break:break-all}}
.hint{{font-size:11.5px;color:oklch(62% 0 0);margin-top:16px}}
.login{{max-width:360px;margin:80px auto 0;background:oklch(11% .006 95);border:1px solid oklch(78% 0 0/.16);border-radius:8px;padding:30px}}
.login h2{{font-family:Kanit,sans-serif;font-weight:300;font-size:22px;color:oklch(91% 0 0);margin-bottom:6px}}
.login p{{font-size:12.5px;color:oklch(72% 0 0)}}
input{{width:100%;background:oklch(4% .004 95);border:1px solid oklch(78% 0 0/.22);color:oklch(88% 0 0);border-radius:4px;padding:12px 14px;font-family:inherit;font-size:14px;margin-top:12px}}
button{{margin-top:16px;width:100%;border:none;border-radius:4px;padding:12px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;background:oklch(84% .19 80.46);color:oklch(4% .004 95)}}
.err{{color:#e08573;font-size:12.5px;margin-top:10px}}
.top-logout{{background:transparent;color:oklch(72% 0 0);border:1px solid oklch(78% 0 0/.22);width:auto;padding:8px 14px;font-weight:500;font-size:12.5px;margin:0}}
footer{{border-top:1px solid oklch(78% 0 0/.16);margin-top:34px;padding:18px 0 30px;text-align:center;font-size:12px;color:oklch(62% 0 0)}}
</style></head><body><div class="wrap">
<header>
  <div class="brand"><h1>CameraSync · แอดมินระบบ</h1></div>
  <form method="post" action="/r/admin/logout" style="margin:0"><button class="top-logout" type="submit">ออกจากระบบ</button></form>
</header>
{body}
<footer>แต่ละช่างภาพใช้บัญชี LINE ของตัวเอง — งานและรูปอยู่บนเครื่องของแต่ละคน แยกจากกันโดยสิ้นเชิง · ภาพไม่ถูกเก็บบนเซิร์ฟเวอร์</footer>
</div>{refresh_script}</body></html>"##,
        body = body,
        refresh_script = if refresh { "<script>setTimeout(()=>location.reload(),15000)</script>" } else { "" },
    )
}

async fn admin_page(State(st): State<SharedHub>, headers: HeaderMap) -> Response {
    if is_admin_session(&st, &headers).await.is_none() {
        let html = admin_shell(
            r#"<div class="login">
  <h2>เข้าสู่ระบบแอดมิน</h2>
  <p>สำหรับผู้ดูแลระบบ — ดูสถานะช่างภาพทุกคนได้จากที่นี่</p>
  <form method="post" action="javascript:void(0)" id="f">
    <input id="u" placeholder="ชื่อผู้ใช้" autocomplete="username" />
    <input id="p" type="password" placeholder="รหัสผ่าน" autocomplete="current-password" />
    <button type="submit">เข้าสู่ระบบ</button>
    <p class="err" id="e" style="display:none"></p>
  </form>
  <script>
    f.onsubmit = async (ev) => {{
      ev.preventDefault();
      e.style.display = "none";
      const r = await fetch("/r/admin/login", {{
        method: "POST",
        headers: {{"content-type": "application/json"}},
        body: JSON.stringify({{username: u.value, password: p.value}}),
      }});
      if (r.ok) location.reload();
      else {{ e.textContent = (await r.json()).error || "เข้าสู่ระบบไม่สำเร็จ"; e.style.display = "block"; }}
    }};
  </script>
</div>"#,
            false,
        );
        return (
            [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
            html,
        )
            .into_response();
    }

    // every account + live status + their announced events
    let users: Vec<(String, i64)> = sqlx::query_as(
        "SELECT username, created_at FROM users ORDER BY created_at DESC",
    )
    .fetch_all(&st.db)
    .await
    .unwrap_or_default();
    let tunnels = st.tunnels.lock().await;
    let slug_map = st.slug_map.lock().await;

    let mut rows = String::new();
    let mut online = 0usize;
    let mut total_events = 0usize;
    for (username, created) in &users {
        let display = username.strip_prefix("line:").map(|_| "LINE ช่างภาพ").unwrap_or("บัญชี");
        let tid = tunnel_id_for(username);
        let is_online = tunnels.contains_key(&tid);
        if is_online {
            online += 1;
        }
        let slugs: Vec<&String> = slug_map
            .iter()
            .filter(|(_, t)| *t == &tid)
            .map(|(s, _)| s)
            .collect();
        total_events += slugs.len();
        let slugs_html = if slugs.is_empty() {
            "<span class=\"slug\" style=\"opacity:.5\">— ยังไม่มีงานบนเว็บ —</span>".to_string()
        } else {
            slugs
                .iter()
                .map(|s| format!("<a class=\"slug\" style=\"color:oklch(70% .12 188)\" href=\"/e/{}/\" target=\"_blank\">{}/</a>", s, s))
                .collect::<Vec<_>>()
                .join(" · ")
        };
        let name = if let Some(rest) = username.strip_prefix("line:") {
            format!("ช่างภาพ LINE ····{}", &rest[rest.len().saturating_sub(6)..])
        } else {
            username.clone()
        };
        let created_str = chrono_trim(*created);
        rows.push_str(&format!(
            "<tr><td><b>{name}</b><br><span style=\"font-size:11px;color:oklch(62% 0 0)\">{display} · สมัคร {created_str}</span></td><td class=\"{}\">{}</td><td>{}</td></tr>",
            if is_online { "on" } else { "off" },
            if is_online { "● ออนไลน์" } else { "ออฟไลน์" },
            slugs_html,
        ));
    }
    drop(tunnels);
    drop(slug_map);

    let body = format!(
        r#"<span class="kicker">System Admin</span>
<h2 class="title">ช่างภาพทุกคน <b>ในหน้าเดียว</b></h2>
<p style="color:oklch(72% 0 0);font-size:13.5px">ออนไลน์ {online} บัญชี · งานบนเว็บทั้งหมด {total_events} งาน · อัปเดตอัตโนมัติทุก 15 วินาที</p>
<table><thead><tr><th>ช่างภาพ</th><th>สถานะเครื่อง</th><th>งาน (ลิงก์ลูกค้า)</th></tr></thead><tbody>{rows}</tbody></table>
<p class="hint">ถ้าสถานะเป็น "ออฟไลน์" ระหว่างงาน = แอปบนเครื่องช่างภาพหลุดการเชื่อมต่อ ควรแจ้งให้เปิดแอปใหม่</p>"#
    );
    let html = admin_shell(&body, true);
    (
        [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
        html,
    )
        .into_response()
}

fn chrono_trim(ms: i64) -> String {
    // simple local-date render without pulling chrono into scope names
    let secs = ms / 1000;
    let days = secs / 86400;
    // 2026-01-01 epoch-days ≈ 20454 (days since 1970-01-01)
    let mut y = 1970i64;
    let mut d = days;
    loop {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let len = if leap { 366 } else { 365 };
        if d < len {
            break;
        }
        d -= len;
        y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let ml = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 1;
    for l in ml {
        if d < l {
            break;
        }
        d -= l;
        m += 1;
    }
    format!("{y}-{m:02}-{:02}", d + 1)
}

async fn line_qr_png(Path(p): Path<SlugPath>) -> Response {
    let url = format!("/e/{}/", p.slug);
    let Ok(code) = qrcode::QrCode::with_error_correction_level(
        url.as_bytes(),
        qrcode::EcLevel::M,
    ) else {
        return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "qr failed").into_response();
    };
    let img = code
        .render::<image::Rgba<u8>>()
        .min_dimensions(720, 720)
        .quiet_zone(true)
        .dark_color(image::Rgba([28, 22, 18, 255]))
        .light_color(image::Rgba([255, 252, 246, 255]))
        .build();
    let mut buf = std::io::Cursor::new(Vec::new());
    if image::DynamicImage::ImageRgba8(img)
        .write_to(&mut buf, image::ImageFormat::Png)
        .is_err()
    {
        return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "png failed").into_response();
    }
    (
        [(axum::http::header::CONTENT_TYPE, "image/png")],
        buf.into_inner(),
    )
        .into_response()
}

async fn line_my_slugs(State(st): State<SharedHub>, headers: HeaderMap) -> Response {
    let Some(username) = web_session_user(&st, &headers).await else {
        return crate::error::AppError::Unauthorized("กรุณาเข้าสู่ระบบด้วย LINE ก่อน".into())
            .into_response();
    };
    let slugs = my_slugs(&st, &username).await;
    Json(serde_json::json!({ "slugs": slugs })).into_response()
}

/// "งานของฉัน" — every guest QR this photographer has created, straight
/// from the hub's live slug map (their machine announces them).
async fn line_me_page(State(st): State<SharedHub>, headers: HeaderMap) -> Response {
    let Some(username) = web_session_user(&st, &headers).await else {
        return axum::response::Redirect::to("/r/line/start").into_response();
    };
    let slugs = my_slugs(&st, &username).await;
    let base = hub_base_url(&headers);

    let mut cards = String::new();
    for slug in &slugs {
        let url = format!("{base}/e/{slug}/");
        cards.push_str(&format!(
            r#"<div class="card">
      <div class="qrbox"><img src="/r/qr/{slug}" alt="QR {slug}" loading="lazy"></div>
      <div class="meta">
        <h3>/{slug}/</h3>
        <p class="url">{url}</p>
        <div class="row">
          <a class="btn" href="/r/qr/{slug}" download="CameraSync-{slug}-qr.png">ดาวน์โหลด QR</a>
          <a class="btn ghost" href="/e/{slug}/" target="_blank" rel="noopener">เปิดหน้าลูกค้า</a>
          <button class="btn ghost" onclick="navigator.clipboard.writeText('{url}').then(()=>this.textContent='คัดลอกแล้ว ✓')">คัดลอกลิงก์</button>
        </div>
        <p class="hint">ปริ้น QR นี้แปะโต๊ะให้ลูกค้าสแกน หรือส่งลิงก์ให้ทีมงาน — ลูกค้าสแกนแล้วดูรูปได้เลย</p>
      </div>
    </div>"#
        ));
    }
    let empty = if slugs.is_empty() {
        r#"<div class="empty">
      <p><b>ยังไม่มีงานบนหน้าเว็บ</b></p>
      <p>เปิดแอป CameraSync บนเครื่องถ่ายรูป แล้วกด "เข้าสู่ระบบด้วย LINE" ด้วยบัญชีเดียวกันนี้ —
         รายการงานและ QR จะขึ้นที่หน้านี้เองภายในไม่กี่วินาที</p>
      <p class="hint">(หน้านี้รีเฟรชให้อัตโนมัติทุก 10 วินาที)</p>
    </div>"#
    } else {
        ""
    };
    let reload = if slugs.is_empty() {
        "<script>setTimeout(()=>location.reload(),10000)</script>"
    } else {
        ""
    };
    let me_count = if slugs.is_empty() {
        String::new()
    } else {
        format!("{} งาน", slugs.len())
    };
    let html = format!(
        r##"<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>งานของฉัน — CameraSync</title>
<link href="https://fonts.googleapis.com/css2?family=Anuphan:wght@300;400;500;600&family=Kanit:wght@200;300;400;500&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:Anuphan,"Noto Sans Thai",system-ui,sans-serif;background:oklch(7% .006 95);color:oklch(88% 0 0);line-height:1.7}}
.wrap{{max-width:880px;margin:0 auto;padding:0 20px}}
header{{display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid oklch(78% 0 0/.16)}}
.brand{{display:flex;align-items:center;gap:11px;text-decoration:none;color:inherit}}
.brand h1{{font-family:Kanit,sans-serif;font-size:17px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:oklch(91% 0 0)}}
.brand p{{font-size:11px;color:oklch(62% 0 0);margin-top:-3px}}
.kicker{{display:inline-flex;align-items:center;gap:10px;font-family:"Roboto Mono",monospace;font-size:.68rem;font-weight:500;letter-spacing:.24em;text-transform:uppercase;color:oklch(84% .19 80.46)}}
.kicker::before,.kicker::after{{content:"";width:30px;height:1px;background:oklch(74% .09 82/.6)}}
h2.title{{font-family:Kanit,"Noto Sans Thai",sans-serif;font-size:clamp(26px,4.6vw,38px);font-weight:300;margin:18px 0 6px;color:oklch(91% 0 0)}}
h2.title em{{font-style:normal;color:oklch(84% .19 80.46)}}
.count{{color:oklch(72% 0 0);font-size:14px}}
.count b{{color:oklch(70% .12 188);font-weight:500}}
.grid{{display:grid;gap:16px;margin-top:26px}}
.card{{display:flex;gap:20px;background:oklch(11% .006 95);border:1px solid oklch(78% 0 0/.16);border-radius:6px;padding:20px;align-items:center;flex-wrap:wrap;transition:border-color .2s}}
.card:hover{{border-color:oklch(74% .09 82/.6)}}
.qrbox img{{width:150px;height:150px;border-radius:4px;border:1px solid oklch(78% 0 0/.22);background:#fff;display:block}}
.meta{{flex:1;min-width:230px}}
.meta h3{{font-family:Kanit,"Noto Sans Thai",sans-serif;font-size:18px;font-weight:400;word-break:break-all;color:oklch(91% 0 0)}}
.url{{font-family:ui-monospace,monospace;font-size:12px;color:oklch(72% 0 0);margin:4px 0 12px;word-break:break-all}}
.row{{display:flex;gap:8px;flex-wrap:wrap}}
.btn{{display:inline-flex;align-items:center;gap:6px;border:none;border-radius:4px;padding:10px 16px;font-size:13px;font-weight:500;font-family:inherit;cursor:pointer;text-decoration:none;background:oklch(84% .19 80.46);color:oklch(4% .004 95)}}
.btn:hover{{background:oklch(86% .07 84)}}
.btn.ghost{{background:transparent;color:oklch(84% .19 80.46);border:1px solid oklch(74% .09 82/.6)}}
.hint{{font-size:11.5px;color:oklch(62% 0 0);margin-top:10px}}
.empty{{background:oklch(11% .006 95);border:1px dashed oklch(78% 0 0/.3);border-radius:6px;padding:34px;text-align:center;margin-top:26px}}
.empty p{{margin:6px 0;color:oklch(72% 0 0)}}
.empty p:first-child b{{color:oklch(84% .19 80.46);font-weight:500}}
footer{{border-top:1px solid oklch(78% 0 0/.16);margin-top:34px;padding:18px 0 30px;text-align:center;font-size:12.5px;color:oklch(62% 0 0);background:oklch(4% .004 95)}}
footer a{{color:oklch(72% 0 0)}}
</style></head><body><div class="wrap">
<header>
  <a class="brand" href="/"><svg width="38" height="38" viewBox="0 0 512 512" style="display:block">
    <defs>
      <linearGradient id="cs1bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2B231B"/><stop offset="1" stop-color="#130F0B"/>
      </linearGradient>
      <radialGradient id="cs1glow" cx="0.3" cy="0.2" r="0.85">
        <stop offset="0" stop-color="#F0C97E" stop-opacity="0.3"/><stop offset="1" stop-color="#F0C97E" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="cs1gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#F6D488"/><stop offset="0.5" stop-color="#E2B15C"/><stop offset="1" stop-color="#B98A3F"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="118" fill="url(#cs1bg)"/>
    <rect width="512" height="512" rx="118" fill="url(#cs1glow)"/>
    <circle cx="256" cy="256" r="128" fill="none" stroke="url(#cs1gold)" stroke-width="26" stroke-linecap="round" stroke-dasharray="94 40" stroke-dashoffset="20"/>
    <path fill="url(#cs1gold)" d="M256 312 C 214 280 190 256 190 228 C 190 206 207 191 227 191 C 240 191 251 198 256 208 C 261 198 272 191 285 191 C 305 191 322 206 322 228 C 322 256 298 280 256 312 Z"/>
    <circle cx="347" cy="165" r="24" fill="#5FBDBD"/>
  </svg>
  <div><h1>CameraSync</h1><p style="font-size:11.5px;color:#6f6760">งานของฉัน · {username}</p></div></a>
</header>
<span class="kicker">My Events</span>
<h2 class="title">QR ทุกงานของคุณ <em style="font-style:normal;color:oklch(84% .19 80.46)">ในหน้าเดียว</em></h2>
<p class="count"><b>{me_count}</b> — รายการอัปเดตจากเครื่องที่เชื่อมต่ออยู่ของคุณ</p>
<div class="grid">{cards}{empty}</div>
<footer>CameraSync — รูปทั้งหมดอยู่บนเครื่องคุณ เราเป็นเพียงทางผ่าน · <a href="/" style="color:inherit;font-weight:600">หน้าแรก</a></footer>
</div>{reload}</body></html>"##
    );
    (
        [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
        html,
    )
        .into_response()
}

// ---------- LINE Login (hub auth สำหรับช่างภาพ) ----------

fn line_config() -> Option<(String, String)> {
    let id = std::env::var("LINE_CHANNEL_ID").ok()?;
    let secret = std::env::var("LINE_CHANNEL_SECRET").ok()?;
    if id.is_empty() || secret.is_empty() {
        None
    } else {
        Some((id, secret))
    }
}

fn hub_base_url(headers: &HeaderMap) -> String {
    if let Ok(base) = std::env::var("HUB_PUBLIC_URL") {
        return base.trim_end_matches('/').to_string();
    }
    let host = headers
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost:9000");
    format!("http://{host}")
}

fn pct_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

async fn line_begin(
    State(st): State<SharedHub>,
    headers: HeaderMap,
) -> Response {
    if line_config().is_none() {
        return crate::error::AppError::ServiceUnavailable(
            "hub นี้ยังไม่ได้ตั้งค่า LINE Login (ต้องตั้ง LINE_CHANNEL_ID / LINE_CHANNEL_SECRET)".into(),
        )
        .into_response();
    }
    let state = crate::util::random_token()[..24].to_string();
    st.line_pending.lock().await.insert(
        state.clone(),
        LinePending {
            created: crate::util::now_ms(),
            done: None,
        },
    );
    let url = format!("{}/r/line/login?state={state}", hub_base_url(&headers));
    Json(serde_json::json!({ "state": state, "url": url })).into_response()
}

#[derive(Deserialize)]
struct LineStateQuery {
    state: String,
}

async fn line_login_redirect(State(st): State<SharedHub>, headers: HeaderMap, Query(q): Query<LineStateQuery>) -> Response {
    let Some((id, _secret)) = line_config() else {
        return crate::error::AppError::ServiceUnavailable(
            "hub นี้ยังไม่ได้ตั้งค่า LINE Login".into(),
        )
        .into_response();
    };
    if !st.line_pending.lock().await.contains_key(&q.state) {
        return crate::error::AppError::bad("state ไม่ถูกต้องหรือหมดอายุ — เริ่มล็อกอินใหม่จากแอป").into_response();
    }
    let redirect_uri = format!("{}/r/line/callback", hub_base_url(&headers));
    let authorize = format!(
        "https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id={id}&redirect_uri={}&state={}&scope=profile%20openid",
        pct_encode(&redirect_uri),
        q.state
    );
    (StatusCode::FOUND, [("Location", authorize)]).into_response()
}

#[derive(Deserialize)]
struct LineCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

async fn line_callback(
    State(st): State<SharedHub>,
    headers: HeaderMap,
    Query(q): Query<LineCallbackQuery>,
) -> Response {
    if let Some(err) = &q.error {
        return line_html_page(false, &format!("LINE แจ้ง error: {err}"));
    }
    let (Some(code), Some(state)) = (&q.code, &q.state) else {
        return line_html_page(false, "ไม่ได้รับ authorization code จาก LINE");
    };
    let Some((id, secret)) = line_config() else {
        return line_html_page(false, "hub ยังไม่ได้ตั้งค่า LINE Login");
    };
    let pending_exists = st.line_pending.lock().await.contains_key(state);
    if !pending_exists {
        return line_html_page(false, "state ไม่ถูกต้องหรือหมดอายุ — เริ่มล็อกอินใหม่");
    }

    // exchange code → access token
    let redirect_uri = format!("{}/r/line/callback", hub_base_url(&headers));
    let http = reqwest::Client::new();
    let token_resp = http
        .post("https://api.line.me/oauth2/v2.1/token")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("client_id", id.as_str()),
            ("client_secret", secret.as_str()),
        ])
        .send()
        .await;
    let token_resp = match token_resp {
        Ok(r) if r.status().is_success() => {
            r.json::<serde_json::Value>().await.unwrap_or_default()
        }
        Ok(r) => {
            let status = r.status().as_u16();
            return line_html_page(
                false,
                &format!("แลก token กับ LINE ไม่สำเร็จ (HTTP {status}) — ตรวจ redirect URI ใน LINE Developers ให้ตรงกับ {redirect_uri}"),
            );
        }
        Err(e) => return line_html_page(false, &format!("ติดต่อ LINE ไม่ได้: {e}")),
    };
    let Some(access_token) = token_resp["access_token"].as_str() else {
        return line_html_page(false, "LINE ไม่คืน access token");
    };

    // profile → stable LINE user id
    let profile: serde_json::Value = match http
        .get("https://api.line.me/v2/profile")
        .bearer_auth(access_token)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or_default(),
        _ => return line_html_page(false, "ดึงโปรไฟล์ LINE ไม่สำเร็จ"),
    };
    let Some(line_user_id) = profile["userId"].as_str() else {
        return line_html_page(false, "LINE ไม่คืน userId");
    };
    let _display = profile["displayName"].as_str().unwrap_or("ช่างภาพ");

    // upsert local account for this LINE user (password unusable — LINE-only)
    let username = format!("line:{line_user_id}");
    let user_id: String = match sqlx::query_as::<_, (String,)>(
        "SELECT id FROM users WHERE username=?1",
    )
    .bind(&username)
    .fetch_one(&st.db)
    .await
    {
        Ok((id,)) => id,
        Err(_) => {
            let id = crate::util::new_id();
            let _ = sqlx::query(
                "INSERT INTO users(id, username, password_hash, created_at) VALUES (?1,?2,'!',?3)",
            )
            .bind(&id)
            .bind(&username)
            .bind(crate::util::now_ms())
            .execute(&st.db)
            .await;
            id
        }
    };
    let token = crate::util::random_token();
    let ttl = 90 * 24 * 3600 * 1000i64;
    let _ = sqlx::query("INSERT INTO sessions(token, user_id, kind, expires_at) VALUES (?1,?2,'machine',?3)")
        .bind(&token)
        .bind(&user_id)
        .bind(crate::util::now_ms() + ttl)
        .execute(&st.db)
        .await;
    let tunnel_id = tunnel_id_for(&username);

    let mut map = st.line_pending.lock().await;
    if let Some(p) = map.get_mut(state) {
        p.done = Some((token, tunnel_id.clone()));
    }
    drop(map);

    // web session so /r/line/me can list this photographer's QR codes
    let web_token = crate::util::random_token();
    let web_ttl = 30 * 24 * 3600 * 1000i64;
    let _ = sqlx::query("INSERT INTO sessions(token, user_id, kind, expires_at) VALUES (?1,?2,'web',?3)")
        .bind(&web_token)
        .bind(&user_id)
        .bind(crate::util::now_ms() + web_ttl)
        .execute(&st.db)
        .await;
    let mut res = axum::response::Redirect::to("/r/line/me").into_response();
    if let Ok(v) = axum::http::HeaderValue::from_str(&format!(
        "cs_hub={web_token}; Path=/; SameSite=Lax; Max-Age={}",
        30 * 24 * 3600
    )) {
        res.headers_mut().append(axum::http::header::SET_COOKIE, v);
    }
    res
}

#[derive(Deserialize)]
struct LinePollQuery {
    state: String,
}

async fn line_poll(State(st): State<SharedHub>, Query(q): Query<LinePollQuery>) -> Response {
    let mut map = st.line_pending.lock().await;
    let Some(p) = map.get(&q.state) else {
        return crate::error::AppError::not_found("state ไม่ถูกต้อง").into_response();
    };
    if crate::util::now_ms() - p.created > 10 * 60 * 1000 {
        map.remove(&q.state);
        return crate::error::AppError::bad("หมดเวลาล็อกอิน — เริ่มใหม่อีกครั้ง").into_response();
    }
    match &p.done {
        Some((token, tunnel_id)) => {
            let token = token.clone();
            let tunnel_id = tunnel_id.clone();
            map.remove(&q.state);
            Json(serde_json::json!({ "token": token, "tunnel_id": tunnel_id })).into_response()
        }
        None => Json(serde_json::json!({ "pending": true })).into_response(),
    }
}

fn line_html_page(ok: bool, msg: &str) -> Response {
    let (emoji, color) = if ok { ("✓", "#0f9d58") } else { ("✕", "#b3261e") };
    let html = format!(
        "<!doctype html><html lang=th><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>\
         <title>CameraSync — LINE Login</title>\
         <body style=\"font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#faf7f2;color:#2a2420\">\
         <div style=text-align:center;padding:24px>\
         <div style='font-size:52px;color:{color}'>{emoji}</div>\
         <h2 style=margin:14px 0>CameraSync</h2>\
         <p style=color:#6b6560;max-width:280px>{msg}</p>\
         </div></body></html>"
    );
    axum::response::Html(html).into_response()
}

// ---------- machine websocket ----------

#[derive(Deserialize)]
struct WsQuery {
    token: Option<String>,
}

async fn ws_connect(
    State(state): State<SharedHub>,
    Path(id): Path<String>,
    Query(q): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    // authenticated machines must use their own derived tunnel id (u-<username>)
    if let Some(token) = &q.token {
        match session_user(&state, token).await {
            Some(username) if tunnel_id_for(&username) == id => {}
            _ => {
                return crate::error::AppError::Unauthorized("invalid machine token".into())
                    .into_response()
            }
        }
    }
    ws.on_upgrade(move |socket| handle_machine(state, id, socket))
}

async fn handle_machine(state: SharedHub, id: String, socket: WebSocket) {
    use futures_util::StreamExt;
    let (mut sink, mut stream) = socket.split();

    let first = stream.next().await;
    let matches = matches!(&first, Some(Ok(Message::Text(t))) if t.contains("register"));
    if !matches {
        let _ = sink
            .send(Message::Text(r#"{"error":"expected register handshake"}"#.into()))
            .await;
        return;
    }

    let (tx, mut rx) = mpsc::channel::<Job>(16);
    let conn_key = state.counter.fetch_add(1, Ordering::Relaxed);
    {
        let mut tunnels = state.tunnels.lock().await;
        if let Some((_, old_tx)) = tunnels.insert(id.clone(), (conn_key, tx.clone())) {
            drop(old_tx); // closes the replaced connection's job channel → its task exits
        }
    }
    tracing::info!(tunnel = %id, "machine connected");
    println!("  ⇄ machine '{id}' connected");

    let mut pending: HashMap<String, oneshot::Sender<Result<RespMsg, String>>> = HashMap::new();
    let mut announced: Vec<String> = Vec::new();

    loop {
        tokio::select! {
            job = rx.recv() => {
                let Some((req, done)) = job else { break };
                pending.insert(req.id.clone(), done);
                let Ok(text) = serde_json::to_string(&req) else { continue };
                if sink.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(t))) => {
                        if t.contains("\"announce\"") {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                                if let Some(slugs) = v["announce"].as_array() {
                                    let slugs: Vec<String> = slugs
                                        .iter()
                                        .filter_map(|s| s.as_str().map(|s| s.to_string()))
                                        .collect();
                                    let mut map = state.slug_map.lock().await;
                                    for old in &announced {
                                        if map.get(old).map(|o| o == &id).unwrap_or(false) {
                                            map.remove(old);
                                        }
                                    }
                                    for s in &slugs {
                                        map.insert(s.clone(), id.clone());
                                    }
                                    tracing::info!(tunnel = %id, slugs = ?slugs, "announced events");
                                    announced = slugs;
                                }
                            }
                            continue;
                        }
                        let Ok(resp) = serde_json::from_str::<RespMsg>(&t) else { continue };
                        if let Some(done) = pending.remove(&resp.id) {
                            let _ = done.send(Ok(resp));
                        }
                    }
                    Some(Ok(Message::Ping(p))) => { let _ = sink.send(Message::Pong(p)).await; }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }

    // cleanup: only remove registrations still owned by THIS connection
    let still_mine = {
        let tunnels = state.tunnels.lock().await;
        matches!(tunnels.get(&id), Some((k, _)) if *k == conn_key)
    };
    if still_mine {
        state.tunnels.lock().await.remove(&id);
        let mut map = state.slug_map.lock().await;
        for s in &announced {
            if map.get(s).map(|o| o == &id).unwrap_or(false) {
                map.remove(s);
            }
        }
    }
    for (_, done) in pending.drain() {
        let _ = done.send(Err("tunnel disconnected".into()));
    }
    tracing::warn!(tunnel = %id, "machine disconnected");
    println!("  ✕ machine '{id}' disconnected");
}

// ---------- proxying ----------

fn headers_to_vec(headers: &HeaderMap) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (name, value) in headers.iter() {
        let n = name.as_str().to_ascii_lowercase();
        if HOP_HEADERS.contains(&n.as_str()) {
            continue;
        }
        if let Ok(v) = value.to_str() {
            out.push((n, v.to_string()));
        }
    }
    out
}

async fn proxy(
    state: &SharedHub,
    tunnel_id: &str,
    method: Method,
    uri_path_query: String,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let tx = state.tunnels.lock().await.get(tunnel_id).map(|(_, tx)| tx.clone());
    let Some(tx) = tx else {
        return error_page(
            StatusCode::BAD_GATEWAY,
            "เครื่องช่างภาพของงานนี้ออฟไลน์อยู่ (desktop app ไม่ได้เปิด หรือเน็ตหลุด) — ลองใหม่อีกครั้งเมื่อกลับมาออนไลน์",
        );
    };

    let id = format!("j{}", state.counter.fetch_add(1, Ordering::Relaxed));
    let msg = ReqMsg {
        id: id.clone(),
        method: method.as_str().to_string(),
        path: uri_path_query,
        headers: headers_to_vec(&headers),
        body: if body.is_empty() { None } else { Some(B64.encode(&body)) },
    };

    let (done_tx, done_rx) = oneshot::channel::<Result<RespMsg, String>>();
    if tx.send((msg, done_tx)).await.is_err() {
        return error_page(StatusCode::BAD_GATEWAY, "tunnel disconnected");
    }

    let resp = match tokio::time::timeout(Duration::from_secs(90), done_rx).await {
        Ok(Ok(Ok(resp))) => resp,
        Ok(Ok(Err(e))) => return error_page(StatusCode::BAD_GATEWAY, &e),
        _ => return error_page(StatusCode::GATEWAY_TIMEOUT, "tunnel response timeout"),
    };

    let mut builder = Response::builder().status(
        StatusCode::from_u16(resp.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
    );
    for (k, v) in &resp.headers {
        let (Ok(name), Ok(value)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v))
        else {
            continue;
        };
        builder = builder.header(name, value);
    }
    let bytes = B64.decode(&resp.body).unwrap_or_default();
    // NOTE: bytes live only in this response — the hub never writes them to disk.
    match builder.body(axum::body::Body::from(bytes)) {
        Ok(r) => r,
        Err(_) => error_page(StatusCode::BAD_GATEWAY, "bad tunnel response"),
    }
}

async fn read_request_parts(req: axum::extract::Request) -> (Method, String, HeaderMap, axum::body::Bytes) {
    let (parts, body) = req.into_parts();
    let path = parts
        .uri
        .path_and_query()
        .map(|pq| pq.as_str().to_string())
        .unwrap_or_else(|| "/".into());
    let bytes = axum::body::to_bytes(body, 400 * 1024 * 1024)
        .await
        .unwrap_or_default();
    (parts.method, path, parts.headers, bytes)
}

fn set_tunnel_cookie(resp: &mut Response, id: &str) {
    let cookie = format!("{TUNNEL_COOKIE}={id}; Path=/; SameSite=Lax; Max-Age=86400");
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        resp.headers_mut().append(axum::http::header::SET_COOKIE, v);
    }
}

/// Legacy entry: `/t/{id}/rest?query` → forward, then bind the browser to
/// this tunnel with a cookie so absolute `/api/…` paths keep working.
async fn tunnel_entry(
    State(state): State<SharedHub>,
    Path((id, rest)): Path<(String, String)>,
    req: axum::extract::Request,
) -> Response {
    let (method, _, headers, bytes) = read_request_parts(req).await;
    let path = format!("/{rest}");
    let mut resp = proxy(&state, &id, method, path, headers, bytes).await;
    set_tunnel_cookie(&mut resp, &id);
    resp
}

#[derive(Deserialize)]
struct GuestPath {
    slug: String,
    #[serde(default)]
    rest: Option<String>,
}

/// Guest entry: pretty `/e/{slug}/…` — look up which machine owns the event,
/// forward, and set the tunnel cookie. Guests never see a tunnel prefix.
async fn guest_entry(
    State(state): State<SharedHub>,
    Path(p): Path<GuestPath>,
    req: axum::extract::Request,
) -> Response {
    let (method, _, headers, bytes) = read_request_parts(req).await;
    let path = match &p.rest {
        Some(rest) if !rest.is_empty() => format!("/e/{}/{}", p.slug, rest),
        _ => format!("/e/{}/", p.slug),
    };
    let owner = state.slug_map.lock().await.get(&p.slug).cloned();
    let Some(tunnel_id) = owner else {
        return error_page(
            StatusCode::NOT_FOUND,
            "ไม่พบงานนี้บน hub — เครื่องช่างภาพอาจยังไม่ได้เชื่อมต่อ หรือ slug ไม่ถูกต้อง",
        );
    };
    let mut resp = proxy(&state, &tunnel_id, method, path, headers, bytes).await;
    set_tunnel_cookie(&mut resp, &tunnel_id);
    resp
}

/// Fallback: cookie-bound traffic (/api/…, /assets/…, SPA routes) goes back
/// to the same tunnel.
async fn hub_fallback(State(state): State<SharedHub>, req: axum::extract::Request) -> Response {
    let (method, path, headers, bytes) = read_request_parts(req).await;
    let cookies = crate::util::parse_cookies(&headers);
    let Some(id) = cookies.get(TUNNEL_COOKIE).cloned() else {
        return error_page(
            StatusCode::NOT_FOUND,
            "CameraSync hub — ลูกค้าเข้าแกลเลอรีผ่านลิงก์ /e/{event-slug}/ ที่ได้จากงาน · ช่างภาพเริ่มที่หน้าแรก",
        );
    };
    proxy(&state, &id, method, path, headers, bytes).await
}

fn error_page(status: StatusCode, msg: &str) -> Response {
    let html = format!(
        "<!doctype html><html lang=th><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>\
         <title>CameraSync</title>\
         <body style=\"font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#faf7f2;color:#2a2420\">\
         <div style=text-align:center><div style=font-size:44px>◉</div><h2 style=margin:12px 0>CameraSync</h2>\
         <p style=color:#6b6560>{msg}</p></div></body></html>"
    );
    (status, axum::response::Html(html)).into_response()
}
