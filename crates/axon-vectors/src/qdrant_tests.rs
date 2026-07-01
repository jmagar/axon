use axon_api::source::*;
use qdrant_client::qdrant::{
    FieldType, condition, r#match, point_id, vector, vectors, vectors_config,
};
use serde_json::json;

use crate::point::VectorPointBatchBuilder;
use crate::qdrant::{
    QdrantVectorStore, qdrant_collection_request, qdrant_filter, qdrant_payload_index_requests,
    qdrant_upsert_points,
};
use crate::store::VectorStore;
use crate::testing::{test_collection_spec, test_embedding_result_for, test_prepared_document};

#[test]
fn collection_spec_converts_to_named_dense_and_optional_sparse_config() {
    let mut spec = test_collection_spec(3);
    spec.dense.name = "dense_docs".to_string();
    spec.sparse = Some(SparseVectorConfig {
        name: "bm42".to_string(),
        modifier: SparseVectorModifier::Idf,
    });

    let request = qdrant_collection_request(&spec);

    assert_eq!(request.collection_name, "axon-test");
    let vectors = request.vectors_config.unwrap();
    let vectors_config::Config::ParamsMap(map) = vectors.config.unwrap() else {
        panic!("expected named dense vector params");
    };
    assert_eq!(map.map["dense_docs"].size, 3);
    assert_eq!(
        map.map["dense_docs"].distance,
        qdrant_client::qdrant::Distance::Cosine as i32
    );

    let sparse = request.sparse_vectors_config.unwrap();
    assert_eq!(
        sparse.map["bm42"].modifier,
        Some(qdrant_client::qdrant::Modifier::Idf as i32)
    );
}

#[test]
fn payload_index_specs_convert_to_qdrant_index_requests() {
    let spec = test_collection_spec(3);
    let indexes = qdrant_payload_index_requests(&spec);

    assert!(indexes.iter().any(|index| {
        index.collection_name == "axon-test"
            && index.field_name == "source_generation"
            && index.field_type == Some(FieldType::Integer as i32)
            && index.wait == Some(true)
    }));
    assert!(indexes.iter().any(|index| {
        index.field_name == "source_id" && index.field_type == Some(FieldType::Keyword as i32)
    }));
}

#[test]
fn source_generation_and_document_filters_convert_to_qdrant_filters() {
    let mut request = VectorSearchRequest {
        collection: "axon-test".to_string(),
        query: "docs".to_string(),
        limit: 10,
        dense_vector: None,
        sparse_vector: None,
        filters: MetadataMap(
            [
                ("source_id".to_string(), json!("src-web")),
                ("document_id".to_string(), json!("doc-web")),
            ]
            .into_iter()
            .collect(),
        ),
        hybrid: None,
        generation: Some(SourceGenerationId::new("7")),
        graph_refs: Vec::new(),
        metadata: MetadataMap::new(),
    };

    let filter = qdrant_filter(&request).unwrap();
    assert_eq!(filter.must.len(), 3);
    let keys = filter
        .must
        .iter()
        .map(|condition| {
            let condition::ConditionOneOf::Field(field) =
                condition.condition_one_of.as_ref().unwrap()
            else {
                panic!("expected field condition");
            };
            field.key.as_str()
        })
        .collect::<Vec<_>>();
    assert!(keys.contains(&"source_id"));
    assert!(keys.contains(&"source_generation"));
    assert!(keys.contains(&"document_id"));
    let generation_condition = filter
        .must
        .iter()
        .find_map(|condition| {
            let condition::ConditionOneOf::Field(field) = condition.condition_one_of.as_ref()?
            else {
                return None;
            };
            (field.key == "source_generation").then_some(field)
        })
        .expect("source_generation condition");
    assert!(matches!(
        generation_condition
            .r#match
            .as_ref()
            .and_then(|value| value.match_value.as_ref()),
        Some(r#match::MatchValue::Integer(7))
    ));

    request.filters.clear();
    request.generation = None;
    assert!(qdrant_filter(&request).is_none());
}

#[test]
fn vector_point_batch_converts_to_qdrant_points_without_dropping_payload_fields() {
    let mut spec = test_collection_spec(3);
    spec.dense.name = "dense_docs".to_string();
    let document = test_prepared_document();
    let embeddings = test_embedding_result_for(&document, "text-embedding-test", 3);
    let batch = VectorPointBatchBuilder::new(spec.clone(), document, embeddings)
        .build()
        .unwrap();

    let points = qdrant_upsert_points(&spec, &batch);

    assert_eq!(points.len(), 2);
    let first = &points[0];
    let point_id::PointIdOptions::Uuid(uuid) = first
        .id
        .as_ref()
        .unwrap()
        .point_id_options
        .as_ref()
        .unwrap()
    else {
        panic!("expected UUID point id");
    };
    assert_eq!(uuid, &batch.points[0].point_id.0);
    let vectors::VectorsOptions::Vectors(named) = first
        .vectors
        .as_ref()
        .unwrap()
        .vectors_options
        .as_ref()
        .unwrap()
    else {
        panic!("expected named vectors");
    };
    assert!(!named.vectors.contains_key("dense"));
    let vector::Vector::Dense(dense) = named.vectors["dense_docs"].vector.as_ref().unwrap() else {
        panic!("expected dense vector");
    };
    assert_eq!(dense.data, batch.points[0].vector);
    assert!(first.payload.contains_key("source_id"));
    assert!(first.payload.contains_key("source_generation"));
    assert!(first.payload.contains_key("chunk_locator"));
    assert!(first.payload.contains_key("web_title"));
}

#[tokio::test]
async fn qdrant_vector_store_live_calls_return_not_wired_errors() {
    let store = QdrantVectorStore::new("http://127.0.0.1:6334", "target-qdrant");

    let err = store
        .ensure_collection(test_collection_spec(3))
        .await
        .unwrap_err();
    assert_eq!(err.code.to_string(), "vector.not_wired");
    assert_eq!(err.provider_id.as_deref(), Some("target-qdrant"));

    let capability = store.capabilities().await.unwrap();
    assert_eq!(capability.provider_kind, ProviderKind::Vector);
    assert_eq!(capability.health, HealthStatus::Unavailable);
    assert!(capability.vector_store.unwrap().dense);
}
