use anyhow::Context;
use axon_api::source::*;
use axon_embedding::provider::EmbeddingProvider;
use axon_jobs::boundary::JobStore;
use axon_ledger::store::LedgerStore;
use axon_vectors::store::VectorStore;

use super::local_source_discovery::{local_source_id, timestamp};
use super::{LocalSourceIndexInput, LocalSourceIndexOutput, index_local_source};

const LOCAL_SOURCE_PHASES: &[PipelinePhase] = &[
    PipelinePhase::Discovering,
    PipelinePhase::Diffing,
    PipelinePhase::Preparing,
    PipelinePhase::Embedding,
    PipelinePhase::Vectorizing,
    PipelinePhase::Publishing,
];

pub async fn index_local_source_with_job(
    mut input: LocalSourceIndexInput,
    jobs: &dyn JobStore,
    ledger: &dyn LedgerStore,
    embedding_provider: &dyn EmbeddingProvider,
    vector_store: &dyn VectorStore,
) -> anyhow::Result<LocalSourceIndexOutput> {
    let root = tokio::fs::canonicalize(&input.root)
        .await
        .with_context(|| format!("invalid local source root {}", input.root.display()))?;
    let source_id = local_source_id(&root);
    let descriptor = jobs
        .create(job_create_request(&input, source_id.clone()))
        .await?;
    input.job_id = descriptor.job_id;
    for (index, phase) in LOCAL_SOURCE_PHASES.iter().copied().enumerate() {
        record_phase(jobs, &input, &source_id, phase, index as u64 + 1).await?;
    }
    match index_local_source(input.clone(), ledger, embedding_provider, vector_store).await {
        Ok(output) => {
            record_phase(
                jobs,
                &input,
                &output.source_id,
                PipelinePhase::Complete,
                LOCAL_SOURCE_PHASES.len() as u64 + 1,
            )
            .await?;
            jobs.update_status(JobStatusUpdate {
                job_id: input.job_id,
                status: LifecycleStatus::Completed,
                phase: PipelinePhase::Complete,
                stage_id: None,
                counts: Some(counts_for_output(&output)),
                current: None,
                message: Some("local source indexing complete".to_string()),
                error: None,
            })
            .await?;
            Ok(output)
        }
        Err(err) => {
            let source_error = SourceError {
                code: "source.local.index_failed".to_string(),
                severity: Severity::Failed,
                message: err.to_string(),
                source_item_key: None,
                retryable: false,
                provider_id: None,
                cause: Some(err.to_string()),
            };
            let _ = jobs
                .update_status(JobStatusUpdate {
                    job_id: input.job_id,
                    status: LifecycleStatus::Failed,
                    phase: PipelinePhase::Complete,
                    stage_id: None,
                    counts: None,
                    current: None,
                    message: Some("local source indexing failed".to_string()),
                    error: Some(source_error),
                })
                .await;
            Err(err)
        }
    }
}

fn job_create_request(input: &LocalSourceIndexInput, source_id: SourceId) -> JobCreateRequest {
    JobCreateRequest {
        request_id: None,
        job_kind: JobKind::Source,
        job_intent: JobIntent::Run,
        source_id: Some(source_id),
        watch_id: None,
        parent_job_id: None,
        root_job_id: None,
        priority: JobPriority::Background,
        idempotency_key: None,
        stage_plan: Vec::new(),
        request: Some(serde_json::json!({ "root": input.root })),
        auth_snapshot: MetadataMap::new(),
        config_snapshot_id: Some(ConfigSnapshotId::new("cfg_local_source")),
        requirements: MetadataMap::new(),
        result_schema: Some("source_result".to_string()),
        metadata: MetadataMap::new(),
    }
}

async fn record_phase(
    jobs: &dyn JobStore,
    input: &LocalSourceIndexInput,
    source_id: &SourceId,
    phase: PipelinePhase,
    sequence: u64,
) -> anyhow::Result<()> {
    let status = if phase == PipelinePhase::Complete {
        LifecycleStatus::Completed
    } else {
        LifecycleStatus::Running
    };
    jobs.update_status(JobStatusUpdate {
        job_id: input.job_id,
        status,
        phase,
        stage_id: None,
        counts: None,
        current: None,
        message: Some(format!("local source {phase:?}").to_ascii_lowercase()),
        error: None,
    })
    .await?;
    jobs.append_event(SourceProgressEvent {
        event_id: format!("evt_local_{}_{}", input.job_id.0, sequence),
        sequence,
        job_id: input.job_id,
        attempt: 1,
        stage_id: None,
        batch_id: None,
        reservation_id: None,
        checkpoint_id: None,
        dedupe_key: None,
        phase,
        status,
        severity: Severity::Info,
        visibility: Visibility::Public,
        message: format!("local source {phase:?}").to_ascii_lowercase(),
        timestamp: timestamp(),
        source_id: Some(source_id.clone()),
        canonical_uri: None,
        adapter: None,
        scope: None,
        generation: None,
        counts: empty_counts(),
        timing: None,
        current: None,
        throughput: None,
        retry: None,
        warning: None,
        error: None,
    })
    .await?;
    jobs.heartbeat(JobHeartbeat {
        job_id: input.job_id,
        attempt: 1,
        worker_id: Some("local-source".to_string()),
        phase,
        status,
        stage_id: None,
        heartbeat_at: timestamp(),
        last_event_sequence: Some(sequence),
        counts: None,
        provider_reservations: Vec::new(),
    })
    .await?;
    Ok(())
}

fn empty_counts() -> StageCounts {
    StageCounts {
        items_total: None,
        items_done: 0,
        documents_total: None,
        documents_done: 0,
        chunks_total: None,
        chunks_done: 0,
        bytes_total: None,
        bytes_done: 0,
    }
}

fn counts_for_output(output: &LocalSourceIndexOutput) -> StageCounts {
    StageCounts {
        items_total: None,
        items_done: 0,
        documents_total: Some(output.documents_prepared),
        documents_done: output.documents_prepared,
        chunks_total: Some(output.chunks_prepared),
        chunks_done: output.chunks_prepared,
        bytes_total: None,
        bytes_done: 0,
    }
}
