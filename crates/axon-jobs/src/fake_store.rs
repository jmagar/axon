use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use axon_api::source::*;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::boundary::{JobStore, Result};
use crate::limits::clamp_page_limit;
use crate::state_machine::validate_transition;

#[path = "fake_store/helpers.rs"]
mod helpers;
#[path = "fake_store/watch.rs"]
mod watch;

use helpers::*;

#[derive(Debug, Clone, Default)]
pub struct FakeJobWatchStore {
    state: Arc<Mutex<FakeJobWatchState>>,
}

#[derive(Debug, Default)]
struct FakeJobWatchState {
    jobs: BTreeMap<JobId, JobSummary>,
    stages: BTreeMap<JobId, Vec<JobStageSnapshot>>,
    events: BTreeMap<JobId, Vec<JobEvent>>,
    idempotency_keys: BTreeMap<String, JobId>,
    watches: BTreeMap<WatchId, WatchResult>,
    watch_runs: BTreeMap<WatchId, Vec<JobId>>,
    next_job: u128,
    next_stage: u128,
    next_watch: u64,
    next_tick: u64,
}

impl FakeJobWatchStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl JobStore for FakeJobWatchStore {
    async fn create(&self, request: JobCreateRequest) -> Result<JobDescriptor> {
        let mut state = self.state.lock().await;
        if let Some(job_id) = request
            .idempotency_key
            .as_ref()
            .and_then(|key| state.idempotency_keys.get(key).copied())
        {
            let summary = state
                .jobs
                .get(&job_id)
                .cloned()
                .ok_or_else(|| missing_job(job_id))?;
            return Ok(descriptor(&summary));
        }
        state.next_job += 1;
        let job_id = JobId::new(Uuid::from_u128(state.next_job));
        let created_at = state.timestamp();
        let summary = JobSummary {
            job_id,
            kind: request.job_kind,
            intent: Some(request.job_intent),
            status: LifecycleStatus::Queued,
            phase: PipelinePhase::Queued,
            created_at: created_at.clone(),
            updated_at: created_at.clone(),
            started_at: None,
            finished_at: None,
            source_id: request.source_id.clone(),
            watch_id: request.watch_id.clone(),
            parent_job_id: request.parent_job_id,
            root_job_id: request.root_job_id,
            attempt: 0,
            priority: request.priority,
            counts: None,
            current: None,
            heartbeat: None,
            last_error: None,
            warnings: Vec::new(),
        };
        state.jobs.insert(job_id, summary);
        let mut stages = Vec::new();
        for stage in request.stage_plan {
            state.next_stage += 1;
            stages.push(JobStageSnapshot {
                stage_id: StageId::new(Uuid::from_u128(state.next_stage)),
                phase: stage.phase,
                status: LifecycleStatus::Queued,
                required: stage.required,
                provider_requirements: stage.provider_requirements,
                counts: empty_counts(),
                started_at: None,
                completed_at: None,
                error: None,
            });
        }
        state.stages.insert(job_id, stages);
        if let Some(key) = request.idempotency_key {
            state.idempotency_keys.insert(key, job_id);
        }
        Ok(new_job_descriptor(job_id, request.job_kind, created_at))
    }

    async fn get(&self, job_id: JobId) -> Result<Option<JobSummary>> {
        Ok(self.state.lock().await.jobs.get(&job_id).cloned())
    }

    async fn attempts(&self, job_id: JobId) -> Result<Vec<JobAttemptSnapshot>> {
        let Some(summary) = self.state.lock().await.jobs.get(&job_id).cloned() else {
            return Err(missing_job(job_id));
        };
        Ok(summary
            .heartbeat
            .map(|heartbeat| JobAttemptSnapshot {
                attempt: heartbeat.attempt,
                status: heartbeat.status,
                worker_id: heartbeat.worker_id,
                started_at: summary.started_at.unwrap_or(summary.created_at),
                finished_at: summary.finished_at,
                heartbeat_at: Some(heartbeat.heartbeat_at),
                error: None,
            })
            .into_iter()
            .collect())
    }

    async fn stages(&self, job_id: JobId) -> Result<Vec<JobStageSnapshot>> {
        let state = self.state.lock().await;
        if !state.jobs.contains_key(&job_id) {
            return Err(missing_job(job_id));
        }
        Ok(state.stages.get(&job_id).cloned().unwrap_or_default())
    }

    async fn update_status(&self, status: JobStatusUpdate) -> Result<()> {
        let mut state = self.state.lock().await;
        let updated_at = state.timestamp();
        let stage_counts = status.counts.clone();
        {
            let job = state
                .jobs
                .get_mut(&status.job_id)
                .ok_or_else(|| missing_job(status.job_id))?;
            validate_transition(status.job_id, job.status, status.status)?;
            job.status = status.status;
            job.phase = status.phase;
            job.counts = status.counts;
            job.current = status.current;
            job.last_error = status.error.clone();
            job.updated_at = updated_at.clone();
        }
        if let Some(stage_id) = status.stage_id
            && let Some(stages) = state.stages.get_mut(&status.job_id)
            && let Some(stage) = stages.iter_mut().find(|stage| stage.stage_id == stage_id)
        {
            stage.status = status.status;
            if let Some(counts) = stage_counts {
                stage.counts = counts;
            }
            if status.status == LifecycleStatus::Running && stage.started_at.is_none() {
                stage.started_at = Some(updated_at.clone());
            }
            if is_terminal_status(status.status) {
                stage.completed_at = Some(updated_at);
            }
            stage.error = None;
        }
        Ok(())
    }

