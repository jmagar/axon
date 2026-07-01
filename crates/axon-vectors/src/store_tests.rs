use axon_api::source::*;
use serde_json::json;
use uuid::Uuid;

use crate::store::{FakeVectorMode, FakeVectorStore, VectorStore};

fn collection() -> CollectionSpec {
    CollectionSpec {
        collection: "axon-test".to_string(),
        dense: VectorConfig {
            name: "dense".to_string(),
            dimensions: 3,
            distance: VectorDistance::Cosine,
        },
        payload_indexes: vec![
            payload_index("source_id", PayloadFieldSchema::Keyword),
            payload_index("source_generation", PayloadFieldSchema::Integer),
            payload_index("document_id", PayloadFieldSchema::Keyword),
            payload_index("chunk_id", PayloadFieldSchema::Keyword),
            payload_index("vector_namespace", PayloadFieldSchema::Keyword),
            payload_index("visibility", PayloadFieldSchema::Keyword),
            payload_index("content_kind", PayloadFieldSchema::Keyword),
        ],
        sparse: None,
        aliases: Vec::new(),
        distance: Some(VectorDistance::Cosine),
        metadata: MetadataMap::new(),
    }
}

fn payload_index(field_name: &str, field_schema: PayloadFieldSchema) -> PayloadIndexSpec {
    PayloadIndexSpec {
        field_name: field_name.to_string(),
        field_schema,
        required_for_filters: true,
    }
}

fn batch() -> VectorPointBatch {
    VectorPointBatch {
        batch_id: BatchId::new(Uuid::from_u128(10)),
        collection: "axon-test".to_string(),
        points: vec![
            VectorPoint {
                point_id: VectorPointId::new("point-a"),
                chunk_id: ChunkId::new("chunk-a"),
                vector: vec![1.0, 0.0, 0.0],
                sparse_vector: None,
                payload: payload(
                    "src-a",
                    7,
                    "doc-a",
                    "chunk-a",
                    "dense",
                    "internal",
                    "markdown",
                    "https://example.com/docs/a",
                ),
            },
            VectorPoint {
                point_id: VectorPointId::new("point-b"),
                chunk_id: ChunkId::new("chunk-b"),
                vector: vec![0.0, 1.0, 0.0],
                sparse_vector: None,
                payload: payload(
                    "src-a",
                    8,
                    "doc-b",
                    "chunk-b",
                    "dense",
                    "public",
                    "code",
                    "https://example.com/docs/b",
                ),
            },
            VectorPoint {
                point_id: VectorPointId::new("point-c"),
                chunk_id: ChunkId::new("chunk-c"),
                vector: vec![0.0, 0.0, 1.0],
                sparse_vector: None,
                payload: payload(
                    "src-b",
                    7,
                    "doc-c",
                    "chunk-c",
                    "summary",
                    "internal",
                    "markdown",
                    "https://example.com/other/c",
                ),
            },
        ],
        model: "fake-embedding".to_string(),
        dimensions: 3,
        sparse_vectors: None,
        payload_indexes: collection().payload_indexes,
    }
}

#[allow(clippy::too_many_arguments)]
fn payload(
    source_id: &str,
    generation: i64,
    document_id: &str,
    chunk_id: &str,
    namespace: &str,
    visibility: &str,
    content_kind: &str,
    url: &str,
) -> MetadataMap {
    MetadataMap(
        [
            ("source_id".to_string(), json!(source_id)),
            ("source_generation".to_string(), json!(generation)),
            ("committed_generation".to_string(), json!(generation)),
            ("document_id".to_string(), json!(document_id)),
            ("chunk_id".to_string(), json!(chunk_id)),
            (
                "chunk_locator".to_string(),
                json!({
                    "canonical_uri": url,
                    "path": url,
                    "heading_path": [],
                    "symbol": null,
                    "range": source_range(),
                }),
            ),
            ("source_range".to_string(), source_range()),
            ("vector_namespace".to_string(), json!(namespace)),
            ("visibility".to_string(), json!(visibility)),
            ("redaction_status".to_string(), json!("clean")),
            (
                "job_id".to_string(),
                json!("00000000-0000-0000-0000-000000000000"),
            ),
            ("document_status".to_string(), json!("prepared")),
            ("embedding_model".to_string(), json!("fake-embedding")),
            ("embedding_dimensions".to_string(), json!(3)),
            ("embedding_provider".to_string(), json!("fake-vector")),
            ("embedding_profile".to_string(), json!("test")),
            ("embedded_at".to_string(), json!("2026-07-01T00:00:00Z")),
            ("payload_contract_version".to_string(), json!("2026-07-01")),
            ("collection".to_string(), json!("axon-test")),
            ("source_family".to_string(), json!("web")),
            ("content_kind".to_string(), json!(content_kind)),
            ("web_title".to_string(), json!("Fixture")),
            ("web_domain".to_string(), json!("example.com")),
            ("web_status_code".to_string(), json!(200)),
            ("web_depth".to_string(), json!(1)),
        ]
        .into_iter()
        .collect(),
    )
}

