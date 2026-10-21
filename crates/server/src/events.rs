use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthUser;
use crate::error::{ApiResult, AppError};
use crate::util::{keyed_hash, new_id, now_ms, parse_cookies, pin_cookie_name, random_suffix, random_token, slugify};
use crate::SharedState;

#[derive(sqlx::FromRow, serde::Serialize, Clone)]
pub struct Event {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub partner_a: String,
    pub partner_b: String,
    pub event_date: String,
    pub pin: String,
    pub face_enabled: i64,
    pub guestbook_enabled: i64,
    pub upload_token: String,
    pub created_at: i64,
    pub enabled: i64,
    /// template id driving the guest page wording (wedding / ordination / …)
    pub event_type: String,
    /// gallery theme id, see web/src/lib/galleryThemes.ts
    pub theme: String,
    /// photo chosen by the photographer as the share-link cover (OG image)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_photo_id: Option<String>,
}

#[derive(sqlx::FromRow, serde::Serialize)]
pub struct EventWithCounts {
    #[sqlx(flatten)]
    #[serde(flatten)]
    pub event: Event,
    pub total: i64,
    pub ready: i64,
    pub pending: i64,
    pub faces_done: i64,
    pub wishes: i64,
}

const EVENT_COLUMNS: &str =
    "e.id, e.slug, e.title, e.partner_a, e.partner_b, e.event_date, e.pin, e.face_enabled, e.guestbook_enabled, e.upload_token, e.created_at, e.enabled, e.event_type, e.theme, e.cover_photo_id";
const EVENT_COUNTS: &str = "\
 (SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id) AS total, \
 (SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id AND p.status = 'ready') AS ready, \
 (SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id AND p.status IN ('queued','processing')) AS pending, \
 (SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id AND p.face_status = 'done') AS faces_done, \
 (SELECT COUNT(*) FROM guestbook g WHERE g.event_id = e.id AND g.hidden = 0) AS wishes";

pub async fn fetch_event(st: &SharedState, id: &str) -> Result<Event, AppError> {
    sqlx::query_as::<_, Event>(&format!(
        "SELECT {EVENT_COLUMNS} FROM events e WHERE e.id = ?1"
    ))
    .bind(id)
    .fetch_optional(&st.pool)
    .await
    .map_err(AppError::from)?
    .ok_or_else(|| AppError::not_found("event not found"))
}

pub async fn fetch_event_by_slug(st: &SharedState, slug: &str) -> Result<Event, AppError> {
    sqlx::query_as::<_, Event>(&format!(
        "SELECT {EVENT_COLUMNS} FROM events e WHERE e.slug = ?1"
    ))
    .bind(slug)
    .fetch_optional(&st.pool)
    .await
    .map_err(AppError::from)?
    .ok_or_else(|| AppError::not_found("event not found"))
}

async fn fetch_with_counts(st: &SharedState, id: &str) -> Result<EventWithCounts, AppError> {
    sqlx::query_as::<_, EventWithCounts>(&format!(
        "SELECT {EVENT_COLUMNS}, {EVENT_COUNTS} FROM events e WHERE e.id = ?1"
    ))
    .bind(id)
    .fetch_optional(&st.pool)
    .await
    .map_err(AppError::from)?
    .ok_or_else(|| AppError::not_found("event not found"))
}

/// Guest access check: events without a PIN are open; PIN-protected events need
/// the unlock cookie (admins always pass).
pub async fn guest_can_access(st: &SharedState, ev: &Event, headers: &HeaderMap) -> bool {
    if ev.pin.is_empty() {
        return true;
    }
    let expected = keyed_hash(&st.cfg.secret, &ev.pin);
    parse_cookies(headers)
        .get(&pin_cookie_name(&ev.id))
        .map(|v| v == &expected)
        .unwrap_or(false)
}

pub async fn list(State(st): State<SharedState>, _user: AuthUser) -> ApiResult<Json<Vec<EventWithCounts>>> {
    let rows = sqlx::query_as::<_, EventWithCounts>(&format!(
        "SELECT {EVENT_COLUMNS}, {EVENT_COUNTS} FROM events e ORDER BY e.created_at DESC"
    ))
    .fetch_all(&st.pool)
    .await
    .map_err(AppError::from)?;
    Ok(Json(rows))
}