    async fn append_event(&self, event: SourceProgressEvent) -> Result<()> {
        let mut state = self.state.lock().await;
        if !state.jobs.contains_key(&event.job_id) {
            return Err(missing_job(event.job_id));
        }
        let expected_sequence = state
            .events
            .get(&event.job_id)
            .and_then(|events| events.last())
            .map(|event| event.sequence + 1)
            .unwrap_or(1);
        if event.sequence != expected_sequence {
            if let Some(dedupe_key) = event.dedupe_key.as_ref()
                && state
                    .events
                    .get(&event.job_id)
                    .into_iter()
                    .flatten()
                    .any(|existing| {
                        existing.details.get("dedupe_key") == Some(&serde_json::json!(dedupe_key))
                    })
            {
                return Ok(());
            }
            return Err(ApiError::new(
                "job_event.sequence_invalid",
                ErrorStage::Publishing,
                format!(
                    "expected event sequence {} for job {}, got {}",
                    expected_sequence, event.job_id.0, event.sequence
                ),
            ));
        }
        let details = event_details(&event);
        state
            .events
            .entry(event.job_id)
            .or_default()
            .push(JobEvent {
                event_id: event.event_id,
                sequence: event.sequence,
                job_id: event.job_id,
                attempt: event.attempt,
                stage_id: event.stage_id,
                phase: event.phase,
                status: event.status,
                severity: event.severity,
                visibility: event.visibility,
                message: event.message,
                timestamp: event.timestamp,
                details,
            });
        Ok(())
    }

    async fn heartbeat(&self, heartbeat: JobHeartbeat) -> Result<()> {
        let mut state = self.state.lock().await;
        let job = state
            .jobs
            .get_mut(&heartbeat.job_id)
            .ok_or_else(|| missing_job(heartbeat.job_id))?;
        if job.status != heartbeat.status {
            validate_transition(heartbeat.job_id, job.status, heartbeat.status)?;
        }
        job.phase = heartbeat.phase;
        job.status = heartbeat.status;
        job.updated_at = heartbeat.heartbeat_at.clone();
        job.counts = heartbeat.counts.clone();
        job.heartbeat = Some(heartbeat);
        Ok(())
    }

    async fn list(&self, request: JobListRequest) -> Result<Page<JobSummary>> {
        if request.cursor.is_some() {
            return Err(ApiError::new(
                "job.cursor_unsupported",
                ErrorStage::Retrieving,
                "fake job store does not implement cursor pagination",
            ));
        }
        let mut items = self
            .state
            .lock()
            .await
            .jobs
            .values()
            .cloned()
            .collect::<Vec<_>>();
        if let Some(status) = request.status {
            items.retain(|job| job.status == status);
        }
        if let Some(kind) = request.kind {
            items.retain(|job| job.kind == kind);
        }
        if let Some(source_id) = request.source_id {
            items.retain(|job| job.source_id.as_ref() == Some(&source_id));
        }
        if let Some(watch_id) = request.watch_id {
            items.retain(|job| job.watch_id.as_ref() == Some(&watch_id));
        }
        let total = items.len() as u64;
        let limit = clamp_page_limit(request.limit);
        items.truncate(limit as usize);
        Ok(Page {
            total: Some(total),
            limit,
            next_cursor: None,
            items,
        })
    }

    async fn events(&self, request: JobEventListRequest) -> Result<JobEventPage> {
        if request.cursor.is_some() {
            return Err(ApiError::new(
                "job_event.cursor_unsupported",
                ErrorStage::Retrieving,
                "fake job store does not implement event cursor pagination",
            ));
        }
        let mut items = self
            .state
            .lock()
            .await
            .events
            .get(&request.job_id)
            .cloned()
            .unwrap_or_default();
        if let Some(phase) = request.phase {
            items.retain(|event| event.phase == phase);
        }
        if let Some(severity) = request.severity {
            items.retain(|event| event.severity == severity);
        }
        apply_visibility_filter(&mut items, request.visibility);
        if let Some(since_sequence) = request.since_sequence {
            items.retain(|event| event.sequence > since_sequence);
        }
        let limit = clamp_page_limit(request.limit);
        items.truncate(limit as usize);
        Ok(JobEventPage {
            last_sequence: items.last().map(|event| event.sequence),
            limit,
            next_cursor: None,
            events: items,
        })
    }

    async fn latest_event_sequence(&self, job_id: JobId) -> Result<Option<u64>> {
        if !self.state.lock().await.jobs.contains_key(&job_id) {
            return Err(missing_job(job_id));
        }
        Ok(self
            .state
            .lock()
            .await
            .events
            .get(&job_id)
            .and_then(|events| events.last())
            .map(|event| event.sequence))
    }