fn source_range() -> serde_json::Value {
    json!({
        "line_start": 1,
        "line_end": 2
    })
}

fn search(filters: MetadataMap) -> VectorSearchRequest {
    VectorSearchRequest {
        collection: "axon-test".to_string(),
        query: "chunk".to_string(),
        limit: 10,
        dense_vector: Some(vec![1.0, 0.0, 0.0]),
        sparse_vector: None,
        filters,
        hybrid: Some(false),
        generation: None,
        graph_refs: Vec::new(),
        metadata: MetadataMap::new(),
    }
}

fn filter(field: &str, value: serde_json::Value) -> MetadataMap {
    MetadataMap([(field.to_string(), value)].into_iter().collect())
}

#[tokio::test]
async fn fake_vector_store_upserts_searches_and_deletes_without_qdrant() {
    let store = FakeVectorStore::new("fake-vector");

    store.ensure_collection(collection()).await.unwrap();
    let written = store.upsert(batch()).await.unwrap();
    assert_eq!(written.points_written, 3);

    let search = store.search(search(MetadataMap::new())).await.unwrap();
    assert_eq!(search.results[0].point_id, VectorPointId::new("point-a"));

    let deleted = store
        .delete(VectorDeleteSelector::Chunks {
            collection: "axon-test".to_string(),
            chunk_ids: vec![ChunkId::new("chunk-a")],
        })
        .await
        .unwrap();
    assert_eq!(deleted.points_deleted, 1);
}

#[tokio::test]
async fn fake_vector_store_reports_capabilities_and_records_calls() {
    let store = FakeVectorStore::new("fake-vector");

    let capability = store.capabilities().await.unwrap();
    assert_eq!(capability.provider_kind, ProviderKind::Vector);
    assert!(capability.vector_store.unwrap().dense);

    store.ensure_collection(collection()).await.unwrap();
    store.upsert(batch()).await.unwrap();
    assert_eq!(store.calls().await, vec!["ensure_collection", "upsert"]);

    store.reset().await.unwrap();
    assert!(store.calls().await.is_empty());
}

#[tokio::test]
async fn collection_creation_is_idempotent_and_rejects_drift() {
    let store = FakeVectorStore::new("fake-vector");
    store.ensure_collection(collection()).await.unwrap();
    store.ensure_collection(collection()).await.unwrap();

    let mut drifted_dimensions = collection();
    drifted_dimensions.dense.dimensions = 4;
    let err = store
        .ensure_collection(drifted_dimensions)
        .await
        .unwrap_err();
    assert_eq!(err.code.to_string(), "vector.collection_drift");

    let mut drifted_name = collection();
    drifted_name.dense.name = "other-dense".to_string();
    let err = store.ensure_collection(drifted_name).await.unwrap_err();
    assert_eq!(err.code.to_string(), "vector.collection_drift");
}

#[tokio::test]
async fn fake_vector_store_records_payload_indexes_from_collection_spec() {
    let store = FakeVectorStore::new("fake-vector");
    store.ensure_collection(collection()).await.unwrap();
    let spec = store.collection_spec("axon-test").await.unwrap();

    assert_eq!(spec.payload_indexes.len(), 7);
    assert!(spec.payload_indexes.iter().any(|index| {
        index.field_name == "source_generation"
            && index.field_schema == PayloadFieldSchema::Integer
            && index.required_for_filters
    }));
}

