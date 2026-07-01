//! TEI embedding provider shell.

use std::time::Duration;

use async_trait::async_trait;
use axon_api::source::*;

use crate::capability::{
    EmbeddingCapabilityConfig, ProviderCapabilityConfig, embedding_capability,
    embedding_provider_capability, embedding_reservation_policy, embedding_reservation_state,
};
use crate::provider::{EmbeddingProvider, Result, not_wired_error};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeiEmbeddingConfig {
    pub endpoint: String,
    pub model: String,
    pub dimensions: u32,
    pub timeout: Duration,
    pub max_batch_inputs: u32,
    pub max_input_tokens: u32,
    pub max_batch_tokens: u32,
    pub instruction_support: InstructionSupport,
}

#[derive(Debug, Clone)]
pub struct TeiEmbeddingProvider {
    config: TeiEmbeddingConfig,
}

impl TeiEmbeddingProvider {
    pub fn new(config: TeiEmbeddingConfig) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &TeiEmbeddingConfig {
        &self.config
    }
}

#[async_trait]
impl EmbeddingProvider for TeiEmbeddingProvider {
    async fn embed(&self, _batch: EmbeddingBatch) -> Result<EmbeddingResult> {
        Err(not_wired_error("tei", "TEI"))
    }

    async fn capabilities(&self) -> Result<ProviderCapability> {
        let last_error = not_wired_error("tei", "TEI");
        Ok(embedding_provider_capability(ProviderCapabilityConfig {
            provider_id: ProviderId::new("tei"),
            implementation: "tei".to_string(),
            health: HealthStatus::Unavailable,
            limits: ProviderLimits {
                max_batch_size: Some(self.config.max_batch_inputs),
                timeout_ms: Some(self.config.timeout.as_millis() as u64),
                ..ProviderLimits::default()
            },
            features: vec!["dense_embeddings".to_string(), "http_shell".to_string()],
            cooldown_until: None,
            last_error: Some(last_error),
            reservation_policy: embedding_reservation_policy(false, QueuePolicy::Fifo, 0),
            reservation_state: embedding_reservation_state(0),
            cost_class: ProviderCostClass::Internal,
            degraded_modes: Vec::new(),
            fake_overrides_supported: false,
            embedding: embedding_capability(EmbeddingCapabilityConfig {
                model_id: self.config.model.clone(),
                dimensions: self.config.dimensions,
                max_input_tokens: self.config.max_input_tokens,
                max_batch_tokens: self.config.max_batch_tokens,
                instruction_support: self.config.instruction_support,
                sparse_output: false,
                max_batch_items: self.config.max_batch_inputs,
                max_batch_bytes: None,
            }),
        }))
    }
}
