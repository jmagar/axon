use axon_api::source::{MetadataMap, VectorPointBatch, VectorSearchRequest};

use crate::point::VectorPointBatchBuilder;
use crate::store::{FakeVectorMode, FakeVectorStore, VectorStore};
use crate::testing::{test_collection_spec, test_embedding_result_for, test_prepared_document};

fn batch() -> VectorPointBatch {
    let document = test_prepared_document();
    let embeddings = test_embedding_result_for(&document, "text-embedding-test", 3);
    VectorPointBatchBuilder::new(test_collection_spec(3), document, embeddings)
        .build()
        .unwrap()
}

fn search() -> VectorSearchRequest {
    VectorSearchRequest {
        collection: "axon-test".to_string(),
        query: "chunk".to_string(),
        limit: 10,
        dense_vector: Some(vec![1.0, 0.0, 0.0]),
        sparse_vector: None,
        filters: MetadataMap::new(),
        hybrid: Some(false),
        generation: None,
        graph_refs: Vec::new(),
        metadata: MetadataMap::new(),
    }
}

#[tokio::test]
async fn fake_vector_store_can_simulate_partial_failure_and_slow_write() {
    let partial = FakeVectorStore::new("fake-vector").with_mode(FakeVectorMode::PartialFailure);
    partial
        .ensure_collection(test_collection_spec(3))
        .await
        .unwrap();
    let err = partial.upsert(batch()).await.unwrap_err();
    assert_eq!(err.code.to_string(), "provider.partial_failure");
    assert_eq!(partial.search(search()).await.unwrap().results.len(), 1);

    let slow = FakeVectorStore::new("fake-vector").with_mode(FakeVectorMode::SlowWrite);
    slow.ensure_collection(test_collection_spec(3))
        .await
        .unwrap();
    let written = slow.upsert(batch()).await.unwrap();
    assert_eq!(written.points_written, 2);
    assert_eq!(slow.calls().await, vec!["ensure_collection", "upsert"]);
}
