use sqlx::{SqliteConnection, SqlitePool, pool::PoolConnection};
use uuid::Uuid;

use crate::core::config::Config;
use crate::jobs::backend::JobPayload;
use crate::jobs::error::JobError;
use crate::jobs::lite::store::now_ms;

/// Check whether the pending job count for a given queue is at or above the configured cap.
///
/// `table` is the SQL table name (e.g. `axon_crawl_jobs`).
/// `queue_name` is the human-readable queue name used in the error variant.
/// `cap` is the cap (`0` = unlimited; `>= 1` rejects when `pending >= cap`).
///
/// Generic over the executor so callers can pass `&SqlitePool` (test helpers)
/// or `&mut SqliteConnection` (the immediate-transaction path used by
/// `enqueue_job`). Both call sites share the same COUNT + threshold logic.
///
/// # SQL injection safety
///
/// `table` is interpolated directly into the SQL string because sqlx does not
/// support binding a table name. The invariant is that `table` is a compile-time
/// `&'static str` literal, supplied only by the `enqueue_job` callsites in this
/// file (`"axon_crawl_jobs"`, `"axon_embed_jobs"`, `"axon_extract_jobs"`,
/// `"axon_ingest_jobs"`). Do **not** call this function with attacker- or
/// caller-controlled `table` values.
pub(super) async fn check_pending_cap_for<'e, E>(
    executor: E,
    table: &'static str,
    queue_name: &'static str,
    cap: u64,
) -> Result<(), JobError>
where
    E: sqlx::SqliteExecutor<'e>,
{
    if cap == 0 {
        return Ok(());
    }
    let query = format!("SELECT COUNT(*) FROM {table} WHERE status = 'pending'");
    let count_i64: i64 = sqlx::query_scalar(&query).fetch_one(executor).await?;
    // SQLite COUNT(*) is non-negative in practice, but defend against a wrapping
    // cast: clamp negatives to 0 and refuse to consult the cap if conversion fails.
    let count: u64 = u64::try_from(count_i64).unwrap_or(0);
    if count >= cap {
        return Err(JobError::QueueCapacityExceeded {
            kind: queue_name,
            cap,
            current: count,
        });
    }
    Ok(())
}

/// Acquire a dedicated connection and open a `BEGIN IMMEDIATE` transaction on
/// it. sqlx's `pool.begin()` always emits plain `BEGIN` (deferred), and a
/// follow-up `BEGIN IMMEDIATE` on the same connection errors as a nested
/// transaction — so we go through a raw connection instead. The caller is
/// responsible for issuing `COMMIT` (or `ROLLBACK`) before dropping the
/// connection.
async fn begin_immediate(pool: &SqlitePool) -> Result<PoolConnection<sqlx::Sqlite>, sqlx::Error> {
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;
    Ok(conn)
}

async fn commit(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    sqlx::query("COMMIT").execute(&mut *conn).await?;
    Ok(())
}

async fn rollback_best_effort(conn: &mut SqliteConnection) {
    if let Err(e) = sqlx::query("ROLLBACK").execute(&mut *conn).await {
        tracing::warn!(error = %e, "enqueue: ROLLBACK after failed transaction errored");
    }
}

