use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::common::*;
use super::enums::*;
use super::ids::*;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EmbeddingBatch {
    pub batch_id: BatchId,
    pub job_id: JobId,
    pub provider_id: ProviderId,
    pub model: String,
    pub items: Vec<EmbeddingInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
    pub priority: JobPriority,
    pub metadata: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EmbeddingInput {
    pub chunk_id: ChunkId,
    pub text: String,
    pub content_kind: ContentKind,
    pub metadata: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EmbeddingResult {
    pub batch_id: BatchId,
    pub model: String,
    pub dimensions: u32,
    pub vectors: Vec<EmbeddingVector>,
    pub usage: ProviderUsage,
    pub warnings: Vec<SourceWarning>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EmbeddingVector {
    pub chunk_id: ChunkId,
    pub dense: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProviderUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub requests: u64,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VectorPointBatch {
    pub batch_id: BatchId,
    pub collection: String,
    pub points: Vec<VectorPoint>,
    pub model: String,
    pub dimensions: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sparse_vectors: Option<Vec<SparseVector>>,
    pub payload_indexes: Vec<PayloadIndexSpec>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VectorPoint {
    pub point_id: String,
    pub chunk_id: ChunkId,
    pub dense: Vec<f32>,
    pub payload: MetadataMap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SparseVector {
    pub indices: Vec<u32>,
    pub values: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PayloadIndexSpec {
    pub field_name: String,
    pub field_schema: String,
}
