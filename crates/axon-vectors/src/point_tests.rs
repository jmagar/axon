use axon_api::source::*;
use serde_json::json;

use crate::point::{VectorPointBatchBuildError, VectorPointBatchBuilder};
use crate::testing::{
    test_collection_spec, test_embedding_result_for, test_embedding_result_with_vectors,
    test_prepared_document,
};

#[test]
fn prepared_document_and_embeddings_build_validated_points() {
    let document = test_prepared_document();
    let embeddings = test_embedding_result_for(&document, "text-embedding-test", 3);
    let batch = VectorPointBatchBuilder::new(test_collection_spec(3), document, embeddings)
        .build()
        .unwrap();

    assert_eq!(batch.collection, "axon-test");
    assert_eq!(batch.model, "text-embedding-test");
    assert_eq!(batch.dimensions, 3);
    assert_eq!(batch.points.len(), 2);
    assert_eq!(batch.points[0].chunk_id, ChunkId::new("chunk-web-1"));
    assert_eq!(batch.points[0].vector, vec![1.0, 2.0, 3.0]);
    assert_eq!(batch.points[0].payload["collection"], "axon-test");
    assert_eq!(batch.points[0].payload["source_id"], "src-web");
    assert_eq!(batch.points[0].payload["source_generation"], 7);
    assert_eq!(batch.points[0].payload["chunk_id"], "chunk-web-1");
    assert_eq!(batch.points[0].payload["chunk_text"], "chunk-web-1 content");
    assert!(batch.points[0].payload["source_range"].is_object());
    assert_eq!(batch.payload_indexes.len(), 3);
}

#[test]
fn embedding_chunk_mismatch_fails_without_partial_batch() {
    let document = test_prepared_document();
    let embeddings = test_embedding_result_with_vectors(
        "text-embedding-test",
        3,
        vec![
            ("chunk-web-1", vec![1.0, 2.0, 3.0]),
            ("chunk-web-missing", vec![4.0, 5.0, 6.0]),
        ],
    );

    let err = VectorPointBatchBuilder::new(test_collection_spec(3), document, embeddings)
        .build()
        .unwrap_err();
    assert_eq!(
        err,
        VectorPointBatchBuildError::UnexpectedEmbeddingChunk {
            chunk_id: ChunkId::new("chunk-web-missing")
        }
    );
}

#[test]
fn duplicate_chunk_ids_fail() {
    let mut document = test_prepared_document();
    document.chunks[1].chunk_id = document.chunks[0].chunk_id.clone();
    let embeddings = test_embedding_result_for(&document, "text-embedding-test", 3);

    let err = VectorPointBatchBuilder::new(test_collection_spec(3), document, embeddings)
        .build()
        .unwrap_err();
    assert_eq!(
        err,
        VectorPointBatchBuildError::DuplicateChunkId {
            chunk_id: ChunkId::new("chunk-web-1")
        }
    );
}

#[test]
fn point_ids_are_stable_and_include_embedding_model() {
    let document = test_prepared_document();
    let embeddings = test_embedding_result_for(&document, "text-embedding-test", 3);
    let first = VectorPointBatchBuilder::new(test_collection_spec(3), document.clone(), embeddings)
        .build()
        .unwrap();

    let same_model = test_embedding_result_for(&document, "text-embedding-test", 3);
    let second =
        VectorPointBatchBuilder::new(test_collection_spec(3), document.clone(), same_model)
            .build()
            .unwrap();

    let other_model = test_embedding_result_for(&document, "other-embedding-model", 3);
    let changed = VectorPointBatchBuilder::new(test_collection_spec(3), document, other_model)
        .build()
        .unwrap();

    assert_eq!(first.points[0].point_id, second.points[0].point_id);
    assert_ne!(first.points[0].point_id, changed.points[0].point_id);
}

