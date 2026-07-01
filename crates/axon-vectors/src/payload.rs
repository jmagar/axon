//! Validated vector payload metadata.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use axon_api::source::MetadataMap;

use crate::payload_redaction::{forbidden_field_name, validate_forbidden_value};

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
