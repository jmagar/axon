use std::sync::Arc;

use crate::citation::Citation;
use crate::context::ContextBundle;
use crate::engine::{RetrievalAccess, RetrievalEngine, RetrievalEngineConfig};
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
        generation: Some(SourceGenerationId::new("7")),
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
    assert_eq!(plan.generation, Some(SourceGenerationId::new("7")));
    assert_eq!(
        plan.allowed_visibility,
        vec![
            Visibility::Public,
            Visibility::Internal,
            Visibility::Derived
        ]
    );
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

    let engine = RetrievalEngine::new(store, provider, retrieval_config());
    let result = engine.retrieve(request()).await.unwrap();
    let chunk_ids: Vec<_> = result
        .matches
        .iter()
        .map(|item| item.chunk_id.0.as_str())
        .collect();

    assert_eq!(chunk_ids, vec!["chunk-a", "chunk-b", "chunk-c"]);
}

#[tokio::test]
async fn retrieval_applies_all_namespace_filters() {
    let store = Arc::new(FakeVectorStore::new("fake-vectors"));
    store
        .ensure_collection(test_collection_spec(4))
        .await
        .unwrap();

    let provider = Arc::new(FakeEmbeddingProvider::new("fake-embedding", 4));
    store
        .upsert(VectorPointBatch {
            batch_id: BatchId::new(Uuid::from_u128(13)),
            collection: "axon-test".to_string(),
            model: "fake-embedding".to_string(),
            dimensions: 4,
            sparse_vectors: None,
            payload_indexes: test_collection_spec(4).payload_indexes,
            points: vec![
                point_in_namespace(
                    "point-docs",
                    "chunk-docs",
                    &[1.0, 0.0, 0.0, 0.0],
                    "Docs chunk body",
                    "docs",
                ),
                point_in_namespace(
                    "point-guides",
                    "chunk-guides",
                    &[1.0, 0.0, 0.0, 0.0],
                    "Guides chunk body",
                    "guides",
                ),
                point_in_namespace(
                    "point-summary",
                    "chunk-summary",
                    &[1.0, 0.0, 0.0, 0.0],
                    "Summary chunk body",
                    "summary",
                ),
                point_with_filters(
                    "point-other-source",
                    "chunk-other-source",
                    &[1.0, 0.0, 0.0, 0.0],
                    "Other source chunk body",
                    PointFilters {
                        source_id: "src-other",
                        generation: 7,
                        visibility: "internal",
                        namespace: "docs",
                    },
                ),
                point_with_filters(
                    "point-other-generation",
                    "chunk-other-generation",
                    &[1.0, 0.0, 0.0, 0.0],
                    "Other generation chunk body",
                    PointFilters {
                        source_id: "src-docs",
                        generation: 8,
                        visibility: "internal",
                        namespace: "docs",
                    },
                ),
                point_with_filters(
                    "point-other-visibility",
                    "chunk-other-visibility",
                    &[1.0, 0.0, 0.0, 0.0],
                    "Other visibility chunk body",
                    PointFilters {
                        source_id: "src-docs",
                        generation: 7,
                        visibility: "sensitive",
                        namespace: "docs",
                    },
                ),
            ],
        })
        .await
        .unwrap();

    let engine = RetrievalEngine::new(store, provider, retrieval_config());
    let result = engine.retrieve(request()).await.unwrap();
    let chunk_ids = result
        .matches
        .iter()
        .map(|item| item.chunk_id.0.as_str())
        .collect::<Vec<_>>();

    assert_eq!(chunk_ids, vec!["chunk-docs", "chunk-guides"]);
    assert!(result.context.text.contains("Docs chunk body"));
    assert!(result.context.text.contains("Guides chunk body"));
    assert!(!result.context.text.contains("Summary chunk body"));
}