#[test]
fn point_ids_include_collection_namespace_document_chunk_model_and_generation() {
    let document = test_prepared_document();
    let embeddings = test_embedding_result_for(&document, "text-embedding-test", 3);
    let baseline = VectorPointBatchBuilder::new(
        test_collection_spec(3),
        document.clone(),
        embeddings.clone(),
    )
    .build()
    .unwrap()
    .points
    .remove(0)
    .point_id;

    let mut other_collection = test_collection_spec(3);
    other_collection.collection = "other-collection".to_string();
    assert_ne!(
        baseline,
        VectorPointBatchBuilder::new(other_collection, document.clone(), embeddings.clone())
            .build()
            .unwrap()
            .points[0]
            .point_id
    );

    let mut other_namespace = test_collection_spec(3);
    other_namespace.dense.name = "dense-code".to_string();
    assert_ne!(
        baseline,
        VectorPointBatchBuilder::new(other_namespace, document.clone(), embeddings.clone())
            .build()
            .unwrap()
            .points[0]
            .point_id
    );

    let mut other_document = document.clone();
    other_document.document_id = DocumentId::new("doc-other");
    assert_ne!(
        baseline,
        VectorPointBatchBuilder::new(test_collection_spec(3), other_document, embeddings.clone())
            .build()
            .unwrap()
            .points[0]
            .point_id
    );

    let mut other_chunk = document.clone();
    other_chunk.chunks[0].chunk_id = ChunkId::new("chunk-other");
    let other_chunk_embeddings = test_embedding_result_for(&other_chunk, "text-embedding-test", 3);
    assert_ne!(
        baseline,
        VectorPointBatchBuilder::new(test_collection_spec(3), other_chunk, other_chunk_embeddings)
            .build()
            .unwrap()
            .points[0]
            .point_id
    );

    let mut other_generation = document;
    other_generation.generation = SourceGenerationId::new("8");
    let other_generation_embeddings =
        test_embedding_result_for(&other_generation, "text-embedding-test", 3);
    assert_ne!(
        baseline,
        VectorPointBatchBuilder::new(
            test_collection_spec(3),
            other_generation,
            other_generation_embeddings
        )
        .build()
        .unwrap()
        .points[0]
            .point_id
    );
}

#[test]
fn dimensions_mismatch_fails() {
    let document = test_prepared_document();
    let embeddings = test_embedding_result_with_vectors(
        "text-embedding-test",
        3,
        vec![
            ("chunk-web-1", vec![1.0, 2.0]),
            ("chunk-web-2", vec![4.0, 5.0, 6.0]),
        ],
    );

    let err = VectorPointBatchBuilder::new(test_collection_spec(3), document, embeddings)
        .build()
        .unwrap_err();
    assert_eq!(
        err,
        VectorPointBatchBuildError::DimensionMismatch {
            chunk_id: Some(ChunkId::new("chunk-web-1")),
            expected: 3,
            actual: 2
        }
    );
}

#[test]
fn negative_source_generation_fails_before_payload_build() {
    let mut document = test_prepared_document();
    document.generation = SourceGenerationId::new("-1");
    let embeddings = test_embedding_result_for(&document, "text-embedding-test", 3);

    let err = VectorPointBatchBuilder::new(test_collection_spec(3), document, embeddings)
        .build()
        .unwrap_err();

    assert_eq!(
        err,
        VectorPointBatchBuildError::InvalidGeneration {
            generation: SourceGenerationId::new("-1")
        }
    );
}

#[test]
fn payload_validation_runs_before_returning_batch() {
    let mut document = test_prepared_document();
    document.chunks[0].metadata.insert(
        "raw_auth_headers".to_string(),
        json!("Authorization: Bearer secret"),
    );
    let embeddings = test_embedding_result_for(&document, "text-embedding-test", 3);

    let err = VectorPointBatchBuilder::new(test_collection_spec(3), document, embeddings)
        .build()
        .unwrap_err();
    assert!(matches!(
        err,
        VectorPointBatchBuildError::Payload {
            chunk_id,
            source: crate::payload::VectorPayloadValidationError::ForbiddenField { field }
        } if chunk_id == ChunkId::new("chunk-web-1") && field == "raw_auth_headers"
    ));
}
