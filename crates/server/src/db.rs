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
    Ok(pool)
}
