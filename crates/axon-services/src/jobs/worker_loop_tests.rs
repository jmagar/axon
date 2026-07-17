use super::*;

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};

use async_trait::async_trait;
use axon_core::config::Config;
use axon_jobs::status::JobStatus;

use crate::runtime::{RuntimeResult, ServiceJobRuntime};

/// Fake runtime whose queue reads active for the first `active_polls`
/// `has_active_jobs` calls, then idle. Counts recover sweeps.
struct FakeQueueRuntime {
    active_polls: AtomicI64,
    recover_calls: AtomicU64,
}

impl FakeQueueRuntime {
    fn with_active_polls(active_polls: i64) -> Self {
        Self {
            active_polls: AtomicI64::new(active_polls),
            recover_calls: AtomicU64::new(0),
        }
    }
}

#[async_trait]
impl ServiceJobRuntime for FakeQueueRuntime {
    fn mode_name(&self) -> &'static str {
        "test"
    }

    async fn wait_for_job(&self, _id: uuid::Uuid, _kind: JobKind) -> RuntimeResult<String> {
        Ok("completed".to_string())
    }

    async fn job_errors(&self, _id: uuid::Uuid, _kind: JobKind) -> RuntimeResult<Option<String>> {
        Ok(None)
    }

    async fn has_active_jobs(&self, kind: JobKind) -> RuntimeResult<bool> {
        // Only decrement on the first watched kind so one loop iteration
        // consumes exactly one poll credit.
        if kind != WORKER_LOOP_KINDS[0] {
            return Ok(false);
        }
        Ok(self.active_polls.fetch_sub(1, Ordering::SeqCst) > 0)
    }

    async fn list_jobs(
        &self,
        _kind: JobKind,
        _limit: i64,
        _offset: i64,
    ) -> RuntimeResult<Vec<crate::types::ServiceJob>> {
        Ok(Vec::new())
    }

    async fn job_status(
        &self,
        _kind: JobKind,
        _id: uuid::Uuid,
    ) -> RuntimeResult<Option<crate::types::ServiceJob>> {
        Ok(None)
    }

    async fn cancel_job(&self, _kind: JobKind, _id: uuid::Uuid) -> RuntimeResult<bool> {
        Ok(false)
    }

    async fn cleanup_jobs(&self, _kind: JobKind) -> RuntimeResult<u64> {
        Ok(0)
    }

    async fn clear_jobs(&self, _kind: JobKind) -> RuntimeResult<u64> {
        Ok(0)
    }

    async fn recover_jobs(&self, _kind: JobKind, _stale_threshold_ms: i64) -> RuntimeResult<u64> {
        self.recover_calls.fetch_add(1, Ordering::SeqCst);
        Ok(1)
    }

    async fn count_jobs(&self, _kind: JobKind) -> RuntimeResult<i64> {
        Ok(0)
    }

    async fn count_jobs_by_status(&self, _kind: JobKind) -> RuntimeResult<HashMap<JobStatus, i64>> {
        Ok(HashMap::new())
    }
}

fn context_with(runtime: Arc<FakeQueueRuntime>) -> crate::context::ServiceContext {
    crate::context::ServiceContext::from_runtime(Arc::new(Config::test_default()), runtime)
}

#[tokio::test(start_paused = true)]
async fn exits_after_continuous_idle_window() {
    let runtime = Arc::new(FakeQueueRuntime::with_active_polls(2));
    let ctx = context_with(Arc::clone(&runtime));

    let report = run_worker_until_idle(&ctx, WorkerLoopOptions { idle_exit_secs: 3 })
        .await
        .expect("worker loop");

    // 2 active polls + 3 idle seconds — with paused time the loop advances
    // virtually, so this stays instant in wall-clock terms.
    assert!(report.elapsed_secs >= 4, "elapsed={}", report.elapsed_secs);
    // Startup sweep runs once across both watched kinds.
    assert_eq!(report.recovered_jobs, WORKER_LOOP_KINDS.len() as u64);
    assert!(runtime.recover_calls.load(Ordering::SeqCst) >= 2);
}

#[tokio::test(start_paused = true)]
async fn idle_queue_exits_after_exactly_the_idle_window() {
    let runtime = Arc::new(FakeQueueRuntime::with_active_polls(0));
    let ctx = context_with(Arc::clone(&runtime));

    let report = run_worker_until_idle(&ctx, WorkerLoopOptions { idle_exit_secs: 2 })
        .await
        .expect("worker loop");

    assert!(report.elapsed_secs >= 2, "elapsed={}", report.elapsed_secs);
    assert!(report.elapsed_secs <= 5, "elapsed={}", report.elapsed_secs);
}
