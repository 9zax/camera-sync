//! CameraSync desktop app (Tauri) — zero-input UX
//!
//! เปิดแอป = เซิร์ฟเวอร์เริ่มเอง (รูปอยู่เครื่องนี้ทั้งหมด) เหลือแค่กดปุ่มเดียว
//! "เข้าสู่ระบบด้วย LINE" แล้วระบบต่อ hub + แสดงลิงก์แขกให้ทันที

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, OnceLock, RwLock};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};

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
    tunnel_task: RwLock<Option<tokio::task::JoinHandle<()>>>,
}

#[derive(Serialize)]
struct EventLink {
    id: String,
    slug: String,
    title: String,
    enabled: bool,
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
    face_state: String, // ready | loading | unavailable
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

// ---- persisted LINE machine session (token valid 90 days on the hub) ----

fn machine_session_path() -> std::path::PathBuf {
    default_data_dir().join("machine-session.json")
}

fn save_machine_session(creds: &wedsync_agent::MachineCreds) {
    let res = (|| -> std::io::Result<()> {
        use std::io::Write;
        std::fs::create_dir_all(default_data_dir())?;
        let json = serde_json::to_vec(creds)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        #[cfg(unix)]
        let mut opts = {
            use std::os::unix::fs::OpenOptionsExt;
            let mut o = std::fs::OpenOptions::new();
            o.mode(0o600);
            o
        };
        #[cfg(not(unix))]
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        opts.open(machine_session_path())?.write_all(&json)?;
        Ok(())
    })();
    if let Err(e) = res {
        eprintln!("save machine session failed: {e}");
    }
}

fn read_machine_session() -> Option<wedsync_agent::MachineCreds> {
    serde_json::from_slice(&std::fs::read(machine_session_path()).ok()?).ok()
}

fn clear_machine_session() {
    let _ = std::fs::remove_file(machine_session_path());
}

/// Start (or restart) the hub tunnel with the given machine credentials.
/// Shared by fresh LINE logins and the auto-reconnect on app launch.
fn start_tunnel_task(app: &tauri::AppHandle, hub: String, port: u16, creds: wedsync_agent::MachineCreds) {
    let state = app.state::<App>();
    if let Some(prev) = state.tunnel_task.write().unwrap().take() {
        prev.abort();
    }
    *state.hub_url.write().unwrap() = hub.clone();
    *state.line_user.write().unwrap() = creds.tunnel_id.clone();
    *state.tunnel_status.write().unwrap() = "กำลังเชื่อมต่อ hub…".into();
    let cfg = wedsync_agent::TunnelConfig {
        server: format!("http://localhost:{port}"),
        relay: hub,
        id: None,
        user: None,
        pass: None,
        machine: Some(creds),
    };
    let app_handle = app.clone();
    let status_cb: wedsync_agent::StatusCb = {
        let app_handle = app_handle.clone();
        Arc::new(move |s: &str| {
            if let Some(state) = app_handle.try_state::<App>() {
                *state.tunnel_status.write().unwrap() = s.to_string();
            }
            let _ = app_handle.emit("tunnel-status", s);
        })
    };
    let handle = rt().spawn(async move {
        if let Err(e) = wedsync_agent::run_tunnel_forever_status(cfg, status_cb).await {
            eprintln!("tunnel stopped: {e:#}");
            let _ = app_handle.emit("tunnel-status", &format!("เชื่อมต่อไม่สำเร็จ: {e}"));
        }
    });
    *state.tunnel_task.write().unwrap() = Some(handle);
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
    let rows: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT id, slug, title, COALESCE(enabled, 1) FROM events ORDER BY created_at DESC",
    )
    .fetch_all(&st.pool)
    .await
    .unwrap_or_default();
    rows.into_iter()
        .map(|(id, slug, title, enabled)| EventLink {
            id,
            slug,
            title,
            enabled: enabled != 0,
        })
        .collect()
}

