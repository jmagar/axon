use axon_api::source::*;
use axon_embedding::fake::{FakeEmbeddingMode, FakeEmbeddingProvider};
use axon_embedding::reservation::{ProviderReservationConfig, ProviderReservationManager};
use axon_jobs::boundary::{FakeJobWatchStore, JobStore};
use axon_ledger::store::{FakeLedgerStore, LedgerStore};
use axon_vectors::store::{FakeVectorMode, FakeVectorStore};
use std::sync::Arc;

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

fn input_with_reservations(root: std::path::PathBuf) -> LocalSourceIndexInput {
    let mut input = input(root);
    input.embedding_reservations = Some(Arc::new(ProviderReservationManager::new(
        ProviderReservationConfig {
            provider_id: input.embedding_provider_id.clone(),
            provider_kind: ProviderKind::Embedding,
            capacity: 2,
            interactive_reserve: 1,
            cooldown_after_failures: 1,
            cooldown_secs: 30,
        },
    )));
    input.vector_reservations = Some(Arc::new(ProviderReservationManager::new(
        ProviderReservationConfig {
            provider_id: input.vector_provider_id.clone(),
            provider_kind: ProviderKind::Vector,
            capacity: 2,
            interactive_reserve: 1,
            cooldown_after_failures: 1,
            cooldown_secs: 30,
        },
    )));
    input
}

#[tokio::test]
async fn local_file_refresh_writes_vectors_then_commits_source_generation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lib.rs");
    tokio::fs::write(&path, "pub fn answer() -> i32 {\n    42\n}\n")
        .await
        .unwrap();
    let ledger = FakeLedgerStore::new();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let vectors = FakeVectorStore::new("fake-vector");

    let output = index_local_source(input(path), &ledger, &embedder, &vectors)
        .await
        .unwrap();

    assert_eq!(
        ledger.committed_generation(&output.source_id).await,
        Some(output.generation.clone())
    );
    assert_eq!(embedder.calls().await.len(), 1);
    assert!(output.documents_prepared >= 1);
    assert!(output.chunks_prepared >= 1);
    assert!(output.vector_points_written >= 1);
    assert_eq!(
        vectors.calls().await,
        vec!["ensure_collection", "upsert", "mark_generation_committed"]
    );
    assert!(
        vectors
            .points("axon-test")
            .await
            .iter()
            .all(|point| point.payload["committed_generation"].as_str()
                == Some(output.generation.0.as_str()))
    );
    assert!(
        vectors
            .points("axon-test")
            .await
            .iter()
            .all(|point| point.payload["document_status"].as_str() == Some("published"))
    );
    for point in vectors.points("axon-test").await {
        let status = ledger
            .document_status(&DocumentId::new(
                point.payload["document_id"].as_str().unwrap(),
            ))
            .await
            .expect("ledger document status");
        assert_eq!(status.status, DocumentLifecycleStatus::Published);
    }
    let source = ledger
        .get_source(output.source_id.clone())
        .await
        .unwrap()
        .expect("source summary");
    assert_eq!(source.status, LifecycleStatus::Completed);
    assert_eq!(source.counts.items_total, 1);
    assert_eq!(source.counts.documents_total, output.documents_prepared);
}

