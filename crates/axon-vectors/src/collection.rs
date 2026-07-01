//! Collection-spec helpers for vector stores.

use axon_api::source::*;

pub fn normalize_collection_spec(mut spec: CollectionSpec) -> CollectionSpec {
    spec.payload_indexes
        .sort_by(|left, right| left.field_name.cmp(&right.field_name));
    spec.aliases.sort();
    spec.aliases.dedup();
    spec
}

pub fn check_collection_drift(existing: &CollectionSpec, incoming: &CollectionSpec) -> Result<()> {
    if existing.dense != incoming.dense || existing.sparse != incoming.sparse {
        return Err(collection_drift(format!(
            "collection {} already exists with a different vector configuration",
            existing.collection
        )));
    }
    for required in incoming
        .payload_indexes
        .iter()
        .filter(|index| index.required_for_filters)
    {
        let Some(existing_index) = existing
            .payload_indexes
            .iter()
            .find(|index| index.field_name == required.field_name)
        else {
            return Err(collection_drift(format!(
                "collection {} is missing required payload index {}",
                existing.collection, required.field_name
            )));
        };
        if existing_index.field_schema != required.field_schema {
            return Err(collection_drift(format!(
                "collection {} payload index {} has a different field schema",
                existing.collection, required.field_name
            )));
        }
    }
    Ok(())
}

fn collection_drift(message: String) -> ApiError {
    ApiError::new(
        "vector.collection_drift",
        axon_error::ErrorStage::Upserting,
        message,
    )
}

type Result<T> = std::result::Result<T, ApiError>;
