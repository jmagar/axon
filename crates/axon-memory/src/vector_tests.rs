use std::sync::Arc;

use axon_api::source::*;
use axon_embedding::fake::FakeEmbeddingProvider;
use axon_vectors::store::FakeVectorStore;

use crate::store::{FakeMemoryStore, MemoryStore};
use crate::vector::{MEMORY_VECTOR_NAMESPACE, MemoryVectorConfig, VectorBackedMemoryStore};

fn request(body: &str) -> MemoryRequest {
    MemoryRequest {
        memory_type: MemoryType::Decision,
        body: body.to_string(),
        confidence: 0.9,
        salience: 0.8,
        scope: MemoryScope {
            kind: "project".to_string(),
            value: "axon".to_string(),
        },
        title: Some("decision".to_string()),
        tags: Vec::new(),
        links: Vec::new(),
        decay: None,
        embed: true,
        visibility: None,
    }
}

fn service(vector_store: Arc<FakeVectorStore>) -> VectorBackedMemoryStore {
    VectorBackedMemoryStore::new(
        Arc::new(FakeMemoryStore::new()),
        Arc::new(FakeEmbeddingProvider::new("fake-embedding", 4)),
        vector_store,
        MemoryVectorConfig {
            collection: "axon-test".to_string(),
            embedding_provider_id: ProviderId::new("fake-embedding"),
            embedding_model: "fake-embedding".to_string(),
            embedding_dimensions: 4,
        },
    )
}

#[tokio::test]
async fn remember_writes_memory_vector_payload() {
    let vectors = Arc::new(FakeVectorStore::new("fake-vector"));
    let service = service(Arc::clone(&vectors));

    let result = service
        .remember(request("phase 3b uses qdrant memory"))
        .await
        .unwrap();

    assert_eq!(result.vector_point_ids.len(), 1);
    let points = vectors.points("axon-test").await;
    assert_eq!(points.len(), 1);
    let payload = &points[0].payload;
    assert_eq!(
        payload["vector_namespace"].as_str(),
        Some(MEMORY_VECTOR_NAMESPACE)
    );
    assert_eq!(
        payload["memory_id"].as_str(),
        Some(result.memory_id.0.as_str())
    );
    assert_eq!(payload["memory_status"].as_str(), Some("active"));
    assert_eq!(payload["redaction_status"].as_str(), Some("clean"));
}

#[tokio::test]
async fn forgotten_memory_is_not_recalled_from_vector_namespace() {
    let vectors = Arc::new(FakeVectorStore::new("fake-vector"));
    let service = service(Arc::clone(&vectors));
    let result = service
        .remember(request("durable qdrant memory"))
        .await
        .unwrap();

    service
        .set_status(MemoryStatusRequest {
            memory_id: result.memory_id.clone(),
            status: MemoryStatus::Forgotten,
            reason: Some("test".to_string()),
            timestamp: Timestamp("2026-07-04T00:00:00Z".to_string()),
        })
        .await
        .unwrap();

    let hits = service
        .search(MemorySearchRequest {
            query: "durable".to_string(),
            limit: 10,
            filters: Default::default(),
            include_graph: false,
            include_archived: false,
            reinforce: false,
        })
        .await
        .unwrap();
    assert!(hits.results.is_empty());
    assert!(vectors.points("axon-test").await.is_empty());
}
