//! Cross-table job statistics queries.

use crate::crates::jobs::status::JobStatus;
use sqlx::PgPool;

use super::pool::make_pool;
use crate::crates::core::config::Config;

/// Count jobs stuck in `running` state beyond `stale_minutes` and jobs in `pending` state,
/// across all four job tables. Uses a pre-existing pool. Returns `(stale, pending)` counts,
/// or `None` on query failure.
///
/// Note: `stale_minutes` is clamped to a minimum of 1 to avoid matching all running jobs
/// when 0 is passed.
pub async fn count_stale_and_pending_jobs_with_pool(
    pool: &PgPool,
    stale_minutes: i64,
) -> Option<(i64, i64)> {
    let query = format!(
        r#"
        WITH all_jobs AS (
            SELECT status, updated_at FROM axon_crawl_jobs
            UNION ALL
            SELECT status, updated_at FROM axon_extract_jobs
            UNION ALL
            SELECT status, updated_at FROM axon_embed_jobs
            UNION ALL
            SELECT status, updated_at FROM axon_ingest_jobs
        )
        SELECT
            COUNT(*) FILTER (
                WHERE status = '{running}'
                  AND updated_at < NOW() - make_interval(mins => $1::int)
            ) AS stale,
            COUNT(*) FILTER (WHERE status = '{pending}') AS pending
        FROM all_jobs
    "#,
        running = JobStatus::Running.as_str(),
        pending = JobStatus::Pending.as_str(),
    );

    let stale_mins = stale_minutes.clamp(1, i32::MAX as i64) as i32;
    match sqlx::query_as::<_, (i64, i64)>(&query)
        .bind(stale_mins)
        .fetch_one(pool)
        .await
    {
        Ok((stale, pending)) => Some((stale, pending)),
        Err(_) => None,
    }
}

/// Count jobs stuck in `running` state beyond `stale_minutes` and jobs in `pending` state,
/// across all four job tables. Creates a new pool for the call.
/// Returns `(stale, pending)` counts, or `None` if Postgres is unreachable.
pub async fn count_stale_and_pending_jobs(cfg: &Config, stale_minutes: i64) -> Option<(i64, i64)> {
    let pool = match make_pool(cfg).await {
        Ok(p) => p,
        Err(_) => return None,
    };
    count_stale_and_pending_jobs_with_pool(&pool, stale_minutes).await
}
