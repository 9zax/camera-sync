//! Background pipeline: original -> (thumb, web) -> face index.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use image::imageops::FilterType;
use image::DynamicImage;
use tokio::sync::Notify;

use crate::faces::{self, EngineState};
use crate::{util, SharedState};

const WEB_MAX: u32 = 2048;
const THUMB_MAX: u32 = 480;
const DET_SCORE_THRESHOLD: f32 = 0.35;
const MAX_FACES_PER_PHOTO: usize = 24;

pub struct Queue {
    notify: Arc<Notify>,
}

impl Queue {
    pub fn new() -> Self {
        Self {
            notify: Arc::new(Notify::new()),
        }
    }
    pub fn notify(&self) {
        self.notify.notify_one();
    }
    async fn wait(&self) {
        tokio::select! {
            _ = self.notify.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(15)) => {}
        }
    }
}

pub fn start(st: SharedState) {
    // Recover from a previous run: re-queue interrupted photos, settle states.
    tokio::spawn({
        let st = st.clone();
        async move {
            if let Ok(r) = sqlx::query("UPDATE photos SET status='queued' WHERE status='processing'")
                .execute(&st.pool)
                .await
            {
                if r.rows_affected() > 0 {
                    tracing::info!("re-queued {} interrupted photos", r.rows_affected());
                }
            }
            let _ = sqlx::query(
                "UPDATE photos SET face_status='disabled' WHERE status='ready' AND face_status='queued' \
                 AND event_id IN (SELECT id FROM events WHERE face_enabled=0)",
            )
            .execute(&st.pool)
            .await;
            st.queue.notify();
        }
    });

    for i in 0..2 {
        let st = st.clone();
        tokio::spawn(async move {
            tracing::debug!("pipeline worker {i} started");
            loop {
                let id = match next_job(&st).await {
                    Ok(Some(id)) => id,
                    Ok(None) => {
                        st.queue.wait().await;
                        continue;
                    }
                    Err(e) => {
                        tracing::error!("queue poll failed: {e:#}");
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        continue;
                    }
                };
                if let Err(e) = process_photo(&st, &id).await {
                    tracing::error!("photo {id} failed: {e:#}");
                    let msg: String = format!("{e:#}").chars().take(400).collect();
                    let _ = sqlx::query("UPDATE photos SET status='failed', error=?1 WHERE id=?2 AND status!='ready'")
                        .bind(&msg)
                        .bind(&id)
                        .execute(&st.pool)
                        .await;
                }
            }
        });
    }
}

async fn next_job(st: &SharedState) -> Result<Option<String>> {
    if let Some((id,)) = sqlx::query_as::<_, (String,)>(
        "SELECT id FROM photos WHERE status='queued' ORDER BY created_at ASC LIMIT 1",
    )
    .fetch_optional(&st.pool)
    .await?
    {
        return Ok(Some(id));
    }
    // Face indexing only when the engine is actually loaded (avoid busy loop while loading).
    #[cfg(feature = "face")]
    {
        let engine_ready = matches!(st.face_engine.get(), Some(EngineState::Ready(_)));
        if engine_ready {
            if let Some((id,)) = sqlx::query_as::<_, (String,)>(
                "SELECT p.id FROM photos p JOIN events e ON e.id = p.event_id \
                 WHERE p.status='ready' AND p.face_status='queued' AND e.face_enabled=1 \
                 ORDER BY p.created_at ASC LIMIT 1",
            )
            .fetch_optional(&st.pool)
            .await?
            {
                return Ok(Some(id));
            }
        }
    }
    let _ = EngineState::Loading; // keep import meaningful in face-less builds
    Ok(None)
}

#[derive(sqlx::FromRow)]
struct JobRow {
    id: String,
    orig_hash: String,
    ext: String,
    status: String,
    face_status: String,
    face_enabled: i64,
}

