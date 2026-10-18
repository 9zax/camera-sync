use std::collections::HashSet;
use std::path::PathBuf;

use axum::body::Body;
use axum::extract::{Multipart, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::auth::{self, AuthUser};
use crate::error::{ApiResult, AppError};
use crate::events::{self, Event};
use crate::util::{bearer_token, new_id, now_ms};
use crate::SharedState;

#[derive(sqlx::FromRow, serde::Serialize)]
pub struct Photo {
    pub id: String,
    pub filename: String,
    pub bytes: i64,
    pub width: i64,
    pub height: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub taken_at: Option<i64>,
    pub status: String,
    pub face_status: String,
    pub created_at: i64,
    #[serde(skip)]
    pub event_id: String,
    #[serde(skip)]
    pub orig_hash: String,
    #[serde(skip)]
    pub ext: String,
}

const MAX_UPLOAD_BYTES: usize = 400 * 1024 * 1024;

fn normalize_ext(filename: &str) -> Option<String> {
    let ext = filename.rsplit('.').next()?.to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => Some("jpg".into()),
        "png" => Some("png".into()),
        "webp" => Some("webp".into()),
        _ => None,
    }
}

fn content_type_for(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    }
}

/// Upload authorization: either an admin session (cookie or bearer) or the
/// event's upload token (used by the sync agent).
async fn authorize_upload(st: &SharedState, headers: &HeaderMap, ev: &Event) -> Result<(), AppError> {
    if let Some(tok) = bearer_token(headers) {
        if tok == ev.upload_token {
            return Ok(());
        }
    }
    if auth::token_from_headers(headers).is_some() && auth::is_admin_request(st, headers).await {
        return Ok(());
    }
    Err(AppError::Unauthorized(
        "upload requires an admin session or the event upload token".into(),
    ))
}

/// Shared ingestion path used by HTTP uploads, the local folder importer and the agent.
/// Returns Ok(true) when a new photo row was created, Ok(false) on duplicate.
pub async fn ingest_bytes(
    st: &SharedState,
    event_id: &str,
    filename: &str,
    data: &[u8],
) -> Result<bool, AppError> {
    if data.is_empty() {
        return Ok(false);
    }
    if data.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::bad(format!(
            "{filename} ใหญ่เกิน 400MB — ตัดไฟล์ใหญ่ออกก่อนอัปโหลด"
        )));
    }
    let Some(ext) = normalize_ext(filename) else {
        return Err(AppError::bad(format!(
            "ไฟล์ {filename} ไม่ใช่ประเภทที่รองรับ (รองรับ jpg / jpeg / png / webp)"
        )));
    };
    let hash = blake3::hash(data).to_hex().to_string();
    let orig = st.cfg.orig_path(&hash, &ext);
    if !orig.exists() {
        if let Some(parent) = orig.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(AppError::from)?;
        }
        tokio::fs::write(&orig, data).await.map_err(AppError::from)?;
    }
    let id = new_id();
    let res = sqlx::query(
        "INSERT INTO photos(id, event_id, orig_hash, filename, ext, bytes, status, face_status, created_at) \
         VALUES (?1,?2,?3,?4,?5,?6,'queued','queued',?7) \
         ON CONFLICT(event_id, orig_hash) DO NOTHING",
    )
    .bind(&id)
    .bind(event_id)
    .bind(&hash)
    .bind(filename)
    .bind(&ext)
    .bind(data.len() as i64)
    .bind(now_ms())
    .execute(&st.pool)
    .await
    .map_err(AppError::from)?;
    let inserted = res.rows_affected() == 1;
    if inserted {
        st.queue.notify();
    }
    Ok(inserted)
}