#[tokio::test]
async fn local_source_job_emits_progress_events_for_pipeline_phases() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lib.rs");
    tokio::fs::write(&path, "pub fn answer() -> i32 {\n    42\n}\n")
        .await
        .unwrap();
    let jobs = FakeJobWatchStore::new();
    let ledger = FakeLedgerStore::new();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let vectors = FakeVectorStore::new("fake-vector");

    let output = index_local_source_with_job(input(path), &jobs, &ledger, &embedder, &vectors)
        .await
        .unwrap();

    let summary = JobStore::get(&jobs, output.job_id)
        .await
        .unwrap()
        .expect("job summary");
    assert_eq!(summary.kind, JobKind::Source);
    assert_eq!(summary.status, LifecycleStatus::Completed);
    assert_eq!(summary.source_id, Some(output.source_id.clone()));

    let events = JobStore::events(
        &jobs,
        JobEventListRequest {
            job_id: output.job_id,
            phase: None,
            severity: None,
            visibility: Some(Visibility::Public),
            since_sequence: None,
            limit: Some(20),
            cursor: None,
        },
    )
    .await
    .unwrap();
    let phases = events
        .events
        .iter()
        .map(|event| event.phase)
        .collect::<Vec<_>>();

    assert_eq!(
        phases,
        vec![
            PipelinePhase::Discovering,
            PipelinePhase::Diffing,
            PipelinePhase::Preparing,
            PipelinePhase::Embedding,
            PipelinePhase::Vectorizing,
            PipelinePhase::Publishing,
            PipelinePhase::Cleaning,
            PipelinePhase::Complete,
        ]
    );
    assert!(
        events
            .events
            .iter()
            .all(|event| event.job_id == output.job_id)
    );
}

#[tokio::test]
async fn local_source_job_records_provider_reservation_events() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lib.rs");
    tokio::fs::write(&path, "pub fn answer() -> i32 {\n    42\n}\n")
        .await
        .unwrap();
    let jobs = FakeJobWatchStore::new();
    let ledger = FakeLedgerStore::new();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let vectors = FakeVectorStore::new("fake-vector");

    let output = index_local_source_with_job(
        input_with_reservations(path),
        &jobs,
        &ledger,
        &embedder,
        &vectors,
    )
    .await
    .unwrap();

    let events = JobStore::events(
        &jobs,
        JobEventListRequest {
            job_id: output.job_id,
            phase: None,
            severity: None,
            visibility: Some(Visibility::Public),
            since_sequence: None,
            limit: Some(20),
            cursor: None,
        },
    )
    .await
    .unwrap();
    let embedding_event = events
        .events
        .iter()
        .find(|event| event.phase == PipelinePhase::Embedding)
        .expect("embedding event");
    assert!(
        progress_reservation_id(embedding_event).is_some(),
        "embedding phase should expose reservation evidence"
    );
    let vectorizing_event = events
        .events
        .iter()
        .find(|event| event.phase == PipelinePhase::Vectorizing)
        .expect("vectorizing event");
    assert!(
        progress_reservation_id(vectorizing_event).is_some(),
        "vectorizing phase should expose reservation evidence"
    );
}

fn progress_reservation_id(event: &JobEvent) -> Option<&str> {
    event
        .details
        .get("source_progress_event")?
        .get("reservation_id")?
        .as_str()
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

#[tokio::test]
async fn unchanged_refresh_reuses_committed_generation_without_vector_work() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lib.rs");
    tokio::fs::write(&path, "pub fn answer() -> i32 {\n    42\n}\n")
        .await
        .unwrap();
    let ledger = FakeLedgerStore::new();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let vectors = FakeVectorStore::new("fake-vector");

    let first = index_local_source(input(path.clone()), &ledger, &embedder, &vectors)
        .await
        .unwrap();
    let embedding_calls = embedder.calls().await.len();
    let vector_calls = vectors.calls().await;

    let second = index_local_source(input(path), &ledger, &embedder, &vectors)
        .await
        .unwrap();

    assert_eq!(second.generation, first.generation);
    assert_eq!(
        ledger.committed_generation(&first.source_id).await,
        Some(first.generation)
    );
    assert_eq!(second.documents_prepared, 0);
    assert_eq!(second.chunks_prepared, 0);
    assert_eq!(second.vector_points_written, 0);
    assert_eq!(embedder.calls().await.len(), embedding_calls);
    assert_eq!(vectors.calls().await, vector_calls);
}

