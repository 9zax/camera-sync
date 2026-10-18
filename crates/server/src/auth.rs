use axum::extract::State;
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::error::{ApiResult, AppError};
use crate::util::{now_ms, parse_cookies, random_token, bearer_token};
use crate::SharedState;

pub const SESSION_COOKIE: &str = "wedsync_session";
const WEB_TTL_MS: i64 = 7 * 24 * 3600 * 1000;
const AGENT_TTL_MS: i64 = 90 * 24 * 3600 * 1000;

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub user_id: String,
    pub username: String,
}

pub async fn user_for_token(st: &SharedState, token: &str) -> Option<AuthUser> {
    sqlx::query_as::<_, (String, String)>(
        "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.token = ?1 AND s.expires_at > ?2",
    )
    .bind(token)
    .bind(now_ms())
    .fetch_optional(&st.pool)
    .await
    .ok()
    .flatten()
    .map(|(user_id, username)| AuthUser { user_id, username })
}

/// True when the request carries a valid admin session (cookie or bearer).
pub async fn is_admin_request(st: &SharedState, headers: &HeaderMap) -> bool {
    match token_from_headers(headers) {
        Some(t) => user_for_token(st, &t).await.is_some(),
        None => false,
    }
}

pub fn token_from_headers(headers: &HeaderMap) -> Option<String> {
    bearer_token(headers).or_else(|| parse_cookies(headers).get(SESSION_COOKIE).cloned())
}

impl axum::extract::FromRequestParts<SharedState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &SharedState) -> Result<Self, Self::Rejection> {
        let token = token_from_headers(&parts.headers)
            .ok_or_else(|| AppError::Unauthorized("not signed in".into()))?;
        user_for_token(state, &token)
            .await
            .ok_or_else(|| AppError::Unauthorized("invalid or expired session".into()))
    }
}

#[derive(Deserialize)]
pub struct LoginReq {
    pub username: String,
    pub password: String,
}

async fn create_session(st: &SharedState, user_id: &str, kind: &str, ttl_ms: i64) -> anyhow::Result<String> {
    let token = random_token();
    sqlx::query("INSERT INTO sessions(token, user_id, kind, expires_at) VALUES (?1,?2,?3,?4)")
        .bind(&token)
        .bind(user_id)
        .bind(kind)
        .bind(now_ms() + ttl_ms)
        .execute(&st.pool)
        .await?;
    Ok(token)
}

fn set_session_cookie(res: &mut Response, token: &str, ttl_ms: i64) {
    let max_age = ttl_ms / 1000;
    let cookie = format!("{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}");
    if let Ok(v) = axum::http::HeaderValue::from_str(&cookie) {
        res.headers_mut().append(axum::http::header::SET_COOKIE, v);
    }
}

fn hash_password(p: &str) -> anyhow::Result<String> {
    use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
    let salt = SaltString::generate(&mut OsRng);
    let hash = argon2::Argon2::default()
        .hash_password(p.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("password hashing failed: {e:?}"))?;
    Ok(hash.to_string())
}

fn verify_password(hash: &str, p: &str) -> bool {
    use argon2::password_hash::PasswordVerifier;
    match argon2::password_hash::PasswordHash::new(hash) {
        Ok(parsed) => argon2::Argon2::default()
            .verify_password(p.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

fn validate(req: &LoginReq) -> Result<(), AppError> {
    if req.username.trim().len() < 3 {
        return Err(AppError::bad("username must be at least 3 characters"));
    }
    if req.password.len() < 6 {
        return Err(AppError::bad("password must be at least 6 characters"));
    }
    Ok(())
}

pub async fn status(State(st): State<SharedState>) -> ApiResult<Json<serde_json::Value>> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&st.pool)
        .await?;
    Ok(Json(json!({ "needs_setup": count == 0 })))
}

pub async fn setup(
    State(st): State<SharedState>,
    Json(req): Json<LoginReq>,
) -> ApiResult<Response> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&st.pool)
        .await?;
    if count > 0 {
        return Err(AppError::Forbidden(
            "an admin account already exists — sign in instead".into(),
        ));
    }
    validate(&req)?;
    let id = crate::util::new_id();
    let hash = hash_password(&req.password).map_err(AppError::from)?;
    sqlx::query("INSERT INTO users(id, username, password_hash, created_at) VALUES (?1,?2,?3,?4)")
        .bind(&id)
        .bind(req.username.trim())
        .bind(&hash)
        .bind(now_ms())
        .execute(&st.pool)
        .await?;
    let token = create_session(&st, &id, "web", WEB_TTL_MS)
        .await
        .map_err(AppError::from)?;
    let mut res = Json(json!({ "username": req.username.trim() })).into_response();
    set_session_cookie(&mut res, &token, WEB_TTL_MS);
    Ok(res)
}

pub async fn login(State(st): State<SharedState>, Json(req): Json<LoginReq>) -> ApiResult<Response> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT id, password_hash FROM users WHERE username = ?1",
    )
    .bind(req.username.trim())
    .fetch_optional(&st.pool)
    .await?;
    let Some((user_id, hash)) = row else {
        return Err(AppError::Unauthorized("invalid username or password".into()));
    };
    if !verify_password(&hash, &req.password) {
        return Err(AppError::Unauthorized("invalid username or password".into()));
    }
    let token = create_session(&st, &user_id, "web", WEB_TTL_MS)
        .await
        .map_err(AppError::from)?;
    let mut res = Json(json!({ "ok": true })).into_response();
    set_session_cookie(&mut res, &token, WEB_TTL_MS);
    Ok(res)
}

pub async fn logout(
    State(st): State<SharedState>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    if let Some(token) = token_from_headers(&headers) {
        let _ = sqlx::query("DELETE FROM sessions WHERE token = ?1")
            .bind(&token)
            .execute(&st.pool)
            .await;
    }
    let res = (StatusCode::OK, Json(json!({ "ok": true })))
        .into_response()
        .with_clear_cookie();
    Ok(res)
}

pub trait ClearCookie {
    fn with_clear_cookie(self) -> Response;
}
impl ClearCookie for Response {
    fn with_clear_cookie(mut self) -> Response {
        let cookie =
            format!("{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
        if let Ok(v) = axum::http::HeaderValue::from_str(&cookie) {
            self.headers_mut().append(axum::http::header::SET_COOKIE, v);
        }
        self
    }
}

pub async fn me(user: AuthUser) -> Json<serde_json::Value> {
    Json(json!({ "username": user.username }))
}

pub async fn agent_login(
    State(st): State<SharedState>,
    Json(req): Json<LoginReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE username = ?1")
            .bind(req.username.trim())
            .fetch_optional(&st.pool)
            .await?;
    let Some((user_id, hash)) = row else {
        return Err(AppError::Unauthorized("invalid username or password".into()));
    };
    if !verify_password(&hash, &req.password) {
        return Err(AppError::Unauthorized("invalid username or password".into()));
    }
    let token = create_session(&st, &user_id, "agent", AGENT_TTL_MS)
        .await
        .map_err(AppError::from)?;
    let events: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, title, slug FROM events ORDER BY created_at DESC",
    )
    .fetch_all(&st.pool)
    .await?;
    Ok(Json(json!({
        "token": token,
        "expires_in_ms": AGENT_TTL_MS,
        "events": events.iter().map(|(id, title, slug)| json!({"id": id, "title": title, "slug": slug})).collect::<Vec<_>>(),
    })))
}