pub async fn upload(
    State(st): State<SharedState>,
    Path(event_id): Path<String>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> ApiResult<Json<serde_json::Value>> {
    let ev = events::fetch_event(&st, &event_id).await?;
    authorize_upload(&st, &headers, &ev).await?;

    let mut uploaded = 0u64;
    let mut duplicated = 0u64;
    let mut ids: Vec<String> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad(format!("multipart error: {e}")))?
    {
        let Some(filename) = field.file_name().map(|s| s.to_string()) else {
            continue; // ignore plain fields (event, etc.)
        };
        let data = field
            .bytes()
            .await
            .map_err(|e| AppError::bad(format!("reading file {filename}: {e}")))?;
        if ingest_bytes(&st, &ev.id, &filename, &data).await? {
            uploaded += 1;
            ids.push(filename);
        } else {
            duplicated += 1;
        }
    }

    Ok(Json(json!({ "uploaded": uploaded, "duplicated": duplicated, "ids": ids })))
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub status: Option<String>,
}

pub async fn list_admin(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path(event_id): Path<String>,
    Query(q): Query<ListQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    let limit = q.limit.unwrap_or(300).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);
    let valid_status = q
        .status
        .as_deref()
        .filter(|s| matches!(*s, "queued" | "processing" | "ready" | "failed"));
    let (total,): (i64,) = match valid_status {
        Some(s) => sqlx::query_as(
            "SELECT COUNT(*) FROM photos WHERE event_id=?1 AND status=?2",
        )
        .bind(&event_id)
        .bind(s)
        .fetch_one(&st.pool)
        .await
        .map_err(AppError::from)?,
        None => sqlx::query_as("SELECT COUNT(*) FROM photos WHERE event_id=?1")
            .bind(&event_id)
            .fetch_one(&st.pool)
            .await
            .map_err(AppError::from)?,
    };
    let items = match valid_status {
        Some(s) => {
            sqlx::query_as::<_, Photo>(
                "SELECT id, filename, bytes, width, height, taken_at, status, face_status, created_at, event_id, orig_hash, ext \
                 FROM photos WHERE event_id=?1 AND status=?2 ORDER BY created_at DESC, id DESC LIMIT ?3 OFFSET ?4",
            )
            .bind(&event_id)
            .bind(s)
            .bind(limit)
            .bind(offset)
            .fetch_all(&st.pool)
            .await
        }
        None => {
            sqlx::query_as::<_, Photo>(
                "SELECT id, filename, bytes, width, height, taken_at, status, face_status, created_at, event_id, orig_hash, ext \
                 FROM photos WHERE event_id=?1 ORDER BY created_at DESC, id DESC LIMIT ?2 OFFSET ?3",
            )
            .bind(&event_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&st.pool)
            .await
        }
    }
    .map_err(AppError::from)?;
    Ok(Json(json!({ "total": total, "items": items })))
}

#[derive(Deserialize)]
pub struct FileQuery {
    pub variant: Option<String>,
}

pub async fn serve_file(
    State(st): State<SharedState>,
    Path(id): Path<String>,
    Query(q): Query<FileQuery>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let photo: Photo = sqlx::query_as(
        "SELECT id, filename, bytes, width, height, taken_at, status, face_status, created_at, event_id, orig_hash, ext \
         FROM photos WHERE id = ?1",
    )
    .bind(&id)
    .fetch_optional(&st.pool)
    .await
    .map_err(AppError::from)?
    .ok_or_else(|| AppError::not_found("photo not found"))?;

    let ev = events::fetch_event(&st, &photo.event_id).await?;
    let admin = auth::is_admin_request(&st, &headers).await;
    if !admin && !events::guest_can_access(&st, &ev, &headers).await {
        return Err(AppError::Unauthorized("event PIN required".into()));
    }
    // Guests can only see processed photos (thumbs exist); admins can fetch originals anytime.
    if photo.status != "ready" && !admin {
        return Err(AppError::not_found("photo is still being processed"));
    }

    let variant = q.variant.as_deref().unwrap_or("web");
    let (path, ctype) = match variant {
        "thumb" | "t" => (st.cfg.thumb_path(&photo.orig_hash), "image/jpeg"),
        "orig" | "original" => (
            st.cfg.orig_path(&photo.orig_hash, &photo.ext),
            content_type_for(&photo.ext),
        ),
        _ => (st.cfg.web_path(&photo.orig_hash), "image/jpeg"),
    };
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|_| AppError::not_found("file not ready yet"))?;
    let len = file.metadata().await.map_err(AppError::from)?.len();
    let stream = tokio_util::io::ReaderStream::new(file);
    Response::builder()
        .status(StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, ctype)
        .header(axum::http::header::CONTENT_LENGTH, len)
        .header(axum::http::header::CACHE_CONTROL, "private, max-age=31536000, immutable")
        .body(Body::from_stream(stream))
        .map_err(|e| AppError::Internal(e.into()))
}

