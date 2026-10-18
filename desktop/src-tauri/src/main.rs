//! CameraSync desktop app (Tauri)
//!
//! หลักการ: เครื่องช่างภาพ = ที่เก็บรูปทั้งหมด (disk ตัวเอง เปิดไว้ตลอด)
//! App นี้ embed photo-drive server ทั้งตัวไว้ในเครื่อง + เชื่อม tunnel ไป hub
//! ของระบบเรา — hub ดึงภาพจากเครื่องนี้แบบ realtime โดยไม่เก็บภาพบน hub เด็ดขาด

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, OnceLock, RwLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
fn rt() -> &'static tokio::runtime::Runtime {
    RUNTIME.get_or_init(|| tokio::runtime::Runtime::new().expect("create tokio runtime"))
}

fn default_data_dir() -> std::path::PathBuf {
    std::env::var("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(".camerasync")
}

#[derive(Default)]
struct App {
    port: RwLock<Option<u16>>,
    import_dir: RwLock<Option<String>>,
    data_dir: RwLock<String>,
    hub_url: RwLock<String>,
    hub_user: RwLock<String>,
    tunnel_status: RwLock<String>,
}

impl App {
    fn data_path(&self) -> std::path::PathBuf {
        let dir = self.data_dir.read().unwrap().clone();
        if dir.is_empty() {
            default_data_dir()
        } else {
            std::path::PathBuf::from(dir)
        }
    }
}

#[derive(Serialize)]
struct Status {
    server_running: bool,
    port: Option<u16>,
    data_dir: String,
    import_dir: Option<String>,
    hub_url: String,
    hub_user: String,
    tunnel_status: String,
    local_url: Option<String>,
}

#[tauri::command]
fn get_status(app: State<'_, App>) -> Status {
    let port = *app.port.read().unwrap();
    let import = app.import_dir.read().unwrap().clone();
    let data = app.data_dir.read().unwrap().clone();
    let hub = app.hub_url.read().unwrap().clone();
    let user = app.hub_user.read().unwrap().clone();
    let tunnel = app.tunnel_status.read().unwrap().clone();
    Status {
        server_running: port.is_some(),
        port,
        data_dir: if data.is_empty() {
            default_data_dir().display().to_string()
        } else {
            data
        },
        import_dir: import,
        hub_url: hub,
        hub_user: user,
        tunnel_status: if tunnel.is_empty() { "ยังไม่เชื่อมต่อ".into() } else { tunnel },
        local_url: port.map(|p| format!("http://localhost:{p}")),
    }
}

#[tauri::command]
fn pick_import_folder(app: AppHandle, state: State<'_, App>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|p| p.to_string());
    if let Some(ref f) = folder {
        *state.import_dir.write().unwrap() = Some(f.clone());
    }
    folder
}

#[tauri::command]
fn start_server(app: State<'_, App>, import_dir: Option<String>) -> Result<u16, String> {
    if app.port.read().unwrap().is_some() {
        return Err("เซิร์ฟเวอร์กำลังทำงานอยู่แล้ว".into());
    }
    if let Some(ref d) = import_dir {
        *app.import_dir.write().unwrap() = Some(d.clone());
    }
    // pick a free port between 8080–8089
    let mut port = None;
    for p in 8080..8090 {
        if std::net::TcpListener::bind(("127.0.0.1", p)).is_ok() {
            port = Some(p);
            break;
        }
    }
    let port = port.ok_or_else(|| "หาพอร์ตว่าง (8080–8089) ไม่ได้".to_string())?;
    *app.port.write().unwrap() = Some(port);

    let data_dir = app.data_path();
    rt().spawn(async move {
        if let Err(e) = wedsync_server::run_server(data_dir, port, import_dir.map(Into::into), None).await {
            eprintln!("server stopped: {e:#}");
        }
    });
    Ok(port)
}

#[derive(serde::Deserialize)]
struct HubParams {
    url: String,
    user: String,
    pass: String,
}

#[tauri::command]
async fn register_hub(app: State<'_, App>, params: HubParams) -> Result<String, String> {
    let r = wedsync_agent::hub_register(&params.url, &params.user, &params.pass)
        .await
        .map_err(|e| format!("สมัครไม่สำเร็จ: {e}"))?;
    *app.hub_url.write().unwrap() = params.url;
    *app.hub_user.write().unwrap() = params.user;
    Ok(r)
}

#[tauri::command]
async fn connect_hub(app: State<'_, App>, params: HubParams) -> Result<String, String> {
    let port = *app.port.read().unwrap();
    let Some(port) = port else {
        return Err("เริ่มเซิร์ฟเวอร์ในเครื่องก่อน (กดปุ่มเริ่มด้านบน)".into());
    };
    // fail fast on bad credentials
    let tunnel_id = wedsync_agent::hub_validate(&params.url, &params.user, &params.pass)
        .await
        .map_err(|e| format!("ล็อกอิน hub ไม่สำเร็จ: {e}"))?;

    *app.hub_url.write().unwrap() = params.url.clone();
    *app.hub_user.write().unwrap() = params.user.clone();
    *app.tunnel_status.write().unwrap() = "กำลังเชื่อมต่อ hub…".into();

    let cfg = wedsync_agent::TunnelConfig {
        server: format!("http://localhost:{port}"),
        relay: params.url,
        id: None,
        user: Some(params.user),
        pass: Some(params.pass),
        machine: None,
    };
    rt().spawn(async move {
        let status_cb: wedsync_agent::StatusCb = Arc::new(|_| {});
        if let Err(e) = wedsync_agent::run_tunnel_forever_status(cfg, status_cb).await {
            eprintln!("tunnel stopped: {e:#}");
        }
    });
    Ok(tunnel_id)
}

#[tauri::command]
async fn line_login(app: AppHandle, state: State<'_, App>, hub_url: String) -> Result<String, String> {
    let (state_key, url) = wedsync_agent::line_login_begin(&hub_url)
        .await
        .map_err(|e| format!("เริ่ม LINE Login ไม่สำเร็จ: {e}"))?;
    *state.hub_url.write().unwrap() = hub_url;
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(state_key)
}

#[tauri::command]
async fn line_connect(app: State<'_, App>, state_key: String) -> Result<String, String> {
    let port = *app.port.read().unwrap();
    let Some(port) = port else {
        return Err("เริ่มเซิร์ฟเวอร์ในเครื่องก่อน (กดปุ่มเริ่มด้านบน)".into());
    };
    let hub_url = app.hub_url.read().unwrap().clone();
    *app.tunnel_status.write().unwrap() = "รอยืนยันใน LINE…".into();

    let creds = wedsync_agent::line_login_wait(&hub_url, &state_key)
        .await
        .map_err(|e| format!("LINE Login ไม่สำเร็จ: {e}"))?;

    let cfg = wedsync_agent::TunnelConfig {
        server: format!("http://localhost:{port}"),
        relay: hub_url,
        id: None,
        user: None,
        pass: None,
        machine: Some(creds.clone()),
    };
    *app.tunnel_status.write().unwrap() = "กำลังเชื่อมต่อ hub…".into();
    rt().spawn(async move {
        let status_cb: wedsync_agent::StatusCb = Arc::new(|_| {});
        if let Err(e) = wedsync_agent::run_tunnel_forever_status(cfg, status_cb).await {
            eprintln!("tunnel stopped: {e:#}");
        }
    });
    Ok(creds.tunnel_id)
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
        .invoke_handler(tauri::generate_handler![
            get_status,
            pick_import_folder,
            start_server,
            register_hub,
            connect_hub,
            line_login,
            line_connect,
            open_in_browser,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CameraSync desktop");
}
