use axon_api::source::*;

use crate::boundary::JobStore;
use crate::store::open_sqlite_pool;
use crate::unified::SqliteUnifiedJobStore;

async fn store() -> SqliteUnifiedJobStore {
    SqliteUnifiedJobStore::new(open_sqlite_pool(":memory:").await.expect("open sqlite"))
}

fn create_request() -> JobCreateRequest {
    JobCreateRequest {
        job_kind: JobKind::Source,
        job_intent: JobIntent::Run,
        source_id: Some(SourceId::new("src_local")),
        watch_id: None,
        parent_job_id: None,
        root_job_id: None,
        priority: JobPriority::Normal,
        idempotency_key: Some("idem-local".to_string()),
        stage_plan: vec![JobStagePlan {
            phase: PipelinePhase::Embedding,
            required: true,
            provider_requirements: Vec::new(),
            estimated_items: Some(3),
        }],
        request: Some(serde_json::json!({"source": "/tmp/project"})),
        metadata: MetadataMap::new(),
    }
}

#[tokio::test]
async fn migration_creates_canonical_job_tables() {
    let pool = open_sqlite_pool(":memory:").await.expect("open sqlite");
    let tables = [
        "jobs",
        "job_attempts",
        "job_stages",
        "job_events",
        "job_heartbeats",
        "job_artifacts",
    ];
    for table in tables {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .bind(table)
        .fetch_one(&pool)
        .await
        .expect("sqlite_master query");
        assert_eq!(count, 1, "{table} should exist");
    }
}

#[tokio::test]
async fn create_is_idempotent_and_get_returns_summary() {
    let store = store().await;
    let first = store.create(create_request()).await.expect("create job");
    let second = store
        .create(create_request())
        .await
        .expect("idempotent create");
    assert_eq!(first.job_id, second.job_id);

    let summary = store
        .get(first.job_id)
        .await
        .expect("get job")
        .expect("job exists");
    assert_eq!(summary.kind, JobKind::Source);
    assert_eq!(summary.intent, Some(JobIntent::Run));
    assert_eq!(summary.status, LifecycleStatus::Queued);
    assert_eq!(summary.phase, PipelinePhase::Queued);
    assert_eq!(summary.source_id, Some(SourceId::new("src_local")));
}

#[tokio::test]
async fn status_update_enforces_state_machine_and_persists_progress() {
    let store = store().await;
    let job = store.create(create_request()).await.expect("create job");

    let invalid = store
        .update_status(JobStatusUpdate {
            job_id: job.job_id,
            status: LifecycleStatus::Completed,
            phase: PipelinePhase::Complete,
            stage_id: None,
            counts: None,
            current: None,
            message: None,
            error: None,
        })
        .await;
    assert!(invalid.is_err(), "queued -> completed should be rejected");

    let counts = StageCounts {
        items_total: Some(2),
        items_done: 1,
        documents_total: Some(1),
        documents_done: 1,
        chunks_total: Some(4),
        chunks_done: 2,
        bytes_total: None,
        bytes_done: 0,
    };
    store
        .update_status(JobStatusUpdate {
            job_id: job.job_id,
            status: LifecycleStatus::Running,
            phase: PipelinePhase::Embedding,
            stage_id: None,
            counts: Some(counts.clone()),
            current: Some(ProgressCurrent {
                source_item_key: Some(SourceItemKey::new("src/lib.rs")),
                document_id: None,
                chunk_id: None,
                adapter: Some("local".to_string()),
                provider: Some(ProviderId::new("tei")),
                message: Some("embedding src/lib.rs".to_string()),
            }),
            message: Some("running".to_string()),
            error: None,
        })
        .await
        .expect("queued -> running");

    let summary = store
        .get(job.job_id)
        .await
        .expect("get job")
        .expect("job exists");
    assert_eq!(summary.status, LifecycleStatus::Running);
    assert_eq!(summary.phase, PipelinePhase::Embedding);
    assert_eq!(summary.counts, Some(counts));
    assert!(summary.started_at.is_some());
}

#[tokio::test]
async fn append_event_requires_monotonic_sequences_and_filters_events() {
    let store = store().await;
    let job = store.create(create_request()).await.expect("create job");

    let skipped = store
        .append_event(progress_event(job.job_id, 2, Visibility::Public))
        .await;
    assert!(skipped.is_err(), "first event must be sequence 1");

    store
        .append_event(progress_event(job.job_id, 1, Visibility::Internal))
        .await
        .expect("append first event");
    store
        .append_event(progress_event(job.job_id, 2, Visibility::Public))
        .await
        .expect("append second event");

    let public_events = store
        .events(JobEventListRequest {
            job_id: job.job_id,
            phase: None,
            severity: None,
            visibility: Some(Visibility::Public),
            since_sequence: None,
            limit: Some(10),
            cursor: None,
        })
        .await
        .expect("list events");
    assert_eq!(public_events.events.len(), 1);
    assert_eq!(public_events.events[0].sequence, 2);
    assert_eq!(public_events.last_sequence, Some(2));
}