    async fn cancel(&self, job_id: JobId, request: JobCancelRequest) -> Result<JobCancelResult> {
        let mut state = self.state.lock().await;
        let updated_at = state.timestamp();
        let job = state
            .jobs
            .get_mut(&job_id)
            .ok_or_else(|| missing_job(job_id))?;
        validate_transition(job_id, job.status, LifecycleStatus::Canceling)?;
        job.status = LifecycleStatus::Canceling;
        job.phase = PipelinePhase::Canceled;
        job.updated_at = updated_at;
        Ok(JobCancelResult {
            job_id,
            status: LifecycleStatus::Canceling,
            canceled_at: None,
            reason: request.reason,
        })
    }

    async fn retry(&self, job_id: JobId, _request: JobRetryRequest) -> Result<JobRetryResult> {
        let original = JobStore::get(self, job_id)
            .await?
            .ok_or_else(|| missing_job(job_id))?;
        let attempt = original.attempt + 1;
        let retry = JobStore::create(
            self,
            JobCreateRequest {
                job_kind: original.kind,
                job_intent: JobIntent::Retry,
                source_id: original.source_id,
                watch_id: original.watch_id,
                parent_job_id: Some(job_id),
                root_job_id: Some(original.root_job_id.unwrap_or(job_id)),
                priority: original.priority,
                idempotency_key: None,
                stage_plan: Vec::new(),
                request: None,
                metadata: MetadataMap::new(),
            },
        )
        .await?;
        Ok(JobRetryResult {
            original_job_id: job_id,
            retry_job: retry,
            attempt,
        })
    }

    async fn recover(&self, request: JobRecoveryRequest) -> Result<JobRecoveryResult> {
        let mut state = self.state.lock().await;
        let now = state.timestamp();
        let mut scanned = 0;
        let mut failed = 0;
        for job in state.jobs.values_mut() {
            if request.kind.is_some_and(|kind| kind != job.kind)
                || !matches!(
                    job.status,
                    LifecycleStatus::Running | LifecycleStatus::Waiting
                )
                || !is_stale(job, &now, request.older_than_seconds)
            {
                continue;
            }
            scanned += 1;
            if !request.dry_run {
                job.status = LifecycleStatus::Failed;
                job.phase = PipelinePhase::Complete;
                job.updated_at = now.clone();
                failed += 1;
            }
        }
        Ok(JobRecoveryResult {
            jobs_scanned: scanned,
            jobs_requeued: 0,
            jobs_failed: failed,
            warnings: Vec::new(),
        })
    }

    async fn cleanup(&self, request: JobCleanupRequest) -> Result<JobCleanupResult> {
        let mut state = self.state.lock().await;
        let terminal_ids = state
            .jobs
            .iter()
            .filter_map(|(job_id, job)| is_terminal_status(job.status).then_some(*job_id))
            .collect::<Vec<_>>();
        let events_pruned = terminal_ids
            .iter()
            .filter_map(|job_id| state.events.get(job_id).map(Vec::len))
            .sum::<usize>() as u64;
        if !request.dry_run {
            for job_id in &terminal_ids {
                state.jobs.remove(job_id);
                state.events.remove(job_id);
            }
        }
        Ok(JobCleanupResult {
            jobs_pruned: terminal_ids.len() as u64,
            events_pruned,
            heartbeats_pruned: 0,
            artifacts_pruned: 0,
        })
    }

    async fn artifacts(&self, request: JobArtifactListRequest) -> Result<JobArtifactListResult> {
        if !self.state.lock().await.jobs.contains_key(&request.job_id) {
            return Err(missing_job(request.job_id));
        }
        Ok(JobArtifactListResult {
            artifacts: Vec::new(),
            limit: clamp_page_limit(request.limit),
            next_cursor: None,
        })
    }

    async fn reset(&self) -> Result<()> {
        let mut state = self.state.lock().await;
        state.jobs.clear();
        state.stages.clear();
        state.events.clear();
        state.idempotency_keys.clear();
        state.next_job = 0;
        state.next_stage = 0;
        Ok(())
    }

    async fn capabilities(&self) -> Result<JobStoreCapability> {
        Ok(capability("fake-job-store").into())
    }
}

impl FakeJobWatchState {
    fn timestamp(&mut self) -> Timestamp {
        self.next_tick += 1;
        Timestamp(format!("2026-07-01T00:00:{:02}Z", self.next_tick))
    }

    pub(super) fn peek_timestamp(&self) -> Timestamp {
        Timestamp(format!("2026-07-01T00:00:{:02}Z", self.next_tick + 1))
    }
}

pub(super) fn missing_job(job_id: JobId) -> ApiError {
    ApiError::new(
        "job.not_found",
        ErrorStage::Retrieving,
        format!("job {} not found", job_id.0),
    )
}

pub(super) fn missing_watch(watch_id: &WatchId) -> ApiError {
    ApiError::new(
        "watch.not_found",
        ErrorStage::Retrieving,
        format!("watch {} not found", watch_id.0),
    )
}

#[cfg(test)]
#[path = "boundary_tests.rs"]
mod tests;
