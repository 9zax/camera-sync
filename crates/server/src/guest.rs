use std::collections::HashMap;

use axum::extract::{Multipart, Path, Query, State};
use axum::http::{header, HeaderMap};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::error::{ApiResult, AppError};
use crate::events::{self, Event};
use crate::faces::{self, EngineState};
use crate::photos::zip_stream;
use crate::util::{keyed_hash, pin_cookie_name};
use crate::SharedState;

fn face_ready(st: &SharedState) -> bool {
    #[cfg(feature = "face")]
    {
        matches!(st.face_engine.get(), Some(EngineState::Ready(_)))
    }
    #[cfg(not(feature = "face"))]
    {
        let _ = st;
        false
    }
}

pub(crate) async fn event_or_404(st: &SharedState, slug: &str) -> Result<Event, AppError> {
    let ev = events::fetch_event_by_slug(st, slug).await?;
    if ev.enabled == 0 {
        // offline toggle (desktop/admin) — guests get a clear message, not a 404
        return Err(AppError::ServiceUnavailable(
            "แกลเลอรีนี้ปิดใช้งานชั่วคราว — ลองมาใหม่ภายหลังนะ".into(),
        ));
    }
    Ok(ev)
}

pub(crate) async fn require_pin(st: &SharedState, ev: &Event, headers: &HeaderMap) -> Result<(), AppError> {
    if events::guest_can_access(st, ev, headers).await {
        Ok(())
    } else {
        Err(AppError::Unauthorized("event PIN required".into()))
    }
}

// ---- public event info (works even before PIN unlock: needed for the gate screen) ----

pub async fn info(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let ev = event_or_404(&st, &slug).await?;
    let ready: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM photos WHERE event_id=?1 AND status='ready'")
            .bind(&ev.id)
            .fetch_one(&st.pool)
            .await
            .unwrap_or(0);
    Ok(Json(json!({
        "slug": ev.slug,
        "title": ev.title,
        "partner_a": ev.partner_a,
        "partner_b": ev.partner_b,
        "event_date": ev.event_date,
        "photo_count": ready,
        "face_enabled": ev.face_enabled != 0 && face_ready(&st),
        "guestbook_enabled": ev.guestbook_enabled != 0,
        "pin_required": !ev.pin.is_empty(),
        "cover_photo_id": ev.cover_photo_id,
    })))
}

#[derive(Deserialize)]
pub struct GuestQrQuery {
    pub base: Option<String>,
}

/// QR for the guest link — used by the venue wall and any custom share screen.
pub async fn qr_png(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    Query(q): Query<GuestQrQuery>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let ev = event_or_404(&st, &slug).await?;
    require_pin(&st, &ev, &headers).await?;
    let base = q
        .base
        .filter(|b| b.starts_with("http://") || b.starts_with("https://"))
        .unwrap_or_else(|| st.cfg.public_app_url.clone());
    Ok(events::png_response(events::qr_png_bytes(&ev, &base)?))
}

#[derive(Deserialize)]
pub struct UnlockReq {
    pub pin: String,
}

pub async fn unlock(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    Json(req): Json<UnlockReq>,
) -> ApiResult<Response> {
    let ev = event_or_404(&st, &slug).await?;
    if ev.pin.is_empty() {
        return Ok(Json(json!({ "ok": true })).into_response());
    }
    let given = keyed_hash(&st.cfg.secret, req.pin.trim());
    let expected = keyed_hash(&st.cfg.secret, &ev.pin);
    if given != expected {
        return Err(AppError::Forbidden("PIN ไม่ถูกต้อง".into()));
    }
    let cookie = format!(
        "{}={}; Path=/; SameSite=Lax; Max-Age={}",
        pin_cookie_name(&ev.id),
        given,
        30 * 24 * 3600
    );
    let mut res = Json(json!({ "ok": true })).into_response();
    if let Ok(v) = axum::http::HeaderValue::from_str(&cookie) {
        res.headers_mut().append(header::SET_COOKIE, v);
    }
    Ok(res)
}

