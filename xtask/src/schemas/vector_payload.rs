use std::collections::BTreeMap;
use std::path::Path;

use anyhow::Result;
use serde_json::{Map, Value, json};

use super::super::artifact::SchemaArtifact;
use super::super::rel;
use super::super::schema_json::{json_string, schema_defs};
use super::super::source_input::{SourceInput, source_inputs};
use axon_vectors::payload::{
    VECTOR_REQUIRED_FIELDS, VECTOR_SHARED_FIELDS, VECTOR_SOURCE_FAMILIES,
    VECTOR_SOURCE_FAMILY_FIELDS, VECTOR_VISIBILITY_VALUES,
};

pub fn vector_payload_artifacts(root: &Path) -> Result<Vec<SchemaArtifact>> {
    let registry = VectorPayloadRegistry::load(root)?;
    let inputs = source_inputs(
        root,
        &[
            "crates/axon-vectors/src/payload.rs",
            "crates/axon-vectors/src/point.rs",
            "crates/axon-api/src/source/vector.rs",
            "docs/pipeline-unification/sources/metadata-payload.md",
            "docs/pipeline-unification/sources/chunking-contract.md",
            "docs/pipeline-unification/schemas/vector-payload-schema.md",
        ],
    )?;
    let schema = schema_bundle(&inputs, &registry);

    Ok(vec![
        SchemaArtifact::new(
            rel("docs/reference/sources/vector-payload.schema.json"),
            json_string(&schema)?,
        ),
        SchemaArtifact::new(
            rel("docs/reference/sources/vector-payload.md"),
            markdown(&inputs, &registry),
        ),
    ])
}

struct VectorPayloadRegistry {
    required_fields: Vec<String>,
    shared_fields: Vec<String>,
    source_families: Vec<SourceFamilySpec>,
}

struct SourceFamilySpec {
    name: String,
    fields: Vec<String>,
}

impl VectorPayloadRegistry {
    fn load(_root: &Path) -> Result<Self> {
        Ok(Self {
            required_fields: VECTOR_REQUIRED_FIELDS
                .iter()
                .map(|field| (*field).to_string())
                .collect(),
            shared_fields: VECTOR_SHARED_FIELDS
                .iter()
                .map(|field| (*field).to_string())
                .collect(),
            source_families: VECTOR_SOURCE_FAMILY_FIELDS
                .iter()
                .map(|(name, fields)| SourceFamilySpec {
                    name: (*name).to_string(),
                    fields: fields.iter().map(|field| (*field).to_string()).collect(),
                })
                .collect(),
        })
    }
}

fn schema_bundle(inputs: &[SourceInput], registry: &VectorPayloadRegistry) -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://axon.local/schemas/sources/vector-payload.schema.json",
        "title": "AxonVectorPayloadSchema",
        "description": "Generated vector payload metadata contract derived from the axon-vectors registry.",
        "type": "object",
        "required": registry.required_fields,
        "properties": schema_properties(registry),
        "additionalProperties": false,
        "$defs": schema_defs(
            &[
                ("ChunkLocator", schemars::schema_for!(axon_api::source::ChunkLocator).into()),
                ("SourceRange", schemars::schema_for!(axon_api::source::SourceRange).into()),
            ],
            None,
        ),
        "x-axon": {
            "contract_version": "2026-06-30",
            "generated_by": "cargo xtask schemas vector-payload",
            "owner_crates": ["axon-vectors", "axon-api"],
            "source_inputs": inputs,
            "clean_break": true,
            "source_specific_families": registry_families_json(registry),
            "index_plan": index_plan(),
            "examples": payload_examples(registry),
            "api_dtos": [
                "EmbeddingBatch",
                "EmbeddingInput",
                "VectorPointBatch",
                "VectorPoint",
                "PayloadIndexSpec",
                "CollectionSpec",
                "VectorSearchRequest",
                "VectorSearchResult"
            ]
        }
    })
}

fn schema_properties(registry: &VectorPayloadRegistry) -> Value {
    let mut properties = Map::new();
    for field in &registry.shared_fields {
        properties.insert(field.clone(), shared_field_schema(field));
    }
    for family in &registry.source_families {
        for field in &family.fields {
            properties.insert(field.clone(), source_specific_field_schema(field));
        }
    }
    Value::Object(properties)
}

