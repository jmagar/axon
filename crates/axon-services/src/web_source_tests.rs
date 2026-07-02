use axon_api::source::*;
use axon_embedding::fake::FakeEmbeddingProvider;
use axon_ledger::store::FakeLedgerStore;
use axon_vectors::store::FakeVectorStore;
use serde_json::json;

use super::{WebSourceIndexInput, index_web_source};

fn job_id() -> JobId {
    JobId::new(uuid::Uuid::from_u128(0x29812))
}

fn input(root: &std::path::Path, manifest_path: std::path::PathBuf) -> WebSourceIndexInput {
    WebSourceIndexInput {
        source: "https://example.com/docs?utm_source=noise".to_string(),
        scope: SourceScope::Docs,
        manifest_path,
        markdown_root: root.to_path_buf(),
        collection: "axon-web-test".to_string(),
        owner_id: "test-owner".to_string(),
        job_id: job_id(),
        embedding_provider_id: ProviderId::new("fake-embedding"),
        vector_provider_id: ProviderId::new("fake-vector"),
        embedding_model: "fake-embedding".to_string(),
        embedding_dimensions: 8,
    }
}

#[tokio::test]
async fn web_source_refresh_writes_vectors_then_commits_generation() {
    let fixture = web_fixture("# Intro\n\nHello docs.");
    let ledger = FakeLedgerStore::new();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let vectors = FakeVectorStore::new("fake-vector");

    let output = index_web_source(
        input(fixture.root.path(), fixture.manifest_path.clone()),
        &ledger,
        &embedder,
        &vectors,
    )
    .await
    .unwrap();

    assert_eq!(
        ledger.committed_generation(&output.source_id).await,
        Some(output.generation.clone())
    );
    assert_eq!(embedder.calls().await.len(), 1);
    assert_eq!(
        vectors.calls().await,
        vec!["ensure_collection", "upsert", "mark_generation_committed"]
    );
    assert!(output.documents_prepared >= 1);
    assert!(output.chunks_prepared >= 1);
    assert!(output.vector_points_written >= 1);

    let points = vectors.points("axon-web-test").await;
    assert!(!points.is_empty());
    assert!(points.iter().all(|point| {
        point.payload["source_kind"].as_str() == Some("web")
            && point.payload["source_adapter"].as_str() == Some("web")
            && point.payload["source_scope"].as_str() == Some("docs")
            && point.payload["web_domain"].as_str() == Some("example.com")
            && point.payload["committed_generation"].as_str() == Some(output.generation.0.as_str())
            && point.payload["document_status"].as_str() == Some("published")
    }));
}

#[tokio::test]
async fn unchanged_web_refresh_reuses_committed_generation_without_vector_work() {
    let fixture = web_fixture("# Intro\n\nHello docs.");
    let ledger = FakeLedgerStore::new();
    let embedder = FakeEmbeddingProvider::new("fake-embedding", 8);
    let vectors = FakeVectorStore::new("fake-vector");

    let first = index_web_source(
        input(fixture.root.path(), fixture.manifest_path.clone()),
        &ledger,
        &embedder,
        &vectors,
    )
    .await
    .unwrap();
    let embedding_calls = embedder.calls().await.len();
    let vector_calls = vectors.calls().await;

    let second = index_web_source(
        input(fixture.root.path(), fixture.manifest_path),
        &ledger,
        &embedder,
        &vectors,
    )
    .await
    .unwrap();

    assert_eq!(second.generation, first.generation);
    assert_eq!(second.documents_prepared, 0);
    assert_eq!(second.chunks_prepared, 0);
    assert_eq!(second.vector_points_written, 0);
    assert_eq!(embedder.calls().await.len(), embedding_calls);
    assert_eq!(vectors.calls().await, vector_calls);
}

struct WebFixture {
    root: tempfile::TempDir,
    manifest_path: std::path::PathBuf,
}

fn web_fixture(markdown: &str) -> WebFixture {
    let root = tempfile::tempdir().unwrap();
    let markdown_dir = root.path().join("markdown");
    std::fs::create_dir_all(&markdown_dir).unwrap();
    std::fs::write(markdown_dir.join("docs-intro.md"), markdown).unwrap();
    let manifest_path = root.path().join("manifest.jsonl");
    std::fs::write(
        &manifest_path,
        serde_json::to_string(&json!({
            "url": "https://example.com/docs/intro?utm_source=noise&token=secret",
            "relative_path": "markdown/docs-intro.md",
            "markdown_chars": markdown.len() as u64,
            "content_hash": format!("sha256:{}", markdown.len()),
            "changed": true,
            "structured": {
                "title": "Intro"
            }
        }))
        .unwrap()
            + "\n",
    )
    .unwrap();
    WebFixture {
        root,
        manifest_path,
    }
}