pub async fn summary(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    let ev = event_or_404(&st, &slug).await?;
    require_pin(&st, &ev, &headers).await?;
    let (total, ready, pending): (i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), \
                COALESCE(SUM(status='ready'), 0), \
                COALESCE(SUM(status IN ('queued','processing')), 0) \
         FROM photos WHERE event_id = ?1",
    )
    .bind(&ev.id)
    .fetch_one(&st.pool)
    .await
    .map_err(AppError::from)?;
    Ok(Json(json!({ "total": total, "ready": ready, "pending": pending })))
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn photos(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    Query(q): Query<ListQuery>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    let ev = event_or_404(&st, &slug).await?;
    require_pin(&st, &ev, &headers).await?;
    let limit = q.limit.unwrap_or(200).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);
    let (total,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM photos WHERE event_id=?1 AND status='ready'",
    )
    .bind(&ev.id)
    .fetch_one(&st.pool)
    .await
    .map_err(AppError::from)?;
    let items = sqlx::query_as::<_, crate::photos::Photo>(
        "SELECT id, filename, bytes, width, height, taken_at, status, face_status, created_at, event_id, orig_hash, ext \
         FROM photos WHERE event_id=?1 AND status='ready' ORDER BY created_at DESC, id DESC LIMIT ?2 OFFSET ?3",
    )
    .bind(&ev.id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&st.pool)
    .await
    .map_err(AppError::from)?;
    Ok(Json(json!({ "total": total, "items": items })))
}

const SELFIE_MAX_BYTES: usize = 30 * 1024 * 1024;

/// Guest face search: send a selfie, get matching photos of the event back.
/// The selfie is processed in memory and never stored.
#[cfg(feature = "face")]
pub async fn face_search(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> ApiResult<Json<serde_json::Value>> {
    let ev = event_or_404(&st, &slug).await?;
    require_pin(&st, &ev, &headers).await?;
    if ev.face_enabled == 0 {
        return Err(AppError::bad("งานนี้ปิดการใช้งานค้นหาด้วยใบหน้า"));
    }
    let engine = match st.face_engine.get() {
        Some(EngineState::Ready(e)) => e.clone(),
        Some(EngineState::Loading) | None => {
            return Err(AppError::ServiceUnavailable(
                "ระบบค้นหาใบหน้ากำลังเริ่มต้น ลองใหม่อีกครั้งในสักครู่".into(),
            ))
        }
        Some(EngineState::Unavailable) => {
            return Err(AppError::ServiceUnavailable(
                "ระบบค้นหาใบหน้าไม่พร้อมใช้งาน (เซิร์ฟเวอร์ยังไม่ได้ติดตั้งโมเดล)".into(),
            ))
        }
    };

    let mut image: Option<Vec<u8>> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad(format!("multipart error: {e}")))?
    {
        let is_file = field.file_name().is_some()
            || matches!(field.name(), Some("file") | Some("image") | Some("selfie"));
        if is_file {
            let data = field
                .bytes()
                .await
                .map_err(|e| AppError::bad(format!("reading image: {e}")))?;
            image = Some(data.to_vec());
            break;
        }
    }
    let Some(image) = image else {
        return Err(AppError::bad("กรุณาแนบรูปเซลฟี่"));
    };
    if image.len() > SELFIE_MAX_BYTES {
        return Err(AppError::bad("รูปใหญ่เกินไป (สูงสุด 30MB)"));
    }

    let threshold = st.cfg.face_threshold;
    let selfie = {
        let engine = engine.clone();
        tokio::task::spawn_blocking(move || -> anyhow::Result<Option<Vec<f32>>> {
            let img = image::load_from_memory(&image)
                .map_err(|_| anyhow::anyhow!("อ่านรูปไม่ได้ (รองรับ jpg / png / webp)"))?;
            let img = img.resize(900, 900, image::imageops::FilterType::Triangle);
            let dets = engine.detect(&img, 0.3)?;
            let Some(best) = dets.first() else {
                return Ok(None);
            };
            Ok(Some(engine.embed(&img, &best.kps)?))
        })
        .await
        .map_err(|e| AppError::bad(format!("worker: {e}")))?
        .map_err(AppError::from)?
    };
    let Some(emb) = selfie else {
        return Ok(Json(json!({
            "results": [],
            "count": 0,
            "message": "ไม่พบใบหน้าในรูป — ลองถ่ายเซลฟี่หน้าตรง แสงสว่าง ไม่มีอะไรบังใบหน้า",
        })));
    };

    let rows: Vec<(String, Vec<u8>)> = sqlx::query_as(
        "SELECT f.photo_id, f.embedding FROM faces f \
         JOIN photos p ON p.id = f.photo_id \
         WHERE p.event_id = ?1 AND p.status = 'ready'",
    )
    .bind(&ev.id)
    .fetch_all(&st.pool)
    .await
    .map_err(AppError::from)?;

    let mut best_by_photo: HashMap<String, f32> = HashMap::new();
    for (pid, blob) in &rows {
        let target = faces::bytes_to_embedding(blob);
        let s = faces::cosine(&emb, &target);
        best_by_photo
            .entry(pid.clone())
            .and_modify(|m| {
                if s > *m {
                    *m = s;
                }
            })
            .or_insert(s);
    }
    let mut results: Vec<(String, f32)> = best_by_photo
        .into_iter()
        .filter(|(_, s)| *s >= threshold)
        .collect();
    results.sort_by(|a, b| b.1.total_cmp(&a.1));
    results.truncate(60);

    let count = results.len();
    let items: Vec<serde_json::Value> = results
        .into_iter()
        .map(|(photo_id, score)| json!({ "photo_id": photo_id, "score": (score * 1000.0).round() / 1000.0 }))
        .collect();
    let message = if count == 0 {
        "ยังไม่พบรูปที่คล้ายกัน — ช่างภาพอาจยังอัปโหลดรูปไม่ครบ หรือลองใช้รูปเซลฟี่ที่เห็นหน้าชัดขึ้น"
    } else {
        ""
    };
    Ok(Json(json!({ "results": items, "count": count, "message": message })))
}