pub async fn get_one(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<EventWithCounts>> {
    Ok(Json(fetch_with_counts(&st, &id).await?))
}

/// Public slug manifest — the hub's tunnel agent announces these so guests
/// can use pretty /e/{slug} URLs on the hub. Slugs are already semi-public
/// (they are the guest links).
pub async fn manifest(State(st): State<SharedState>) -> Json<serde_json::Value> {
    let slugs: Vec<(String,)> = sqlx::query_as("SELECT slug FROM events ORDER BY created_at DESC")
        .fetch_all(&st.pool)
        .await
        .unwrap_or_default();
    Json(json!({
        "slugs": slugs.into_iter().map(|(s,)| s).collect::<Vec<_>>(),
    }))
}

#[derive(Deserialize)]
pub struct CreateReq {
    pub title: String,
    #[serde(default)]
    pub partner_a: String,
    #[serde(default)]
    pub partner_b: String,
    #[serde(default)]
    pub event_date: String,
    #[serde(default)]
    pub pin: String,
    #[serde(default = "default_true")]
    pub face_enabled: bool,
    #[serde(default)]
    pub event_type: String,
    #[serde(default)]
    pub theme: String,
}
fn default_true() -> bool {
    true
}

/// Template/theme ids come from the front-end registries. Keep them to a plain
/// slug so a hand-crafted request can never put odd markup on the guest page;
/// unknown-but-clean ids are allowed and the UI falls back to its default.
pub(crate) fn normalize_design_id(raw: &str, fallback: &str) -> String {
    let clean: String = raw
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-' || *c == '_')
        .take(40)
        .collect();
    if clean.is_empty() {
        fallback.to_string()
    } else {
        clean
    }
}

pub async fn create(
    State(st): State<SharedState>,
    _user: AuthUser,
    Json(req): Json<CreateReq>,
) -> ApiResult<Json<EventWithCounts>> {
    let title = req.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::bad("กรุณาใส่ชื่องาน (title)"));
    }
    if req.pin.len() > 12 {
        return Err(AppError::bad("PIN ต้องไม่เกิน 12 ตัวอักษร"));
    }
    let base = slugify(&title);
    // prefix with the photographer's short id so links carry their identity
    let short = crate::util::machine_short_id(&st.cfg.data_dir);
    let qualified = if short.is_empty() {
        base.clone()
    } else {
        format!("{short}-{base}")
    };
    let mut slug = format!("{qualified}-{}", random_suffix(4));
    for _ in 0..5 {
        let taken: Option<(String,)> =
            sqlx::query_as("SELECT slug FROM events WHERE slug = ?1")
                .bind(&slug)
                .fetch_optional(&st.pool)
                .await
                .map_err(AppError::from)?;
        if taken.is_none() {
            break;
        }
        slug = format!("{qualified}-{}", random_suffix(5));
    }
    let id = new_id();
    let event_type = normalize_design_id(&req.event_type, "wedding");
    let theme = normalize_design_id(&req.theme, "kinpaku-gold");
    sqlx::query(
        "INSERT INTO events(id, slug, title, partner_a, partner_b, event_date, pin, face_enabled, \
         upload_token, created_at, event_type, theme) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
    )
    .bind(&id)
    .bind(&slug)
    .bind(&title)
    .bind(req.partner_a.trim())
    .bind(req.partner_b.trim())
    .bind(req.event_date.trim())
    .bind(req.pin.trim())
    .bind(req.face_enabled as i64)
    .bind(random_token())
    .bind(now_ms())
    .bind(&event_type)
    .bind(&theme)
    .execute(&st.pool)
    .await
    .map_err(AppError::from)?;
    Ok(Json(fetch_with_counts(&st, &id).await?))
}

#[derive(Deserialize)]
pub struct UpdateReq {
    pub title: Option<String>,
    pub slug: Option<String>,
    pub partner_a: Option<String>,
    pub partner_b: Option<String>,
    pub event_date: Option<String>,
    pub pin: Option<String>,
    pub face_enabled: Option<bool>,
    pub guestbook_enabled: Option<bool>,
    pub event_type: Option<String>,
    pub theme: Option<String>,
}

