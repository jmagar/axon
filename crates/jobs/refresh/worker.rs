use super::{RefreshJobConfig, TABLE, ensure_schema_once, processor::process_refresh_job};
use crate::crates::core::config::Config;
use crate::crates::core::logging::log_info;
use crate::crates::jobs::common::{make_pool, reclaim_stale_running_jobs};
use crate::crates::jobs::status::JobStatus;
use crate::crates::jobs::worker_lane::{ProcessFn, WorkerConfig, run_job_worker};
use std::error::Error;
use std::sync::Arc;
use uuid::Uuid;

pub async fn run_refresh_worker(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let pool = make_pool(cfg).await?;
    ensure_schema_once(&pool).await?;

    let wc = WorkerConfig {
        table: TABLE,
        queue_name: cfg.refresh_queue.clone(),
        job_kind: "refresh",
        consumer_tag_prefix: "refresh-worker",
        lane_count: 2,
    };

    let process_fn: ProcessFn =
        Arc::new(|cfg, pool, id| Box::pin(process_refresh_job(cfg, pool, id)));

    run_job_worker(cfg, pool, &wc, process_fn).await
}

pub async fn run_refresh_once(
    cfg: &Config,
    urls: &[String],
) -> Result<serde_json::Value, Box<dyn Error>> {
    let pool = make_pool(cfg).await?;
    ensure_schema_once(&pool).await?;

    let id = Uuid::new_v4();
    let urls_json = serde_json::to_value(urls)?;
    let cfg_json = serde_json::to_value(RefreshJobConfig {
        urls: urls.to_vec(),
        embed: cfg.embed,
        output_dir: cfg.output_dir.to_string_lossy().to_string(),
    })?;

    sqlx::query(
        "INSERT INTO axon_refresh_jobs (id, status, urls_json, config_json, started_at) VALUES ($1, $2, $3, $4, NOW())",
    )
    .bind(id)
    .bind(JobStatus::Running.as_str())
    .bind(urls_json)
    .bind(cfg_json)
    .execute(&pool)
    .await?;

    process_refresh_job(cfg.clone(), pool.clone(), id).await;

    let result_json = sqlx::query_scalar::<_, Option<serde_json::Value>>(
        "SELECT result_json FROM axon_refresh_jobs WHERE id=$1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await?
    .unwrap_or_else(|| serde_json::json!({}));

    Ok(result_json)
}

pub async fn recover_stale_refresh_jobs_startup(cfg: &Config) -> Result<u64, Box<dyn Error>> {
    let pool = make_pool(cfg).await?;
    ensure_schema_once(&pool).await?;
    let stats = reclaim_stale_running_jobs(
        &pool,
        TABLE,
        "refresh",
        cfg.watchdog_stale_timeout_secs,
        cfg.watchdog_confirm_secs,
        "startup",
    )
    .await?;
    log_info(&format!(
        "refresh watchdog startup reclaimed={} candidates={}",
        stats.reclaimed_jobs, stats.stale_candidates
    ));
    Ok(stats.reclaimed_jobs)
}
