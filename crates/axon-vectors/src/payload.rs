//! Validated vector payload metadata.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use axon_api::source::MetadataMap;
use serde_json::Value;

pub const MODULE_NAME: &str = "payload";

#[derive(Debug, Clone, PartialEq)]
pub struct VectorPayload {
    metadata: MetadataMap,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VectorPayloadBuilder {
    metadata: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VectorPayloadValidationError {
    MissingRequiredField {
        field: String,
    },
    ForbiddenField {
        field: String,
    },
    ForbiddenValue {
        field: String,
    },
    UnknownSourceSpecificField {
        source_family: String,
        field: String,
    },
    InvalidGeneration {
        field: String,
    },
    InvalidVisibility {
        value: String,
    },
}

impl fmt::Display for VectorPayloadValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingRequiredField { field } => {
                write!(f, "missing required vector payload field `{field}`")
            }
            Self::ForbiddenField { field } => {
                write!(f, "forbidden vector payload field `{field}`")
            }
            Self::ForbiddenValue { field } => {
                write!(f, "forbidden vector payload value under `{field}`")
            }
            Self::UnknownSourceSpecificField {
                source_family,
                field,
            } => write!(
                f,
                "unknown vector payload field `{field}` for source family `{source_family}`"
            ),
            Self::InvalidGeneration { field } => {
                write!(f, "vector payload field `{field}` must be an integer")
            }
            Self::InvalidVisibility { value } => {
                write!(f, "invalid vector payload visibility `{value}`")
            }
        }
    }
}

impl std::error::Error for VectorPayloadValidationError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceSpecificFieldRegistry {
    fields: BTreeMap<&'static str, BTreeSet<&'static str>>,
}

