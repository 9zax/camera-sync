//! Built-in reverse tunnel ("ngrok จิ๋ว" ของเราเอง)
//!
//! `wedsync-server relay` runs on any reachable machine (VPS/NAS). The
//! photographer's box dials out with `wedsync tunnel` and keeps a WebSocket
//! connection; guests reach the gallery through `/t/{id}/...` — the relay
//! prefixes/strips a `cs_tunnel` cookie so the SPA and its absolute `/api`
//! paths work unchanged through the tunnel. Photos never leave the
//! photographer's disk; the relay only shuttles HTTP bytes.

use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::Router;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot, Mutex};
use futures_util::SinkExt;

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

#[derive(Default)]
pub struct RelayState {
    tunnels: Mutex<HashMap<String, mpsc::Sender<Job>>>,
    counter: AtomicU64,
}

pub type SharedRelay = Arc<RelayState>;

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

pub async fn run_relay(port: u16) -> anyhow::Result<()> {
    let state: SharedRelay = Arc::new(RelayState::default());

    let app = Router::new()
        .route("/r/connect/{id}", get(ws_connect))
        .route("/t/{id}/{*rest}", any(tunnel_entry))
        .fallback(relay_fallback)
        .layer(axum::extract::DefaultBodyLimit::max(400 * 1024 * 1024))
        .with_state(state.clone());

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!();
    println!("  ◉ CameraSync relay (tunnel)");
    println!("  ────────────────────────────────────────────");
    println!("  listening on http://0.0.0.0:{port}");
    println!("  agent : ws://<this-host>:{port}/r/connect/<tunnel-id>");
    println!("  guests: http://<this-host>:{port}/t/<tunnel-id>/");
    println!();
    tracing::info!("relay listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn ws_connect(
    State(state): State<SharedRelay>,
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| handle_agent(state, id, socket))
}

async fn handle_agent(state: SharedRelay, id: String, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    use futures_util::StreamExt;

    // first message must be the register handshake
    let registered = match stream.next().await {
        Some(Ok(Message::Text(t))) if t.contains("register") => true,
        _ => false,
    };
    if !registered {
        let _ = sink
            .send(Message::Text(r#"{"error":"expected register handshake"}"#.into()))
            .await;
        return;
    }

    let (tx, mut rx) = mpsc::channel::<Job>(16);
    state.tunnels.lock().await.insert(id.clone(), tx.clone());
    tracing::info!(tunnel = %id, "tunnel connected");
    println!("  ⇄ tunnel '{id}' connected");

    let mut pending: HashMap<String, oneshot::Sender<Result<RespMsg, String>>> = HashMap::new();
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

    state.tunnels.lock().await.remove(&id);
    for (_, done) in pending.drain() {
        let _ = done.send(Err("tunnel disconnected".into()));
    }
    tracing::warn!(tunnel = %id, "tunnel disconnected");
    println!("  ✕ tunnel '{id}' disconnected");
}

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
    state: SharedRelay,
    tunnel_id: &str,
    method: Method,
    uri_path_query: String,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let tx = state.tunnels.lock().await.get(tunnel_id).cloned();
    let Some(tx) = tx else {
        return error_page(
            StatusCode::BAD_GATEWAY,
            "tunnel นี้ไม่ได้เชื่อมต่ออยู่ (เครื่องช่างภาพออฟไลน์ หรือ id ไม่ถูกต้อง)",
        );
    };

    let id = format!("j{}", state.counter.fetch_add(1, Ordering::Relaxed));
    let msg = ReqMsg {
        id: id.clone(),
        method: method.as_str().to_string(),
        path: uri_path_query,
        headers: headers_to_vec(&headers),
        body: if body.is_empty() {
            None
        } else {
            Some(B64.encode(&body))
        },
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

    let mut builder = Response::builder().status(StatusCode::from_u16(resp.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR));
    for (k, v) in &resp.headers {
        let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) else {
            continue;
        };
        builder = builder.header(name, value);
    }
    let bytes = B64.decode(&resp.body).unwrap_or_default();
    match builder.body(axum::body::Body::from(bytes)) {
        Ok(r) => r,
        Err(_) => error_page(StatusCode::BAD_GATEWAY, "bad tunnel response"),
    }
}

/// Entry point: `/t/{id}/rest?query` → forwarded to the tunnel, and the
/// browser gets a `cs_tunnel` cookie so later absolute-path requests
/// (`/api/...`, `/assets/...`, `/e/...`) are routed to the same tunnel.
async fn tunnel_entry(
    State(state): State<SharedRelay>,
    Path((id, rest)): Path<(String, String)>,
    req: axum::extract::Request,
) -> Response {
    let (parts, body) = req.into_parts();
    let path = format!(
        "/{}{}",
        rest,
        parts.uri.query().map(|q| format!("?{q}")).unwrap_or_default()
    );
    let bytes = axum::body::to_bytes(body, 400 * 1024 * 1024)
        .await
        .unwrap_or_default();
    let mut resp = proxy(state.clone(), &id, parts.method, path, parts.headers, bytes).await;    let cookie = format!("{TUNNEL_COOKIE}={id}; Path=/; SameSite=Lax; Max-Age=86400");
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        resp.headers_mut().append(axum::http::header::SET_COOKIE, v);
    }
    resp
}

/// Anything not matching `/t/...` or `/r/...` is checked against the
/// `cs_tunnel` cookie and forwarded to that tunnel (SPA assets & API calls).
async fn relay_fallback(
    State(state): State<SharedRelay>,
    req: axum::extract::Request,
) -> Response {
    let (parts, body) = req.into_parts();
    let cookies = crate::util::parse_cookies(&parts.headers);
    let Some(id) = cookies.get(TUNNEL_COOKIE).cloned() else {
        return error_page(
            StatusCode::NOT_FOUND,
            "CameraSync relay — เข้าแกลเลอรีผ่านลิงก์ /t/<tunnel-id>/ ที่ได้จากระบบ",
        );
    };
    let path = parts
        .uri
        .path_and_query()
        .map(|pq| pq.as_str().to_string())
        .unwrap_or_else(|| "/".into());
    let bytes = axum::body::to_bytes(body, 400 * 1024 * 1024)
        .await
        .unwrap_or_default();
    proxy(state, &id, parts.method, path, parts.headers, bytes).await
}

fn error_page(status: StatusCode, msg: &str) -> Response {
    let html = format!(
        "<!doctype html><html lang=th><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>\
         <title>CameraSync Tunnel</title>\
         <body style=\"font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#faf7f2;color:#2a2420\">\
         <div style=text-align:center><div style=font-size:44px>◉</div><h2 style=margin:12px 0>CameraSync Tunnel</h2>\
         <p style=color:#6b6560>{msg}</p></div></body></html>"
    );
    (status, axum::response::Html(html)).into_response()
}

// used by tests / future stats endpoint
#[allow(dead_code)]
fn _unused(_: HashSet<String>) {}
