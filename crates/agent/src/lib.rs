//! CameraSync agent library — reusable by the `wedsync` CLI and the Tauri
//! desktop app. Provides the reverse-tunnel client that links the
//! photographer's machine (where all photos live) to the hub.

use std::time::Duration;

use anyhow::{anyhow, Result};

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ReqMsg {
    pub id: String,
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct RespMsg {
    pub id: String,
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct TunnelConfig {
    /// Local photo-drive server (e.g. http://localhost:8080) — runs on this machine
    pub server: String,
    /// Hub WebSocket URL, e.g. wss://hub.example.com:9000
    pub relay: String,
    /// Legacy free-form tunnel id (mutually exclusive with user/pass & machine)
    pub id: Option<String>,
    /// Hub account (preferred) — logs in, derives tunnel id, authenticates the socket
    pub user: Option<String>,
    pub pass: Option<String>,
    /// Pre-authenticated machine credentials (e.g. from LINE Login)
    pub machine: Option<MachineCreds>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct MachineCreds {
    pub tunnel_id: String,
    pub token: String,
}

fn ws_to_http(ws: &str) -> String {
    let mut s = ws.trim().to_string();
    if s.starts_with("wss://") {
        s = s.replacen("wss://", "https://", 1);
    } else if s.starts_with("ws://") {
        s = s.replacen("ws://", "http://", 1);
    }
    while s.ends_with('/') {
        s.pop();
    }
    s
}

fn ws_url(relay: &str) -> String {
    let mut s = relay.trim().to_string();
    if s.starts_with("http://") {
        s = s.replacen("http://", "ws://", 1);
    } else if s.starts_with("https://") {
        s = s.replacen("https://", "wss://", 1);
    }
    while s.ends_with('/') {
        s.pop();
    }
    s
}

struct HubSession {
    token: Option<String>,
    tunnel_id: String,
}

async fn resolve_session(cfg: &TunnelConfig, http: &reqwest::Client) -> Result<HubSession> {
    if let Some(m) = &cfg.machine {
        return Ok(HubSession {
            token: Some(m.token.clone()),
            tunnel_id: m.tunnel_id.clone(),
        });
    }
    if let (Some(u), Some(p)) = (&cfg.user, &cfg.pass) {
        let resp: serde_json::Value = http
            .post(format!("{}/r/login", ws_to_http(&cfg.relay)))
            .json(&serde_json::json!({ "username": u, "password": p }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(HubSession {
            token: resp["token"].as_str().map(|s| s.to_string()),
            tunnel_id: resp["tunnel_id"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| anyhow!("hub did not return tunnel_id"))?,
        })
    } else {
        Ok(HubSession {
            token: None,
            tunnel_id: cfg
                .id
                .clone()
                .ok_or_else(|| anyhow!("ต้องระบุ --user/--pass (บัญชี hub) หรือ --id (legacy)"))?,
        })
    }
}

/// Register a new hub account (used by the desktop app's sign-up flow).
pub async fn hub_register(relay: &str, user: &str, pass: &str) -> Result<String> {
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()?;
    let resp: serde_json::Value = http
        .post(format!("{}/r/register", ws_to_http(relay)))
        .json(&serde_json::json!({ "username": user, "password": pass }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    resp["tunnel_id"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("hub did not confirm registration"))
}

/// Validate hub credentials before starting the tunnel (fail fast in the UI).
pub async fn hub_validate(relay: &str, user: &str, pass: &str) -> Result<String> {
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()?;
    let resp: serde_json::Value = http
        .post(format!("{}/r/login", ws_to_http(relay)))
        .json(&serde_json::json!({ "username": user, "password": pass }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    resp["tunnel_id"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("hub did not return tunnel_id"))
}

// ---------- LINE Login helpers (desktop app) ----------

/// Start a LINE Login handshake: returns (state, browser_url).
pub async fn line_login_begin(relay: &str) -> Result<(String, String)> {
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()?;
    let resp: serde_json::Value = http
        .get(format!("{}/r/line/begin", ws_to_http(relay)))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let state = resp["state"].as_str().ok_or_else(|| anyhow!("hub ไม่คืน state"))?.to_string();
    let url = resp["url"].as_str().ok_or_else(|| anyhow!("hub ไม่คืน url"))?.to_string();
    Ok((state, url))
}

/// Poll the hub until the LINE Login completes; returns machine credentials.
pub async fn line_login_wait(relay: &str, state: &str) -> Result<MachineCreds> {
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()?;
    let url = format!("{}/r/line/poll?state={}", ws_to_http(relay), state);
    let deadline = std::time::Instant::now() + Duration::from_secs(240);
    loop {
        if std::time::Instant::now() > deadline {
            anyhow::bail!("หมดเวลารอ LINE Login");
        }
        let resp = http.get(&url).send().await?;
        if resp.status().is_success() {
            let v: serde_json::Value = resp.json().await?;
            if v["pending"].as_bool() == Some(true) {
                tokio::time::sleep(Duration::from_millis(1500)).await;
                continue;
            }
            let token = v["token"].as_str().ok_or_else(|| anyhow!("hub ไม่คืน token"))?.to_string();
            let tunnel_id = v["tunnel_id"].as_str().ok_or_else(|| anyhow!("hub ไม่คืน tunnel_id"))?.to_string();
            return Ok(MachineCreds { tunnel_id, token });
        } else {
            let status = resp.status().as_u16();
            let msg = resp.text().await.unwrap_or_default();
            anyhow::bail!("poll ล้มเหลว (HTTP {status}): {msg}");
        }
    }
}

async fn fetch_manifest_slugs(server: &str, http: &reqwest::Client) -> Vec<String> {
    let Ok(r) = http
        .get(format!("{}/api/manifest", server.trim_end_matches('/')))
        .timeout(Duration::from_secs(10))
        .send()
        .await
    else {
        return vec![];
    };
    let Ok(v) = r.json::<serde_json::Value>().await else {
        return vec![];
    };
    v["slugs"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// Status callback for UIs (desktop app).
pub type StatusCb = std::sync::Arc<dyn Fn(&str) + Send + Sync>;

pub async fn run_tunnel_forever(cfg: TunnelConfig) -> Result<()> {
    let noop: StatusCb = std::sync::Arc::new(|_| {});
    run_tunnel_forever_status(cfg, noop).await
}

/// Dial the hub and keep forwarding HTTP requests to the local server.
/// Announces this machine's event slugs so guests get pretty /e/{slug} URLs.
/// Reconnects forever (2s backoff) — meant to run all night.
pub async fn run_tunnel_forever_status(cfg: TunnelConfig, on_status: StatusCb) -> Result<()> {
    use base64::Engine;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()?;
    let session = resolve_session(&cfg, &http).await?;
    let b64 = base64::engine::general_purpose::STANDARD;

    let base = ws_url(&cfg.relay);
    let url = match &session.token {
        Some(t) => format!("{base}/r/connect/{}?token={t}", session.tunnel_id),
        None => format!("{base}/r/connect/{}", session.tunnel_id),
    };

    println!("◉ CameraSync tunnel — {url}");
    println!("  local server : {}", cfg.server);
    if session.token.is_some() {
        println!("  guest URLs   : <hub>/e/{{slug}}/  (auto from your events)");
    } else {
        println!("  public URL   : <hub>/t/{}/", session.tunnel_id);
    }
    println!("  (reconnects automatically — Ctrl-C to stop)\n");

    loop {
        on_status("กำลังเชื่อมต่อ hub…");
        match tokio_tungstenite::connect_async(&url).await {
            Ok((mut ws, _)) => {
                ws.send(Message::Text(r#"{"register":1}"#.into())).await?;
                println!("  ⇄ connected to hub as '{}'", session.tunnel_id);
                on_status(&format!("เชื่อมต่อแล้ว ({})", session.tunnel_id));

                // announce this machine's events right away, then periodically
                let mut announce = {
                    let slugs = fetch_manifest_slugs(&cfg.server, &http).await;
                    serde_json::json!({ "announce": slugs }).to_string()
                };
                if let Err(e) = ws.send(Message::Text(announce.clone().into())).await {
                    println!("  ↻ announce failed: {e}");
                }
                let mut ticker = tokio::time::interval(Duration::from_secs(60));
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

                loop {
                    tokio::select! {
                        _ = ticker.tick() => {
                            let slugs = fetch_manifest_slugs(&cfg.server, &http).await;
                            announce = serde_json::json!({ "announce": slugs }).to_string();
                            let _ = ws.send(Message::Text(announce.clone().into())).await;
                        }
                        msg = ws.next() => {
                            let msg = match msg {
                                Some(Ok(m)) => m,
                                Some(Err(_)) => break,
                                None => break,
                            };
                            match msg {
                                Message::Text(text) => {
                                    let Ok(req) = serde_json::from_str::<ReqMsg>(&text) else { continue };
                                    let resp = match forward_once(&cfg.server, &http, &req).await {
                                        Ok(r) => r,
                                        Err(e) => RespMsg {
                                            id: req.id,
                                            status: 502,
                                            headers: vec![("content-type".into(), "text/plain".into())],
                                            body: b64.encode(format!("tunnel forward error: {e}")),
                                            error: Some(e.to_string()),
                                        },
                                    };
                                    let Ok(out) = serde_json::to_string(&resp) else { continue };
                                    if ws.send(Message::Text(out.into())).await.is_err() {
                                        break;
                                    }
                                }
                                Message::Ping(p) => {
                                    let _ = ws.send(Message::Pong(p)).await;
                                }
                                Message::Close(_) => break,
                                _ => {}
                            }
                        }
                    }
                }
                println!("  ↻ hub connection closed — retrying in 2s…");
                on_status("หลุดการเชื่อมต่อ — กำลังลองใหม่ใน 2 วินาที…");
            }
            Err(e) => {
                println!("  ↻ cannot reach hub ({e}) — retrying in 2s…");
                on_status("ติดต่อ hub ไม่ได้ — กำลังลองใหม่…");
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

async fn forward_once(server: &str, http: &reqwest::Client, req: &ReqMsg) -> Result<RespMsg> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let url = format!("{}{}", server.trim_end_matches('/'), req.path);
    let method = reqwest::Method::from_bytes(req.method.as_bytes())?;
    let mut builder = http.request(method, &url);
    for (k, v) in &req.headers {
        if let (Ok(name), Ok(value)) = (
            reqwest::header::HeaderName::from_bytes(k.as_bytes()),
            reqwest::header::HeaderValue::from_str(v),
        ) {
            builder = builder.header(name, value);
        }
    }
    if let Some(body) = &req.body {
        builder = builder.body(b64.decode(body)?);
    }
    let resp = builder.timeout(Duration::from_secs(85)).send().await?;
    let status = resp.status().as_u16();
    // strip hop-by-hop headers so the hub can re-frame the response itself
    const HOP: &[&str] = &["connection", "transfer-encoding", "content-length", "keep-alive", "upgrade"];
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .filter_map(|(k, v)| {
            if HOP.contains(&k.as_str()) {
                return None;
            }
            v.to_str()
                .ok()
                .map(|v| (k.as_str().to_string(), v.to_string()))
        })
        .collect();
    let bytes = resp.bytes().await?;
    Ok(RespMsg {
        id: req.id.clone(),
        status,
        headers,
        body: b64.encode(&bytes),
        error: None,
    })
}
