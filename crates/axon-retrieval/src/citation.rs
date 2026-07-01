//! Citation helpers for the retrieval boundary fake.

use axon_api::source::{ChunkId, DocumentId, SourceId, SourceRange, VectorSearchMatch};
use axon_error::{ApiError, ErrorStage};
use serde_json::Value;

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
            .get("chunk_locator")
            .and_then(|value| value.as_object())
            .and_then(|value| value.get("canonical_uri"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                ApiError::new(
                    "retrieval.missing_canonical_uri",
                    ErrorStage::Retrieving,
                    format!("vector match {} is missing canonical_uri", item.point_id.0),
                )
            })?
            .to_string();
        let range = payload_range(item);
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

fn payload_range(item: &VectorSearchMatch) -> SourceRange {
    let source_range = item.payload.get("source_range");
    let chunk_locator_range = item
        .payload
        .get("chunk_locator")
        .and_then(|value| value.as_object())
        .and_then(|value| value.get("range"));

    SourceRange {
        line_start: nested_u32(source_range, "line_start")
            .or_else(|| nested_u32(chunk_locator_range, "line_start")),
        line_end: nested_u32(source_range, "line_end")
            .or_else(|| nested_u32(chunk_locator_range, "line_end")),
        byte_start: nested_u64(source_range, "byte_start")
            .or_else(|| nested_u64(chunk_locator_range, "byte_start")),
        byte_end: nested_u64(source_range, "byte_end")
            .or_else(|| nested_u64(chunk_locator_range, "byte_end")),
        char_start: nested_u64(source_range, "char_start")
            .or_else(|| nested_u64(chunk_locator_range, "char_start")),
        char_end: nested_u64(source_range, "char_end")
            .or_else(|| nested_u64(chunk_locator_range, "char_end")),
        time_start_ms: nested_u64(source_range, "time_start_ms")
            .or_else(|| nested_u64(chunk_locator_range, "time_start_ms")),
        time_end_ms: nested_u64(source_range, "time_end_ms")
            .or_else(|| nested_u64(chunk_locator_range, "time_end_ms")),
        dom_selector: nested_string(source_range, "dom_selector")
            .or_else(|| nested_string(chunk_locator_range, "dom_selector")),
        json_pointer: nested_string(source_range, "json_pointer")
            .or_else(|| nested_string(chunk_locator_range, "json_pointer")),
        yaml_path: nested_string(source_range, "yaml_path")
            .or_else(|| nested_string(chunk_locator_range, "yaml_path")),
        xml_xpath: nested_string(source_range, "xml_xpath")
            .or_else(|| nested_string(chunk_locator_range, "xml_xpath")),
        csv_row: nested_u32(source_range, "csv_row")
            .or_else(|| nested_u32(chunk_locator_range, "csv_row")),
        session_turn_id: nested_string(source_range, "session_turn_id")
            .or_else(|| nested_string(chunk_locator_range, "session_turn_id")),
        turn_start: nested_string(source_range, "turn_start")
            .or_else(|| nested_string(chunk_locator_range, "turn_start")),
        turn_end: nested_string(source_range, "turn_end")
            .or_else(|| nested_string(chunk_locator_range, "turn_end")),
    }
}

fn nested_u32(value: Option<&Value>, key: &str) -> Option<u32> {
    value?.as_object()?.get(key)?.as_u64()?.try_into().ok()
}

fn nested_u64(value: Option<&Value>, key: &str) -> Option<u64> {
    value?.as_object()?.get(key)?.as_u64()
}

fn nested_string(value: Option<&Value>, key: &str) -> Option<String> {
    let value = value?.as_object()?.get(key)?.as_str()?.trim();
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
