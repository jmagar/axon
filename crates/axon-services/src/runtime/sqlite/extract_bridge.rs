//! Extract-only bridge from the unified `JobStore` onto the legacy
//! `ServiceJob` shape.
//!
//! `JobKind::Extract` now enqueues and executes on the unified job store
//! (`crates/axon-jobs/src/workers/unified/extract_runner.rs`), but every
//! CLI/MCP/REST caller still renders through `ServiceJob` (shared with
//! Crawl/Embed/Ingest, which remain on the legacy per-family backend). This
//! module is the one place that converts unified `JobSummary`/result DTOs
//! into `ServiceJob` so those shared renderers keep working unchanged for
//! Extract while other kinds still take the legacy path in
//! [`super::sqlite::SqliteServiceRuntime`].

use std::error::Error;
use std::sync::Arc;

use axon_api::source::{
    JobCancelRequest, JobCleanupRequest, JobId, JobKind as UnifiedJobKind, JobListRequest,
    JobRecoveryRequest, JobSummary, LifecycleStatus,
};
use axon_jobs::boundary::JobStore;
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::types::ServiceJob;

fn parse_timestamp(value: &axon_api::source::Timestamp) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&value.0)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

/// Collapse the 11-value unified `LifecycleStatus` onto the 5-value legacy
/// status vocabulary `ServiceJob` callers already render against.
fn legacy_status(status: LifecycleStatus) -> String {
    match status {
        LifecycleStatus::Queued
        | LifecycleStatus::Pending
        | LifecycleStatus::Waiting
        | LifecycleStatus::Blocked => "pending",
        LifecycleStatus::Running | LifecycleStatus::Canceling => "running",
        LifecycleStatus::Completed | LifecycleStatus::CompletedDegraded => "completed",
        LifecycleStatus::Failed | LifecycleStatus::Expired => "failed",
        LifecycleStatus::Canceled | LifecycleStatus::Skipped => "canceled",
    }
    .to_string()
}

fn job_summary_to_service_job(summary: JobSummary) -> ServiceJob {
    ServiceJob {
        id: summary.job_id.0,
        status: legacy_status(summary.status),
        created_at: parse_timestamp(&summary.created_at),
        updated_at: parse_timestamp(&summary.updated_at),
        started_at: summary.started_at.as_ref().map(parse_timestamp),
        finished_at: summary.finished_at.as_ref().map(parse_timestamp),
        error_text: summary.last_error.as_ref().map(|e| e.message.clone()),
        url: None,
        source_type: None,
        target: None,
        urls_json: None,
        progress_json: summary
            .counts
            .as_ref()
            .and_then(|counts| serde_json::to_value(counts).ok()),
        result_json: None,
        config_json: None,
        attempt_count: summary.attempt.max(1) as i64,
        active_attempt_id: None,
        last_reclaimed_at: None,
        last_reclaimed_reason: None,
    }
}

pub(super) async fn list(
    store: &Arc<dyn JobStore>,
    limit: i64,
    offset: i64,
) -> Result<Vec<ServiceJob>, Box<dyn Error + Send + Sync>> {
    // The unified store paginates by opaque cursor, not offset; Extract job
    // volumes are low enough that re-listing from the start and slicing is
    // an acceptable bridge until Extract's own cursor-aware CLI/MCP/REST
    // rendering lands.
    let page = store
        .list(JobListRequest {
            status: None,
            kind: Some(UnifiedJobKind::Extract),
            source_id: None,
            watch_id: None,
            limit: Some((offset + limit).clamp(1, 1000) as u32),
            cursor: None,
        })
        .await
        .map_err(|e| Box::<dyn Error + Send + Sync>::from(e.message))?;
    Ok(page
        .items
        .into_iter()
        .skip(offset.max(0) as usize)
        .take(limit.max(0) as usize)
        .map(job_summary_to_service_job)
        .collect())
}

pub(super) async fn status(
    store: &Arc<dyn JobStore>,
    id: Uuid,
) -> Result<Option<ServiceJob>, Box<dyn Error + Send + Sync>> {
    let summary = store
        .get(JobId::new(id))
        .await
        .map_err(|e| Box::<dyn Error + Send + Sync>::from(e.message))?;
    Ok(summary.map(job_summary_to_service_job))
}

pub(super) async fn cancel(
    store: &Arc<dyn JobStore>,
    id: Uuid,
) -> Result<bool, Box<dyn Error + Send + Sync>> {
    let result = store
        .cancel(
            JobId::new(id),
            JobCancelRequest {
                reason: Some("cancel requested via extract job surface".to_string()),
                force_after_ms: None,
            },
        )
        .await
        .map_err(|e| Box::<dyn Error + Send + Sync>::from(e.message))?;
    Ok(matches!(
        result.status,
        LifecycleStatus::Canceling | LifecycleStatus::Canceled
    ))
}

pub(super) async fn cleanup(
    store: &Arc<dyn JobStore>,
) -> Result<u64, Box<dyn Error + Send + Sync>> {
    let result = store
        .cleanup(JobCleanupRequest {
            dry_run: false,
            kind: Some(UnifiedJobKind::Extract),
            older_than: None,
            status: None,
            limit: Some(500),
            older_than_seconds: None,
            confirm_all_terminal: true,
        })
        .await
        .map_err(|e| Box::<dyn Error + Send + Sync>::from(e.message))?;
    Ok(result.deleted)
}

pub(super) async fn clear(store: &Arc<dyn JobStore>) -> Result<u64, Box<dyn Error + Send + Sync>> {
    // `clear` is the CLI's "purge the whole queue" verb — same as cleanup for
    // the unified backend since both drain via the same terminal-job sweep.
    cleanup(store).await
}

pub(super) async fn recover(
    store: &Arc<dyn JobStore>,
    stale_threshold_ms: i64,
) -> Result<u64, Box<dyn Error + Send + Sync>> {
    let stale_before = axon_api::source::Timestamp::from(
        Utc::now() - chrono::Duration::milliseconds(stale_threshold_ms.max(0)),
    );
    let result = store
        .recover(JobRecoveryRequest {
            kind: Some(UnifiedJobKind::Extract),
            stale_before: Some(stale_before),
            limit: None,
            older_than_seconds: None,
            dry_run: false,
            allow_without_cutoff: false,
        })
        .await
        .map_err(|e| Box::<dyn Error + Send + Sync>::from(e.message))?;
    Ok(result.recovered)
}
