use async_trait::async_trait;
use axon_api::source::*;
use axon_embedding::provider::EmbeddingProvider;
use axon_vectors::store::VectorStore;

#[async_trait]
pub(super) trait LocalSourceProgress: Send + Sync {
    async fn record_phase(
        &self,
        phase: PipelinePhase,
        status: LifecycleStatus,
        counts: Option<StageCounts>,
        error: Option<SourceError>,
    ) -> anyhow::Result<()>;
}

pub(super) async fn ensure_providers_ready(
    embedding_provider: &dyn EmbeddingProvider,
    vector_store: &dyn VectorStore,
) -> anyhow::Result<()> {
    ensure_provider_capability_ready(embedding_provider.capabilities().await?)?;
    ensure_provider_capability_ready(vector_store.capabilities().await?)?;
    Ok(())
}

pub(super) async fn record_progress(
    progress: Option<&dyn LocalSourceProgress>,
    phase: PipelinePhase,
    counts: Option<StageCounts>,
) -> anyhow::Result<()> {
    if let Some(progress) = progress {
        progress
            .record_phase(phase, LifecycleStatus::Running, counts, None)
            .await?;
    }
    Ok(())
}

pub(super) async fn record_progress_error(
    progress: Option<&dyn LocalSourceProgress>,
    phase: PipelinePhase,
    error: &ApiError,
) -> anyhow::Result<()> {
    if let Some(progress) = progress {
        progress
            .record_phase(
                phase,
                LifecycleStatus::Failed,
                None,
                Some(source_error_from_api_error(error)),
            )
            .await?;
    }
    Ok(())
}

fn ensure_provider_capability_ready(capability: ProviderCapability) -> anyhow::Result<()> {
    if matches!(
        capability.health,
        HealthStatus::Healthy | HealthStatus::Degraded
    ) {
        return Ok(());
    }
    if let Some(error) = capability.last_error {
        return Err(anyhow::Error::new(error));
    }
    Err(anyhow::anyhow!(
        "provider {} is not ready: {:?}",
        capability.provider_id.0,
        capability.health
    ))
}

fn source_error_from_api_error(error: &ApiError) -> SourceError {
    SourceError {
        code: error.code.0.clone(),
        severity: Severity::Failed,
        message: error.message.clone(),
        source_item_key: None,
        retryable: error.retryable,
        provider_id: error
            .provider_id
            .as_ref()
            .map(|id| ProviderId::new(id.clone())),
        cause: Some(error.to_string()),
    }
}