#[derive(Deserialize)]
pub struct FaceDownloadReq {
    pub photo_ids: Vec<String>,
}

/// Guest: zip of web-quality versions for a set of photos (face-search hits
/// or the guest's favourites). The originals stay on the photographer's disk.
pub async fn face_download_zip(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    Query(_q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Json(req): Json<FaceDownloadReq>,
) -> ApiResult<Response> {
    let ev = event_or_404(&st, &slug).await?;
    require_pin(&st, &ev, &headers).await?;
    if req.photo_ids.is_empty() || req.photo_ids.len() > 200 {
        return Err(AppError::bad("photo_ids must contain 1–200 ids"));
    }
    let mut entries = Vec::new();
    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
    for id in &req.photo_ids {
        let row: Option<(String, String)> = sqlx::query_as(
            "SELECT p.orig_hash, p.filename FROM photos p \
             WHERE p.id = ?1 AND p.event_id = ?2 AND p.status = 'ready'",
        )
        .bind(id)
        .bind(&ev.id)
        .fetch_optional(&st.pool)
        .await
        .map_err(AppError::from)?;
        let Some((hash, filename)) = row else { continue };
        let mut name = format!("{}.jpg", filename.trim_end_matches(|c: char| c != '.').trim_end_matches('.'));
        if name.is_empty() || name == ".jpg" {
            name = format!("{}.jpg", &hash[..12]);
        }
        if !used.insert(name.clone()) {
            name = format!("{}-{}.jpg", name.trim_end_matches(".jpg"), &hash[..6]);
            used.insert(name.clone());
        }
        entries.push((name, st.cfg.web_path(&hash)));
    }
    if entries.is_empty() {
        return Err(AppError::not_found("no valid photos to download"));
    }
    Ok(zip_stream(entries, "my-photos.zip").await)
}

/// face-less build (hub-only binary): the search runs on the photographer's
/// machine and is reached through the hub tunnel.
#[cfg(not(feature = "face"))]
pub async fn face_search(
    State(_st): State<SharedState>,
    Path(slug): Path<String>,
    headers: HeaderMap,
    _multipart: Multipart,
) -> ApiResult<Json<serde_json::Value>> {
    let ev = event_or_404(&_st, &slug).await?;
    require_pin(&_st, &ev, &headers).await?;
    Err(AppError::ServiceUnavailable(
        "hub build นี้ไม่ได้เปิด face search — ใช้ได้บนเครื่องช่างภาพ (ผ่าน tunnel)".into(),
    ))
}
