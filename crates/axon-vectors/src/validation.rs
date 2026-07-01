//! Shared write validation for vector store implementations.

use std::collections::BTreeMap;

use axon_api::source::*;

use crate::payload::VectorPayload;
use crate::sparse::{batch_sparse_vectors_by_chunk, validate_sparse_vector};
use crate::store::Result;

pub(crate) fn validate_upsert_batch(
    spec: &CollectionSpec,
    batch: &VectorPointBatch,
    stage: axon_error::ErrorStage,
) -> Result<BTreeMap<String, SparseVector>> {
    if batch.dimensions != spec.dense.dimensions {
        return Err(ApiError::new(
            "vector.dimension_mismatch",
            stage,
            format!(
                "batch dimensions {} do not match collection dimensions {}",
                batch.dimensions, spec.dense.dimensions
            ),
        ));
    }
    let has_sparse = batch.sparse_vectors.is_some()
        || batch
            .points
            .iter()
            .any(|point| point.sparse_vector.is_some());
    if has_sparse && spec.sparse.is_none() {
        return Err(ApiError::new(
            "vector.sparse_not_configured",
            stage,
            format!(
                "collection {} does not declare a sparse vector namespace",
                batch.collection
            ),
        ));
    }
    let batch_sparse = batch_sparse_vectors_by_chunk(batch, stage)?;
    for point in &batch.points {
        let sparse_vector = point
            .sparse_vector
            .as_ref()
            .or_else(|| batch_sparse.get(&point.chunk_id.0));
        if let Some(sparse) = sparse_vector {
            validate_sparse_vector(&point.chunk_id, sparse, stage)?;
        }
        if point.vector.len() as u32 != spec.dense.dimensions {
            return Err(ApiError::new(
                "vector.dimension_mismatch",
                stage,
                format!(
                    "point {} dimensions {} do not match collection dimensions {}",
                    point.point_id.0,
                    point.vector.len(),
                    spec.dense.dimensions
                ),
            ));
        }
        if point.vector.iter().any(|value| !value.is_finite()) {
            return Err(ApiError::new(
                "vector.invalid_dense_vector",
                stage,
                format!(
                    "point {} dense vector contains non-finite values",
                    point.point_id.0
                ),
            ));
        }
        VectorPayload::try_from_metadata(point.payload.clone())
            .map_err(|err| ApiError::new("vector.invalid_payload", stage, err.to_string()))?;
    }
    Ok(batch_sparse)
}