fn shared_field_schema(field: &str) -> Value {
    match field {
        "payload_contract_version" => {
            json!({ "type": ["string", "integer"], "x-qdrant-index": "keyword" })
        }
        "collection" | "source_id" | "source_item_key" | "document_id" | "chunk_id"
        | "chunk_key" | "content_hash" | "job_id" | "document_status" | "embedding_model"
        | "embedding_provider" | "embedding_profile" => {
            json!({ "type": "string", "x-qdrant-index": "keyword" })
        }
        "source_family" => {
            json!({
                "type": "string",
                "enum": VECTOR_SOURCE_FAMILIES,
                "x-qdrant-index": "keyword"
            })
        }
        "source_generation" | "committed_generation" | "embedding_dimensions" => {
            json!({ "type": "integer", "minimum": 0, "x-qdrant-index": "integer" })
        }
        "chunk_locator" => json!({ "$ref": "#/$defs/ChunkLocator" }),
        "source_range" => json!({ "$ref": "#/$defs/SourceRange" }),
        "visibility" => json!({
            "type": "string",
            "enum": VECTOR_VISIBILITY_VALUES,
            "x-qdrant-index": "keyword"
        }),
        "redaction_status" => json!({ "type": "string", "x-qdrant-index": "keyword" }),
        "embedded_at" => json!({ "type": "string", "format": "date-time" }),
        _ => json!({ "type": "string" }),
    }
}

fn source_specific_field_schema(field: &str) -> Value {
    match field {
        "web_status_code" | "web_depth" | "session_turn_index" | "memory_importance" => {
            json!({ "type": "integer" })
        }
        "graph_confidence" => json!({ "type": "number" }),
        "graph_node_ids" | "graph_edge_ids" => {
            json!({ "type": "array", "items": { "type": "string" } })
        }
        _ => json!({ "type": "string" }),
    }
}

fn registry_families_json(registry: &VectorPayloadRegistry) -> Vec<Value> {
    registry
        .source_families
        .iter()
        .map(|family| {
            json!({
                "source_family": family.name,
                "fields": family.fields,
            })
        })
        .collect()
}

fn index_plan() -> Value {
    json!({
        "collection": "axon",
        "indexes": [
            { "field_name": "payload_contract_version", "field_schema": "keyword" },
            { "field_name": "collection", "field_schema": "keyword" },
            { "field_name": "source_family", "field_schema": "keyword" },
            { "field_name": "source_id", "field_schema": "keyword" },
            { "field_name": "source_item_key", "field_schema": "keyword" },
            { "field_name": "source_generation", "field_schema": "integer" },
            { "field_name": "committed_generation", "field_schema": "integer" },
            { "field_name": "document_id", "field_schema": "keyword" },
            { "field_name": "chunk_id", "field_schema": "keyword" },
            { "field_name": "job_id", "field_schema": "keyword" },
            { "field_name": "document_status", "field_schema": "keyword" },
            { "field_name": "embedding_model", "field_schema": "keyword" },
            { "field_name": "embedding_provider", "field_schema": "keyword" },
            { "field_name": "visibility", "field_schema": "keyword" }
        ]
    })
}

fn payload_examples(registry: &VectorPayloadRegistry) -> Vec<Value> {
    registry
        .source_families
        .iter()
        .map(|family| {
            let mut payload = BTreeMap::<String, Value>::new();
            for field in &registry.required_fields {
                payload.insert(field.clone(), required_example_value(field, &family.name));
            }
            payload.insert("source_family".to_string(), json!(family.name));
            payload.insert(
                "source_item_key".to_string(),
                json!(format!("{}-item", family.name)),
            );
            payload.insert(
                "chunk_key".to_string(),
                json!(format!("{}-chunk-key", family.name)),
            );
            payload.insert(
                "content_hash".to_string(),
                json!(format!("sha256:{}hash", family.name)),
            );
            for field in &family.fields {
                payload.insert(
                    field.clone(),
                    source_specific_example_value(field, &family.name),
                );
            }
            serde_json::to_value(payload).expect("example payload should serialize")
        })
        .collect()
}

fn required_example_value(field: &str, family: &str) -> Value {
    match field {
        "payload_contract_version" => json!("2026-07-01"),
        "collection" => json!("axon"),
        "source_id" => json!(format!("src-{family}")),
        "source_generation" | "committed_generation" => json!(7),
        "document_id" => json!(format!("doc-{family}")),
        "chunk_id" => json!(format!("chunk-{family}-0")),
        "chunk_locator" => json!({
            "canonical_uri": format!("https://example.com/{family}"),
            "path": format!("/{family}"),
            "heading_path": [format!("{family} heading")],
            "symbol": Value::Null,
            "range": source_range_example(),
        }),
        "source_range" => source_range_example(),
        "visibility" => json!("internal"),
        "redaction_status" => json!("clean"),
        "job_id" => json!(format!("job-{family}")),
        "document_status" => json!("prepared"),
        "embedding_model" => json!("text-embedding-test"),
        "embedding_dimensions" => json!(768),
        "embedding_provider" => json!("tei"),
        "embedding_profile" => json!("default"),
        "embedded_at" => json!("2026-06-30T00:00:00Z"),
        _ => json!(field),
    }
}