fn read_local_admin() -> Option<(String, String)> {
    let dir = default_data_dir();
    // .env (ADMIN_USER / ADMIN_PASS) is the source of truth; legacy txt as fallback
    if let Ok(text) = std::fs::read_to_string(dir.join(".env")) {
        let mut user = None;
        let mut pass = None;
        for line in text.lines() {
            let line = line.trim();
            if let Some(v) = line.strip_prefix("ADMIN_USER=") {
                user = Some(v.trim().to_string()).filter(|v| !v.is_empty());
            } else if let Some(v) = line.strip_prefix("ADMIN_PASS=") {
                pass = Some(v.trim().to_string()).filter(|v| !v.is_empty());
            }
        }
        if let (Some(u), Some(p)) = (user, pass) {
            return Some((u, p));
        }
    }
    let s = std::fs::read_to_string(dir.join("local-admin.txt")).ok()?;
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
    let face_state = match wedsync_server::server_state() {
        Some(st) => match st.face_engine.get() {
            Some(wedsync_server::faces::EngineState::Ready(_)) => "ready",
            Some(wedsync_server::faces::EngineState::Unavailable) => "unavailable",
            _ => "loading",
        },
        None => "loading",
    }
    .to_string();
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
        face_state,
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

    // remember the machine token so reopening the app reconnects silently
    save_machine_session(&creds);
    start_tunnel_task(&app, hub, port, creds.clone());
    Ok(creds.tunnel_id)
}

#[tauri::command]
async fn rename_event(id: String, title: String) -> Result<(), String> {
    let st = server_state_or_err()?;
    wedsync_server::events::rename_event(&st, &id, &title)
        .await
        .map_err(|e| format!("เปลี่ยนชื่อไม่สำเร็จ: {e:?}"))?;
    Ok(())
}

#[tauri::command]
fn line_logout(app: AppHandle, state: State<'_, App>) -> Result<(), String> {
    if let Some(t) = state.tunnel_task.write().unwrap().take() {
        t.abort();
    }
    clear_machine_session();
    *state.line_user.write().unwrap() = String::new();
    *state.tunnel_status.write().unwrap() = "ยังไม่เชื่อมต่อ".into();
    let _ = app.emit("tunnel-status", "ยังไม่เชื่อมต่อ");
    Ok(())
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

fn server_state_or_err() -> Result<wedsync_server::SharedState, String> {
    wedsync_server::server_state().ok_or_else(|| "เซิร์ฟเวอร์ยังไม่พร้อม ลองอีกครั้งในสักครู่".into())
}

#[tauri::command]
async fn delete_event(id: String) -> Result<(), String> {
    let st = server_state_or_err()?;
    wedsync_server::events::delete_event(&st, &id)
        .await
        .map_err(|e| format!("ลบงานไม่สำเร็จ: {e:?}"))?;
    Ok(())
}

#[tauri::command]
async fn set_event_enabled(id: String, enabled: bool) -> Result<(), String> {
    let st = server_state_or_err()?;
    wedsync_server::events::set_event_enabled(&st, &id, enabled)
        .await
        .map_err(|e| format!("เปลี่ยนสถานะไม่สำเร็จ: {e:?}"))?;
    Ok(())
}

fn guest_url(hub: &str, slug: &str) -> String {
    format!("{}/e/{}", guest_base(hub), slug)
}

/// QR PNG (720px) for a guest link — base64 so the webview can show it
/// directly as a data URL and we can reuse the bytes for "save".
fn qr_png_bytes(url: &str) -> Result<Vec<u8>, String> {
    let code = qrcode::QrCode::with_error_correction_level(url.as_bytes(), qrcode::EcLevel::M)
        .map_err(|e| format!("สร้าง QR ไม่สำเร็จ: {e}"))?;
    let img = code
        .render::<image::Rgba<u8>>()
        .min_dimensions(720, 720)
        .quiet_zone(true)
        .dark_color(image::Rgba([28, 22, 18, 255]))
        .light_color(image::Rgba([255, 252, 246, 255]))
        .build();
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("เข้ารหัส PNG ไม่สำเร็จ: {e}"))?;
    Ok(buf.into_inner())
}