pub async fn process_photo(st: &SharedState, id: &str) -> Result<()> {
    let row: JobRow = sqlx::query_as(
        "SELECT p.id, p.orig_hash, p.ext, p.status, p.face_status, e.face_enabled \
         FROM photos p JOIN events e ON e.id = p.event_id WHERE p.id = ?1",
    )
    .bind(id)
    .fetch_optional(&st.pool)
    .await?
    .ok_or_else(|| anyhow!("photo {id} not found"))?;

    let mut web_img: Option<DynamicImage> = None;

    if row.status == "queued" {
        sqlx::query("UPDATE photos SET status='processing' WHERE id=?1")
            .bind(id)
            .execute(&st.pool)
            .await?;
        let orig = st.cfg.orig_path(&row.orig_hash, &row.ext);
        let bytes = tokio::fs::read(&orig)
            .await
            .with_context(|| format!("reading original {}", orig.display()))?;

        let (img, orientation, taken_ms) =
            tokio::task::spawn_blocking(move || decode_with_exif(bytes))
                .await
                .map_err(|e| anyhow!("worker join: {e}"))??;
        let img = apply_orientation(img, orientation);

        let (w, h) = (img.width() as i64, img.height() as i64);
        let thumb_img = img.resize(THUMB_MAX, THUMB_MAX, FilterType::Triangle);
        let web = img.resize(WEB_MAX, WEB_MAX, FilterType::Lanczos3);
        drop(img);

        let (web, web_buf, thumb_buf) =
            tokio::task::spawn_blocking(move || -> Result<_> {
                let web_buf = encode_jpeg(&web, 86)?;
                let thumb_buf = encode_jpeg(&thumb_img, 80)?;
                Ok((web, web_buf, thumb_buf))
            })
            .await
            .map_err(|e| anyhow!("worker join: {e}"))??;

        let web_path = st.cfg.web_path(&row.orig_hash);
        let thumb_path = st.cfg.thumb_path(&row.orig_hash);
        tokio::fs::write(&web_path, &web_buf)
            .await
            .with_context(|| format!("writing {}", web_path.display()))?;
        tokio::fs::write(&thumb_path, &thumb_buf).await?;

        sqlx::query(
            "UPDATE photos SET status='ready', width=?1, height=?2, taken_at=COALESCE(?3, taken_at), error='' WHERE id=?4",
        )
        .bind(w)
        .bind(h)
        .bind(taken_ms)
        .bind(id)
        .execute(&st.pool)
        .await?;

        tracing::info!("ready: photo {id} ({w}x{h})");
        web_img = Some(web);
    }

    // ---- face stage ----
    if row.face_enabled == 0 {
        if row.face_status == "queued" {
            sqlx::query("UPDATE photos SET face_status='disabled' WHERE id=?1")
                .bind(id)
                .execute(&st.pool)
                .await?;
        }
        return Ok(());
    }
    if row.face_status != "queued" {
        return Ok(());
    }

    // face-less build (hub-only): nothing to index — tail expression for this build
    #[cfg(not(feature = "face"))]
    {
        sqlx::query("UPDATE photos SET face_status='unavailable' WHERE id=?1 AND face_status='queued'")
            .bind(id)
            .execute(&st.pool)
            .await?;
        Ok(())
    }

    #[cfg(feature = "face")]
    {
        let engine = match st.face_engine.get() {
            Some(EngineState::Ready(e)) => e.clone(),
            _ => {
                // engine not loaded (yet) — leave queued; will be swept when engine resolves
                return Ok(());
            }
        };

        let claimed = sqlx::query("UPDATE photos SET face_status='processing' WHERE id=?1 AND face_status='queued'")
            .bind(id)
            .execute(&st.pool)
            .await?
            .rows_affected()
            == 1;
        if !claimed {
            return Ok(());
        }

    // Need a web-sized image to work from (fast + light on RAM for big files).
    let web = match web_img.take() {
        Some(w) => w,
        None => {
            let bytes = tokio::fs::read(st.cfg.web_path(&row.orig_hash)).await?;
            let bytes = tokio::task::spawn_blocking(move || -> Result<_> {
                Ok(image::load_from_memory(&bytes)?)
            })
            .await
            .map_err(|e| anyhow!("worker join: {e}"))??;
            bytes
        }
    };

    let face_rows = tokio::task::spawn_blocking(move || -> Result<Vec<(f32, f32, f32, f32, f32, Vec<u8>)>> {
        let dets = engine.detect(&web, DET_SCORE_THRESHOLD)?;
        let mut out = Vec::new();
        for d in dets.iter().take(MAX_FACES_PER_PHOTO) {
            let emb = engine.embed(&web, &d.kps)?;
            out.push((d.x1, d.y1, d.x2, d.y2, d.score, faces::embedding_to_bytes(&emb)));
        }
        Ok(out)
    })
    .await
    .map_err(|e| anyhow!("worker join: {e}"))??;

    let mut tx = st.pool.begin().await?;
    sqlx::query("DELETE FROM faces WHERE photo_id=?1").bind(id).execute(&mut *tx).await?;
    for (x1, y1, x2, y2, score, emb) in &face_rows {
        sqlx::query("INSERT INTO faces(id, photo_id, x1, y1, x2, y2, score, embedding) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")
            .bind(util::new_id())
            .bind(id)
            .bind(x1).bind(y1).bind(x2).bind(y2).bind(score)
            .bind(emb)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE photos SET face_status='done' WHERE id=?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    tracing::info!("face index: photo {id} → {} faces", face_rows.len());
    Ok(())
    } // cfg(feature = "face")
}

fn decode_with_exif(bytes: Vec<u8>) -> Result<(DynamicImage, u8, Option<i64>)> {
    let mut orientation = 1u8;
    let mut taken = None;
    if let Ok(ex) = exif::Reader::new().read_from_container(&mut std::io::Cursor::new(&bytes)) {
        if let Some(f) = ex.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
            orientation = f.value.get_uint(0).unwrap_or(1).clamp(1, 8) as u8;
        }
        if let Some(f) = ex.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY) {
            if let exif::Value::Ascii(ref a) = f.value {
                if let Some(first) = a.first() {
                    let s = String::from_utf8_lossy(first).trim().to_string();
                    taken = chrono::NaiveDateTime::parse_from_str(&s, "%Y:%m:%d %H:%M:%S")
                        .ok()
                        .map(|t| t.and_utc().timestamp_millis());
                }
            }
        }
    }
    let img = image::load_from_memory(&bytes)
        .with_context(|| "decoding image (supported: JPEG / PNG / WebP; RAW and HEIC are on the roadmap)")?;
    Ok((img, orientation, taken))
}

fn apply_orientation(img: DynamicImage, o: u8) -> DynamicImage {
    match o {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate90().flipv(),
        8 => img.rotate270(),
        _ => img,
    }
}

fn encode_jpeg(img: &DynamicImage, quality: u8) -> Result<Vec<u8>> {
    let mut buf = std::io::Cursor::new(Vec::new());
    let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
    img.to_rgb8().write_with_encoder(enc)?;
    Ok(buf.into_inner())
}