/// Insert a new job row with status='pending'. Returns the new job's UUID.
///
/// Pending-queue caps are sourced from `cfg.max_pending_{crawl,embed,extract,ingest}_jobs`
/// (priority CLI flag > env > TOML > default). Pass `&Config::default_lite()` from
/// tests to use the built-in defaults (100/50/50/50) — those are well above any
/// reasonable test fixture so production caps don't accidentally fail tests.
///
/// The cap COUNT and the INSERT run inside a `BEGIN IMMEDIATE` transaction so
/// concurrent enqueues serialize on the SQLite RESERVED write lock — without
/// it, two callers can both observe `count=0`, pass the cap check, and
/// double-insert past the configured cap.
pub async fn enqueue_job(
    pool: &SqlitePool,
    payload: &JobPayload,
    cfg: &Config,
) -> Result<Uuid, JobError> {
    let id = Uuid::new_v4();
    let now = now_ms();
    let id_str = id.to_string();

    let mut conn = begin_immediate(pool).await?;

    let result = match payload {
        JobPayload::Crawl { url, config_json } => {
            insert_crawl(&mut conn, &id_str, url, config_json, now, cfg).await
        }
        JobPayload::Embed { input, config_json } => {
            insert_embed(&mut conn, &id_str, input, config_json, now, cfg).await
        }
        JobPayload::Extract { urls, config_json } => {
            insert_extract(&mut conn, &id_str, urls, config_json, now, cfg).await
        }
        JobPayload::Ingest {
            target,
            source_type,
            config_json,
        } => {
            insert_ingest(
                &mut conn,
                &id_str,
                target,
                source_type,
                config_json,
                now,
                cfg,
            )
            .await
        }
    };

    match result {
        Ok(()) => match commit(&mut conn).await {
            Ok(()) => Ok(id),
            Err(commit_err) => {
                // sqlx doesn't auto-rollback on PoolConnection::drop, so a
                // failed COMMIT would leave the next pool checkout inside a
                // stale BEGIN IMMEDIATE.
                rollback_best_effort(&mut conn).await;
                Err(commit_err.into())
            }
        },
        Err(e) => {
            rollback_best_effort(&mut conn).await;
            Err(e)
        }
    }
}

async fn insert_crawl(
    conn: &mut SqliteConnection,
    id_str: &str,
    url: &str,
    config_json: &str,
    now: i64,
    cfg: &Config,
) -> Result<(), JobError> {
    check_pending_cap_for(
        &mut *conn,
        "axon_crawl_jobs",
        "crawl",
        cfg.max_pending_crawl_jobs as u64,
    )
    .await?;
    sqlx::query(
        "INSERT INTO axon_crawl_jobs (id, status, url, config_json, created_at, updated_at) \
         VALUES (?, 'pending', ?, ?, ?, ?)",
    )
    .bind(id_str)
    .bind(url)
    .bind(config_json)
    .bind(now)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn insert_embed(
    conn: &mut SqliteConnection,
    id_str: &str,
    input: &str,
    config_json: &str,
    now: i64,
    cfg: &Config,
) -> Result<(), JobError> {
    check_pending_cap_for(
        &mut *conn,
        "axon_embed_jobs",
        "embed",
        cfg.max_pending_embed_jobs as u64,
    )
    .await?;
    sqlx::query(
        "INSERT INTO axon_embed_jobs (id, status, input_text, config_json, created_at, updated_at) \
         VALUES (?, 'pending', ?, ?, ?, ?)",
    )
    .bind(id_str)
    .bind(input)
    .bind(config_json)
    .bind(now)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn insert_extract(
    conn: &mut SqliteConnection,
    id_str: &str,
    urls: &[String],
    config_json: &str,
    now: i64,
    cfg: &Config,
) -> Result<(), JobError> {
    check_pending_cap_for(
        &mut *conn,
        "axon_extract_jobs",
        "extract",
        cfg.max_pending_extract_jobs as u64,
    )
    .await?;
    let urls_json = serde_json::to_string(urls).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
    sqlx::query(
        "INSERT INTO axon_extract_jobs (id, status, urls_json, config_json, created_at, updated_at) \
         VALUES (?, 'pending', ?, ?, ?, ?)",
    )
    .bind(id_str)
    .bind(&urls_json)
    .bind(config_json)
    .bind(now)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn insert_ingest(
    conn: &mut SqliteConnection,
    id_str: &str,
    target: &str,
    source_type: &str,
    config_json: &str,
    now: i64,
    cfg: &Config,
) -> Result<(), JobError> {
    check_pending_cap_for(
        &mut *conn,
        "axon_ingest_jobs",
        "ingest",
        cfg.max_pending_ingest_jobs as u64,
    )
    .await?;
    sqlx::query(
        "INSERT INTO axon_ingest_jobs (id, status, target, source_type, config_json, created_at, updated_at) \
         VALUES (?, 'pending', ?, ?, ?, ?, ?)",
    )
    .bind(id_str)
    .bind(target)
    .bind(source_type)
    .bind(config_json)
    .bind(now)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    Ok(())
}
