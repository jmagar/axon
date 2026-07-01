use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::common::SourceRange;
use super::ids::*;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceParseFacts {
    pub document_id: DocumentId,
    pub source_item_key: SourceItemKey,
    pub fact_kind: String,
    pub name: String,
    pub value: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<SourceRange>,
    pub confidence: f32,
    pub metadata: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GraphCandidate {
    pub candidate_id: String,
    pub job_id: JobId,
    pub source_id: SourceId,
    pub source_item_key: SourceItemKey,
    pub item_canonical_uri: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<DocumentId>,
    pub producer: GraphCandidateProducer,
    pub nodes: Vec<GraphNodeCandidate>,
    pub edges: Vec<GraphEdgeCandidate>,
    pub evidence: Vec<GraphEvidence>,
    pub confidence: f32,
    pub metadata: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GraphCandidateProducer {
    pub adapter: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parser: Option<String>,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GraphNodeCandidate {
    pub node_kind: String,
    pub stable_key: String,
    pub label: String,
    pub properties: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GraphEdgeCandidate {
    pub edge_kind: String,
    pub from_stable_key: String,
    pub to_stable_key: String,
    pub properties: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GraphEvidence {
    pub evidence_id: String,
    pub source_id: SourceId,
    pub source_item_key: SourceItemKey,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<DocumentId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<SourceRange>,
    pub quote: Option<String>,
    pub confidence: f32,
    pub metadata: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GraphRef {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<GraphNodeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_id: Option<GraphEdgeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_id: Option<String>,
}
