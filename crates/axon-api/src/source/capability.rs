use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::common::*;
use super::enums::*;
use super::ids::*;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CapabilityBase {
    pub name: String,
    pub version: String,
    pub owner_crate: String,
    pub health: HealthStatus,
    pub features: Vec<String>,
    pub limits: MetadataMap,
}

pub type SourceResolverCapability = CapabilityBase;
pub type SourceRouterCapability = CapabilityBase;
pub type SourceAdapterCapability = CapabilityBase;
pub type SourceScopeCapability = CapabilityBase;
pub type SourceEnricherCapability = CapabilityBase;
pub type DocumentPreparerCapability = CapabilityBase;
pub type ChunkProfileCapability = CapabilityBase;
pub type ParserCapability = CapabilityBase;
pub type RetrievalCapability = CapabilityBase;
pub type LedgerStoreCapability = CapabilityBase;
pub type GraphStoreCapability = CapabilityBase;
pub type MemoryStoreCapability = CapabilityBase;
pub type JobStoreCapability = CapabilityBase;
pub type WatchStoreCapability = CapabilityBase;
pub type ArtifactStoreCapability = CapabilityBase;
pub type ConfigStoreCapability = CapabilityBase;
pub type DocumentCacheCapability = CapabilityBase;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProviderCapability {
    pub provider_id: ProviderId,
    pub provider_kind: ProviderKind,
    pub name: String,
    pub version: String,
    pub health: HealthStatus,
    pub features: Vec<String>,
    pub limits: MetadataMap,
    pub reservations_supported: bool,
    pub cooling_supported: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProviderSummary {
    pub provider_id: ProviderId,
    pub provider_kind: ProviderKind,
    pub health: HealthStatus,
    pub active_reservations: u32,
    pub queued_requests: u32,
    pub cooling_until: Option<Timestamp>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CapabilityDocument {
    pub server: ServerInfo,
    pub generated_at: Timestamp,
    pub source_kinds: Vec<SourceKind>,
    pub source_scopes: Vec<SourceScope>,
    pub pipeline_phases: Vec<PipelinePhase>,
    pub adapters: Vec<SourceAdapterCapability>,
    pub providers: Vec<ProviderCapability>,
    pub stores: StoreCapabilities,
    pub metadata: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
    pub build: Option<String>,
    pub environment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StoreCapabilities {
    pub ledger: Option<LedgerStoreCapability>,
    pub graph: Option<GraphStoreCapability>,
    pub memory: Option<MemoryStoreCapability>,
    pub job: Option<JobStoreCapability>,
    pub watch: Option<WatchStoreCapability>,
    pub artifact: Option<ArtifactStoreCapability>,
    pub config: Option<ConfigStoreCapability>,
    pub document_cache: Option<DocumentCacheCapability>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HealthReport {
    pub status: HealthStatus,
    pub generated_at: Timestamp,
    pub providers: Vec<ProviderSummary>,
    pub warnings: Vec<SourceWarning>,
    pub metadata: MetadataMap,
}
