use super::run_due::run_refresh_schedule_due_sweep_with_pool;
use crate::crates::core::config::Config;
use crate::crates::core::logging::{log_info, log_warn};
use crate::crates::jobs::common::make_pool;
use std::error::Error;
use tokio::time::Duration as TokioDuration;
use tokio::time::Instant;

const REFRESH_SCHEDULE_WORKER_DEFAULT_TICK_SECS: u64 = 30;
const REFRESH_SCHEDULE_WORKER_TICK_ENV: &str = "AXON_REFRESH_SCHEDULER_TICK_SECS";

pub fn refresh_schedule_tick_secs_default() -> u64 {
    REFRESH_SCHEDULE_WORKER_DEFAULT_TICK_SECS
}

fn refresh_schedule_tick_secs() -> u64 {
    std::env::var(REFRESH_SCHEDULE_WORKER_TICK_ENV)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|secs| *secs > 0)
        .unwrap_or_else(refresh_schedule_tick_secs_default)
}

pub(super) async fn handle_refresh_schedule_worker(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let tick_secs = refresh_schedule_tick_secs();
    let tick_duration = TokioDuration::from_secs(tick_secs);
    log_info(&format!(
        "refresh schedule worker started tick_secs={tick_secs} (env={REFRESH_SCHEDULE_WORKER_TICK_ENV})"
    ));

    let pool = make_pool(cfg).await?;

    loop {
        let sweep_start = Instant::now();
        log_info("refresh schedule worker running due sweep");
        match run_refresh_schedule_due_sweep_with_pool(cfg, &pool, 25).await {
            Ok(sweep) => {
                log_info(&format!(
                    "refresh schedule worker sweep complete claimed={} dispatched={} skipped={} failed={}",
                    sweep.claimed_count,
                    sweep.dispatched_count,
                    sweep.skipped_count,
                    sweep.failed_count
                ));
            }
            Err(err) => {
                log_warn(&format!("refresh schedule worker sweep failed: {err}"));
            }
        }

        let remaining = tick_duration.saturating_sub(sweep_start.elapsed());
        tokio::time::sleep(remaining).await;
    }
}
