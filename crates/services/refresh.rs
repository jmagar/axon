use crate::crates::core::config::Config;
use crate::crates::jobs::refresh::{
    cancel_refresh_job, cleanup_refresh_jobs, clear_refresh_jobs, get_refresh_job, list_refresh_jobs,
    list_refresh_schedules, recover_stale_refresh_jobs, run_refresh_once, run_refresh_worker,
    set_refresh_schedule_enabled, start_refresh_job,
};

pub use crate::crates::jobs::refresh::{
    RefreshJob, RefreshSchedule, RefreshScheduleCreate, create_refresh_schedule,
    delete_refresh_schedule, list_refresh_jobs as schedule_list_jobs,
};
use crate::crates::services::types::{RefreshRunResult, RefreshStartResult};
use std::error::Error;
use uuid::Uuid;

pub async fn refresh_now(
    cfg: &Config,
    urls: &[String],
) -> Result<RefreshRunResult, Box<dyn Error>> {
    let payload = run_refresh_once(cfg, urls).await?;
    Ok(RefreshRunResult { payload })
}

pub async fn refresh_start(
    cfg: &Config,
    urls: &[String],
) -> Result<RefreshStartResult, Box<dyn Error>> {
    let job_id = start_refresh_job(cfg, urls).await?;
    Ok(RefreshStartResult {
        job_id: job_id.to_string(),
        urls: urls.to_vec(),
    })
}

pub async fn refresh_status(
    cfg: &Config,
    job_id: Uuid,
) -> Result<Option<RefreshRunResult>, Box<dyn Error>> {
    let job = get_refresh_job(cfg, job_id).await?;
    Ok(job.map(|job| RefreshRunResult {
        payload: serde_json::to_value(job).unwrap_or(serde_json::Value::Null),
    }))
}

pub async fn refresh_list(
    cfg: &Config,
    limit: i64,
    offset: i64,
) -> Result<RefreshRunResult, Box<dyn Error>> {
    let jobs = list_refresh_jobs(cfg, limit, offset).await?;
    Ok(RefreshRunResult {
        payload: serde_json::to_value(jobs)?,
    })
}

pub async fn refresh_cancel(cfg: &Config, job_id: Uuid) -> Result<bool, Box<dyn Error>> {
    cancel_refresh_job(cfg, job_id).await
}

pub async fn refresh_cleanup(cfg: &Config) -> Result<u64, Box<dyn Error>> {
    cleanup_refresh_jobs(cfg).await
}

pub async fn refresh_clear(cfg: &Config) -> Result<u64, Box<dyn Error>> {
    clear_refresh_jobs(cfg).await
}

pub async fn refresh_recover(cfg: &Config) -> Result<u64, Box<dyn Error>> {
    recover_stale_refresh_jobs(cfg).await
}

pub async fn refresh_worker(cfg: &Config) -> Result<(), Box<dyn Error>> {
    run_refresh_worker(cfg).await
}

pub async fn refresh_schedule_list(
    cfg: &Config,
    limit: i64,
) -> Result<Vec<RefreshSchedule>, Box<dyn Error>> {
    list_refresh_schedules(cfg, limit).await
}

pub async fn refresh_schedule_create(
    cfg: &Config,
    schedule: &RefreshScheduleCreate,
) -> Result<RefreshSchedule, Box<dyn Error>> {
    create_refresh_schedule(cfg, schedule).await
}

pub async fn refresh_schedule_delete(cfg: &Config, name: &str) -> Result<bool, Box<dyn Error>> {
    delete_refresh_schedule(cfg, name).await
}

pub async fn refresh_schedule_enable(cfg: &Config, name: &str) -> Result<bool, Box<dyn Error>> {
    set_refresh_schedule_enabled(cfg, name, true).await
}

pub async fn refresh_schedule_disable(cfg: &Config, name: &str) -> Result<bool, Box<dyn Error>> {
    set_refresh_schedule_enabled(cfg, name, false).await
}
