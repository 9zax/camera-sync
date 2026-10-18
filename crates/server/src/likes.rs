//! Guest photo likes — stored as one JSON file per event on the
//! photographer's machine: `{data_dir}/likes/{slug}/likes.json`.
//! The hub never stores these; the API is reached through the tunnel
//! like every other /api/g/{slug} route.

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::error::{ApiResult, AppError};
use crate::guest::{event_or_404, require_pin};
use crate::SharedState;

#[derive(serde::Serialize, serde::Deserialize)]
struct LikeEntry {
    photo_id: String,
    guest_id: String,
    liked_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct LikesFile {
    event: String,
    items: Vec<LikeEntry>,
}

/// All likes for one event, on disk next to nothing else — one folder per
/// event so a photographer can grab/copy a single wedding's likes easily.
fn likes_path(st: &SharedState, ev: &crate::events::Event) -> std::path::PathBuf {
    st.cfg.data_dir.join("likes").join(&ev.slug).join("likes.json")
}


fn internal(msg: impl Into<String>) -> AppError {
    AppError::Internal(anyhow::anyhow!(msg.into()))
}

/// Serialize read-modify-write cycles: one process, one file at a time.
static LIKES_IO: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
fn io_lock() -> &'static tokio::sync::Mutex<()> {
    LIKES_IO.get_or_init(|| tokio::sync::Mutex::new(()))
}

async fn load(st: &SharedState, ev: &crate::events::Event) -> Result<LikesFile, AppError> {
    let path = likes_path(st, ev);
    match tokio::fs::read(&path).await {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| internal(format!("อ่านไฟล์ likes ไม่ได้: {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LikesFile {
            event: ev.slug.clone(),
            items: Vec::new(),
        }),
        Err(e) => Err(internal(format!("อ่านไฟล์ likes ไม่ได้: {e}"))),
    }
}

async fn save(st: &SharedState, ev: &crate::events::Event, likes: &LikesFile) -> Result<(), AppError> {
    let path = likes_path(st, ev);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| internal(format!("สร้างโฟลเดอร์ likes ไม่ได้: {e}")))?;
    }
    let bytes = serde_json::to_vec_pretty(likes)
        .map_err(|e| internal(format!("เขียนไฟล์ likes ไม่ได้: {e}")))?;
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, &bytes)
        .await
        .map_err(|e| internal(format!("เขียนไฟล์ likes ไม่ได้: {e}")))?;
    tokio::fs::rename(&tmp, &path)
        .await
        .map_err(|e| internal(format!("เขียนไฟล์ likes ไม่ได้: {e}")))?;
    Ok(())
}

fn valid_guest_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

/// Which photos has this guest liked?
pub async fn list(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    Query(q): Query<LikesQuery>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    let ev = event_or_404(&st, &slug).await?;
    require_pin(&st, &ev, &headers).await?;
    let guest_id = q.guest_id.unwrap_or_default();
    if !valid_guest_id(&guest_id) {
        return Err(AppError::bad("guest_id ไม่ถูกต้อง"));
    }
    let likes = load(&st, &ev).await?;
    let items: Vec<&str> = likes
        .items
        .iter()
        .filter(|e| e.guest_id == guest_id)
        .map(|e| e.photo_id.as_str())
        .collect();
    Ok(Json(json!({ "items": items })))
}

#[derive(Deserialize)]
pub struct LikesQuery {
    pub guest_id: Option<String>,
}

#[derive(Deserialize)]
pub struct SetLikeReq {
    pub guest_id: String,
    pub photo_id: String,
    pub liked: bool,
}

pub async fn set(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    headers: HeaderMap,
    Json(req): Json<SetLikeReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let ev = event_or_404(&st, &slug).await?;
    require_pin(&st, &ev, &headers).await?;
    if !valid_guest_id(&req.guest_id) {
        return Err(AppError::bad("guest_id ไม่ถูกต้อง"));
    }
    // only photos that really belong to this event can be liked
    let exists: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM photos WHERE id = ?1 AND event_id = ?2 AND status = 'ready'",
    )
    .bind(&req.photo_id)
    .bind(&ev.id)
    .fetch_optional(&st.pool)
    .await
    .map_err(AppError::from)?;
    if exists.is_none() {
        return Err(AppError::not_found("ไม่พบรูปนี้ในงาน"));
    }

    let _guard = io_lock().lock().await;
    let mut likes = load(&st, &ev).await?;
    likes.items.retain(|e| !(e.photo_id == req.photo_id && e.guest_id == req.guest_id));
    if req.liked {
        likes.items.push(LikeEntry {
            photo_id: req.photo_id.clone(),
            guest_id: req.guest_id.clone(),
            liked_at: chrono::Utc::now().timestamp(),
        });
    }
    let count = likes
        .items
        .iter()
        .filter(|e| e.photo_id == req.photo_id)
        .count();
    save(&st, &ev, &likes).await?;
    Ok(Json(json!({ "liked": req.liked, "photo_likes": count })))
}
