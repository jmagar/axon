//! Vector point batch construction.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use axon_api::source::*;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::payload::{VectorPayloadBuilder, VectorPayloadValidationError};

pub const MODULE_NAME: &str = "point";

#[derive(Debug, Clone)]
pub struct VectorPointBatchBuilder {
    collection: CollectionSpec,
    document: PreparedDocument,
    embeddings: EmbeddingResult,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VectorPointBatchBuildError {
    DuplicateChunkId {
        chunk_id: ChunkId,
    },
    UnexpectedEmbeddingChunk {
        chunk_id: ChunkId,
    },
    MissingEmbeddingChunk {
        chunk_id: ChunkId,
    },
    DimensionMismatch {
        chunk_id: Option<ChunkId>,
        expected: u32,
        actual: u32,
    },
    InvalidGeneration {
        generation: SourceGenerationId,
    },
    Payload {
        chunk_id: ChunkId,
        source: VectorPayloadValidationError,
    },
}

impl fmt::Display for VectorPointBatchBuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DuplicateChunkId { chunk_id } => {
                write!(f, "duplicate vector chunk id `{}`", chunk_id.0)
            }
            Self::UnexpectedEmbeddingChunk { chunk_id } => {
                write!(f, "embedding returned unexpected chunk id `{}`", chunk_id.0)
            }
            Self::MissingEmbeddingChunk { chunk_id } => {
                write!(f, "missing embedding for chunk id `{}`", chunk_id.0)
            }
            Self::DimensionMismatch {
                chunk_id,
                expected,
                actual,
            } => {
                if let Some(chunk_id) = chunk_id {
                    write!(
                        f,
                        "chunk `{}` has {actual} embedding dimensions, expected {expected}",
                        chunk_id.0
                    )
                } else {
                    write!(
                        f,
                        "embedding result declares {actual} dimensions, expected {expected}"
                    )
                }
            }
            Self::InvalidGeneration { generation } => {
                write!(f, "source generation `{}` is not numeric", generation.0)
            }
            Self::Payload { chunk_id, source } => {
                write!(
                    f,
                    "invalid vector payload for chunk `{}`: {source}",
                    chunk_id.0
                )
            }
        }
    }
}

impl std::error::Error for VectorPointBatchBuildError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Payload { source, .. } => Some(source),
            _ => None,
        }
    }
}

impl VectorPointBatchBuilder {
    pub fn new(
        collection: CollectionSpec,
        document: PreparedDocument,
        embeddings: EmbeddingResult,
    ) -> Self {
        Self {
            collection,
            document,
            embeddings,
        }
    }

    pub fn build(self) -> Result<VectorPointBatch, VectorPointBatchBuildError> {
        let expected_dimensions = self.collection.dense.dimensions;
        if self.embeddings.dimensions != expected_dimensions {
            return Err(VectorPointBatchBuildError::DimensionMismatch {
                chunk_id: None,
                expected: expected_dimensions,
                actual: self.embeddings.dimensions,
            });
        }

        let chunks = chunks_by_id(&self.document)?;
        let vectors = vectors_by_chunk_id(&self.embeddings, &chunks, expected_dimensions)?;
        let source_generation = parse_generation(&self.document.generation)?;
        let mut points = Vec::with_capacity(self.document.chunks.len());

        for chunk in &self.document.chunks {
            let vector = vectors.get(&chunk.chunk_id).ok_or_else(|| {
                VectorPointBatchBuildError::MissingEmbeddingChunk {
                    chunk_id: chunk.chunk_id.clone(),
                }
            })?;
            let payload = build_payload(
                &self.collection,
                &self.document,
                chunk,
                &self.embeddings,
                source_generation,
            )?;
            points.push(VectorPoint {
                point_id: stable_point_id(
                    &self.collection.collection,
                    &self.collection.dense.name,
                    &self.document.document_id,
                    &chunk.chunk_id,
                    &self.embeddings.model,
                    &self.document.generation,
                ),
                chunk_id: chunk.chunk_id.clone(),
                vector: vector.values.clone(),
                sparse_vector: None,
                payload,
            });
        }

        Ok(VectorPointBatch {
            batch_id: self.embeddings.batch_id,
            collection: self.collection.collection,
            points,
            model: self.embeddings.model,
            dimensions: expected_dimensions,
            sparse_vectors: None,
            payload_indexes: self.collection.payload_indexes,
        })
    }
}

fn chunks_by_id(
    document: &PreparedDocument,
) -> Result<BTreeSet<ChunkId>, VectorPointBatchBuildError> {
    let mut ids = BTreeSet::new();
    for chunk in &document.chunks {
        if !ids.insert(chunk.chunk_id.clone()) {
            return Err(VectorPointBatchBuildError::DuplicateChunkId {
                chunk_id: chunk.chunk_id.clone(),
            });
        }
    }
    Ok(ids)
}

