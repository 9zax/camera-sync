use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::config::Config;

/// Idempotent schema bootstrap (CREATE ... IF NOT EXISTS), so no compile-time
/// migration machinery is needed for the single-binary server.
pub async fn init_pool(cfg: &Config) -> anyhow::Result<SqlitePool> {
    let opts = SqliteConnectOptions::new()
        .filename(cfg.db_path())
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(opts)
        .await?;
    sqlx::raw_sql(include_str!("../migrations/0001_init.sql"))
        .execute(&pool)
        .await?;
    // Columns added after 0001 shipped — guard with pragma checks so they
    // stay idempotent on every start.
    let cols: Vec<(String,)> = sqlx::query_as("SELECT name FROM pragma_table_info('events')")
        .fetch_all(&pool)
        .await?;
    if !cols.iter().any(|(name,)| name == "enabled") {
        sqlx::raw_sql("ALTER TABLE events ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")
            .execute(&pool)
            .await?;
    }
    if !cols.iter().any(|(name,)| name == "cover_photo_id") {
        sqlx::raw_sql("ALTER TABLE events ADD COLUMN cover_photo_id TEXT")
            .execute(&pool)
            .await?;
    }
    if !cols.iter().any(|(name,)| name == "guestbook_enabled") {
        sqlx::raw_sql("ALTER TABLE events ADD COLUMN guestbook_enabled INTEGER NOT NULL DEFAULT 1")
            .execute(&pool)
            .await?;
    }
    let user_cols: Vec<(String,)> = sqlx::query_as("SELECT name FROM pragma_table_info('users')")
        .fetch_all(&pool)
        .await?;
    if !user_cols.iter().any(|(name,)| name == "is_admin") {
        sqlx::raw_sql("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
            .execute(&pool)
            .await?;
    }
    if !user_cols.iter().any(|(name,)| name == "short_id") {
        sqlx::raw_sql("ALTER TABLE users ADD COLUMN short_id TEXT")
            .execute(&pool)
            .await?;
    }
    // guest wishes — text only, on the photographer's own disk like everything else
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS guestbook(\
           id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, \
           guest_id TEXT NOT NULL DEFAULT '', guest_name TEXT NOT NULL, message TEXT NOT NULL, \
           hidden INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
    )
    .execute(&pool)
    .await?;
    sqlx::raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_guestbook_event \
         ON guestbook(event_id, hidden, created_at DESC)",
    )
    .execute(&pool)
    .await?;
    // folders the photographer added in the desktop app — replayed on launch
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS import_dirs(\
           id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, \
           event_id TEXT NOT NULL, created_at INTEGER NOT NULL)",
    )
    .execute(&pool)
    .await?;
    // face-search tokens — only ever written by the hub (see quota.rs)
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS face_quota(\
           account TEXT PRIMARY KEY, tokens_left INTEGER NOT NULL, \
           used INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    )
    .execute(&pool)
    .await?;
    Ok(pool)
}