#[tokio::test]
async fn heartbeat_updates_latest_job_summary_and_history() {
    let store = store().await;
    let job = store.create(create_request()).await.expect("create job");
    let heartbeat = JobHeartbeat {
        job_id: job.job_id,
        attempt: 1,
        worker_id: Some("worker-a".to_string()),
        phase: PipelinePhase::Embedding,
        status: LifecycleStatus::Running,
        stage_id: None,
        heartbeat_at: Timestamp("2026-07-01T12:00:00Z".to_string()),
        last_event_sequence: Some(7),
        counts: None,
        provider_reservations: Vec::new(),
    };

    store.heartbeat(heartbeat.clone()).await.expect("heartbeat");

    let summary = store
        .get(job.job_id)
        .await
        .expect("get job")
        .expect("job exists");
    assert_eq!(summary.phase, PipelinePhase::Embedding);
    assert_eq!(summary.status, LifecycleStatus::Running);
    assert_eq!(summary.attempt, 1);
    assert_eq!(summary.heartbeat, Some(heartbeat));
}

#[tokio::test]
async fn control_operations_cancel_retry_recover_cleanup_and_list_artifacts() {
    let store = store().await;
    let job = store.create(create_request()).await.expect("create job");
    store
        .update_status(JobStatusUpdate {
            job_id: job.job_id,
            status: LifecycleStatus::Running,
            phase: PipelinePhase::Embedding,
            stage_id: None,
            counts: None,
            current: None,
            message: None,
            error: None,
        })
        .await
        .expect("running");

    let cancel = store
        .cancel(
            job.job_id,
            JobCancelRequest {
                reason: Some("user requested".to_string()),
                force_after_ms: None,
            },
        )
        .await
        .expect("cancel");
    assert_eq!(cancel.status, LifecycleStatus::Canceling);
    assert_eq!(cancel.reason.as_deref(), Some("user requested"));

    store
        .update_status(JobStatusUpdate {
            job_id: job.job_id,
            status: LifecycleStatus::Canceled,
            phase: PipelinePhase::Canceled,
            stage_id: None,
            counts: None,
            current: None,
            message: None,
            error: None,
        })
        .await
        .expect("canceled");
    let retry = store
        .retry(
            job.job_id,
            JobRetryRequest {
                mode: JobRetryMode::SameConfig,
                from_phase: None,
                idempotency_key: None,
                overrides: MetadataMap::new(),
            },
        )
        .await
        .expect("retry");
    assert_eq!(retry.original_job_id, job.job_id);
    assert_eq!(retry.retry_job.status, LifecycleStatus::Queued);

    let running = store
        .create(JobCreateRequest {
            idempotency_key: Some("recover-running".to_string()),
            ..create_request()
        })
        .await
        .expect("create running job");
    store
        .update_status(JobStatusUpdate {
            job_id: running.job_id,
            status: LifecycleStatus::Running,
            phase: PipelinePhase::Embedding,
            stage_id: None,
            counts: None,
            current: None,
            message: None,
            error: None,
        })
        .await
        .expect("running");
    let recovery = store
        .recover(JobRecoveryRequest {
            kind: Some(JobKind::Source),
            older_than_seconds: None,
            dry_run: false,
        })
        .await
        .expect("recover");
    assert_eq!(recovery.jobs_scanned, 1);
    assert_eq!(recovery.jobs_failed, 1);

    let artifacts = store
        .artifacts(JobArtifactListRequest {
            job_id: retry.retry_job.job_id,
            kind: None,
            limit: Some(7),
            cursor: None,
        })
        .await
        .expect("artifacts");
    assert!(artifacts.artifacts.is_empty());
    assert_eq!(artifacts.limit, 7);

    let cleanup = store
        .cleanup(JobCleanupRequest {
            older_than_seconds: None,
            dry_run: false,
        })
        .await
        .expect("cleanup");
    assert_eq!(cleanup.jobs_pruned, 2);
}

fn progress_event(job_id: JobId, sequence: u64, visibility: Visibility) -> SourceProgressEvent {
    SourceProgressEvent {
        event_id: format!("event-{sequence}"),
        sequence,
        job_id,
        attempt: 0,
        stage_id: None,
        batch_id: None,
        reservation_id: None,
        checkpoint_id: None,
        dedupe_key: None,
        phase: PipelinePhase::Embedding,
        status: LifecycleStatus::Running,
        severity: Severity::Info,
        visibility,
        message: format!("event {sequence}"),
        timestamp: Timestamp(format!("2026-07-01T00:00:0{sequence}Z")),
        source_id: None,
        canonical_uri: None,
        adapter: None,
        scope: None,
        generation: None,
        counts: StageCounts {
            items_total: None,
            items_done: 0,
            documents_total: None,
            documents_done: 0,
            chunks_total: None,
            chunks_done: 0,
            bytes_total: None,
            bytes_done: 0,
        },
        timing: None,
        current: None,
        throughput: None,
        retry: None,
        warning: None,
        error: None,
    }
}