#[tauri::command]
fn guest_qr(app: State<'_, App>, slug: String) -> Result<String, String> {
    let url = guest_url(&app.hub(), &slug);
    let bytes = qr_png_bytes(&url)?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
async fn save_qr(app: AppHandle, state: State<'_, App>, slug: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let default_name = format!("CameraSync-{slug}-qr.png");
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("PNG image", &["png"])
        .save_file(move |file| {
            let _ = tx.send(file.map(|p| p.to_string()));
        });
    let Some(path): Option<String> = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let url = guest_url(&state.hub(), &slug);
    let bytes = qr_png_bytes(&url)?;
    let saved = path.clone();
    tokio::task::spawn_blocking(move || std::fs::write(&saved, bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("บันทึกไฟล์ไม่สำเร็จ: {e}"))?;
    Ok(Some(path))
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Menu-bar presence: the app is LSUIElement (no dock icon), so the tray is
/// the only way back in after the window is closed — and a quick status peek
/// without opening anything.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "เปิดหน้าต่าง CameraSync", true, None::<&str>)?;
    let admin = MenuItem::with_id(app, "admin", "เปิดหน้าเว็บแอดมิน", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "ปิดโปรแกรม (เซิร์ฟเวอร์จะหยุด)", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &admin, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("CameraSync — เครื่องช่างภาพ (เซิร์ฟเวอร์ทำงานอยู่เบื้องหลัง)")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "admin" => {
                let port = app
                    .try_state::<App>()
                    .and_then(|s| *s.port.read().unwrap())
                    .unwrap_or(8080);
                use tauri_plugin_opener::OpenerExt;
                let _ = app.opener().open_url(format!("http://localhost:{port}/admin"), None::<&str>);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(App::default())
        .setup(|app| {
            build_tray(app)?;
            let handle = app.handle().clone();
            // auto-start the embedded photo-drive server (zero-input)
            let server_handle = handle.clone();
            rt().spawn(async move {
                let mut port = None;
                for p in 8080..8090 {
                    if std::net::TcpListener::bind(("127.0.0.1", p)).is_ok() {
                        port = Some(p);
                        break;
                    }
                }
                let Some(port) = port else {
                    eprintln!("no free port 8080-8090");
                    return;
                };
                if let Some(state) = server_handle.try_state::<App>() {
                    *state.port.write().unwrap() = Some(port);
                }
                // reconnect with the saved LINE machine session (if any) as
                // soon as the local server is actually accepting connections
                let tunnel_handle = server_handle.clone();
                rt().spawn(async move {
                    for _ in 0..120 {
                        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    }
                    // replay import folders the photographer added earlier
                    wedsync_server::start_saved_imports().await;
                    let Some(creds) = read_machine_session() else {
                        return;
                    };
                    let hub = wedsync_server::default_hub();
                    if let Some(state) = tunnel_handle.try_state::<App>() {
                        *state.tunnel_status.write().unwrap() =
                            "เชื่อมต่ออัตโนมัติด้วยบัญชี LINE ที่บันทึกไว้…".into();
                    }
                    let _ = tunnel_handle.emit("tunnel-status", "กำลังเชื่อมต่อ hub…");
                    start_tunnel_task(&tunnel_handle, hub, port, creds);
                    // watchdog: if the saved token never connects (expired /
                    // revoked), clear it so the login button comes back
                    let watch = tunnel_handle.clone();
                    rt().spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(25)).await;
                        if let Some(state) = watch.try_state::<App>() {
                            let ok = state
                                .tunnel_status
                                .read()
                                .unwrap()
                                .contains("เชื่อมต่อแล้ว");
                            if !ok {
                                clear_machine_session();
                                *state.line_user.write().unwrap() = String::new();
                                *state.tunnel_status.write().unwrap() =
                                    "บัญชี LINE ที่บันทึกไว้ใช้ไม่ได้แล้ว — ล็อกอินใหม่อีกครั้ง".into();
                                let _ = watch.emit(
                                    "tunnel-status",
                                    "บัญชี LINE ที่บันทึกไว้ใช้ไม่ได้แล้ว — ล็อกอินใหม่อีกครั้ง",
                                );
                            }
                        }
                    });
                });
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
            line_logout,
            add_photo_folder,
            open_in_browser,
            delete_event,
            set_event_enabled,
            rename_event,
            guest_qr,
            save_qr,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CameraSync desktop");
}