#[tokio::test]
async fn fake_vector_store_filters_searches_by_indexed_payload_fields() {
    let store = FakeVectorStore::new("fake-vector");
    store.ensure_collection(collection()).await.unwrap();
    store.upsert(batch()).await.unwrap();

    for (field, value, expected) in [
        ("source_id", json!("src-b"), "point-c"),
        ("source_generation", json!(8), "point-b"),
        ("document_id", json!("doc-c"), "point-c"),
        ("chunk_id", json!("chunk-b"), "point-b"),
        ("vector_namespace", json!("summary"), "point-c"),
        ("visibility", json!("public"), "point-b"),
        ("content_kind", json!("code"), "point-b"),
    ] {
        let result = store.search(search(filter(field, value))).await.unwrap();
        assert_eq!(result.results.len(), 1, "{field}");
        assert_eq!(result.results[0].point_id, VectorPointId::new(expected));
    }

    let result = store
        .search(search(filter(
            "vector_namespace",
            json!(["dense", "summary"]),
        )))
        .await
        .unwrap();
    let point_ids = result
        .results
        .iter()
        .map(|result| result.point_id.0.as_str())
        .collect::<Vec<_>>();
    assert_eq!(point_ids, vec!["point-a", "point-b", "point-c"]);

    let result = store
        .search(search(filter("vector_namespace", json!([]))))
        .await
        .unwrap();
    assert!(result.results.is_empty());

    let mut request = search(MetadataMap::new());
    request.generation = Some(SourceGenerationId::new("7"));
    let result = store.search(request).await.unwrap();
    assert_eq!(result.results.len(), 2);
    assert!(
        result
            .results
            .iter()
            .all(|result| result.payload["source_generation"] == 7)
    );
}

#[tokio::test]
async fn fake_vector_store_rejects_upsert_without_matching_collection() {
    let store = FakeVectorStore::new("fake-vector");

    let err = store.upsert(batch()).await.unwrap_err();
    assert_eq!(err.code.to_string(), "vector.collection_not_found");

    let mut spec = collection();
    spec.dense.dimensions = 4;
    store.ensure_collection(spec).await.unwrap();
    let err = store.upsert(batch()).await.unwrap_err();
    assert_eq!(err.code.to_string(), "vector.dimension_mismatch");
}

#[tokio::test]
async fn fake_vector_store_rejects_invalid_payloads_before_insert() {
    let store = FakeVectorStore::new("fake-vector");
    store.ensure_collection(collection()).await.unwrap();
    let mut invalid = batch();
    invalid.points[0].payload.remove("chunk_locator");

    let err = store.upsert(invalid).await.unwrap_err();

    assert_eq!(err.code.to_string(), "vector.invalid_payload");
    let result = store.search(search(MetadataMap::new())).await.unwrap();
    assert!(result.results.is_empty());
}

#[tokio::test]
async fn delete_selectors_only_delete_matching_points() {
    let store = FakeVectorStore::new("fake-vector");
    store.ensure_collection(collection()).await.unwrap();
    store.upsert(batch()).await.unwrap();

    let deleted = store
        .delete(VectorDeleteSelector::Document {
            collection: "axon-test".to_string(),
            document_id: DocumentId::new("doc-b"),
            generation: Some(SourceGenerationId::new("8")),
        })
        .await
        .unwrap();
    assert_eq!(deleted.points_deleted, 1);
    assert_eq!(
        store
            .search(search(MetadataMap::new()))
            .await
            .unwrap()
            .results
            .len(),
        2
    );

    let deleted = store
        .delete(VectorDeleteSelector::Source {
            collection: "axon-test".to_string(),
            source_id: SourceId::new("src-b"),
            generation: Some(SourceGenerationId::new("7")),
        })
        .await
        .unwrap();
    assert_eq!(deleted.points_deleted, 1);
    let remaining = store.search(search(MetadataMap::new())).await.unwrap();
    assert_eq!(remaining.results.len(), 1);
    assert_eq!(remaining.results[0].point_id, VectorPointId::new("point-a"));
}

