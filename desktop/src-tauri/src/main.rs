//! CameraSync desktop app (Tauri) — zero-input UX
//!
//! เปิดแอป = เซิร์ฟเวอร์เริ่มเอง (รูปอยู่เครื่องนี้ทั้งหมด) เหลือแค่กดปุ่มเดียว
//! "เข้าสู่ระบบด้วย LINE" แล้วระบบต่อ hub + แสดงลิงก์แขกให้ทันที

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, OnceLock, RwLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
fn rt() -> &'static tokio::runtime::Runtime {
    RUNTIME.get_or_init(|| tokio::runtime::Runtime::new().expect("create tokio runtime"))
}

fn home() -> std::path::PathBuf {
    std::env::var("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn default_data_dir() -> std::path::PathBuf {
    home().join(".camerasync")
}

fn default_import_dir() -> std::path::PathBuf {
    home().join("Pictures").join("CameraSync-Inbox")
}

#[derive(Default)]
struct App {
    port: RwLock<Option<u16>>,
    hub_url: RwLock<String>,
    tunnel_status: RwLock<String>,
    line_user: RwLock<String>,
}

#[derive(Serialize)]
struct EventLink {
    slug: String,
    title: String,
}

#[derive(Serialize)]
struct Status {
    server_running: bool,
    port: Option<u16>,
    hub_url: String,
    tunnel_status: String,
    line_user: String,
    events: Vec<EventLink>,
    guest_base: String,
    local_admin: Option<(String, String)>,
    import_dir: String,
}

impl App {
    fn hub(&self) -> String {
        let h = self.hub_url.read().unwrap().clone();
        if h.is_empty() {
            wedsync_server::default_hub()
        } else {
            h
        }
    }
}

fn guest_base(hub: &str) -> String {
    let mut base = hub
        .trim()
        .replacen("wss://", "https://", 1)
        .replacen("ws://", "http://", 1);
    while base.ends_with('/') {
        base.pop();
    }
    base
}

async fn collect_events() -> Vec<EventLink> {
    let Some(st) = wedsync_server::server_state() else {
        return vec![];
    };
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT slug, title FROM events ORDER BY created_at DESC")
            .fetch_all(&st.pool)
            .await
            .unwrap_or_default();
    rows.into_iter()
        .map(|(slug, title)| EventLink { slug, title })
        .collect()
}

fn read_local_admin() -> Option<(String, String)> {
    let s = std::fs::read_to_string(default_data_dir().join("local-admin.txt")).ok()?;
    let mut it = s.trim().splitn(2, " / ");
    let u = it.next()?.to_string();
    let p = it.next()?.trim().to_string();
    if u.is_empty() || p.is_empty() {
        None
    } else {
        Some((u, p))
    }
}

#[tauri::command]
async fn get_status(app: State<'_, App>) -> Result<Status, String> {
    let port = *app.port.read().unwrap();
    let hub = app.hub();
    let tunnel = {
        let t = app.tunnel_status.read().unwrap().clone();
        if t.is_empty() { "ยังไม่เชื่อมต่อ".to_string() } else { t }
    };
    let line_user = app.line_user.read().unwrap().clone();
    let events = collect_events().await;
    let admin = read_local_admin();
    Ok(Status {
        server_running: port.is_some(),
        port,
        tunnel_status: tunnel,
        line_user,
        hub_url: hub.clone(),
        events,
        guest_base: guest_base(&hub),
        local_admin: admin,
        import_dir: default_import_dir().display().to_string(),
    })
}

#[tauri::command]
async fn line_login(app: AppHandle, state: State<'_, App>) -> Result<String, String> {
    let hub = state.hub();
    let (state_key, url) = wedsync_agent::line_login_begin(&hub)
        .await
        .map_err(|e| format!("เริ่ม LINE Login ไม่สำเร็จ: {e}"))?;
    *state.hub_url.write().unwrap() = hub;
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(state_key)
}

#[tauri::command]
async fn line_connect(app: AppHandle, state: State<'_, App>, state_key: String) -> Result<String, String> {
    let port = *state.port.read().unwrap();
    let Some(port) = port else {
        return Err("เซิร์ฟเวอร์กำลังเริ่มต้น ลองอีกครั้งในสักครู่".into());
    };
    let hub = state.hub();
    *state.hub_url.write().unwrap() = hub.clone();
    *state.tunnel_status.write().unwrap() = "รอยืนยันใน LINE…".into();

    let creds = wedsync_agent::line_login_wait(&hub, &state_key)
        .await
        .map_err(|e| format!("LINE Login ไม่สำเร็จ: {e}"))?;

    *state.line_user.write().unwrap() = creds.tunnel_id.clone();
    *state.tunnel_status.write().unwrap() = "กำลังเชื่อมต่อ hub…".into();

    let cfg = wedsync_agent::TunnelConfig {
        server: format!("http://localhost:{port}"),
        relay: hub,
        id: None,
        user: None,
        pass: None,
        machine: Some(creds.clone()),
    };
    let app_handle = app.clone();
    let status_cb: wedsync_agent::StatusCb = Arc::new(move |s: &str| {
        if let Some(state) = app_handle.try_state::<App>() {
            *state.tunnel_status.write().unwrap() = s.to_string();
        }
        let _ = app_handle.emit("tunnel-status", s);
    });
    rt().spawn(async move {
        if let Err(e) = wedsync_agent::run_tunnel_forever_status(cfg, status_cb).await {
            eprintln!("tunnel stopped: {e:#}");
        }
    });
    Ok(creds.tunnel_id)
}

#[tauri::command]
async fn add_photo_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |file| {
        let _ = tx.send(file.map(|p| p.to_string()));
    });
    let folder: Option<String> = rx.await.map_err(|e| e.to_string())?;
    let Some(folder) = folder else {
        return Ok(None);
    };
    wedsync_server::add_import_dir(folder.clone().into(), None)
        .await
        .map_err(|e| format!("เพิ่มโฟลเดอร์ไม่สำเร็จ: {e}"))?;
    Ok(Some(folder))
}

#[tauri::command]
fn open_in_browser(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(App::default())
        .setup(|app| {
            let handle = app.handle().clone();
            // auto-start the embedded photo-drive server (zero-input)
            rt().spawn(async move {
                let mut port = None;
                for p in 8080..8090 {
                    if std::net::TcpListener::bind(("127.0.0.1", p)).is_ok() {
                        port = Some(p);
                        break;
                    }
                }
                let Some(port) = port else {
                    eprintln!("no free port 8080-8089");
                    return;
                };
                if let Some(state) = handle.try_state::<App>() {
                    *state.port.write().unwrap() = Some(port);
                }
                let import = default_import_dir();
                std::fs::create_dir_all(&import).ok();
                if let Err(e) =
                    wedsync_server::run_server(default_data_dir(), port, Some(import), None).await
                {
                    eprintln!("server stopped: {e:#}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            line_login,
            line_connect,
            add_photo_folder,
            open_in_browser,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CameraSync desktop");
}
