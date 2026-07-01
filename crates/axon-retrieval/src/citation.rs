//! Citation helpers for the retrieval boundary fake.

use axon_api::source::{ChunkId, DocumentId, SourceId, SourceRange, VectorSearchMatch};
use axon_error::{ApiError, ErrorStage};

pub const MODULE_NAME: &str = "citation";

#[derive(Debug, Clone, PartialEq)]
pub struct Citation {
    pub source_id: SourceId,
    pub document_id: DocumentId,
    pub chunk_id: ChunkId,
    pub canonical_uri: String,
    pub range: SourceRange,
}

impl Citation {
    pub fn new(
        source_id: SourceId,
        document_id: DocumentId,
        chunk_id: ChunkId,
        canonical_uri: String,
        range: SourceRange,
    ) -> Self {
        Self {
            source_id,
            document_id,
            chunk_id,
            canonical_uri,
            range,
        }
    }

    pub fn from_vector_match(item: &VectorSearchMatch) -> Result<Self, ApiError> {
        let chunk_id = item.chunk_id.clone().ok_or_else(|| {
            ApiError::new(
                "retrieval.missing_chunk_id",
                ErrorStage::Retrieving,
                "vector match is missing chunk_id",
            )
        })?;
        let document_id = item.document_id.clone().ok_or_else(|| {
            ApiError::new(
                "retrieval.missing_document_id",
                ErrorStage::Retrieving,
                format!("vector match {} is missing document_id", item.point_id.0),
            )
        })?;
        let source_id = item.source_id.clone().ok_or_else(|| {
            ApiError::new(
                "retrieval.missing_source_id",
                ErrorStage::Retrieving,
                format!("vector match {} is missing source_id", item.point_id.0),
            )
        })?;
        let canonical_uri = item
            .payload
            .get("canonical_uri")
            .and_then(|value| value.as_str())
            .ok_or_else(|| {
                ApiError::new(
                    "retrieval.missing_canonical_uri",
                    ErrorStage::Retrieving,
                    format!("vector match {} is missing canonical_uri", item.point_id.0),
                )
            })?
            .to_string();

        Ok(Self {
            source_id,
            document_id,
            chunk_id,
            canonical_uri,
            range: SourceRange {
                line_start: payload_u32(item, "line_start"),
                line_end: payload_u32(item, "line_end"),
                byte_start: payload_u64(item, "byte_start"),
                byte_end: payload_u64(item, "byte_end"),
                char_start: payload_u64(item, "char_start"),
                char_end: payload_u64(item, "char_end"),
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
        })
    }
}

fn payload_u32(item: &VectorSearchMatch, key: &str) -> Option<u32> {
    item.payload.get(key)?.as_u64()?.try_into().ok()
}

fn payload_u64(item: &VectorSearchMatch, key: &str) -> Option<u64> {
    item.payload.get(key)?.as_u64()
}
