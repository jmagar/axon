use crate::cli::commands::ingest_common;
use crate::core::config::Config;
use crate::ingest::sessions::watch::{SessionsRuntimeAction, run_session_watch, smoke_watch};
use crate::jobs::ingest::IngestSource;
use crate::services::context::ServiceContext;
use crate::services::ingest as ingest_service;
use std::error::Error;

pub async fn run_sessions(
    cfg: &Config,
    service_context: &ServiceContext,
) -> Result<(), Box<dyn Error>> {
    match cfg.sessions_action {
        Some(SessionsRuntimeAction::WatchStatus { limit }) => {
            return run_watch_status(cfg, service_context, limit).await;
        }
        Some(SessionsRuntimeAction::SmokeWatch { timeout_secs }) => {
            return run_smoke_watch(cfg, service_context, timeout_secs).await;
        }
        _ => {}
    }

    if let Some(options) = cfg.sessions_watch.clone() {
        return run_session_watch(cfg, service_context, options)
            .await
            .map_err(|err| -> Box<dyn Error> { err.into() });
    }

    if ingest_common::maybe_handle_ingest_subcommand(cfg, service_context, "sessions").await? {
        return Ok(());
    }

    let source = IngestSource::Sessions {
        sessions_claude: cfg.sessions_claude,
        sessions_codex: cfg.sessions_codex,
        sessions_gemini: cfg.sessions_gemini,
        sessions_project: cfg.sessions_project.clone(),
    };

    if !cfg.wait {
        return ingest_common::enqueue_ingest_job(cfg, source, service_context).await;
    }

    run_ingest_sync(cfg).await
}

async fn run_watch_status(
    cfg: &Config,
    service_context: &ServiceContext,
    limit: usize,
) -> Result<(), Box<dyn Error>> {
    let pool = service_context
        .jobs
        .sqlite_pool()
        .ok_or("watch-status requires the SQLite job runtime")?;
    let status =
        crate::ingest::sessions::checkpoint::watch_status(pool.as_ref(), limit as i64).await?;
    if cfg.json_output {
        println!("{}", serde_json::to_string_pretty(&status)?);
    } else {
        println!(
            "session watch checkpoints={} errors={}",
            status.checkpoint_count, status.error_count
        );
    }
    Ok(())
}

async fn run_smoke_watch(
    cfg: &Config,
    service_context: &ServiceContext,
    timeout_secs: u64,
) -> Result<(), Box<dyn Error>> {
    let report = smoke_watch(cfg, service_context, timeout_secs).await?;
    if cfg.json_output {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!("session watch smoke probe ingested={}", report.ingested);
    }
    Ok(())
}

async fn run_ingest_sync(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let result = ingest_service::ingest_sessions(cfg, None).await?;
    let chunks = result.payload["chunks"]
        .as_u64()
        .ok_or("sessions: service payload missing 'chunks' field")? as usize;
    ingest_common::print_ingest_sync_result(cfg, "sessions", chunks, "local history paths");
    Ok(())
}