pub async fn update(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<UpdateReq>,
) -> ApiResult<Json<EventWithCounts>> {
    let mut ev = fetch_event(&st, &id).await?;
    if let Some(t) = &req.title {
        if t.trim().is_empty() {
            return Err(AppError::bad("title cannot be empty"));
        }
        ev.title = t.trim().to_string();
    }
    if let Some(raw) = &req.slug {
        // the settings form sends the current slug back on every save; leave it
        // untouched unless the photographer actually edited it
        let raw = raw.trim();
        if !raw.is_empty() && raw != ev.slug {
            let s = slugify(raw);
            let taken: Option<(String,)> =
                sqlx::query_as("SELECT slug FROM events WHERE slug = ?1 AND id != ?2")
                    .bind(&s)
                    .bind(&id)
                    .fetch_optional(&st.pool)
                    .await
                    .map_err(AppError::from)?;
            if taken.is_some() {
                return Err(AppError::Conflict(format!("slug '{s}' is already in use")));
            }
            ev.slug = s;
        }
    }
    if let Some(v) = &req.partner_a {
        ev.partner_a = v.trim().into();
    }
    if let Some(v) = &req.partner_b {
        ev.partner_b = v.trim().into();
    }
    if let Some(v) = &req.event_date {
        ev.event_date = v.trim().into();
    }
    if let Some(v) = &req.pin {
        if v.len() > 12 {
            return Err(AppError::bad("PIN ต้องไม่เกิน 12 ตัวอักษร"));
        }
        ev.pin = v.trim().to_string();
    }
    if let Some(v) = req.guestbook_enabled {
        ev.guestbook_enabled = v as i64;
    }
    if let Some(v) = &req.event_type {
        ev.event_type = normalize_design_id(v, &ev.event_type);
    }
    if let Some(v) = &req.theme {
        ev.theme = normalize_design_id(v, &ev.theme);
    }
    let face_toggled = match req.face_enabled {
        Some(true) if ev.face_enabled == 0 => {
            ev.face_enabled = 1;
            true
        }
        Some(false) if ev.face_enabled == 1 => {
            ev.face_enabled = 0;
            true
        }
        _ => false,
    };

    sqlx::query(
        "UPDATE events SET title=?1, slug=?2, partner_a=?3, partner_b=?4, event_date=?5, pin=?6, \
         face_enabled=?7, guestbook_enabled=?8, event_type=?9, theme=?10 WHERE id=?11",
    )
    .bind(&ev.title)
    .bind(&ev.slug)
    .bind(&ev.partner_a)
    .bind(&ev.partner_b)
    .bind(&ev.event_date)
    .bind(&ev.pin)
    .bind(ev.face_enabled)
    .bind(ev.guestbook_enabled)
    .bind(&ev.event_type)
    .bind(&ev.theme)
    .bind(&id)
    .execute(&st.pool)
    .await
    .map_err(AppError::from)?;

    if face_toggled {
        if ev.face_enabled == 1 {
            sqlx::query(
                "UPDATE photos SET face_status='queued' WHERE event_id=?1 AND status='ready' \
                 AND face_status IN ('disabled','unavailable','failed')",
            )
            .bind(&id)
            .execute(&st.pool)
            .await
            .map_err(AppError::from)?;
        } else {
            sqlx::query("DELETE FROM faces WHERE photo_id IN (SELECT id FROM photos WHERE event_id=?1)")
                .bind(&id)
                .execute(&st.pool)
                .await
                .map_err(AppError::from)?;
            sqlx::query("UPDATE photos SET face_status='disabled' WHERE event_id=?1 AND face_status NOT IN ('disabled')")
                .bind(&id)
                .execute(&st.pool)
                .await
                .map_err(AppError::from)?;
        }
        st.queue.notify();
    }

    Ok(Json(fetch_with_counts(&st, &id).await?))
}

pub async fn delete(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let deleted = delete_event(&st, &id).await?;
    Ok(Json(json!({ "deleted": deleted })))
}

