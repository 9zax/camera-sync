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
}

static FTP_INFO: OnceLock<FtpInfo> = OnceLock::new();

/// What the desktop app shows: host:port + credentials for the camera.
pub fn info() -> Option<&'static FtpInfo> {
    FTP_INFO.get()
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
        pass: util::random_suffix(10).to_uppercase(),
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
    let root_for_gen = root.clone();
    let auth = Arc::new(CameraAuth { user: creds.user.clone(), pass: creds.pass.clone() });
    let server = ServerBuilder::with_authenticator(
        Box::new(move || Filesystem::new(&root_for_gen).expect("ftp root exists")),
        auth,
    )
    .passive_ports(50100..=50200)
    .build()?;
    let _ = FTP_INFO.set(FtpInfo {
        port,
        user: creds.user,
        pass: creds.pass,
        dir: root_for_info,
    });
    let lan = crate::util::lan_ip().unwrap_or_else(|| "0.0.0.0".into());
    println!("  ◉ กล้องส่งรูปเข้าได้ผ่าน FTP: {lan}:{port} (โฟลเดอร์รับ: {})", root.display());
    server.listen(format!("0.0.0.0:{port}")).await?;
    Ok(())
}
