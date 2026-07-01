use axon_api::source::MetadataMap;
use serde_json::Value;

use crate::payload::{
    SourceSpecificFieldRegistry, VECTOR_VISIBILITY_VALUES, VectorPayload, VectorPayloadBuilder,
    VectorPayloadValidationError, source_specific_field_registry,
};

fn fixture(name: &str) -> MetadataMap {
    let path = format!("tests/fixtures/payload/{name}");
    let bytes = std::fs::read(&path).unwrap_or_else(|err| panic!("read {path}: {err}"));
    let value: Value =
        serde_json::from_slice(&bytes).unwrap_or_else(|err| panic!("parse {path}: {err}"));
    let object = value
        .as_object()
        .unwrap_or_else(|| panic!("{path} must be a JSON object"));
    MetadataMap(
        object
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    )
}

fn required_fields() -> [&'static str; 18] {
    [
        "payload_contract_version",
        "collection",
        "source_id",
        "source_generation",
        "document_id",
        "chunk_id",
        "chunk_locator",
        "source_range",
        "visibility",
        "redaction_status",
        "job_id",
        "document_status",
        "embedding_model",
        "embedding_dimensions",
        "embedding_provider",
        "embedding_profile",
        "embedded_at",
        "committed_generation",
    ]
}

#[test]
fn valid_payload_fixtures_pass_required_field_and_registry_validation() {
    for name in [
        "code.valid.json",
        "web.valid.json",
        "session.valid.json",
        "memory.valid.json",
        "package.valid.json",
    ] {
        let payload = VectorPayload::try_from_metadata(fixture(name))
            .unwrap_or_else(|err| panic!("{name} should validate: {err:?}"));
        for field in required_fields() {
            assert!(
                payload.metadata().contains_key(field),
                "{name} missing {field}"
            );
        }
        assert!(payload.metadata()["source_generation"].is_i64());
        assert!(payload.metadata()["committed_generation"].is_i64());
    }
}

#[test]
fn initial_source_specific_registry_allows_only_declared_family_fields() {
    let registry = source_specific_field_registry();

    assert!(registry.allows("code", "code_language"));
    assert!(registry.allows("code", "code_symbol_name"));
    assert!(registry.allows("code", "code_symbol_kind"));
    assert!(registry.allows("code", "code_file_type"));
    assert!(registry.allows("web", "web_title"));
    assert!(registry.allows("web", "web_domain"));
    assert!(registry.allows("web", "web_status_code"));
    assert!(registry.allows("web", "web_depth"));
    assert!(registry.allows("package", "package_ecosystem"));
    assert!(registry.allows("package", "package_name"));
    assert!(registry.allows("package", "package_version"));
    assert!(registry.allows("session", "session_id"));
    assert!(registry.allows("session", "session_turn_index"));
    assert!(registry.allows("session", "session_tool_name"));
    assert!(registry.allows("session", "session_skill_name"));
    assert!(registry.allows("graph", "graph_node_ids"));
    assert!(registry.allows("graph", "graph_edge_ids"));
    assert!(registry.allows("graph", "graph_confidence"));
    assert!(registry.allows("memory", "memory_id"));
    assert!(registry.allows("memory", "memory_importance"));
    assert!(registry.allows("memory", "memory_status"));

    assert!(!registry.allows("web", "web_canonical_url"));
    assert!(!registry.allows("code", "web_title"));
}

#[test]
fn invalid_payload_fixtures_report_the_expected_validation_error() {
    let cases = [
        (
            "secret.invalid.json",
            VectorPayloadValidationError::ForbiddenField {
                field: "raw_auth_headers".to_string(),
            },
        ),
        (
            "missing_source_generation.invalid.json",
            VectorPayloadValidationError::MissingRequiredField {
                field: "source_generation".to_string(),
            },
        ),
        (
            "unknown_source_field.invalid.json",
            VectorPayloadValidationError::UnknownSourceSpecificField {
                source_family: "web".to_string(),
                field: "web_canonical_url".to_string(),
            },
        ),
        (
            "bad_visibility.invalid.json",
            VectorPayloadValidationError::InvalidVisibility {
                value: "world".to_string(),
            },
        ),
        (
            "forbidden_auth_header_value.invalid.json",
            VectorPayloadValidationError::ForbiddenValue {
                field: "web_title".to_string(),
            },
        ),
        (
            "forbidden_cookie_value.invalid.json",
            VectorPayloadValidationError::ForbiddenValue {
                field: "source_range.headers[0]".to_string(),
            },
        ),
        (
            "forbidden_dotenv_value.invalid.json",
            VectorPayloadValidationError::ForbiddenValue {
                field: "source_range.env[0]".to_string(),
            },
        ),
        (
            "forbidden_home_credential_path_value.invalid.json",
            VectorPayloadValidationError::ForbiddenValue {
                field: "chunk_locator.canonical_uri".to_string(),
            },
        ),
        (
            "forbidden_raw_html_value.invalid.json",
            VectorPayloadValidationError::ForbiddenValue {
                field: "web_title".to_string(),
            },
        ),
        (
            "forbidden_adapter_response_value.invalid.json",
            VectorPayloadValidationError::ForbiddenValue {
                field: "source_range.adapter_response".to_string(),
            },
        ),
        (
            "forbidden_bare_api_key_value.invalid.json",
            VectorPayloadValidationError::ForbiddenValue {
                field: "web_title".to_string(),
            },
        ),
        (
            "forbidden_embedded_bare_api_key_value.invalid.json",
            VectorPayloadValidationError::ForbiddenValue {
                field: "web_title".to_string(),
            },
        ),
        (
            "forbidden_absolute_home_path_value.invalid.json",
            VectorPayloadValidationError::ForbiddenValue {
                field: "chunk_locator.canonical_uri".to_string(),
            },
        ),
    ];

    for (name, expected) in cases {
        let err = VectorPayload::try_from_metadata(fixture(name))
            .unwrap_err_or_else(|payload| panic!("{name} unexpectedly validated: {payload:?}"));
        assert_eq!(err, expected, "{name}");
    }
}

