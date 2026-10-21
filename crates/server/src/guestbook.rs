//! Guest wishes — a text guestbook stored in SQLite on the photographer's
//! machine. Guests can write without an account; the photographer can hide
//! or delete anything from the admin panel.

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthUser;
use crate::error::{ApiResult, AppError};
use crate::events;
use crate::guest::{event_or_404, require_pin};
use crate::util::{new_id, now_ms, valid_guest_id};
use crate::SharedState;

#[derive(sqlx::FromRow, serde::Serialize)]
pub struct Wish {
    pub id: String,
    pub guest_name: String,
    pub message: String,
    pub hidden: i64,
    pub created_at: i64,
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub limit: Option<i64>,
}

pub async fn guest_list(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    Query(q): Query<ListQuery>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    let ev = event_or_404(&st, &slug).await?;
    require_pin(&st, &ev, &headers).await?;
    let limit = q.limit.unwrap_or(300).clamp(1, 500);
    let items = sqlx::query_as::<_, Wish>(
        "SELECT id, guest_name, message, hidden, created_at FROM guestbook \
         WHERE event_id=?1 AND hidden=0 ORDER BY created_at DESC, id DESC LIMIT ?2",
    )
    .bind(&ev.id)
    .bind(limit)
    .fetch_all(&st.pool)
    .await
    .map_err(AppError::from)?;
    let total: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM guestbook WHERE event_id=?1 AND hidden=0")
            .bind(&ev.id)
            .fetch_one(&st.pool)
            .await
            .unwrap_or(0);
    Ok(Json(json!({ "items": items, "total": total })))
}

#[derive(Deserialize)]
pub struct CreateReq {
    pub guest_id: String,
    pub guest_name: String,
    pub message: String,
}

pub async fn create(
    State(st): State<SharedState>,
    Path(slug): Path<String>,
    headers: HeaderMap,
    Json(req): Json<CreateReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let ev = event_or_404(&st, &slug).await?;
    require_pin(&st, &ev, &headers).await?;
    if ev.guestbook_enabled == 0 {
        return Err(AppError::ServiceUnavailable("งานนี้ปิดสมุดอวยพรอยู่".into()));
    }
    if !valid_guest_id(&req.guest_id) {
        return Err(AppError::bad("guest_id ไม่ถูกต้อง"));
    }
    let name = req.guest_name.trim();
    let message = req.message.trim();
    if name.is_empty() || name.chars().count() > 40 {
        return Err(AppError::bad("กรุณาใส่ชื่อผู้ส่ง (ไม่เกิน 40 ตัวอักษร)"));
    }
    if message.is_empty() || message.chars().count() > 500 {
        return Err(AppError::bad("กรุณาเขียนคำอวยพร (ไม่เกิน 500 ตัวอักษร)"));
    }

    // light per-device cooldown — keeps a double-tap from posting twice
    let last: Option<(i64,)> = sqlx::query_as(
        "SELECT created_at FROM guestbook WHERE event_id=?1 AND guest_id=?2 \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&ev.id)
    .bind(&req.guest_id)
    .fetch_optional(&st.pool)
    .await
    .map_err(AppError::from)?;
    let now = now_ms();
    if let Some((ts,)) = last {
        if now - ts < 8_000 {
            return Err(AppError::Conflict(
                "เพิ่งส่งคำอวยพรไปแล้ว — รอสักครู่แล้วลองอีกครั้งนะ".into(),
            ));
        }
    }

    let id = new_id();
    sqlx::query(
        "INSERT INTO guestbook(id, event_id, guest_id, guest_name, message, hidden, created_at) \
         VALUES (?1,?2,?3,?4,?5,0,?6)",
    )
    .bind(&id)
    .bind(&ev.id)
    .bind(&req.guest_id)
    .bind(name)
    .bind(message)
    .bind(now)
    .execute(&st.pool)
    .await
    .map_err(AppError::from)?;

    Ok(Json(json!({
        "item": Wish {
            id,
            guest_name: name.to_string(),
            message: message.to_string(),
            hidden: 0,
            created_at: now,
        }
    })))
}

pub async fn admin_list(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let ev = events::fetch_event(&st, &id).await?;
    let items = sqlx::query_as::<_, Wish>(
        "SELECT id, guest_name, message, hidden, created_at FROM guestbook \
         WHERE event_id=?1 ORDER BY created_at DESC, id DESC LIMIT 1000",
    )
    .bind(&ev.id)
    .fetch_all(&st.pool)
    .await
    .map_err(AppError::from)?;
    let total = items.len();
    Ok(Json(json!({ "items": items, "total": total })))
}

#[derive(Deserialize)]
pub struct HideReq {
    pub hidden: bool,
}

pub async fn admin_hide(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path((id, wish_id)): Path<(String, String)>,
    Json(req): Json<HideReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let res = sqlx::query("UPDATE guestbook SET hidden=?1 WHERE id=?2 AND event_id=?3")
        .bind(req.hidden as i64)
        .bind(&wish_id)
        .bind(&id)
        .execute(&st.pool)
        .await
        .map_err(AppError::from)?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("ไม่พบคำอวยพรนี้"));
    }
    Ok(Json(json!({ "ok": true, "hidden": req.hidden })))
}

pub async fn admin_delete(
    State(st): State<SharedState>,
    _user: AuthUser,
    Path((id, wish_id)): Path<(String, String)>,
) -> ApiResult<Json<serde_json::Value>> {
    let res = sqlx::query("DELETE FROM guestbook WHERE id=?1 AND event_id=?2")
        .bind(&wish_id)
        .bind(&id)
        .execute(&st.pool)
        .await
        .map_err(AppError::from)?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("ไม่พบคำอวยพรนี้"));
    }
    Ok(Json(json!({ "ok": true })))
}
