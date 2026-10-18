//! CameraSync Hub ("ระบบเรา" ที่ deploy บน server จริง)
//!
//! Hub-and-spoke model:
//! - ช่างภาพรัน desktop app (server + disk อยู่เครื่องเขา) แล้ว auth เข้า hub
//! - Hub เก็บแค่บัญชี + ตาราง slug→tunnel — **ไม่มีการเก็บไฟล์ภาพบน hub เด็ดขาด**
//!   (ไม่มีโค้ดสายใดเขียน bytes ลงดิสก์ มีแค่ HTTP ผ่านหน่วยความจำชั่วคราว)
//! - แขกเปิด https://hub/e/{slug}/ → hub หา tunnel ของเครื่องช่างภาพที่มีงานนั้น
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
pub async fn run_hub(port: u16, data_dir: PathBuf) -> anyhow::Result<()> {
    let cfg = crate::config::Config::load(data_dir, false)?;
    let db = crate::db::init_pool(&cfg).await?;
    let state: SharedHub = Arc::new(HubState {
        db,
        tunnels: Mutex::new(HashMap::new()),
        slug_map: Mutex::new(HashMap::new()),
        line_pending: Mutex::new(HashMap::new()),
        counter: AtomicU64::new(1),
    });

    let app = Router::new()
        .route("/r/register", post(register))
        .route("/r/login", post(login))
        .route("/r/line/begin", get(line_begin))
        .route("/r/line/login", get(line_login_redirect))
        .route("/r/line/callback", get(line_callback))
        .route("/r/line/poll", get(line_poll))
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
    let display = profile["displayName"].as_str().unwrap_or("ช่างภาพ");

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

    line_html_page(true, &format!("สวัสดี {display} — กลับไปที่แอป CameraSync ได้เลย ระบบกำลังเชื่อมต่อให้อัตโนมัติ"))
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
            "CameraSync hub — เข้าแกลเลอรีผ่านลิงก์ /e/{event-slug}/ ที่ได้จากระบบ",
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
