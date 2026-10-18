//! Local folder importer — "เซิร์ฟเวอร์อ่านภาพจากดิสก์เครื่องตัวเอง"
//!
//! `wedsync-server serve --import-dir <folder>` watches a local folder
//! (e.g. the tether-capture folder of Lightroom/Capture One) and ingests
//! every new photo straight into an event — no upload step needed because
//! the disk is already right here.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::photos;
use crate::SharedState;

const SUPPORTED: [&str; 4] = ["jpg", "jpeg", "png", "webp"];

pub async fn resolve_or_create_event(st: &SharedState, event: &Option<String>, dir: &Path) -> anyhow::Result<String> {
    if let Some(key) = event {
        // accept either the event id or its slug
        if let Ok(ev) = crate::events::fetch_event(st, key).await {
            return Ok(ev.id);
        }
        if let Ok(ev) = crate::events::fetch_event_by_slug(st, &key.to_lowercase()).await {
            return Ok(ev.id);
        }
        anyhow::bail!("ไม่พบงาน '{key}' — สร้างก่อนที่หน้า /admin หรือตั้งชื่อใหม่ด้วย --event <id หรือ slug>");
    }
    // no event given → create one named after the folder
    let title = dir
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.to_string())
        .unwrap_or_else(|| "งานแต่งของฉัน".into());
    let created = sqlx::query_scalar::<_, String>(
        "SELECT id FROM events ORDER BY created_at DESC LIMIT 1",
    )
    .fetch_optional(&st.pool)
    .await?;
    let _ = created; // always create a fresh event for an explicit import dir
    let id = crate::util::new_id();
    let base = crate::util::slugify(&title);
    let mut slug = format!("{base}-{}", crate::util::random_suffix(4));
    for _ in 0..5 {
        let taken: Option<(String,)> =
            sqlx::query_as("SELECT slug FROM events WHERE slug = ?1")
                .bind(&slug)
                .fetch_optional(&st.pool)
                .await?;
        if taken.is_none() {
            break;
        }
        slug = format!("{base}-{}", crate::util::random_suffix(5));
    }
    sqlx::query(
        "INSERT INTO events(id, slug, title, partner_a, partner_b, event_date, pin, face_enabled, upload_token, created_at) \
         VALUES (?1,?2,?3,'','','','',1,?4,?5)",
    )
    .bind(&id)
    .bind(&slug)
    .bind(&title)
    .bind(crate::util::random_token())
    .bind(crate::util::now_ms())
    .execute(&st.pool)
    .await?;
    println!("  ✓ สร้างงานใหม่จากโฟลเดอร์: {title} → slug: {slug}");
    Ok(id)
}

pub fn start(st: SharedState, dir: PathBuf, event_id: String) {
    tokio::spawn(async move {
        // initial scan
        if let Err(e) = import_dir(&st, &dir, &event_id).await {
            tracing::error!("import scan failed: {e:#}");
        }
        println!("  ◉ watching folder {} (new photos are ingested automatically)", dir.display());

        // watcher with debounce: coalesce events, then rescan
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if res.is_ok() {
                let _ = tx.send(());
            }
        }) {
            Ok(w) => w,
            Err(e) => {
                tracing::error!("cannot watch folder: {e:#}");
                return;
            }
        };
        use notify::Watcher;
        if let Err(e) = watcher.watch(&dir, notify::RecursiveMode::Recursive) {
            tracing::error!("cannot watch {}: {e:#}", dir.display());
            return;
        }

        loop {
            // wait for first event or periodic rescan every 60s
            if rx.recv_timeout(Duration::from_secs(60)).is_err() {
                // timeout → periodic rescan (also catches files written while offline)
            }
            // debounce burst
            while rx.recv_timeout(Duration::from_millis(1200)).is_ok() {}
            if let Err(e) = import_dir(&st, &dir, &event_id).await {
                tracing::error!("import rescan failed: {e:#}");
            }
        }
    });
}

async fn import_dir(st: &SharedState, dir: &Path, event_id: &str) -> anyhow::Result<()> {
    let files = collect(dir);
    let total = files.len();
    let mut imported = 0usize;
    for path in files {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("photo.jpg")
            .to_string();
        let data = match tokio::fs::read(&path).await {
            Ok(d) => d,
            Err(_) => continue,
        };
        match photos::ingest_bytes(st, event_id, &name, &data).await {
            Ok(true) => imported += 1,
            Ok(false) => {}
            Err(e) => tracing::warn!("skip {name}: {e:?}"),
        }
    }
    if imported > 0 {
        println!("  ↑ imported {imported}/{total} file(s) from {}", dir.display());
        st.queue.notify();
    }
    Ok(())
}

fn collect(dir: &Path) -> Vec<PathBuf> {
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
        let skip = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.') || n.starts_with("._"))
            .unwrap_or(true);
        if skip {
            continue;
        }
        let ok = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| SUPPORTED.iter().any(|x| x.eq_ignore_ascii_case(e)))
            .unwrap_or(false);
        if ok {
            out.push(path.to_path_buf());
        }
    }
    out.sort();
    out
}
