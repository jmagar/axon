use axon_api::source::*;
use axon_embedding::fake::{FakeEmbeddingMode, FakeEmbeddingProvider};
use axon_ledger::store::FakeLedgerStore;
use axon_vectors::store::{FakeVectorMode, FakeVectorStore};

use super::{LocalSourceIndexInput, index_local_source};

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
    assert_eq!(vectors.calls().await, vec!["ensure_collection", "upsert"]);
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
