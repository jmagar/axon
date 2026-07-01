use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::common::*;
use super::document::*;
use super::enums::*;
use super::graph::*;
use super::ids::*;
use super::lifecycle::WatchSchedule;
use super::stage::{ManifestItem, StageCounts};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Page<T> {
    pub items: Vec<T>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceSummary {
    pub source_id: SourceId,
    pub canonical_uri: String,
    pub display_name: String,
    pub source_kind: SourceKind,
    pub adapter: AdapterRef,
    pub authority: AuthorityLevel,
    pub status: LifecycleStatus,
    pub counts: SourceCounts,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watch_id: Option<WatchId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_job_id: Option<JobId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceItem {
    pub source_id: SourceId,
    pub source_item_key: SourceItemKey,
    pub status: DocumentLifecycleStatus,
    pub content_hash: String,
    pub generation: SourceGenerationId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub document_ids: Vec<DocumentId>,
    pub graph_refs: Vec<GraphRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<SourceError>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceItemDetail {
    pub item: SourceItem,
    pub manifest: ManifestItem,
    pub statuses: Vec<DocumentStatus>,
    pub errors: Vec<SourceError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_preview: Option<String>,
    pub metadata: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DocumentSummary {
    pub document_id: DocumentId,
    pub source_id: SourceId,
    pub source_item_key: SourceItemKey,
    pub status: DocumentLifecycleStatus,
    pub chunk_count: u32,
    pub vector_point_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_kind: Option<ContentKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub graph_refs: Vec<GraphRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DocumentDetail {
    pub summary: DocumentSummary,
    pub generation: SourceGenerationId,
    pub metadata: MetadataMap,
    pub chunks: Vec<ChunkSummary>,
    pub vector_keys: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ChunkSummary {
    pub chunk_id: ChunkId,
    pub document_id: DocumentId,
    pub chunk_index: u32,
    pub chunk_locator: ChunkLocator,
    pub source_range: SourceRange,
    pub metadata: MetadataMap,
    pub graph_refs: Vec<GraphRef>,
    pub vector_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ChunkDetail {
    pub summary: ChunkSummary,
    pub content_hash: String,
    pub content: Option<String>,
    pub payload: MetadataMap,
    pub embedding_metadata: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct JobSummary {
    pub job_id: JobId,
    pub kind: JobKind,
    pub status: LifecycleStatus,
    pub phase: PipelinePhase,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<SourceId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watch_id: Option<WatchId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub counts: Option<StageCounts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<SourceError>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct JobListRequest {
    pub status: Option<LifecycleStatus>,
    pub kind: Option<JobKind>,
    pub source_id: Option<SourceId>,
    pub watch_id: Option<WatchId>,
    pub limit: Option<u32>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WatchRequest {
    pub source: String,
    pub schedule: WatchSchedule,
    pub embed: bool,
    pub options: AdapterOptions,
    pub scope: Option<SourceScope>,
    pub collection: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WatchSummary {
    pub watch_id: WatchId,
    pub source_id: SourceId,
    pub enabled: bool,
    pub schedule: WatchSchedule,
    pub next_run_at: Timestamp,
    pub last_job_id: Option<JobId>,
    pub last_status: Option<LifecycleStatus>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WatchListRequest {
    pub enabled: Option<bool>,
    pub source_id: Option<SourceId>,
    pub adapter: Option<String>,
    pub limit: Option<u32>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WatchExecRequest {
    pub reason: Option<String>,
    pub refresh: Option<SourceRefreshPolicy>,
    pub wait: Option<bool>,
}
