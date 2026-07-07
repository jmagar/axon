use super::*;

use axon_api::source::{JobKind, JobListRequest, LifecycleStatus};
use axon_jobs::boundary::FakeJobWatchStore;
use uuid::Uuid;

fn store() -> Arc<dyn JobStore> {
    Arc::new(FakeJobWatchStore::new())
}

fn nonempty_graph_summary(degraded: bool) -> GraphWriteSummary {
    GraphWriteSummary {
        nodes_upserted: 3,
        edges_upserted: 2,
        evidence_records: 2,
        degraded,
    }
}

fn empty_graph_summary() -> GraphWriteSummary {
    GraphWriteSummary {
        nodes_upserted: 0,
        edges_upserted: 0,
        evidence_records: 0,
        degraded: true,
    }
}

fn nonempty_drain_summary(failed: u64) -> DebtDrainSummary {
    DebtDrainSummary {
        resolved: 2,
        failed,
        points_deleted: 5,
    }
}

fn empty_drain_summary() -> DebtDrainSummary {
    DebtDrainSummary::default()
}

async fn only_job(store: &Arc<dyn JobStore>, kind: JobKind) -> axon_api::source::JobSummary {
    let page = store
        .list(JobListRequest {
            status: None,
            kind: Some(kind),
            source_id: None,
            watch_id: None,
            limit: Some(10),
            cursor: None,
        })
        .await
        .expect("list jobs");
    assert_eq!(page.items.len(), 1, "expected exactly one {kind:?} job");
    page.items.into_iter().next().unwrap()
}

#[tokio::test]
async fn track_graph_mutation_creates_completed_child_job_on_success() {
    let store = store();
    let parent_job_id = JobId::new(Uuid::new_v4());

    track_graph_mutation(
        Some(store.clone()),
        parent_job_id,
        &nonempty_graph_summary(false),
    )
    .await;

    let job = only_job(&store, JobKind::Graph).await;
    assert_eq!(job.status, LifecycleStatus::Completed);
    assert_eq!(job.parent_job_id, Some(parent_job_id));
    assert_eq!(job.root_job_id, Some(parent_job_id));
}

#[tokio::test]
async fn track_graph_mutation_marks_degraded_write_as_failed_child_job() {
    let store = store();
    let parent_job_id = JobId::new(Uuid::new_v4());

    track_graph_mutation(
        Some(store.clone()),
        parent_job_id,
        &nonempty_graph_summary(true),
    )
    .await;

    let job = only_job(&store, JobKind::Graph).await;
    assert_eq!(job.status, LifecycleStatus::Failed);
}

#[tokio::test]
async fn track_graph_mutation_skips_job_creation_for_zero_op_write() {
    let store = store();
    let parent_job_id = JobId::new(Uuid::new_v4());

    track_graph_mutation(Some(store.clone()), parent_job_id, &empty_graph_summary()).await;

    let page = store
        .list(JobListRequest {
            status: None,
            kind: Some(JobKind::Graph),
            source_id: None,
            watch_id: None,
            limit: Some(10),
            cursor: None,
        })
        .await
        .expect("list jobs");
    assert!(
        page.items.is_empty(),
        "zero-op graph write must not create a job row"
    );
}

#[tokio::test]
async fn track_graph_mutation_skips_when_no_job_store() {
    // Must not panic without a job store — this is the degraded/no-data-plane
    // path's shape (no assertions possible beyond "did not panic").
    track_graph_mutation(
        None,
        JobId::new(Uuid::new_v4()),
        &nonempty_graph_summary(false),
    )
    .await;
}

#[tokio::test]
async fn track_graph_mutation_skips_nil_parent_job_id() {
    let store = store();
    track_graph_mutation(
        Some(store.clone()),
        JobId::new(Uuid::nil()),
        &nonempty_graph_summary(false),
    )
    .await;

    let page = store
        .list(JobListRequest {
            status: None,
            kind: Some(JobKind::Graph),
            source_id: None,
            watch_id: None,
            limit: Some(10),
            cursor: None,
        })
        .await
        .expect("list jobs");
    assert!(
        page.items.is_empty(),
        "nil parent job id must not create a child job"
    );
}

#[tokio::test]
async fn track_prune_creates_completed_child_job_when_all_debt_resolved() {
    let store = store();
    let parent_job_id = JobId::new(Uuid::new_v4());

    track_prune(
        Some(store.clone()),
        parent_job_id,
        &nonempty_drain_summary(0),
    )
    .await;

    let job = only_job(&store, JobKind::Prune).await;
    assert_eq!(job.status, LifecycleStatus::Completed);
    assert_eq!(job.parent_job_id, Some(parent_job_id));
    assert_eq!(job.root_job_id, Some(parent_job_id));
}

#[tokio::test]
async fn track_prune_marks_partial_failure_as_failed_child_job() {
    let store = store();
    let parent_job_id = JobId::new(Uuid::new_v4());

    track_prune(
        Some(store.clone()),
        parent_job_id,
        &nonempty_drain_summary(1),
    )
    .await;

    let job = only_job(&store, JobKind::Prune).await;
    assert_eq!(job.status, LifecycleStatus::Failed);
}

#[tokio::test]
async fn track_prune_skips_job_creation_when_no_debt_touched() {
    let store = store();
    let parent_job_id = JobId::new(Uuid::new_v4());

    track_prune(Some(store.clone()), parent_job_id, &empty_drain_summary()).await;

    let page = store
        .list(JobListRequest {
            status: None,
            kind: Some(JobKind::Prune),
            source_id: None,
            watch_id: None,
            limit: Some(10),
            cursor: None,
        })
        .await
        .expect("list jobs");
    assert!(
        page.items.is_empty(),
        "empty debt drain must not create a job row"
    );
}

#[tokio::test]
async fn track_prune_skips_nil_parent_job_id() {
    let store = store();
    track_prune(
        Some(store.clone()),
        JobId::new(Uuid::nil()),
        &nonempty_drain_summary(0),
    )
    .await;

    let page = store
        .list(JobListRequest {
            status: None,
            kind: Some(JobKind::Prune),
            source_id: None,
            watch_id: None,
            limit: Some(10),
            cursor: None,
        })
        .await
        .expect("list jobs");
    assert!(
        page.items.is_empty(),
        "nil parent job id must not create a child job"
    );
}
