use axon_api::source::*;
use axon_embedding::fake::{FakeEmbeddingMode, FakeEmbeddingProvider};
use axon_jobs::boundary::{FakeJobWatchStore, JobStore};
use axon_ledger::store::FakeLedgerStore;
use axon_vectors::store::{FakeVectorMode, FakeVectorStore};

use super::{
    LocalSourceIndexInput, LocalSourceSelectionPolicy, index_local_source,
    index_local_source_with_job,
};

fn job_id() -> JobId {
    JobId::new(uuid::Uuid::from_u128(0x1111))
}

fn input(root: std::path::PathBuf) -> LocalSourceIndexInput {
    LocalSourceIndexInput {
        root,
        collection: "axon-test".to_string(),
        owner_id: "test-owner".to_string(),
        job_id: job_id(),
        embedding_provider_id: ProviderId::new("fake-embedding"),
        vector_provider_id: ProviderId::new("fake-vector"),
        embedding_model: "fake-embedding".to_string(),
        embedding_dimensions: 8,
        selection_policy: LocalSourceSelectionPolicy::Permissive,
        embedding_reservations: None,
        vector_reservations: None,
    }
}

#[tokio::test]
async fn vector_failure_leaves_generation_uncommitted_and_releases_lease() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lib.rs");
    tokio::fs::write(&path, "pub fn answer() -> i32 {\n    42\n}\n")
        .await
        .unwrap();
    let ledger = FakeLedgerStore::new();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let failing_vectors =
        FakeVectorStore::new("fake-vector").with_mode(FakeVectorMode::Unavailable);

    let err = index_local_source(input(path.clone()), &ledger, &embedder, &failing_vectors)
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("vector store unavailable"),
        "unexpected error: {err:#}"
    );

    let source_id = super::local_source_id(&tokio::fs::canonicalize(&path).await.unwrap());
    assert_eq!(ledger.committed_generation(&source_id).await, None);
    assert_eq!(ledger.generation_count().await, 0);
    assert_eq!(ledger.manifest_count().await, 0);

    let healthy_vectors = FakeVectorStore::new("fake-vector");
    let output = index_local_source(input(path), &ledger, &embedder, &healthy_vectors)
        .await
        .unwrap();
    assert_eq!(
        ledger.committed_generation(&output.source_id).await,
        Some(output.generation)
    );
}

#[tokio::test]
async fn embedding_failure_keeps_generation_uncommitted() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lib.rs");
    tokio::fs::write(&path, "pub fn answer() -> i32 {\n    42\n}\n")
        .await
        .unwrap();
    let ledger = FakeLedgerStore::new();
    let embedder =
        FakeEmbeddingProvider::new("fake-embedding", 8).with_mode(FakeEmbeddingMode::Fatal);
    let vectors = FakeVectorStore::new("fake-vector");

    let err = index_local_source(input(path.clone()), &ledger, &embedder, &vectors)
        .await
        .unwrap_err();
    assert!(
        err.to_string()
            .contains("embedding provider failed fatally"),
        "unexpected error: {err:#}"
    );
    let source_id = super::local_source_id(&tokio::fs::canonicalize(&path).await.unwrap());
    assert_eq!(ledger.committed_generation(&source_id).await, None);
    assert_eq!(ledger.generation_count().await, 0);
    assert_eq!(ledger.manifest_count().await, 0);
}