fn source_specific_example_value(field: &str, family: &str) -> Value {
    match field {
        "web_title" => json!("Example Docs"),
        "web_domain" => json!("example.com"),
        "web_status_code" => json!(200),
        "web_depth" => json!(1),
        "code_language" => json!("rust"),
        "code_symbol_name" => json!("VectorPayloadBuilder"),
        "code_symbol_kind" => json!("struct"),
        "code_file_type" => json!("source"),
        "package_ecosystem" => json!("cargo"),
        "package_name" => json!("axon"),
        "package_version" => json!("6.2.1"),
        "session_id" => json!(format!("session-{family}")),
        "session_turn_index" => json!(3),
        "session_tool_name" => json!("schemas"),
        "session_skill_name" => json!("test-driven-development"),
        "graph_node_ids" => json!(["node-a", "node-b"]),
        "graph_edge_ids" => json!(["edge-a"]),
        "graph_confidence" => json!(0.93),
        "memory_id" => json!(format!("memory-{family}")),
        "memory_importance" => json!(5),
        "memory_status" => json!("active"),
        _ => json!(field),
    }
}

fn source_range_example() -> Value {
    json!({
        "line_start": 1,
        "line_end": 4,
        "byte_start": Value::Null,
        "byte_end": Value::Null,
        "char_start": Value::Null,
        "char_end": Value::Null,
        "time_start_ms": Value::Null,
        "time_end_ms": Value::Null,
        "dom_selector": Value::Null,
        "json_pointer": Value::Null,
        "yaml_path": Value::Null,
        "xml_xpath": Value::Null,
        "csv_row": Value::Null,
        "session_turn_id": Value::Null,
        "turn_start": Value::Null,
        "turn_end": Value::Null,
    })
}

fn markdown(inputs: &[SourceInput], registry: &VectorPayloadRegistry) -> String {
    let mut out = String::from(
        "# vector-payload Schema Reference\n\nGenerated by `cargo xtask schemas vector-payload`.\n\n",
    );
    out.push_str("## Required Fields\n\n| Field | Type |\n|---|---|\n");
    for field in &registry.required_fields {
        out.push_str(&format!(
            "| `{field}` | `{}` |\n",
            display_type(&shared_field_schema(field))
        ));
    }

    out.push_str("\n## Source-Specific Families\n\n| Family | Fields |\n|---|---|\n");
    for family in &registry.source_families {
        out.push_str(&format!(
            "| `{}` | `{}` |\n",
            family.name,
            family.fields.join("`, `")
        ));
    }

    out.push_str("\n## Qdrant Index Plan\n\n| Field | Schema |\n|---|---|\n");
    for index in index_plan()["indexes"].as_array().unwrap() {
        out.push_str(&format!(
            "| `{}` | `{}` |\n",
            index["field_name"].as_str().unwrap(),
            index["field_schema"].as_str().unwrap()
        ));
    }

    out.push_str("\n## API DTO Coverage\n\n");
    out.push_str("Vector payload docs are paired with the DTO definitions in `docs/reference/api/schemas.json`.\n\n");
    out.push_str("| DTO |\n|---|\n");
    for dto in [
        "EmbeddingBatch",
        "EmbeddingInput",
        "VectorPointBatch",
        "VectorPoint",
        "PayloadIndexSpec",
        "CollectionSpec",
        "VectorSearchRequest",
        "VectorSearchResult",
    ] {
        out.push_str(&format!("| `{dto}` |\n"));
    }

    out.push_str("\n## Source Inputs\n\n| Path | SHA-256 |\n|---|---|\n");
    for input in inputs {
        out.push_str(&format!("| `{}` | `{}` |\n", input.path, input.checksum));
    }
    out
}

fn display_type(schema: &Value) -> String {
    if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
        return reference.to_string();
    }
    match schema.get("type") {
        Some(Value::String(kind)) => kind.clone(),
        Some(Value::Array(kinds)) => kinds
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" | "),
        _ => "unknown".to_string(),
    }
}
