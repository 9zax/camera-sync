//! CameraSync agent — watches a folder on the photographer's machine and syncs
//! new photos to a CameraSync event in near real-time.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use clap::{Parser, Subcommand};
use indicatif::{ProgressBar, ProgressStyle};
use serde::{Deserialize, Serialize};

#[derive(Parser)]
#[command(
    name = "wedsync",
    version,
    about = "CameraSync agent — sync a folder of photos to an event (watch or one-shot push)"
)]
struct Cli {
    /// Server base URL, e.g. http://localhost:8080
    #[arg(long, env = "WEDSYNC_SERVER", default_value = "http://localhost:8080", global = true)]
    server: String,

    /// Event id (see `--list-events` when omitted)
    #[arg(long, global = true)]
    event: Option<String>,

    /// Reuse an agent token obtained earlier (alternative to --user/--pass)
    #[arg(long, global = true, conflicts_with_all = &["user", "pass"])]
    token: Option<String>,

    #[arg(long, global = true, requires = "pass")]
    user: Option<String>,

    #[arg(long, global = true, requires = "user")]
    pass: Option<String>,

    /// File extensions to sync (comma separated)
    #[arg(long, value_delimiter = ',', default_value = "jpg,jpeg,png,webp", global = true)]
    ext: Vec<String>,

    /// Relay WebSocket URL for `tunnel` mode, e.g. ws://relay-host:9000
    #[arg(long, env = "WEDSYNC_RELAY", global = true)]
    relay: Option<String>,

    /// Public tunnel id guests will use (/t/<id>/)
    #[arg(long, global = true)]
    id: Option<String>,

    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Sync once and exit
    Push { dir: PathBuf },
    /// Initial sync, then keep watching for new files
    Watch { dir: PathBuf },
    /// Show events available on the server
    ListEvents,
    /// Reverse tunnel: expose the local server through a CameraSync relay so
    /// guests outside can browse without any cloud disk
    Tunnel,
}

#[derive(Serialize, Deserialize, Clone)]
struct FileState {
    mtime_ns: u128,
    size: u64,
    hash: String,
}

type StateMap = HashMap<String, FileState>;

fn main() -> Result<()> {
    let cli = Cli::parse();
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(run(cli))
}

async fn run(cli: Cli) -> Result<()> {
    let server = cli.server.trim_end_matches('/').to_string();
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()?;
    let auth = Auth {
        server: server.clone(),
        token: String::new(),
        http: http.clone(),
    };

    // Tunnel mode needs no credentials — it only forwards HTTP to the local server.
    if let Cmd::Tunnel = cli.cmd {
        let relay = cli
            .relay
            .clone()
            .ok_or_else(|| anyhow!("ต้องระบุ --relay ws://<relay-host>:9000"))?;
        let id = cli
            .id
            .clone()
            .ok_or_else(|| anyhow!("ต้องระบุ --id <tunnel-id> เช่น --id ploy-n-mek"))?;
        return run_tunnel(auth, relay, id).await;
    }

    // Everything else talks to the server API and needs a token.
    let token = match (&cli.token, &cli.user, &cli.pass) {
        (Some(t), _, _) => t.clone(),
        (_, Some(u), Some(p)) => {
            println!("→ signing in as {u} …");
            let resp: serde_json::Value = http
                .post(format!("{server}/api/agent/login"))
                .json(&serde_json::json!({ "username": u, "password": p }))
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            resp["token"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| anyhow!("server did not return a token"))?
        }
        _ => bail!("provide --token TOKEN or --user/--pass (admin credentials)"),
    };
    let auth = Auth { server, token, http };

    match &cli.cmd {
        Cmd::ListEvents => {
            print_events(&auth).await?;
            Ok(())
        }
        Cmd::Tunnel => unreachable!("tunnel mode is handled before auth"),
        Cmd::Push { dir } => {
            let event = resolve_event(&cli, &auth).await?;
            let st = load_state(&auth, &event, dir);
            let mut st = st;
            push_dir(&auth, &event, &cli.ext, dir, &mut st, true).await?;
            save_state(&auth, &event, dir, &st)?;
            println!("✓ push complete");
            Ok(())
        }
        Cmd::Watch { dir } => {
            let event = resolve_event(&cli, &auth).await?;
            let mut st = load_state(&auth, &event, dir);
            println!(
                "◉ CameraSync agent — watching {} → event {}\n  (Ctrl-C to stop)\n",
                dir.display(),
                &event[..event.len().min(8)]
            );
            push_dir(&auth, &event, &cli.ext, dir, &mut st, true).await?;
            save_state(&auth, &event, dir, &st)?;

            let (tx, rx) = mpsc::channel();
            let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                if let Ok(ev) = res {
                    let _ = tx.send(ev);
                }
            })
            .context("creating file watcher")?;
            use notify::Watcher;
            watcher
                .watch(dir, notify::RecursiveMode::Recursive)
                .with_context(|| format!("watching {}", dir.display()))?;

            loop {
                // Drain events for a moment to coalesce bursts, then rescan.
                rx.recv().map_err(|_| anyhow!("watcher channel closed"))?;
                loop {
                    match rx.recv_timeout(Duration::from_millis(800)) {
                        Ok(_) => continue,
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            bail!("watcher channel closed")
                        }
                    }
                }
                push_dir(&auth, &event, &cli.ext, dir, &mut st, false).await?;
                save_state(&auth, &event, dir, &st)?;
            }
        }
    }
}