/// Core delete — shared by the admin route and the desktop app.
/// Removes DB rows + derived files that no other event references;
/// the photographer's own source folder is never touched.
pub async fn delete_event(st: &SharedState, id: &str) -> Result<String, AppError> {
    let ev = fetch_event(st, id).await?;
    // stop the folder watcher first so the periodic rescan can't resurrect
    // this event, and forget the saved import dir
    crate::importer::stop_event(id);
    let photos: Vec<(String, String)> =
        sqlx::query_as("SELECT orig_hash, ext FROM photos WHERE event_id = ?1")
            .bind(id)
            .fetch_all(&st.pool)
            .await
            .map_err(AppError::from)?;
    sqlx::query("DELETE FROM import_dirs WHERE event_id = ?1")
        .bind(id)
        .execute(&st.pool)
        .await
        .map_err(AppError::from)?;
    sqlx::query("DELETE FROM events WHERE id = ?1")
        .bind(id)
        .execute(&st.pool)
        .await
        .map_err(AppError::from)?;
    // Remove content-addressed files no longer referenced by any event.
    for (hash, ext) in photos {
        let still: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM photos WHERE orig_hash = ?1")
            .bind(&hash)
            .fetch_one(&st.pool)
            .await
            .unwrap_or(0);
        if still == 0 {
            let _ = tokio::fs::remove_file(st.cfg.orig_path(&hash, &ext)).await;
            let _ = tokio::fs::remove_file(st.cfg.web_path(&hash)).await;
            let _ = tokio::fs::remove_file(st.cfg.thumb_path(&hash)).await;
        }
    }
    Ok(ev.id)
}

#[derive(Deserialize)]
pub struct SetEnabledReq {
    pub enabled: bool,
}

pub async fn set_enabled_route(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<SetEnabledReq>,
) -> ApiResult<Json<EventWithCounts>> {
    Ok(Json(set_event_enabled(&st, &id, req.enabled).await?))
}

/// Rename an album (display title only — the slug and guest link stay the
/// same, so printed QRs never break).
pub async fn rename_event(st: &SharedState, id: &str, title: &str) -> Result<EventWithCounts, AppError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::bad("กรุณาใส่ชื่ออัลบั้ม"));
    }
    if title.chars().count() > 80 {
        return Err(AppError::bad("ชื่อยาวเกินไป (สูงสุด 80 ตัวอักษร)"));
    }
    let res = sqlx::query("UPDATE events SET title=?1 WHERE id=?2")
        .bind(title)
        .bind(id)
        .execute(&st.pool)
        .await
        .map_err(AppError::from)?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("event not found"));
    }
    Ok(fetch_with_counts(st, id).await?)
}

/// Online/offline toggle — offline events answer guests with a friendly
/// "ปิดใช้งานชั่วคราว" instead of serving photos. Shared by admin route and
/// the desktop app.
pub async fn set_event_enabled(
    st: &SharedState,
    id: &str,
    enabled: bool,
) -> Result<EventWithCounts, AppError> {
    let res = sqlx::query("UPDATE events SET enabled = ?1 WHERE id = ?2")
        .bind(enabled as i64)
        .bind(id)
        .execute(&st.pool)
        .await
        .map_err(AppError::from)?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("event not found"));
    }
    Ok(fetch_with_counts(st, id).await?)
}

/// Choose (or clear) the album cover photo used by the share-link preview.
/// `photo_id = None` clears it — the newest ready photo becomes the default.
pub async fn set_cover(
    st: &SharedState,
    id: &str,
    photo_id: Option<&str>,
) -> Result<EventWithCounts, AppError> {
    if let Some(pid) = photo_id {
        let owner: Option<(String,)> =
            sqlx::query_as("SELECT id FROM photos WHERE id = ?1 AND event_id = ?2 AND status = 'ready'")
                .bind(pid)
                .bind(id)
                .fetch_optional(&st.pool)
                .await
                .map_err(AppError::from)?;
        if owner.is_none() {
            return Err(AppError::bad("ไม่พบรูปนี้ในงาน"));
        }
    }
    let res = sqlx::query("UPDATE events SET cover_photo_id = ?1 WHERE id = ?2")
        .bind(photo_id)
        .bind(id)
        .execute(&st.pool)
        .await
        .map_err(AppError::from)?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("event not found"));
    }
    Ok(fetch_with_counts(st, id).await?)
}

#[derive(Deserialize)]
pub struct SetCoverReq {
    pub photo_id: Option<String>,
}

pub async fn set_cover_route(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<SetCoverReq>,
) -> ApiResult<Json<EventWithCounts>> {
    let pid = req.photo_id.as_deref().map(str::trim).filter(|s| !s.is_empty());
    Ok(Json(set_cover(&st, &id, pid).await?))
}

