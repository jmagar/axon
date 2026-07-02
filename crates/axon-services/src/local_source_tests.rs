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
        embedding_model: "fake-embedding".to_string(),
        embedding_dimensions: 8,
        selection_policy: LocalSourceSelectionPolicy::Permissive,
    }
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
    assert_eq!(embedder.calls().await.len(), 4);
    assert_eq!(
        vectors
            .calls()
            .await
            .into_iter()
            .filter(|call| *call == "upsert")
            .count(),
        4
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
    assert_eq!(embedder.calls().await.len(), 3);
    assert_eq!(
        ledger.committed_generation(&output.source_id).await,
        Some(output.generation)
    );
}
