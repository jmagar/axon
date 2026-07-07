use super::*;
use crate::context::ServiceContext;
use crate::jobs as job_service;
use axon_jobs::backend::JobKind as LegacyJobKind;
use std::sync::Arc;
use std::time::Duration;

async fn test_ctx_with_workers() -> ServiceContext {
    let dir = tempfile::tempdir().expect("tempdir");
    let cfg = axon_core::config::Config {
        sqlite_path: dir.path().join("jobs.db"),
        ..axon_core::config::Config::test_default()
    };
    std::mem::forget(dir);
    ServiceContext::new_with_workers(Arc::new(cfg))
        .await
        .expect("service context")
}

/// Extract now enqueues onto the unified `JobStore` and runs on the real
/// unified worker (not the legacy per-family `axon_extract_jobs` backend),
/// while `job_service::job_status`/`list_jobs`/`cancel_job`/etc. for
/// `JobKind::Extract` bridge onto the same store (see
/// `runtime/sqlite/extract_bridge.rs`) so existing CLI/MCP/REST callers keep
/// working unchanged. Empty URLs keep this deterministic and network-free.
#[tokio::test]
async fn extract_job_runs_end_to_end_on_the_unified_store() {
    let ctx = test_ctx_with_workers().await;

    // `extract_start_with_context` only rejects an empty *slice* -- a single
    // deliberately-invalid URL keeps this test network-free (it fails fast
    // in URL parsing/fetch) while still proving the unified worker really
    // dispatches to `axon_extract::sync::extract_sync`, not the
    // `job_runner.unsupported_stage` catch-all.
    let outcome =
        extract_start_with_context(ctx.cfg(), &["not-a-real-url".to_string()], None, &ctx, None)
            .await
            .expect("enqueue");
    let job_id = uuid::Uuid::parse_str(&outcome.result.job_id).expect("job id");

    let mut status = None;
    for _ in 0..100 {
        let job = job_service::job_status(&ctx, LegacyJobKind::Extract, job_id)
            .await
            .expect("job_status")
            .expect("job exists");
        if job.status != "pending" && job.status != "running" {
            status = Some(job);
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let job = status.expect("extract job reached a terminal status within timeout");
    let unsupported_stage = job
        .error_text
        .as_deref()
        .is_some_and(|text| text.contains("not wired yet"));
    assert!(
        !unsupported_stage,
        "extract must dispatch to the real runner, not the catch-all: {:?}",
        job.error_text
    );

    let jobs = job_service::list_jobs(&ctx, LegacyJobKind::Extract, 10, 0)
        .await
        .expect("list_jobs");
    assert!(jobs.iter().any(|j| j.id == job_id));
}