struct Auth {
    server: String,
    token: String,
    http: reqwest::Client,
}

// ---- reverse tunnel ----

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ReqMsg {
    id: String,
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    #[serde(default)]
    body: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct RespMsg {
    id: String,
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
    #[serde(default)]
    error: Option<String>,
}

/// Dial the relay and keep forwarding HTTP requests to the local server.
/// Reconnects forever (2s backoff) so it can stay running all night.
async fn run_tunnel(auth: Auth, relay: String, id: String) -> Result<()> {
    use base64::Engine;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    let mut relay_url = relay.trim().to_string();
    if relay_url.starts_with("http://") {
        relay_url = relay_url.replacen("http://", "ws://", 1);
    } else if relay_url.starts_with("https://") {
        relay_url = relay_url.replacen("https://", "wss://", 1);
    }
    while relay_url.ends_with('/') {
        relay_url.pop();
    }
    let url = format!("{relay_url}/r/connect/{id}");
    let b64 = base64::engine::general_purpose::STANDARD;

    println!("◉ CameraSync tunnel — {url}");
    println!("  local server : {}", auth.server);
    println!("  public URL   : <relay>/t/{id}/");
    println!("  (reconnects automatically — Ctrl-C to stop)\n");

    loop {
        match tokio_tungstenite::connect_async(&url).await {
            Ok((mut ws, _)) => {
                ws.send(Message::Text(r#"{"register":1}"#.into())).await?;
                println!("  ⇄ connected to relay as '{id}'");
                while let Some(msg) = ws.next().await {
                    let msg = match msg {
                        Ok(m) => m,
                        Err(e) => return Err(anyhow!("tunnel stream error: {e}")),
                    };
                    match msg {
                        Message::Text(text) => {
                            let Ok(req) = serde_json::from_str::<ReqMsg>(&text) else { continue };
                            let resp = forward_once(&auth, &req).await;
                            let payload = match resp {
                                Ok(r) => r,
                                Err(e) => RespMsg {
                                    id: req.id,
                                    status: 502,
                                    headers: vec![("content-type".into(), "text/plain".into())],
                                    body: b64.encode(format!("tunnel forward error: {e}")),
                                    error: Some(e.to_string()),
                                },
                            };
                            let Ok(out) = serde_json::to_string(&payload) else { continue };
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
                println!("  ↻ relay connection closed — retrying in 2s…");
            }
            Err(e) => {
                println!("  ↻ cannot reach relay ({e}) — retrying in 2s…");
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

async fn forward_once(auth: &Auth, req: &ReqMsg) -> anyhow::Result<RespMsg> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let url = format!("{}{}", auth.server.trim_end_matches('/'), req.path);
    let method = reqwest::Method::from_bytes(req.method.as_bytes())?;
    let mut builder = auth.http.request(method, &url);
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
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_string(), v.to_string())))
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

async fn print_events(auth: &Auth) -> Result<()> {
    let events: serde_json::Value = auth
        .http
        .get(format!("{}/api/events", auth.server))
        .bearer_auth(&auth.token)
        .send()
        .await
        .map_err(|e| anyhow!("connecting to {}: {e}", auth.server))?
        .error_for_status()
        .map_err(|e| {
            if e.status() == Some(reqwest::StatusCode::UNAUTHORIZED) {
                anyhow!("token นี้ไม่มีสิทธิ์ดูรายการงาน — ใช้ --user/--pass (บัญชีผู้ดูแล) เพื่อดูรายการงานทั้งหมด")
            } else {
                anyhow!(e)
            }
        })?
        .json()
        .await?;
    println!("{:<38} {:<24} {}", "EVENT ID", "SLUG", "TITLE");
    for e in events.as_array().unwrap_or(&vec![]) {
        println!(
            "{:<38} {:<24} {}",
            e["id"].as_str().unwrap_or("?"),
            e["slug"].as_str().unwrap_or("?"),
            e["title"].as_str().unwrap_or("?")
        );
    }
    Ok(())
}

async fn resolve_event(cli: &Cli, auth: &Auth) -> Result<String> {
    match &cli.event {
        Some(e) => Ok(e.clone()),
        None => {
            println!("--event is missing — events on this server:\n");
            print_events(auth).await?;
            bail!("\npick one and re-run with --event <id>")
        }
    }
}

fn state_path(auth: &Auth, event: &str, dir: &Path) -> PathBuf {
    let key = format!("{}|{}|{}", auth.server, event, dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf()).display());
    let hash = blake3::hash(key.as_bytes()).to_hex().to_string();
    let base = dirs::home_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join(".wedsync");
    let _ = std::fs::create_dir_all(&base);
    base.join(format!("state-{hash}.json"))
}

fn load_state(auth: &Auth, event: &str, dir: &Path) -> StateMap {
    let path = state_path(auth, event, dir);
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_state(auth: &Auth, event: &str, dir: &Path, st: &StateMap) -> Result<()> {
    let path = state_path(auth, event, dir);
    // best-effort persist; losing it only causes re-uploads (server dedups by hash)
    if let Err(e) = std::fs::write(&path, serde_json::to_string(st)?) {
        eprintln!("warn: cannot save state: {e}");
    }
    Ok(())
}

fn collect_files(dir: &Path, exts: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.') || n.starts_with("._"))
            .unwrap_or(true)
        {
            continue;
        }
        let matches_ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| exts.iter().any(|x| x.eq_ignore_ascii_case(e)))
            .unwrap_or(false);
        if matches_ext {
            out.push(path.to_path_buf());
        }
    }
    out.sort();
    out
}

fn file_hash(path: &Path) -> Result<String> {
    let mut hasher = blake3::Hasher::new();
    let mut file = std::fs::File::open(path)?;
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hasher.finalize().to_hex().to_string())
}

async fn push_dir(
    auth: &Auth,
    event: &str,
    exts: &[String],
    dir: &Path,
    st: &mut StateMap,
    show_bar: bool,
) -> Result<()> {
    let files = collect_files(dir, exts);
    // Determine candidates without hashing (cheap metadata check first).
    let mut candidates: Vec<(PathBuf, u128, u64)> = Vec::new();
    for path in &files {
        let rel = rel_key(dir, path);
        let Ok(meta) = std::fs::metadata(path) else { continue };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let size = meta.len();
        let skip = st.get(&rel).map(|s| s.mtime_ns == mtime && s.size == size).unwrap_or(false);
        if !skip {
            candidates.push((path.clone(), mtime, size));
        }
    }
    if candidates.is_empty() {
        return Ok(());
    }

    let pb = if show_bar && candidates.len() > 1 {
        let pb = ProgressBar::new(candidates.len() as u64);
        pb.set_style(
            ProgressStyle::with_template("{spinner:.green} {pos}/{len} [{bar:36.cyan/blue}] {msg}")
                .unwrap()
                .progress_chars("##-"),
        );
        pb
    } else {
        ProgressBar::hidden()
    };

    let mut uploaded = 0u64;
    let mut errors = 0u64;
    for (path, mtime, size) in candidates {
        let rel = rel_key(dir, &path);
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("photo.jpg")
            .to_string();
        pb.set_message(name.clone());
        match upload_one(auth, event, &path, &name, size).await {
            Ok(dup) => {
                uploaded += 1;
                let hash = match tokio::task::spawn_blocking(move || file_hash(&path)).await {
                    Ok(Ok(h)) => h,
                    _ => String::new(),
                };
                st.insert(
                    rel,
                    FileState {
                        mtime_ns: mtime,
                        size,
                        hash,
                    },
                );
                if !dup && !show_bar {
                    println!("  ↑ {} ({})", name, human_bytes(size));
                }
            }
            Err(e) => {
                errors += 1;
                eprintln!("  ✗ {name}: {e:#}");
            }
        }
        pb.inc(1);
    }
    pb.finish_and_clear();
    if uploaded > 0 || errors > 0 {
        println!("→ synced {uploaded} file(s), {errors} error(s)");
    }
    Ok(())
}

/// Returns Ok(true) when the server already had this file (duplicate).
async fn upload_one(auth: &Auth, event: &str, path: &Path, name: &str, size: u64) -> Result<bool> {
    let file = tokio::fs::File::open(path)
        .await
        .with_context(|| format!("opening {}", path.display()))?;
    let stream = tokio_util::io::ReaderStream::new(file);
    let body = reqwest::Body::wrap_stream(stream);
    let part = reqwest::multipart::Part::stream_with_length(body, size)
        .file_name(name.to_string())
        .mime_str("application/octet-stream")?;
    let form = reqwest::multipart::Form::new().part("file", part);
    let resp: serde_json::Value = auth
        .http
        .post(format!("{}/api/events/{}/photos", auth.server, event))
        .bearer_auth(&auth.token)
        .multipart(form)
        .timeout(Duration::from_secs(600))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(resp["duplicated"].as_i64().unwrap_or(0) > 0 && resp["uploaded"].as_i64() == Some(0))
}

fn rel_key(dir: &Path, path: &Path) -> String {
    path.strip_prefix(dir)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

fn human_bytes(n: u64) -> String {
    if n >= 1024 * 1024 {
        format!("{:.1} MB", n as f64 / 1_048_576.0)
    } else if n >= 1024 {
        format!("{:.0} KB", n as f64 / 1024.0)
    } else {
        format!("{n} B")
    }
}