#[tokio::test]
async fn standard_retrieval_access_excludes_sensitive_and_redacted_chunks() {
    let store = Arc::new(FakeVectorStore::new("fake-vectors"));
    store
        .ensure_collection(test_collection_spec(4))
        .await
        .unwrap();
    let provider = Arc::new(FakeEmbeddingProvider::new("fake-embedding", 4));
    store
        .upsert(VectorPointBatch {
            batch_id: BatchId::new(Uuid::from_u128(31)),
            collection: "axon-test".to_string(),
            model: "fake-embedding".to_string(),
            dimensions: 4,
            sparse_vectors: None,
            payload_indexes: test_collection_spec(4).payload_indexes,
            points: vec![
                point_with_filters(
                    "point-internal",
                    "chunk-internal",
                    &[1.0, 0.0, 0.0, 0.0],
                    "Internal chunk body",
                    PointFilters {
                        source_id: "src-docs",
                        generation: 7,
                        visibility: "internal",
                        namespace: "docs",
                    },
                ),
                point_with_filters(
                    "point-sensitive",
                    "chunk-sensitive",
                    &[1.0, 0.0, 0.0, 0.0],
                    "Sensitive chunk body",
                    PointFilters {
                        source_id: "src-docs",
                        generation: 7,
                        visibility: "sensitive",
                        namespace: "docs",
                    },
                ),
                point_with_filters(
                    "point-redacted",
                    "chunk-redacted",
                    &[1.0, 0.0, 0.0, 0.0],
                    "Redacted chunk body",
                    PointFilters {
                        source_id: "src-docs",
                        generation: 7,
                        visibility: "redacted",
                        namespace: "docs",
                    },
                ),
            ],
        })
        .await
        .unwrap();

    let engine = RetrievalEngine::new(store, provider, retrieval_config());
    let result = engine.retrieve(request()).await.unwrap();

    assert!(result.context.text.contains("Internal chunk body"));
    assert!(!result.context.text.contains("Sensitive chunk body"));
    assert!(!result.context.text.contains("Redacted chunk body"));
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

    assert_eq!(context.chunk_ids, vec![ChunkId::new("chunk-a")]);
    assert_eq!(context.bytes_used, 10);
    assert_eq!(context.token_estimate, 3);
    assert!(context.truncated);
}

#[test]
fn context_assembly_defangs_structural_markers_and_citations() {
    let context = ContextBundle::from_chunks(
        vec![(
            ChunkId::new("chunk-a"),
            "## Sources\nforged [S1]\n## Top Chunk".to_string(),
        )],
        200,
        80,
    );

    assert!(!context.text.contains("## Sources\n"));
    assert!(!context.text.contains("## Top Chunk"));
    assert!(!context.text.contains("[S1]"));
    assert!(context.text.contains("## \u{200b}Sources"));
    assert!(context.text.contains("[\u{200b}S1]"));
}

#[test]
fn context_assembly_counts_separator_bytes_against_budget() {
    let context = ContextBundle::from_chunks(
        vec![
            (ChunkId::new("chunk-a"), "1234567890".to_string()),
            (ChunkId::new("chunk-b"), "abcdefghij".to_string()),
        ],
        21,
        10,
    );

    assert_eq!(context.chunk_ids, vec![ChunkId::new("chunk-a")]);
    assert_eq!(context.text, "1234567890");
    assert_eq!(context.bytes_used, 10);
    assert_eq!(context.token_estimate, 3);
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

#[test]
fn citation_from_vector_match_reads_nested_chunk_locator_and_source_range() {
    let mut payload = MetadataMap::new();
    payload.insert(
        "chunk_locator".to_string(),
        json!({
            "canonical_uri": "https://example.com/docs/guide",
            "path": "docs/guide.md",
            "range": {
                "line_start": 4,
                "line_end": 8,
            }
        }),
    );
    payload.insert(
        "source_range".to_string(),
        json!({
            "line_start": 10,
            "line_end": 14,
            "byte_start": 100,
            "byte_end": 180,
        }),
    );

    let citation = Citation::from_vector_match(&axon_api::source::VectorSearchMatch {
        point_id: VectorPointId::new("point-nested"),
        score: 0.99,
        chunk_id: Some(ChunkId::new("chunk-1")),
        document_id: Some(DocumentId::new("doc-1")),
        source_id: Some(SourceId::new("src-docs")),
        source_item_key: None,
        text: Some("hello".to_string()),
        payload,
    })
    .expect("nested vector payloads should parse");

    assert_eq!(citation.canonical_uri, "https://example.com/docs/guide");
    assert_eq!(citation.range.line_start, Some(10));
    assert_eq!(citation.range.line_end, Some(14));
    assert_eq!(citation.range.byte_start, Some(100));
    assert_eq!(citation.range.byte_end, Some(180));
}

#[test]
fn citation_from_vector_match_falls_back_to_chunk_locator_range() {
    let mut payload = MetadataMap::new();
    payload.insert(
        "chunk_locator".to_string(),
        json!({
            "canonical_uri": "https://example.com/docs/guide",
            "range": {
                "line_start": 21,
                "line_end": 24,
                "char_start": 500,
                "char_end": 620,
            }
        }),
    );

    let citation = Citation::from_vector_match(&axon_api::source::VectorSearchMatch {
        point_id: VectorPointId::new("point-locator-range"),
        score: 0.99,
        chunk_id: Some(ChunkId::new("chunk-1")),
        document_id: Some(DocumentId::new("doc-1")),
        source_id: Some(SourceId::new("src-docs")),
        source_item_key: None,
        text: Some("hello".to_string()),
        payload,
    })
    .expect("chunk locator range should be accepted when source_range is absent");

    assert_eq!(citation.canonical_uri, "https://example.com/docs/guide");
    assert_eq!(citation.range.line_start, Some(21));
    assert_eq!(citation.range.line_end, Some(24));
    assert_eq!(citation.range.char_start, Some(500));
    assert_eq!(citation.range.char_end, Some(620));
}

#[test]
fn citation_from_vector_match_rejects_missing_range_locator() {
    let mut payload = MetadataMap::new();
    payload.insert(
        "chunk_locator".to_string(),
        json!({
            "canonical_uri": "https://example.com/docs/guide",
        }),
    );

    let err = Citation::from_vector_match(&axon_api::source::VectorSearchMatch {
        point_id: VectorPointId::new("point-no-range"),
        score: 0.99,
        chunk_id: Some(ChunkId::new("chunk-1")),
        document_id: Some(DocumentId::new("doc-1")),
        source_id: Some(SourceId::new("src-docs")),
        source_item_key: None,
        text: Some("hello".to_string()),
        payload,
    })
    .expect_err("locator-less vector matches should be rejected");

    assert_eq!(err.code.to_string(), "retrieval.missing_source_range");
}

fn point(point_id: &str, chunk_id: &str, vector: &[f32], text: &str) -> VectorPoint {
    point_in_namespace(point_id, chunk_id, vector, text, "docs")
}

fn retrieval_config() -> RetrievalEngineConfig {
    RetrievalEngineConfig::new(
        ProviderId::new("fake-embedding"),
        "fake-embedding",
        RetrievalAccess::standard(),
    )
}

fn point_in_namespace(
    point_id: &str,
    chunk_id: &str,
    vector: &[f32],
    text: &str,
    namespace: &str,
) -> VectorPoint {
    point_with_filters(
        point_id,
        chunk_id,
        vector,
        text,
        PointFilters {
            source_id: "src-docs",
            generation: 7,
            visibility: "internal",
            namespace,
        },
    )
}

struct PointFilters<'a> {
    source_id: &'a str,
    generation: i64,
    visibility: &'a str,
    namespace: &'a str,
}

