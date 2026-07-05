use axon_api::source::PayloadFieldSchema;

use crate::collection::required_retrieval_payload_indexes;

#[test]
fn required_retrieval_payload_indexes_include_generation_safe_filters() {
    let indexes = required_retrieval_payload_indexes();
    let required = [
        "source_id",
        "source_generation",
        "committed_generation",
        "visibility",
        "redaction_status",
    ];

    for field_name in required {
        let index = indexes
            .iter()
            .find(|index| index.field_name == field_name)
            .unwrap_or_else(|| panic!("missing required payload index {field_name}"));
        let expected_schema = match field_name {
            "source_generation" | "committed_generation" => PayloadFieldSchema::Integer,
            _ => PayloadFieldSchema::Keyword,
        };
        assert_eq!(index.field_schema, expected_schema);
        assert!(
            index.required_for_filters,
            "{field_name} must be marked required for filters"
        );
    }
}
