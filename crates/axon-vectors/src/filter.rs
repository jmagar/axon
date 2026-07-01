//! Payload filter helpers for vector stores.

use axon_api::source::*;
use serde_json::Value;

pub const SOURCE_ID: &str = "source_id";
pub const SOURCE_GENERATION: &str = "source_generation";
pub const DOCUMENT_ID: &str = "document_id";
pub const CHUNK_ID: &str = "chunk_id";
pub const VECTOR_NAMESPACE: &str = "vector_namespace";
pub const VISIBILITY: &str = "visibility";
pub const CONTENT_KIND: &str = "content_kind";

pub fn matches_search_filters(point: &VectorPoint, request: &VectorSearchRequest) -> bool {
    if let Some(generation) = &request.generation
        && !payload_matches_str(&point.payload, SOURCE_GENERATION, &generation.0)
    {
        return false;
    }
    request
        .filters
        .iter()
        .all(|(field, expected)| payload_matches_value(&point.payload, field, expected))
}

pub fn matches_delete_selector(point: &VectorPoint, selector: &VectorDeleteSelector) -> bool {
    match selector {
        VectorDeleteSelector::Source {
            source_id,
            generation,
            ..
        } => {
            payload_matches_str(&point.payload, SOURCE_ID, &source_id.0)
                && generation.as_ref().is_none_or(|generation| {
                    payload_matches_str(&point.payload, SOURCE_GENERATION, &generation.0)
                })
        }
        VectorDeleteSelector::Generation {
            source_id,
            generation,
            ..
        } => {
            payload_matches_str(&point.payload, SOURCE_ID, &source_id.0)
                && payload_matches_str(&point.payload, SOURCE_GENERATION, &generation.0)
        }
        VectorDeleteSelector::Document {
            document_id,
            generation,
            ..
        } => {
            payload_matches_str(&point.payload, DOCUMENT_ID, &document_id.0)
                && generation.as_ref().is_none_or(|generation| {
                    payload_matches_str(&point.payload, SOURCE_GENERATION, &generation.0)
                })
        }
        VectorDeleteSelector::Chunks { chunk_ids, .. } => chunk_ids.contains(&point.chunk_id),
        VectorDeleteSelector::Points { point_ids, .. } => point_ids.contains(&point.point_id),
        VectorDeleteSelector::Url { url, prefix, .. } => point
            .payload
            .get("url")
            .and_then(Value::as_str)
            .is_some_and(|stored| {
                if *prefix {
                    stored.starts_with(url)
                } else {
                    stored == url
                }
            }),
        VectorDeleteSelector::Filter { filter, .. } => matches_json_filter(&point.payload, filter),
    }
}

pub fn selector_collection(selector: &VectorDeleteSelector) -> &str {
    match selector {
        VectorDeleteSelector::Source { collection, .. }
        | VectorDeleteSelector::Generation { collection, .. }
        | VectorDeleteSelector::Document { collection, .. }
        | VectorDeleteSelector::Chunks { collection, .. }
        | VectorDeleteSelector::Points { collection, .. }
        | VectorDeleteSelector::Url { collection, .. }
        | VectorDeleteSelector::Filter { collection, .. } => collection,
    }
}

fn matches_json_filter(payload: &MetadataMap, filter: &Value) -> bool {
    let Some(object) = filter.as_object() else {
        return false;
    };
    object
        .iter()
        .all(|(field, expected)| payload_matches_value(payload, field, expected))
}

fn payload_matches_str(payload: &MetadataMap, field: &str, expected: &str) -> bool {
    payload
        .get(field)
        .is_some_and(|actual| value_matches_str(actual, expected))
}

fn payload_matches_value(payload: &MetadataMap, field: &str, expected: &Value) -> bool {
    if let Some(expected_values) = expected.as_array() {
        return expected_values
            .iter()
            .any(|expected| payload_matches_value(payload, field, expected));
    }
    payload
        .get(field)
        .is_some_and(|actual| actual == expected || value_matches_string_value(actual, expected))
}

fn value_matches_string_value(actual: &Value, expected: &Value) -> bool {
    expected
        .as_str()
        .is_some_and(|expected| value_matches_str(actual, expected))
}

fn value_matches_str(actual: &Value, expected: &str) -> bool {
    actual.as_str() == Some(expected)
        || actual
            .as_i64()
            .is_some_and(|value| value.to_string() == expected)
        || actual
            .as_u64()
            .is_some_and(|value| value.to_string() == expected)
}