fn vectors_by_chunk_id(
    embeddings: &EmbeddingResult,
    chunks: &BTreeSet<ChunkId>,
    expected_dimensions: u32,
) -> Result<BTreeMap<ChunkId, EmbeddingVector>, VectorPointBatchBuildError> {
    let mut vectors = BTreeMap::new();
    for vector in &embeddings.vectors {
        if vector.values.len() as u32 != expected_dimensions {
            return Err(VectorPointBatchBuildError::DimensionMismatch {
                chunk_id: Some(vector.chunk_id.clone()),
                expected: expected_dimensions,
                actual: vector.values.len() as u32,
            });
        }
        if !chunks.contains(&vector.chunk_id) {
            return Err(VectorPointBatchBuildError::UnexpectedEmbeddingChunk {
                chunk_id: vector.chunk_id.clone(),
            });
        }
        if vectors
            .insert(vector.chunk_id.clone(), vector.clone())
            .is_some()
        {
            return Err(VectorPointBatchBuildError::DuplicateChunkId {
                chunk_id: vector.chunk_id.clone(),
            });
        }
    }
    Ok(vectors)
}

fn build_payload(
    collection: &CollectionSpec,
    document: &PreparedDocument,
    chunk: &PreparedChunk,
    embeddings: &EmbeddingResult,
    source_generation: i64,
) -> Result<MetadataMap, VectorPointBatchBuildError> {
    let mut metadata = document.metadata.clone();
    metadata.0.extend(chunk.metadata.0.clone());
    metadata.insert("payload_contract_version".to_string(), json!(1));
    metadata.insert("collection".to_string(), json!(collection.collection));
    metadata.insert("source_id".to_string(), json!(document.source_id.0));
    metadata.insert("source_generation".to_string(), json!(source_generation));
    metadata.insert("committed_generation".to_string(), json!(source_generation));
    metadata.insert("document_id".to_string(), json!(document.document_id.0));
    metadata.insert("chunk_id".to_string(), json!(chunk.chunk_id.0));
    metadata.insert(
        "chunk_locator".to_string(),
        chunk_locator_json(&chunk.chunk_locator),
    );
    metadata.insert(
        "source_range".to_string(),
        source_range_json(&chunk.source_range),
    );
    metadata.insert("visibility".to_string(), json!("internal"));
    metadata.insert("redaction_status".to_string(), json!("clean"));
    metadata.insert(
        "job_id".to_string(),
        json!(embeddings.batch_id.0.to_string()),
    );
    metadata.insert("document_status".to_string(), json!("prepared"));
    metadata.insert("embedding_model".to_string(), json!(embeddings.model));
    metadata.insert(
        "embedding_dimensions".to_string(),
        json!(collection.dense.dimensions),
    );
    metadata.insert("embedding_provider".to_string(), json!("unspecified"));
    metadata.insert(
        "embedding_profile".to_string(),
        json!(document.chunking_profile),
    );
    metadata.insert("embedded_at".to_string(), json!("1970-01-01T00:00:00Z"));

    VectorPayloadBuilder::new(metadata)
        .build()
        .map(|payload| payload.into_metadata())
        .map_err(|source| VectorPointBatchBuildError::Payload {
            chunk_id: chunk.chunk_id.clone(),
            source,
        })
}

fn parse_generation(generation: &SourceGenerationId) -> Result<i64, VectorPointBatchBuildError> {
    generation
        .0
        .parse()
        .map_err(|_| VectorPointBatchBuildError::InvalidGeneration {
            generation: generation.clone(),
        })
}

fn stable_point_id(
    collection: &str,
    vector_namespace: &str,
    document_id: &DocumentId,
    chunk_id: &ChunkId,
    embedding_model: &str,
    source_generation: &SourceGenerationId,
) -> VectorPointId {
    let key = format!(
        "{collection}\0{vector_namespace}\0{}\0{}\0{embedding_model}\0{}",
        document_id.0, chunk_id.0, source_generation.0
    );
    VectorPointId::new(Uuid::new_v5(&Uuid::NAMESPACE_URL, key.as_bytes()).to_string())
}

fn chunk_locator_json(locator: &ChunkLocator) -> Value {
    json!({
        "canonical_uri": locator.canonical_uri,
        "path": locator.path,
        "heading_path": locator.heading_path,
        "symbol": locator.symbol,
        "range": source_range_json(&locator.range),
    })
}

fn source_range_json(range: &SourceRange) -> Value {
    json!({
        "line_start": range.line_start,
        "line_end": range.line_end,
        "byte_start": range.byte_start,
        "byte_end": range.byte_end,
        "char_start": range.char_start,
        "char_end": range.char_end,
        "time_start_ms": range.time_start_ms,
        "time_end_ms": range.time_end_ms,
        "dom_selector": range.dom_selector,
        "json_pointer": range.json_pointer,
        "yaml_path": range.yaml_path,
        "xml_xpath": range.xml_xpath,
        "csv_row": range.csv_row,
        "session_turn_id": range.session_turn_id,
        "turn_start": range.turn_start,
        "turn_end": range.turn_end,
    })
}
