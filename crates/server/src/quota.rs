//! Face-search token quota — metered on the hub ("ระบบเรา"), never on the
//! photographer's machine.
//!
//! Every photographer account gets `FACE_SEARCH_GRANT` tokens. One guest face
//! search that reaches the account's tunnel costs exactly one token, whatever
//! it matches. The counter lives in the hub database only; the desktop app and
//! the guest page never see the accounting, just the outcome.

use sqlx::SqlitePool;

pub const FACE_SEARCH_GRANT: i64 = 1000;

pub enum Charge {
    Charged { tokens_left: i64 },
    Exhausted { tokens_left: i64 },
}

/// The one request type that spends a token.
pub fn is_face_search(path: &str) -> bool {
    path.contains("/faces/search")
}

async fn insert_grant(pool: &SqlitePool, account: &str, tokens: i64) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT OR IGNORE INTO face_quota(account, tokens_left, used, updated_at) VALUES(?1,?2,0,?3)",
    )
    .bind(account)
    .bind(tokens)
    .bind(crate::util::now_ms())
    .execute(pool)
    .await
    .map(|_| ())
}

/// Spend one token, creating the account's balance at the full grant on first
/// use. SQLite serialises writers, so the guarded UPDATE is the atomic step.
pub async fn charge(pool: &SqlitePool, account: &str) -> anyhow::Result<Charge> {
    insert_grant(pool, account, FACE_SEARCH_GRANT).await?;
    let spent = sqlx::query(
        "UPDATE face_quota SET tokens_left = tokens_left - 1, used = used + 1, updated_at = ?2 \
         WHERE account = ?1 AND tokens_left > 0",
    )
    .bind(account)
    .bind(crate::util::now_ms())
    .execute(pool)
    .await?;
    let left = tokens_left(pool, account).await?;
    Ok(if spent.rows_affected() > 0 {
        Charge::Charged { tokens_left: left }
    } else {
        Charge::Exhausted { tokens_left: left }
    })
}

pub async fn tokens_left(pool: &SqlitePool, account: &str) -> anyhow::Result<i64> {
    let row: Option<(i64,)> = sqlx::query_as("SELECT tokens_left FROM face_quota WHERE account=?1")
        .bind(account)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(n,)| n).unwrap_or(FACE_SEARCH_GRANT))
}

/// `(tokens_left, tokens_used)` for one account.
pub async fn usage(pool: &SqlitePool, account: &str) -> anyhow::Result<(i64, i64)> {
    let row: Option<(i64, i64)> =
        sqlx::query_as("SELECT tokens_left, used FROM face_quota WHERE account=?1")
            .bind(account)
            .fetch_optional(pool)
            .await?;
    Ok(row.unwrap_or((FACE_SEARCH_GRANT, 0)))
}

/// Top-up (or, for housekeeping, correct) an account's balance. Returns the new
/// balance. Negative amounts are clamped at zero.
pub async fn add_tokens(pool: &SqlitePool, account: &str, amount: i64) -> anyhow::Result<i64> {
    insert_grant(pool, account, 0).await?;
    sqlx::query(
        "UPDATE face_quota SET tokens_left = MAX(0, tokens_left + ?2), updated_at = ?3 WHERE account = ?1",
    )
    .bind(account)
    .bind(amount)
    .bind(crate::util::now_ms())
    .execute(pool)
    .await?;
    Ok(tokens_left(pool, account).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> SqlitePool {
        use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
        // one connection: an in-memory SQLite database is per-connection
        let opts = SqliteConnectOptions::new().in_memory(true).create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE face_quota(\
               account TEXT PRIMARY KEY, tokens_left INTEGER NOT NULL, \
               used INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn first_charge_grants_full_balance() {
        let db = pool().await;
        assert!(matches!(
            charge(&db, "u-studio").await.unwrap(),
            Charge::Charged { tokens_left } if tokens_left == FACE_SEARCH_GRANT - 1
        ));
        assert_eq!(usage(&db, "u-studio").await.unwrap(), (999, 1));
    }

    #[tokio::test]
    async fn last_token_spends_then_searches_are_refused() {
        let db = pool().await;
        charge(&db, "u-tight").await.unwrap();
        sqlx::query("UPDATE face_quota SET tokens_left = 1 WHERE account='u-tight'")
            .execute(&db)
            .await
            .unwrap();

        assert!(matches!(
            charge(&db, "u-tight").await.unwrap(),
            Charge::Charged { tokens_left: 0 }
        ));
        assert!(matches!(
            charge(&db, "u-tight").await.unwrap(),
            Charge::Exhausted { tokens_left: 0 }
        ));
        // a refused search must not have been double-counted
        assert_eq!(usage(&db, "u-tight").await.unwrap(), (0, 2));
    }

    #[tokio::test]
    async fn topup_restores_a_spent_account() {
        let db = pool().await;
        sqlx::query(
            "INSERT INTO face_quota(account, tokens_left, used, updated_at) VALUES('u-wedding',0,1000,0)",
        )
        .execute(&db)
        .await
        .unwrap();
        assert_eq!(add_tokens(&db, "u-wedding", 500).await.unwrap(), 500);
        assert!(matches!(
            charge(&db, "u-wedding").await.unwrap(),
            Charge::Charged { tokens_left: 499 }
        ));
        assert_eq!(usage(&db, "u-wedding").await.unwrap(), (499, 1001));
    }

    #[test]
    fn only_the_search_costs() {
        assert!(is_face_search("/api/g/pch-abc/faces/search"));
        assert!(is_face_search("/api/g/pch-abc/faces/search?x=1"));
        assert!(!is_face_search("/api/g/pch-abc/faces/download"));
        assert!(!is_face_search("/api/g/pch-abc/photos"));
    }
}