#[tokio::test]
async fn source_job_terminal_failure_preserves_provider_retryability() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lib.rs");
    tokio::fs::write(&path, "pub fn answer() -> i32 {\n    42\n}\n")
        .await
        .unwrap();
    let jobs = FakeJobWatchStore::new();
    let ledger = FakeLedgerStore::new();
    let embedder =
        FakeEmbeddingProvider::new("fake-embedding", 8).with_mode(FakeEmbeddingMode::RateLimited);
    let vectors = FakeVectorStore::new("fake-vector");

    let err = index_local_source_with_job(input(path), &jobs, &ledger, &embedder, &vectors)
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("rate"),
        "unexpected error: {err:#}"
    );

    let summary = JobStore::list(
        &jobs,
        JobListRequest {
            status: None,
            kind: Some(JobKind::Source),
            source_id: None,
            watch_id: None,
            limit: Some(1),
            cursor: None,
        },
    )
    .await
    .unwrap()
    .items
    .pop()
    .expect("job summary");
    let last_error = summary.last_error.expect("last error");
    assert_eq!(
        last_error.provider_id,
        Some(ProviderId::new("fake-embedding"))
    );
    assert!(last_error.retryable);

    let events = JobStore::events(
        &jobs,
        JobEventListRequest {
            job_id: summary.job_id,
            phase: Some(PipelinePhase::Complete),
            severity: Some(Severity::Failed),
            visibility: Some(Visibility::Public),
            since_sequence: None,
            limit: Some(10),
            cursor: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(events.events.len(), 1);
    assert_eq!(events.events[0].status, LifecycleStatus::Failed);
}

#[tokio::test]
async fn source_job_public_failure_does_not_expose_absolute_root() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bad.rs");
    tokio::fs::write(&path, [0xff, 0xfe, 0xfd]).await.unwrap();
    let jobs = FakeJobWatchStore::new();
    let ledger = FakeLedgerStore::new();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let vectors = FakeVectorStore::new("fake-vector");

    let err = index_local_source_with_job(
        input(dir.path().to_path_buf()),
        &jobs,
        &ledger,
        &embedder,
        &vectors,
    )
    .await
    .unwrap_err();
    assert!(
        !err.to_string()
            .contains(dir.path().to_string_lossy().as_ref()),
        "unexpected absolute root leak in returned error: {err:#}"
    );

    let summary = JobStore::list(
        &jobs,
        JobListRequest {
            status: None,
            kind: Some(JobKind::Source),
            source_id: None,
            watch_id: None,
            limit: Some(1),
            cursor: None,
        },
    )
    .await
    .unwrap()
    .items
    .pop()
    .expect("job summary");
    let summary_json = serde_json::to_string(&summary).unwrap();
    assert!(
        !summary_json.contains(dir.path().to_string_lossy().as_ref()),
        "unexpected absolute root leak in job summary: {summary_json}"
    );
    assert!(
        summary_json.contains("bad.rs"),
        "public errors should keep a small item hint: {summary_json}"
    );

    let events = JobStore::events(
        &jobs,
        JobEventListRequest {
            job_id: summary.job_id,
            phase: None,
            severity: Some(Severity::Failed),
            visibility: Some(Visibility::Public),
            since_sequence: None,
            limit: Some(10),
            cursor: None,
        },
    )
    .await
    .unwrap();
    let events_json = serde_json::to_string(&events).unwrap();
    assert!(
        !events_json.contains(dir.path().to_string_lossy().as_ref()),
        "unexpected absolute root leak in public events: {events_json}"
    );
}

#[tokio::test]
async fn publish_generation_failure_leaves_vectors_uncommitted() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lib.rs");
    tokio::fs::write(&path, "pub fn answer() -> i32 {\n    42\n}\n")
        .await
        .unwrap();
    let ledger = FakeLedgerStore::new().with_publish_generation_failure();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let vectors = FakeVectorStore::new("fake-vector");

    let err = index_local_source(input(path.clone()), &ledger, &embedder, &vectors)
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("failed to publish generation"),
        "unexpected error: {err:#}"
    );

    let source_id = super::local_source_id(&tokio::fs::canonicalize(&path).await.unwrap());
    assert_eq!(ledger.committed_generation(&source_id).await, None);
    assert_eq!(
        vectors.calls().await,
        vec![
            "ensure_collection",
            "upsert",
            "mark_generation_committed",
            "delete"
        ]
    );
    assert!(vectors.points("axon-test").await.is_empty());
}

#[tokio::test]
async fn publish_generation_failure_reports_rollback_delete_failure() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lib.rs");
    tokio::fs::write(&path, "pub fn answer() -> i32 {\n    42\n}\n")
        .await
        .unwrap();
    let ledger = FakeLedgerStore::new().with_publish_generation_failure();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let vectors = FakeVectorStore::new("fake-vector").with_mode(FakeVectorMode::DeleteFailure);

    let err = index_local_source(input(path.clone()), &ledger, &embedder, &vectors)
        .await
        .unwrap_err();

    assert!(
        err.to_string()
            .contains("also failed to rollback committed vector generation"),
        "unexpected error: {err:#}"
    );
    assert_eq!(
        vectors.calls().await,
        vec![
            "ensure_collection",
            "upsert",
            "mark_generation_committed",
            "delete"
        ]
    );
    assert!(
        vectors
            .points("axon-test")
            .await
            .iter()
            .all(|point| point.payload["committed_generation"].as_str() != Some("uncommitted"))
    );
}

#[tokio::test]
async fn vector_commit_marker_failure_leaves_vectors_uncommitted() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lib.rs");
    tokio::fs::write(&path, "pub fn answer() -> i32 {\n    42\n}\n")
        .await
        .unwrap();
    let ledger = FakeLedgerStore::new();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let vectors = FakeVectorStore::new("fake-vector").with_mode(FakeVectorMode::CommitFailure);

    let err = index_local_source(input(path.clone()), &ledger, &embedder, &vectors)
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("mark generation committed"),
        "unexpected error: {err:#}"
    );

    let source_id = super::local_source_id(&tokio::fs::canonicalize(&path).await.unwrap());
    assert_eq!(ledger.committed_generation(&source_id).await, None);
    assert_eq!(ledger.generation_count().await, 1);
    assert!(
        vectors
            .points("axon-test")
            .await
            .iter()
            .all(|point| point.payload["committed_generation"].as_str() == Some("uncommitted"))
    );
}
