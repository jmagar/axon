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
        let range = SourceRange {
            line_start: payload_u32(item, "line_start"),
            line_end: payload_u32(item, "line_end"),
            byte_start: payload_u64(item, "byte_start"),
            byte_end: payload_u64(item, "byte_end"),
            char_start: payload_u64(item, "char_start"),
            char_end: payload_u64(item, "char_end"),
            time_start_ms: payload_u64(item, "time_start_ms"),
            time_end_ms: payload_u64(item, "time_end_ms"),
            dom_selector: payload_string(item, "dom_selector"),
            json_pointer: payload_string(item, "json_pointer"),
            yaml_path: payload_string(item, "yaml_path"),
            xml_xpath: payload_string(item, "xml_xpath"),
            csv_row: payload_u32(item, "csv_row"),
            session_turn_id: payload_string(item, "session_turn_id"),
            turn_start: payload_string(item, "turn_start"),
            turn_end: payload_string(item, "turn_end"),
        };
        if !has_locator(&range) {
            return Err(ApiError::new(
                "retrieval.missing_source_range",
                ErrorStage::Retrieving,
                format!(
                    "vector match {} is missing source range locator fields",
                    item.point_id.0
                ),
            ));
        }

        Ok(Self {
            source_id,
            document_id,
            chunk_id,
            canonical_uri,
            range,
        })
    }
}

fn payload_u32(item: &VectorSearchMatch, key: &str) -> Option<u32> {
    item.payload.get(key)?.as_u64()?.try_into().ok()
}

fn payload_u64(item: &VectorSearchMatch, key: &str) -> Option<u64> {
    item.payload.get(key)?.as_u64()
}

fn payload_string(item: &VectorSearchMatch, key: &str) -> Option<String> {
    let value = item.payload.get(key)?.as_str()?.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn has_locator(range: &SourceRange) -> bool {
    range.line_start.is_some()
        || range.line_end.is_some()
        || range.byte_start.is_some()
        || range.byte_end.is_some()
        || range.char_start.is_some()
        || range.char_end.is_some()
        || range.time_start_ms.is_some()
        || range.time_end_ms.is_some()
        || range.dom_selector.is_some()
        || range.json_pointer.is_some()
        || range.yaml_path.is_some()
        || range.xml_xpath.is_some()
        || range.csv_row.is_some()
        || range.session_turn_id.is_some()
        || range.turn_start.is_some()
        || range.turn_end.is_some()
}