#[tokio::test]
async fn refresh_vectorizes_added_and_modified_docs_and_debts_removed_and_replaced_items() {
    let dir = tempfile::tempdir().unwrap();
    let old_path = dir.path().join("old.rs");
    let keep_path = dir.path().join("keep.rs");
    let new_path = dir.path().join("new.rs");
    tokio::fs::write(&old_path, "pub fn old() -> i32 { 1 }\n")
        .await
        .unwrap();
    tokio::fs::write(&keep_path, "pub fn keep() -> i32 { 1 }\n")
        .await
        .unwrap();
    let ledger = FakeLedgerStore::new();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let vectors = FakeVectorStore::new("fake-vector");

    let first = index_local_source(
        input(dir.path().to_path_buf()),
        &ledger,
        &embedder,
        &vectors,
    )
    .await
    .unwrap();
    assert_eq!(first.documents_prepared, 2);

    tokio::fs::remove_file(old_path).await.unwrap();
    tokio::fs::write(&keep_path, "pub fn keep() -> i32 { 2 }\n")
        .await
        .unwrap();
    tokio::fs::write(&new_path, "pub fn new() -> i32 { 3 }\n")
        .await
        .unwrap();

    let second = index_local_source(
        input(dir.path().to_path_buf()),
        &ledger,
        &embedder,
        &vectors,
    )
    .await
    .unwrap();

    assert_ne!(second.generation, first.generation);
    assert_eq!(second.documents_prepared, 2);
    assert_eq!(embedder.calls().await.len(), 2);
    assert_eq!(
        vectors
            .calls()
            .await
            .into_iter()
            .filter(|call| *call == "upsert")
            .count(),
        2
    );
    assert_eq!(
        vectors
            .calls()
            .await
            .into_iter()
            .filter(|call| *call == "delete")
            .count(),
        0
    );
    assert!(
        vectors
            .points("axon-test")
            .await
            .iter()
            .any(|point| point.payload["source_generation"].as_str()
                == Some(first.generation.0.as_str()))
    );
    assert_eq!(ledger.cleanup_debt_count().await, 2);
    assert_eq!(
        ledger.committed_generation(&second.source_id).await,
        Some(second.generation)
    );
}

#[tokio::test]
async fn code_search_selection_skips_lockfiles_and_pruned_dirs() {
    let dir = tempfile::tempdir().unwrap();
    tokio::fs::create_dir_all(dir.path().join("src"))
        .await
        .unwrap();
    tokio::fs::create_dir_all(dir.path().join("target/debug"))
        .await
        .unwrap();
    tokio::fs::create_dir_all(dir.path().join(".cache"))
        .await
        .unwrap();
    tokio::fs::write(dir.path().join("src/lib.rs"), "pub fn x() {}\n")
        .await
        .unwrap();
    tokio::fs::write(
        dir.path().join("Cargo.toml"),
        "[package]\nname = \"demo\"\n",
    )
    .await
    .unwrap();
    tokio::fs::write(dir.path().join("README.md"), "# demo\n")
        .await
        .unwrap();
    tokio::fs::write(
        dir.path().join("pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\n",
    )
    .await
    .unwrap();
    tokio::fs::write(
        dir.path().join("target/debug/generated.rs"),
        "pub fn generated() {}\n",
    )
    .await
    .unwrap();
    tokio::fs::write(dir.path().join(".cache/script.sh"), "echo cache\n")
        .await
        .unwrap();
    let ledger = FakeLedgerStore::new();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let vectors = FakeVectorStore::new("fake-vector");
    let mut request = input(dir.path().to_path_buf());
    request.selection_policy = LocalSourceSelectionPolicy::CodeSearch;

    let output = index_local_source(request, &ledger, &embedder, &vectors)
        .await
        .unwrap();

    assert_eq!(output.documents_prepared, 3);
    assert_eq!(embedder.calls().await.len(), 1);
    assert_eq!(
        ledger.committed_generation(&output.source_id).await,
        Some(output.generation)
    );
}
