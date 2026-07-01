use std::sync::Arc;

use crate::citation::Citation;
use crate::context::ContextBundle;
use crate::engine::RetrievalEngine;
use crate::query::RetrievalRequest;
use axon_api::source::{
    BatchId, ChunkId, ContentKind, DocumentId, EmbeddingInput, JobId, JobPriority, MetadataMap,
    ProviderId, SourceGenerationId, SourceId, SourceRange, VectorPoint, VectorPointBatch,
    VectorPointId, Visibility,
};
use axon_embedding::fake::FakeEmbeddingProvider;
use axon_embedding::provider::EmbeddingProvider;
use axon_vectors::store::{FakeVectorStore, VectorStore};
use axon_vectors::testing::test_collection_spec;
use serde_json::json;
use uuid::Uuid;

fn request() -> RetrievalRequest {
    RetrievalRequest {
        query: "vector embedding split".to_string(),
        collection: "axon-test".to_string(),
        limit: 3,
        source_id: Some(SourceId::new("src-docs")),
        generation: Some(SourceGenerationId::new("gen-7")),
        visibility: Visibility::Internal,
        namespace_filters: vec!["docs".to_string(), "guides".to_string()],
        byte_budget: 80,
        token_budget: 20,
    }
}

#[test]
fn retrieval_plan_preserves_source_id_generation_visibility_and_namespace_filters() {
    let request = request();

    let plan = request.plan();

    assert_eq!(plan.collection, "axon-test");
    assert_eq!(plan.source_id, Some(SourceId::new("src-docs")));
    assert_eq!(plan.generation, Some(SourceGenerationId::new("gen-7")));
    assert_eq!(plan.visibility, Visibility::Internal);
    assert_eq!(plan.namespace_filters, vec!["docs", "guides"]);
    assert_eq!(plan.limit, 3);
}

#[tokio::test]
async fn ranking_is_deterministic_with_fixed_fake_vector_search_results() {
    let store = Arc::new(FakeVectorStore::new("fake-vectors"));
    store
        .ensure_collection(test_collection_spec(4))
        .await
        .unwrap();

    let provider = Arc::new(FakeEmbeddingProvider::new("fake-embedding", 4));
    let query_vector = provider
        .embed(axon_api::source::EmbeddingBatch {
            batch_id: BatchId::new(Uuid::from_u128(10)),
            job_id: JobId::new(Uuid::from_u128(11)),
            provider_id: ProviderId::new("fake-embedding"),
            model: "fake-embedding".to_string(),
            items: vec![EmbeddingInput {
                chunk_id: ChunkId::new("query"),
                text: request().query.clone(),
                content_kind: ContentKind::PlainText,
                metadata: MetadataMap::new(),
            }],
            instruction: None,
            priority: JobPriority::Interactive,
            metadata: MetadataMap::new(),
        })
        .await
        .unwrap()
        .vectors
        .remove(0)
        .values;

    store
        .upsert(VectorPointBatch {
            batch_id: BatchId::new(Uuid::from_u128(12)),
            collection: "axon-test".to_string(),
            model: "fake-embedding".to_string(),
            dimensions: 4,
            sparse_vectors: None,
            payload_indexes: test_collection_spec(4).payload_indexes,
            points: vec![
                point("point-a", "chunk-a", &query_vector, "Alpha chunk body"),
                point(
                    "point-b",
                    "chunk-b",
                    &[1.0, 0.0, 0.0, 0.0],
                    "Beta chunk body",
                ),
                point(
                    "point-c",
                    "chunk-c",
                    &[1.0, 0.0, 0.0, 0.0],
                    "Gamma chunk body",
                ),
            ],
        })
        .await
        .unwrap();

    let engine = RetrievalEngine::new(store, provider);
    let result = engine.retrieve(request()).await.unwrap();
    let chunk_ids: Vec<_> = result
        .matches
        .iter()
        .map(|item| item.chunk_id.0.as_str())
        .collect();

    assert_eq!(chunk_ids, vec!["chunk-a", "chunk-b", "chunk-c"]);
}

#[test]
fn context_assembly_respects_byte_and_token_budget_inputs() {
    let context = ContextBundle::from_chunks(
        vec![
            (ChunkId::new("chunk-a"), "1234567890".to_string()),
            (ChunkId::new("chunk-b"), "abcdefghij".to_string()),
            (ChunkId::new("chunk-c"), "klmnopqrst".to_string()),
        ],
        24,
        5,
    );

    assert_eq!(
        context.chunk_ids,
        vec![ChunkId::new("chunk-a"), ChunkId::new("chunk-b")]
    );
    assert_eq!(context.bytes_used, 20);
    assert_eq!(context.token_estimate, 5);
    assert!(context.truncated);
}

#[test]
fn citations_always_include_source_document_chunk_uri_and_range() {
    let citation = Citation::new(
        SourceId::new("src-docs"),
        DocumentId::new("doc-1"),
        ChunkId::new("chunk-1"),
        "https://example.com/docs/guide".to_string(),
        SourceRange {
            line_start: Some(10),
            line_end: Some(14),
            byte_start: Some(100),
            byte_end: Some(180),
            char_start: None,
            char_end: None,
            time_start_ms: None,
            time_end_ms: None,
            dom_selector: None,
            json_pointer: None,
            yaml_path: None,
            xml_xpath: None,
            csv_row: None,
            session_turn_id: None,
            turn_start: None,
            turn_end: None,
        },
    );

    assert_eq!(citation.source_id, SourceId::new("src-docs"));
    assert_eq!(citation.document_id, DocumentId::new("doc-1"));
    assert_eq!(citation.chunk_id, ChunkId::new("chunk-1"));
    assert_eq!(citation.canonical_uri, "https://example.com/docs/guide");
    assert_eq!(citation.range.line_start, Some(10));
    assert_eq!(citation.range.line_end, Some(14));
}

fn point(point_id: &str, chunk_id: &str, vector: &[f32], text: &str) -> VectorPoint {
    let mut payload = MetadataMap::new();
    payload.insert("source_id".to_string(), json!("src-docs"));
    payload.insert("source_generation".to_string(), json!("gen-7"));
    payload.insert("document_id".to_string(), json!(format!("doc-{chunk_id}")));
    payload.insert(
        "canonical_uri".to_string(),
        json!(format!("https://example.com/{chunk_id}")),
    );
    payload.insert("visibility".to_string(), json!("internal"));
    payload.insert("vector_namespace".to_string(), json!("docs"));
    payload.insert("text".to_string(), json!(text));
    payload.insert("line_start".to_string(), json!(1));
    payload.insert("line_end".to_string(), json!(3));

    VectorPoint {
        point_id: VectorPointId::new(point_id),
        chunk_id: ChunkId::new(chunk_id),
        vector: vector.to_vec(),
        sparse_vector: None,
        payload,
    }
}