impl SourceSpecificFieldRegistry {
    pub fn new<I>(entries: I) -> Self
    where
        I: IntoIterator<Item = (&'static str, &'static [&'static str])>,
    {
        Self {
            fields: entries
                .into_iter()
                .map(|(family, fields)| (family, fields.iter().copied().collect()))
                .collect(),
        }
    }

    pub fn allows(&self, source_family: &str, field: &str) -> bool {
        self.fields
            .get(source_family)
            .is_some_and(|fields| fields.contains(field))
    }
}

pub fn source_specific_field_registry() -> SourceSpecificFieldRegistry {
    SourceSpecificFieldRegistry::new([
        (
            "code",
            &[
                "code_language",
                "code_symbol_name",
                "code_symbol_kind",
                "code_file_type",
            ][..],
        ),
        (
            "web",
            &["web_title", "web_domain", "web_status_code", "web_depth"][..],
        ),
        (
            "package",
            &["package_ecosystem", "package_name", "package_version"][..],
        ),
        (
            "session",
            &[
                "session_id",
                "session_turn_index",
                "session_tool_name",
                "session_skill_name",
            ][..],
        ),
        (
            "graph",
            &["graph_node_ids", "graph_edge_ids", "graph_confidence"][..],
        ),
        (
            "memory",
            &["memory_id", "memory_importance", "memory_status"][..],
        ),
    ])
}

impl VectorPayload {
    pub fn try_from_metadata(metadata: MetadataMap) -> Result<Self, VectorPayloadValidationError> {
        Self::try_from_metadata_with_registry(metadata, &source_specific_field_registry())
    }

    pub fn try_from_metadata_with_registry(
        metadata: MetadataMap,
        registry: &SourceSpecificFieldRegistry,
    ) -> Result<Self, VectorPayloadValidationError> {
        validate_required_fields(&metadata)?;
        validate_forbidden_fields(&metadata)?;
        validate_generations(&metadata)?;
        validate_visibility(&metadata)?;
        validate_known_fields(&metadata, registry)?;
        Ok(Self { metadata })
    }

    pub fn metadata(&self) -> &MetadataMap {
        &self.metadata
    }

    pub fn into_metadata(self) -> MetadataMap {
        self.metadata
    }
}

impl VectorPayloadBuilder {
    pub fn new(metadata: MetadataMap) -> Self {
        Self { metadata }
    }

    pub fn build(self) -> Result<VectorPayload, VectorPayloadValidationError> {
        VectorPayload::try_from_metadata(self.metadata)
    }

    pub fn build_with_registry(
        self,
        registry: &SourceSpecificFieldRegistry,
    ) -> Result<VectorPayload, VectorPayloadValidationError> {
        VectorPayload::try_from_metadata_with_registry(self.metadata, registry)
    }
}

fn validate_required_fields(metadata: &MetadataMap) -> Result<(), VectorPayloadValidationError> {
    for field in REQUIRED_FIELDS {
        if !metadata.contains_key(*field) {
            return Err(VectorPayloadValidationError::MissingRequiredField {
                field: (*field).to_string(),
            });
        }
    }
    Ok(())
}

fn validate_forbidden_fields(metadata: &MetadataMap) -> Result<(), VectorPayloadValidationError> {
    for (field, value) in metadata.iter() {
        if forbidden_field_name(field) {
            return Err(VectorPayloadValidationError::ForbiddenField {
                field: field.clone(),
            });
        }
        validate_forbidden_value(field, value)?;
    }
    Ok(())
}

fn validate_generations(metadata: &MetadataMap) -> Result<(), VectorPayloadValidationError> {
    for field in ["source_generation", "committed_generation"] {
        if !metadata.get(field).is_some_and(|value| value.is_i64()) {
            return Err(VectorPayloadValidationError::InvalidGeneration {
                field: field.to_string(),
            });
        }
    }
    Ok(())
}

fn validate_visibility(metadata: &MetadataMap) -> Result<(), VectorPayloadValidationError> {
    let value = metadata
        .get("visibility")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if matches!(value, "public" | "internal" | "private") {
        Ok(())
    } else {
        Err(VectorPayloadValidationError::InvalidVisibility {
            value: value.to_string(),
        })
    }
}

fn validate_known_fields(
    metadata: &MetadataMap,
    registry: &SourceSpecificFieldRegistry,
) -> Result<(), VectorPayloadValidationError> {
    let source_family = metadata
        .get("source_family")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");
    for field in metadata.keys() {
        if SHARED_FIELDS.contains(&field.as_str()) {
            continue;
        }
        if registry.allows(source_family, field) {
            continue;
        }
        return Err(VectorPayloadValidationError::UnknownSourceSpecificField {
            source_family: source_family.to_string(),
            field: field.clone(),
        });
    }
    Ok(())
}

fn forbidden_field_name(field: &str) -> bool {
    let normalized = field.to_ascii_lowercase();
    FORBIDDEN_FIELD_FRAGMENTS
        .iter()
        .any(|fragment| normalized.contains(fragment))
}

fn validate_forbidden_value(path: &str, value: &Value) -> Result<(), VectorPayloadValidationError> {
    match value {
        Value::String(value) if forbidden_string_value(value) => {
            Err(VectorPayloadValidationError::ForbiddenValue {
                field: path.to_string(),
            })
        }
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                validate_forbidden_value(&format!("{path}[{index}]"), value)?;
            }
            Ok(())
        }
        Value::Object(object) => {
            if adapter_response_blob(object) {
                return Err(VectorPayloadValidationError::ForbiddenValue {
                    field: path.to_string(),
                });
            }
            for (field, value) in object {
                let child_path = format!("{path}.{field}");
                if forbidden_field_name(field) {
                    return Err(VectorPayloadValidationError::ForbiddenValue { field: child_path });
                }
                validate_forbidden_value(&child_path, value)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn forbidden_string_value(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    FORBIDDEN_VALUE_FRAGMENTS
        .iter()
        .any(|fragment| normalized.contains(fragment))
        || raw_dotenv_assignment(value)
        || home_credential_path(&normalized)
        || raw_html_blob(&normalized)
        || normalized.contains("adapter_response")
}

fn raw_dotenv_assignment(value: &str) -> bool {
    value.lines().any(|line| {
        let line = line.trim();
        let Some((key, raw_value)) = line.split_once('=') else {
            return false;
        };
        let key = key.trim();
        !key.is_empty()
            && !raw_value.trim().is_empty()
            && key
                .chars()
                .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '_')
            && key
                .chars()
                .next()
                .is_some_and(|ch| ch.is_ascii_uppercase() || ch == '_')
    })
}

fn home_credential_path(normalized: &str) -> bool {
    normalized.contains("/home/")
        && HOME_CREDENTIAL_PATH_FRAGMENTS
            .iter()
            .any(|fragment| normalized.contains(fragment))
}

fn raw_html_blob(normalized: &str) -> bool {
    let trimmed = normalized.trim_start();
    trimmed.starts_with("<!doctype html")
        || trimmed.starts_with("<html")
        || (normalized.contains("<html") && normalized.contains("</html>"))
        || (normalized.contains("<body") && normalized.contains("</body>"))
}

fn adapter_response_blob(object: &serde_json::Map<String, Value>) -> bool {
    let has_status = object.contains_key("status") || object.contains_key("status_code");
    let has_headers = object.contains_key("headers");
    let has_body = object.contains_key("body")
        || object.contains_key("raw_body")
        || object.contains_key("response_body");
    has_status && has_headers && has_body
}

const REQUIRED_FIELDS: &[&str] = &[
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
];

const SHARED_FIELDS: &[&str] = &[
    "payload_contract_version",
    "collection",
    "source_family",
    "source_id",
    "source_generation",
    "committed_generation",
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
];

const FORBIDDEN_FIELD_FRAGMENTS: &[&str] = &[
    "raw_auth",
    "auth_header",
    "authorization",
    "cookie",
    "api_key",
    "apikey",
    "secret",
    "raw_env",
    "env_value",
    "absolute_home",
    "home_path",
    "raw_html",
    "html_blob",
    "adapter_response",
    "response_blob",
];

const FORBIDDEN_VALUE_FRAGMENTS: &[&str] = &[
    "authorization:",
    "proxy-authorization:",
    "bearer ",
    "cookie:",
    "set-cookie:",
    "api_key=",
    "apikey=",
    "api-key:",
    "x-api-key:",
    "access_token=",
    "refresh_token=",
    "secret_key=",
    "token=",
];

const HOME_CREDENTIAL_PATH_FRAGMENTS: &[&str] = &[
    "/.ssh/",
    "/.aws/",
    "/.gnupg/",
    "/.config/chezmoi/key.txt",
    "/.config/gcloud/",
    "/.docker/config.json",
    "/.kube/config",
    "/.env",
];
