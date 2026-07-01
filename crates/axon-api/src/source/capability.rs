use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::common::*;
use super::enums::*;
use super::ids::*;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CapabilityBase {
    pub name: String,
    pub version: String,
    pub owner_crate: String,
    pub health: HealthStatus,
    pub features: Vec<String>,
    pub limits: MetadataMap,
}

macro_rules! capability_newtype {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
        #[serde(transparent)]
        pub struct $name(pub CapabilityBase);

        impl From<CapabilityBase> for $name {
            fn from(value: CapabilityBase) -> Self {
                Self(value)
            }
        }
    };
}

capability_newtype!(SourceResolverCapability);
capability_newtype!(SourceRouterCapability);
capability_newtype!(SourceAdapterCapability);
capability_newtype!(SourceScopeCapability);
capability_newtype!(SourceEnricherCapability);
capability_newtype!(DocumentPreparerCapability);
capability_newtype!(ChunkProfileCapability);
capability_newtype!(ParserCapability);
capability_newtype!(RetrievalCapability);
capability_newtype!(LedgerStoreCapability);
capability_newtype!(GraphStoreCapability);
capability_newtype!(MemoryStoreCapability);
capability_newtype!(JobStoreCapability);
capability_newtype!(WatchStoreCapability);
capability_newtype!(ArtifactStoreCapability);
capability_newtype!(ConfigStoreCapability);
capability_newtype!(DocumentCacheCapability);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ProviderSummary {
    pub provider_id: ProviderId,
    pub provider_kind: ProviderKind,
    pub health: HealthStatus,
    pub active_reservations: u32,
    pub queued_requests: u32,
    pub cooling_until: Option<Timestamp>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
    pub build: Option<String>,
    pub environment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct HealthReport {
    pub status: HealthStatus,
    pub generated_at: Timestamp,
    pub providers: Vec<ProviderSummary>,
    pub warnings: Vec<SourceWarning>,
    pub metadata: MetadataMap,
}