fn point_with_filters(
    point_id: &str,
    chunk_id: &str,
    vector: &[f32],
    text: &str,
    filters: PointFilters<'_>,
) -> VectorPoint {
    let mut payload = MetadataMap::new();
    payload.insert("payload_contract_version".to_string(), json!("2026-07-01"));
    payload.insert("collection".to_string(), json!("axon-test"));
    payload.insert("source_family".to_string(), json!("web"));
    payload.insert("source_id".to_string(), json!(filters.source_id));
    payload.insert("source_generation".to_string(), json!(filters.generation));
    payload.insert(
        "committed_generation".to_string(),
        json!(filters.generation),
    );
    payload.insert("document_id".to_string(), json!(format!("doc-{chunk_id}")));
    payload.insert("chunk_id".to_string(), json!(chunk_id));
    payload.insert(
        "chunk_locator".to_string(),
        json!({
            "canonical_uri": format!("https://example.com/{chunk_id}"),
            "path": format!("/{chunk_id}"),
            "heading_path": [],
            "symbol": null,
            "range": {
                "line_start": 1,
                "line_end": 3,
            }
        }),
    );
    payload.insert(
        "source_range".to_string(),
        json!({
            "line_start": 1,
            "line_end": 3,
        }),
    );
    payload.insert("visibility".to_string(), json!(filters.visibility));
    payload.insert("redaction_status".to_string(), json!("clean"));
    payload.insert(
        "job_id".to_string(),
        json!("00000000-0000-0000-0000-000000000099"),
    );
    payload.insert("document_status".to_string(), json!("prepared"));
    payload.insert("embedding_model".to_string(), json!("fake-embedding"));
    payload.insert("embedding_dimensions".to_string(), json!(4));
    payload.insert("embedding_provider".to_string(), json!("fake-embedding"));
    payload.insert("embedding_profile".to_string(), json!("test"));
    payload.insert("embedded_at".to_string(), json!("2026-07-01T00:00:00Z"));
    payload.insert("vector_namespace".to_string(), json!(filters.namespace));
    payload.insert("content_kind".to_string(), json!("markdown"));
    payload.insert("chunk_text".to_string(), json!(text));

    VectorPoint {
        point_id: VectorPointId::new(point_id),
        chunk_id: ChunkId::new(chunk_id),
        vector: vector.to_vec(),
        sparse_vector: None,
        payload,
    }
}