trait UnwrapErrOrElse<T, E> {
    fn unwrap_err_or_else<F: FnOnce(T) -> E>(self, op: F) -> E;
}

impl<T, E> UnwrapErrOrElse<T, E> for Result<T, E> {
    fn unwrap_err_or_else<F: FnOnce(T) -> E>(self, op: F) -> E {
        match self {
            Ok(value) => op(value),
            Err(err) => err,
        }
    }
}

#[test]
fn custom_registry_entries_can_admit_new_source_specific_fields() {
    let registry =
        SourceSpecificFieldRegistry::new([("web", &["web_title", "web_canonical_url"][..])]);
    let payload = VectorPayload::try_from_metadata_with_registry(
        fixture("unknown_source_field.invalid.json"),
        &registry,
    );

    assert!(payload.is_ok());
}

#[test]
fn payload_builder_runs_the_same_validation_as_direct_payload_construction() {
    let payload = VectorPayloadBuilder::new(fixture("code.valid.json"))
        .build()
        .unwrap();
    assert_eq!(payload.metadata()["source_family"], "code");

    let err = VectorPayloadBuilder::new(fixture("bad_visibility.invalid.json"))
        .build()
        .unwrap_err_or_else(|payload| panic!("bad visibility unexpectedly built: {payload:?}"));
    assert_eq!(
        err,
        VectorPayloadValidationError::InvalidVisibility {
            value: "world".to_string()
        }
    );
}

#[test]
fn visibility_values_match_the_canonical_vector_payload_enum() {
    for visibility in VECTOR_VISIBILITY_VALUES {
        let mut metadata = fixture("web.valid.json");
        metadata.insert("visibility".to_string(), serde_json::json!(visibility));

        VectorPayload::try_from_metadata(metadata)
            .unwrap_or_else(|err| panic!("{visibility} should validate: {err:?}"));
    }

    let mut private = fixture("web.valid.json");
    private.insert("visibility".to_string(), serde_json::json!("private"));
    let err = VectorPayload::try_from_metadata(private)
        .unwrap_err_or_else(|payload| panic!("private visibility validated: {payload:?}"));
    assert_eq!(
        err,
        VectorPayloadValidationError::InvalidVisibility {
            value: "private".to_string()
        }
    );
}

#[test]
fn typed_payload_fields_reject_legacy_string_shapes() {
    let mut metadata = fixture("web.valid.json");
    metadata.insert(
        "chunk_locator".to_string(),
        serde_json::json!("https://example.com/docs#intro"),
    );

    let err = VectorPayload::try_from_metadata(metadata)
        .unwrap_err_or_else(|payload| panic!("string chunk locator validated: {payload:?}"));

    assert_eq!(
        err,
        VectorPayloadValidationError::InvalidFieldShape {
            field: "chunk_locator".to_string()
        }
    );
}

#[test]
fn typed_chunk_locator_values_reject_local_paths() {
    let mut metadata = fixture("web.valid.json");
    metadata.insert(
        "chunk_locator".to_string(),
        serde_json::json!({
            "canonical_uri": "/tmp/axon/secret.rs",
            "path": "/tmp/axon/secret.rs",
            "heading_path": [],
            "symbol": null,
            "range": { "line_start": 1, "line_end": 2 }
        }),
    );

    let err = VectorPayload::try_from_metadata(metadata)
        .unwrap_err_or_else(|payload| panic!("local path locator validated: {payload:?}"));

    assert_eq!(
        err,
        VectorPayloadValidationError::ForbiddenValue {
            field: "chunk_locator.canonical_uri".to_string()
        }
    );
}