#[tokio::test]
async fn point_delete_selector_only_deletes_named_points() {
    let store = FakeVectorStore::new("fake-vector");
    store.ensure_collection(collection()).await.unwrap();
    store.upsert(batch()).await.unwrap();

    let deleted = store
        .delete(VectorDeleteSelector::Points {
            collection: "axon-test".to_string(),
            point_ids: vec![VectorPointId::new("point-b")],
        })
        .await
        .unwrap();
    assert_eq!(deleted.points_deleted, 1);

    let remaining = store.search(search(MetadataMap::new())).await.unwrap();
    assert_eq!(remaining.results.len(), 2);
    assert!(
        remaining
            .results
            .iter()
            .all(|result| result.point_id != VectorPointId::new("point-b"))
    );
}

#[tokio::test]
async fn cleanup_debt_generation_delete_cannot_delete_unrelated_generations() {
    let store = FakeVectorStore::new("fake-vector");
    store.ensure_collection(collection()).await.unwrap();
    store.upsert(batch()).await.unwrap();

    let deleted = store
        .delete(VectorDeleteSelector::Generation {
            collection: "axon-test".to_string(),
            source_id: SourceId::new("src-a"),
            generation: SourceGenerationId::new("7"),
        })
        .await
        .unwrap();
    assert_eq!(deleted.points_deleted, 1);

    let result = store
        .search(search(filter("source_id", json!("src-a"))))
        .await
        .unwrap();
    assert_eq!(result.results.len(), 1);
    assert_eq!(result.results[0].point_id, VectorPointId::new("point-b"));
    assert_eq!(result.results[0].payload["source_generation"], 8);
}

#[tokio::test]
async fn fake_vector_store_reports_health_override() {
    let store = FakeVectorStore::new("fake-vector").with_health(HealthStatus::Cooling);

    let capability = store.capabilities().await.unwrap();

    assert_eq!(capability.health, HealthStatus::Cooling);
}

#[tokio::test]
async fn fake_vector_store_capabilities_reflect_failure_mode() {
    let unavailable = FakeVectorStore::new("fake-vector").with_mode(FakeVectorMode::Unavailable);
    assert_eq!(
        unavailable.capabilities().await.unwrap().health,
        HealthStatus::Unavailable
    );

    let timeout = FakeVectorStore::new("fake-vector").with_mode(FakeVectorMode::Timeout);
    assert_eq!(
        timeout.capabilities().await.unwrap().health,
        HealthStatus::Degraded
    );

    let rate_limited = FakeVectorStore::new("fake-vector").with_mode(FakeVectorMode::RateLimited);
    let capability = rate_limited.capabilities().await.unwrap();
    assert_eq!(capability.health, HealthStatus::Cooling);
    assert!(capability.cooldown_until.is_some());
    assert_eq!(
        capability.last_error.unwrap().code.to_string(),
        "provider.rate_limited"
    );

    let store = FakeVectorStore::new("fake-vector").with_mode(FakeVectorMode::Fatal);

    let capability = store.capabilities().await.unwrap();

    assert_eq!(capability.health, HealthStatus::Unavailable);
    let error = capability.last_error.unwrap();
    assert_eq!(error.code.to_string(), "provider.fatal");
    assert_eq!(error.provider_id, Some("fake-vector".to_string()));
    assert!(!error.retryable);
}

#[tokio::test]
async fn fake_vector_store_returns_deterministic_failure_modes_and_records_calls() {
    let unavailable = FakeVectorStore::new("fake-vector").with_mode(FakeVectorMode::Unavailable);
    let err = unavailable
        .ensure_collection(collection())
        .await
        .unwrap_err();
    assert_eq!(err.code.to_string(), "provider.unavailable");
    assert!(err.retryable);

    let rate_limited = FakeVectorStore::new("fake-vector").with_mode(FakeVectorMode::RateLimited);

    let err = rate_limited
        .ensure_collection(collection())
        .await
        .unwrap_err();
    assert_eq!(err.code.to_string(), "provider.rate_limited");
    assert!(err.retryable);
    assert_eq!(rate_limited.calls().await, vec!["ensure_collection"]);

    let fatal = FakeVectorStore::new("fake-vector").with_mode(FakeVectorMode::Fatal);

    let err = fatal.search(search(MetadataMap::new())).await.unwrap_err();

    assert_eq!(err.code.to_string(), "provider.fatal");
    assert!(!err.retryable);
    assert_eq!(fatal.calls().await, vec!["search"]);
}