pub async fn delete_one(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let photo: Option<Photo> = sqlx::query_as(
        "SELECT id, filename, bytes, width, height, taken_at, status, face_status, created_at, event_id, orig_hash, ext \
         FROM photos WHERE id = ?1",
    )
    .bind(&id)
    .fetch_optional(&st.pool)
    .await
    .map_err(AppError::from)?;
    let Some(photo) = photo else {
        return Err(AppError::not_found("photo not found"));
    };
    sqlx::query("DELETE FROM photos WHERE id = ?1")
        .bind(&id)
        .execute(&st.pool)
        .await
        .map_err(AppError::from)?;
    let still: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM photos WHERE orig_hash = ?1")
        .bind(&photo.orig_hash)
        .fetch_one(&st.pool)
        .await
        .unwrap_or(0);
    if still == 0 {
        let _ = tokio::fs::remove_file(st.cfg.orig_path(&photo.orig_hash, &photo.ext)).await;
        let _ = tokio::fs::remove_file(st.cfg.web_path(&photo.orig_hash)).await;
        let _ = tokio::fs::remove_file(st.cfg.thumb_path(&photo.orig_hash)).await;
    }
    Ok(Json(json!({ "deleted": id })))
}

/// Stream a zip of the given files (name → path). Files that no longer exist are skipped.
pub async fn zip_stream(entries: Vec<(String, PathBuf)>, filename: &str) -> Response {
    use async_zip::base::write::ZipFileWriter;
    use async_zip::{Compression, ZipEntryBuilder};

    let (reader, writer) = tokio::io::duplex(64 * 1024);
    tokio::spawn(async move {
        let mut zw = ZipFileWriter::with_tokio(writer);
        for (name, path) in entries {
            let data = match tokio::fs::read(&path).await {
                Ok(d) => d,
                Err(_) => continue,
            };
            let builder = ZipEntryBuilder::new(name.into(), Compression::Stored);
            if zw.write_entry_whole(builder, &data).await.is_err() {
                break;
            }
        }
        let _ = zw.close().await;
    });

    let stream = tokio_util::io::ReaderStream::new(reader);
    let disposition = format!("attachment; filename=\"{filename}\"");
    Response::builder()
        .status(StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, "application/zip")
        .header(axum::http::header::CONTENT_DISPOSITION, disposition)
        .body(Body::from_stream(stream))
        .unwrap()
}

/// Admin: download all originals of an event as a zip.
pub async fn download_zip(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path(event_id): Path<String>,
) -> ApiResult<Response> {
    let ev = events::fetch_event(&st, &event_id).await?;
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT filename, orig_hash, ext FROM photos WHERE event_id=?1 AND status='ready' ORDER BY created_at ASC",
    )
    .bind(&event_id)
    .fetch_all(&st.pool)
    .await
    .map_err(AppError::from)?;
    let mut used: HashSet<String> = HashSet::new();
    let entries: Vec<(String, PathBuf)> = rows
        .into_iter()
        .map(|(filename, hash, ext)| {
            let mut name = filename.replace(['/', '\\'], "_");
            if !used.insert(name.clone()) {
                let stem = name.trim_end_matches(&format!(".{ext}")).to_string();
                name = format!("{stem}-{}.{ext}", &hash[..8]);
                used.insert(name.clone());
            }
            (name, st.cfg.orig_path(&hash, &ext))
        })
        .collect();
    let safe_slug: String = ev
        .slug
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    Ok(zip_stream(entries, &format!("{safe_slug}.zip")).await)
}
