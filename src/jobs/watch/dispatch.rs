//! Enqueue change-triggered crawls; guard against piling up.

use crate::core::config::Config;
use crate::jobs::backend::{JobKind, JobPayload};
use crate::jobs::config_snapshot::config_snapshot_json;
use crate::jobs::ops::enqueue_job;
use crate::jobs::query::job_status_row;
use sqlx::SqlitePool;
use std::error::Error;
use uuid::Uuid;

pub async fn crawl_job_active(pool: &SqlitePool, job_id: Uuid) -> bool {
    matches!(job_status_row(pool, JobKind::Crawl, job_id).await, Ok(Some(r)) if r.status.is_active())
}

pub async fn enqueue_change_crawl(
    pool: &SqlitePool,
    cfg: &Config,
    seed_url: &str,
    max_depth: usize,
) -> Result<Uuid, Box<dyn Error>> {
    // Defense-in-depth: the crawl worker / Spider path does not run the reqwest
    // SSRF resolver, so re-validate the seed here before enqueuing. Create-time
    // validation already covers watched URLs, but cluster seeds are derived
    // (common-prefix) and may not be one of the originally-validated URLs.
    crate::core::http::validate_url(seed_url)?;
    let mut crawl_cfg = cfg.clone();
    crawl_cfg.max_depth = max_depth;
    let config_json = config_snapshot_json(&crawl_cfg)?;
    let id = enqueue_job(
        pool,
        &JobPayload::Crawl {
            url: seed_url.to_string(),
            config_json,
        },
        &crawl_cfg,
    )
    .await?;
    Ok(id)
}

#[cfg(test)]
#[path = "dispatch_tests.rs"]
mod tests;
