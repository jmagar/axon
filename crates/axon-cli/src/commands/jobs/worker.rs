//! `axon jobs worker` — host the in-process unified worker runtime in a
//! standalone process.
//!
//! Used two ways:
//! - operators run it manually to drain/serve the durable queue without a
//!   full `axon serve`;
//! - the CLI auto-spawns it (detached) after `axon <source>` enqueues a
//!   detached job and no worker process currently holds the drain lock.
//!
//! Exactly one worker process per data dir holds
//! [`WorkerDrainLock`]; a second invocation exits immediately so racing
//! auto-spawns collapse to one drainer. Job-claiming correctness never
//! depends on the lock — `axon serve` (which does not hold it) can race a
//! drainer and the unified store's transactional claim keeps every job
//! single-owner.

use std::error::Error;

use axon_core::config::Config;
use axon_core::ui::{accent, muted, primary};
use axon_services::context::ServiceContext;
use axon_services::jobs::worker_loop::{WorkerLoopOptions, run_worker_until_idle};
use axon_services::runtime::{WorkerDrainLock, drain_lock_path};

pub(super) async fn run_worker(
    cfg: &Config,
    service_context: &ServiceContext,
) -> Result<(), Box<dyn Error>> {
    let lock_path = drain_lock_path(&axon_core::paths::axon_data_base_dir());
    let Some(_lock) = WorkerDrainLock::try_hold(&lock_path)
        .await
        .map_err(|err| -> Box<dyn Error> { err.to_string().into() })?
    else {
        if cfg.json_output {
            println!(
                "{}",
                serde_json::json!({
                    "worker": { "acquired_lock": false, "reason": "another worker process is active" }
                })
            );
        } else {
            println!(
                "  {}",
                muted("Another worker process is already active for this data dir; exiting.")
            );
        }
        return Ok(());
    };

    let idle_exit_secs = super::parse_u64_flag(cfg, "--idle-secs")?
        .unwrap_or(cfg.jobs_worker_idle_exit_secs)
        .min(86_400);

    if !cfg.json_output {
        println!("  {} {}", primary("Worker"), accent("unified job queue"));
        let lifetime = if idle_exit_secs == 0 {
            "until stopped".to_string()
        } else {
            format!("until idle for {idle_exit_secs}s")
        };
        println!("  {}", muted(&format!("Running {lifetime}.")));
    }

    let report =
        run_worker_until_idle(service_context, WorkerLoopOptions { idle_exit_secs }).await?;

    if cfg.json_output {
        println!(
            "{}",
            serde_json::json!({
                "worker": {
                    "acquired_lock": true,
                    "idle_exit_secs": idle_exit_secs,
                    "elapsed_secs": report.elapsed_secs,
                    "recovered_jobs": report.recovered_jobs,
                }
            })
        );
    } else {
        println!(
            "  {}",
            muted(&format!(
                "Queue idle — exiting after {}s ({} stale job(s) recovered).",
                report.elapsed_secs, report.recovered_jobs
            ))
        );
    }
    Ok(())
}
