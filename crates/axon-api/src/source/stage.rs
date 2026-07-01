use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::common::*;
use super::enums::*;
use super::graph::*;
use super::ids::*;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StageResultHeader {
    pub job_id: JobId,
    pub stage_id: StageId,
    pub phase: PipelinePhase,
    pub status: LifecycleStatus,
    pub started_at: Timestamp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<Timestamp>,
    pub counts: StageCounts,
    pub warnings: Vec<SourceWarning>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<SourceError>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StageExecutionResult<T> {
    pub header: StageResultHeader,
    pub data: T,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StageCounts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items_total: Option<u64>,
    pub items_done: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub documents_total: Option<u64>,
    pub documents_done: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunks_total: Option<u64>,
    pub chunks_done: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes_total: Option<u64>,
    pub bytes_done: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceManifest {
    pub source_id: SourceId,
    pub generation: SourceGenerationId,
    pub adapter: AdapterRef,
    pub scope: SourceScope,
    pub items: Vec<ManifestItem>,
    pub created_at: Timestamp,
    pub metadata: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ManifestItem {
    pub source_id: SourceId,
    pub source_item_key: SourceItemKey,
    pub canonical_uri: String,
    pub item_kind: ItemKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_kind: Option<ContentKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_key: Option<SourceItemKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mtime: Option<Timestamp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub metadata: MetadataMap,
    pub graph_hints: Vec<GraphCandidate>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceManifestDiff {
    pub header: StageResultHeader,
    pub source_id: SourceId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_generation: Option<SourceGenerationId>,
    pub next_generation: SourceGenerationId,
    pub added: Vec<ManifestItem>,
    pub modified: Vec<ManifestItem>,
    pub removed: Vec<ManifestItem>,
    pub unchanged: Vec<ManifestItem>,
    pub skipped: Vec<ManifestItemFailure>,
    pub failed: Vec<ManifestItemFailure>,
    pub counts: DiffCounts,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceAcquisition {
    pub header: StageResultHeader,
    pub source_id: SourceId,
    pub generation: SourceGenerationId,
    pub adapter: AdapterRef,
    pub scope: SourceScope,
    pub manifest: SourceManifest,
    pub fetched_items: Vec<AcquiredSourceItem>,
    pub artifacts: Vec<ArtifactRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AcquiredSourceItem {
    pub manifest_item: ManifestItem,
    pub fetch_status: LifecycleStatus,
    pub content_ref: ContentRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_artifact_id: Option<ArtifactId>,
    pub fetched_at: Timestamp,
    pub metadata: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceEnrichment {
    pub header: StageResultHeader,
    pub source_id: SourceId,
    pub source_item_key: SourceItemKey,
    pub enrichment_kind: EnrichmentKind,
    pub status: EnrichmentStatus,
    pub metadata: MetadataMap,
    pub parse_hints: Vec<ParserHint>,
    pub chunk_hints: Vec<ChunkHint>,
    pub graph_candidates: Vec<GraphCandidate>,
    pub artifacts: Vec<ArtifactRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ManifestItemFailure {
    pub item: ManifestItem,
    pub error: SourceError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DiffCounts {
    pub added: u64,
    pub modified: u64,
    pub removed: u64,
    pub unchanged: u64,
    pub skipped: u64,
    pub failed: u64,
}