pub async fn regen_token(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let token = random_token();
    let res = sqlx::query("UPDATE events SET upload_token=?1 WHERE id=?2")
        .bind(&token)
        .bind(&id)
        .execute(&st.pool)
        .await
        .map_err(AppError::from)?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("event not found"));
    }
    Ok(Json(json!({ "upload_token": token })))
}

#[derive(Deserialize)]
pub struct QrQuery {
    pub base: Option<String>,
}

pub(crate) fn qr_png_bytes(ev: &Event, base: &str) -> Result<Vec<u8>, AppError> {
    let mut base = base.trim().to_string();
    if !base.starts_with("http://") && !base.starts_with("https://") {
        return Err(AppError::bad("base must be an http(s) URL"));
    }
    while base.ends_with('/') {
        base.pop();
    }
    let url = format!("{}/e/{}/", base, ev.slug);
    let code = qrcode::QrCode::with_error_correction_level(url.as_bytes(), qrcode::EcLevel::M)
        .map_err(|e| AppError::bad(format!("qr generation failed: {e}")))?;
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
        .map_err(|e| AppError::bad(format!("png encode failed: {e}")))?;
    Ok(buf.into_inner())
}

pub(crate) fn png_response(bytes: Vec<u8>) -> Response {
    (
        StatusCode::OK,
        [
            (axum::http::header::CONTENT_TYPE, "image/png"),
            (axum::http::header::CACHE_CONTROL, "no-store"),
        ],
        bytes,
    )
        .into_response()
}

pub async fn qr_png(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path(id): Path<String>,
    Query(q): Query<QrQuery>,
) -> ApiResult<Response> {
    let ev = fetch_event(&st, &id).await?;
    let base = q
        .base
        .filter(|b| b.starts_with("http://") || b.starts_with("https://"))
        .unwrap_or_else(|| st.cfg.public_app_url.clone());
    Ok(png_response(qr_png_bytes(&ev, &base)?))
}

// ---- machine-token guarded actions (driven from the hub's /r/line/me) ----
// The photographer's phone sits on the hub; these narrow endpoints let the
// hub act on their behalf when the request carries the machine token that
// only the hub (post-websocket-auth) and this machine know.

fn require_machine(st: &SharedState, headers: &HeaderMap) -> Result<(), AppError> {
    let given = headers
        .get("x-machine-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if crate::util::token_matches(given, &crate::util::machine_token(&st.cfg.data_dir)) {
        Ok(())
    } else {
        Err(AppError::Unauthorized("machine token ไม่ถูกต้อง".into()))
    }
}

async fn event_by_slug(st: &SharedState, slug: &str) -> Result<Event, AppError> {
    fetch_event_by_slug(st, slug).await
}

#[derive(Deserialize)]
pub struct MachineRenameReq {
    pub title: String,
}

pub async fn machine_rename(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    headers: HeaderMap,
    Json(req): Json<MachineRenameReq>,
) -> ApiResult<Json<serde_json::Value>> {
    require_machine(&st, &headers)?;
    let ev = event_by_slug(&st, &slug).await?;
    rename_event(&st, &ev.id, &req.title).await?;
    Ok(Json(json!({ "ok": true, "title": req.title.trim() })))
}

#[derive(Deserialize)]
pub struct MachineCoverReq {
    pub photo_id: Option<String>,
}

pub async fn machine_cover(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    headers: HeaderMap,
    Json(req): Json<MachineCoverReq>,
) -> ApiResult<Json<serde_json::Value>> {
    require_machine(&st, &headers)?;
    let ev = event_by_slug(&st, &slug).await?;
    let pid = req.photo_id.as_deref().map(str::trim).filter(|s| !s.is_empty());
    set_cover(&st, &ev.id, pid).await?;
    Ok(Json(json!({ "ok": true, "cover_photo_id": pid })))
}

/// Latest ready photos (for the cover picker) — id + filename only.
pub async fn machine_photos(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    require_machine(&st, &headers)?;
    let ev = event_by_slug(&st, &slug).await?;
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, filename FROM photos WHERE event_id = ?1 AND status = 'ready' \
         ORDER BY created_at DESC, id DESC LIMIT 30",
    )
    .bind(&ev.id)
    .fetch_all(&st.pool)
    .await
    .map_err(AppError::from)?;
    let items: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(id, filename)| json!({ "id": id, "filename": filename }))
        .collect();
    Ok(Json(json!({ "items": items })))
}
