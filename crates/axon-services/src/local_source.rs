mod local_source_adapter;
mod local_source_job;
mod local_source_progress;
mod local_source_vectorize;

use std::path::PathBuf;

use axon_api::source::*;
use axon_embedding::provider::EmbeddingProvider;
use axon_embedding::reservation::ProviderReservationManager;
use axon_ledger::store::LedgerStore;
use axon_vectors::store::VectorStore;
use std::sync::Arc;

#[cfg(test)]
pub(super) use self::local_source_adapter::local_source_id;
use self::local_source_adapter::{
    LocalAdapterRun, collection_spec, discover_manifest, resolve_adapter_run, source_summary,
    timestamp,
};
pub use self::local_source_job::index_local_source_with_job;
use self::local_source_progress::{
    LocalSourceProgress, ensure_providers_ready, phase_for_api_error, record_progress,
    record_progress_error,
};
use self::local_source_vectorize::{
    VectorizeStats, publish_document_status, vectorize_changed_documents,
};

const LOCAL_ADAPTER_VERSION: &str = "target-local-pr11";
const LOCAL_LEASE_TTL_SECONDS: u64 = 30 * 60;

#[derive(Debug, Clone)]
pub struct LocalSourceIndexInput {
    pub root: PathBuf,
    pub collection: String,
    pub owner_id: String,
    pub job_id: JobId,
    pub embedding_provider_id: ProviderId,
    pub vector_provider_id: ProviderId,
    pub embedding_model: String,
    pub embedding_dimensions: u32,
    pub selection_policy: LocalSourceSelectionPolicy,
    pub embedding_reservations: Option<Arc<ProviderReservationManager>>,
    pub vector_reservations: Option<Arc<ProviderReservationManager>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalSourceIndexOutput {
    pub job_id: JobId,
    pub source_id: SourceId,
    pub generation: SourceGenerationId,
    pub documents_prepared: u64,
    pub chunks_prepared: u64,
    pub vector_points_written: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalSourceSelectionPolicy {
    Permissive,
    CodeSearch,
}

pub async fn index_local_source(
    input: LocalSourceIndexInput,
    ledger: &dyn LedgerStore,
    embedding_provider: &dyn EmbeddingProvider,
    vector_store: &dyn VectorStore,
) -> anyhow::Result<LocalSourceIndexOutput> {
    index_local_source_with_progress(input, ledger, embedding_provider, vector_store, None).await
}

async fn index_local_source_with_progress(
    input: LocalSourceIndexInput,
    ledger: &dyn LedgerStore,
    embedding_provider: &dyn EmbeddingProvider,
    vector_store: &dyn VectorStore,
    progress: Option<&dyn LocalSourceProgress>,
) -> anyhow::Result<LocalSourceIndexOutput> {
    let run = resolve_adapter_run(&input).await?;

    ledger.upsert_source(source_summary(&input, &run)).await?;
    let lease = ledger
        .acquire_lease(LeaseRequest {
            lease_key: format!("source:{}", run.source_id.0),
            owner_id: input.owner_id.clone(),
            ttl_seconds: LOCAL_LEASE_TTL_SECONDS,
            job_id: Some(input.job_id),
            metadata: MetadataMap::new(),
        })
        .await?
        .ok_or_else(|| {
            anyhow::anyhow!(
                "local source refresh already running for {}",
                run.source_id.0
            )
        })?;

    let result = index_local_source_with_lease(
        &input,
        ledger,
        embedding_provider,
        vector_store,
        progress,
        run,
    )
    .await;

    let release = ledger.release_lease(lease.lease_id, input.owner_id).await;
    match (result, release) {
        (Ok(output), Ok(())) => Ok(output),
        (Err(err), Ok(())) => Err(err),
        (Ok(_), Err(err)) => {
            Err(anyhow::Error::new(err).context("failed to release local source lease"))
        }
        (Err(err), Err(release_err)) => Err(err.context(format!(
            "additionally failed to release local source lease: {release_err}"
        ))),
    }
}

async fn index_local_source_with_lease(
    input: &LocalSourceIndexInput,
    ledger: &dyn LedgerStore,
    embedding_provider: &dyn EmbeddingProvider,
    vector_store: &dyn VectorStore,
    progress: Option<&dyn LocalSourceProgress>,
    run: LocalAdapterRun,
) -> anyhow::Result<LocalSourceIndexOutput> {
    let mut manifest = discover_manifest(&run).await?;
    record_progress(progress, PipelinePhase::Discovering, None).await?;
    let diff = ledger.diff_manifest(manifest.clone()).await?;
    record_progress(progress, PipelinePhase::Diffing, None).await?;
    if !manifest_diff_has_changes(&diff)
        && let Some(committed_generation) = diff.previous_generation
    {
        return Ok(LocalSourceIndexOutput {
            job_id: input.job_id,
            source_id: run.source_id,
            generation: committed_generation,
            documents_prepared: 0,
            chunks_prepared: 0,
            vector_points_written: 0,
        });
    }

    if let Err(err) = ensure_providers_ready(embedding_provider, vector_store).await {
        record_progress_error(progress, phase_for_api_error(&err), &err).await?;
        return Err(anyhow::Error::new(err));
    }
    let source_id = run.source_id.clone();
    let generation = ledger.create_generation(source_id.clone()).await?;
    manifest.generation = generation.generation.clone();
    ledger.put_manifest(manifest.clone()).await?;

    record_progress(progress, PipelinePhase::Preparing, None).await?;
    let collection = collection_spec(&input.collection, input.embedding_dimensions);
    vector_store.ensure_collection(collection.clone()).await?;
    let vectorized = vectorize_changed_documents(
        input,
        &run,
        &diff,
        &generation.generation,
        ledger,
        embedding_provider,
        vector_store,
        progress,
        collection.clone(),
    )
    .await?;
    let completed = complete_generation(
        ledger,
        generation,
        &diff,
        manifest.items.len() as u64,
        &vectorized.stats,
    )
    .await?;
    if let Err(err) = vector_store
        .mark_generation_committed(
            collection.collection.clone(),
            source_id.clone(),
            completed.generation.clone(),
        )
        .await
    {
        record_progress_error(progress, PipelinePhase::Publishing, &err).await?;
        return Err(anyhow::Error::new(err));
    }
    let published = match publish_completed_generation(ledger, completed.clone()).await {
        Ok(published) => published,
        Err(err) => {
            if let Err(rollback_err) = vector_store
                .delete(VectorDeleteSelector::Generation {
                    collection: collection.collection.clone(),
                    source_id: source_id.clone(),
                    generation: completed.generation.clone(),
                })
                .await
            {
                return Err(err.context(format!(
                    "also failed to rollback committed vector generation {} from collection {}: {rollback_err}",
                    completed.generation.0, collection.collection
                )));
            }
            return Err(err);
        }
    };
    for status in &vectorized.document_statuses {
        ledger
            .update_document_status(publish_document_status(status))
            .await?;
    }
    ledger
        .upsert_source(completed_source_summary(
            input,
            &run,
            manifest.items.len() as u64,
            &diff,
            &vectorized.stats,
        ))
        .await?;
    record_progress(progress, PipelinePhase::Publishing, None).await?;
    record_progress(progress, PipelinePhase::Cleaning, None).await?;

    Ok(LocalSourceIndexOutput {
        job_id: input.job_id,
        source_id,
        generation: published.generation,
        documents_prepared: vectorized.stats.documents_prepared,
        chunks_prepared: vectorized.stats.chunks_prepared,
        vector_points_written: vectorized.stats.points_written,
    })
}

fn completed_source_summary(
    input: &LocalSourceIndexInput,
    run: &LocalAdapterRun,
    item_count: u64,
    diff: &SourceManifestDiff,
    vectorized: &VectorizeStats,
) -> SourceSummary {
    let mut summary = source_summary(input, run);
    summary.status = LifecycleStatus::Completed;
    summary.counts = SourceCounts {
        items_total: item_count,
        items_changed: diff.counts.added + diff.counts.modified + diff.counts.removed,
        documents_total: vectorized.documents_prepared,
        chunks_total: vectorized.chunks_prepared,
        vector_points_total: vectorized.points_written,
        bytes_total: diff
            .added
            .iter()
            .chain(diff.modified.iter())
            .chain(diff.unchanged.iter())
            .map(|item| item.size_bytes.unwrap_or(0))
            .sum(),
    };
    summary.updated_at = timestamp();
    summary
}

async fn complete_generation(
    ledger: &dyn LedgerStore,
    generation: SourceGeneration,
    diff: &SourceManifestDiff,
    discovered_count: u64,
    vectorized: &VectorizeStats,
) -> anyhow::Result<SourceGeneration> {
    let completed = SourceGeneration {
        status: LifecycleStatus::Completed,
        publish_state: PublishState::Publishing,
        published_at: None,
        item_counts: ItemCounts {
            added: diff.counts.added,
            modified: diff.counts.modified,
            removed: diff.counts.removed,
            unchanged: diff.counts.unchanged,
            failed: diff.counts.failed,
        },
        document_counts: DocumentCounts {
            discovered: discovered_count,
            prepared: vectorized.documents_prepared,
            embedded: vectorized.documents_prepared,
            published: vectorized.documents_prepared,
            failed: 0,
        },
        ..generation
    };
    Ok(ledger.complete_generation(completed).await?)
}

async fn publish_completed_generation(
    ledger: &dyn LedgerStore,
    completed: SourceGeneration,
) -> anyhow::Result<SourceGeneration> {
    Ok(ledger
        .publish_generation(PublishGenerationRequest {
            source_id: completed.source_id.clone(),
            generation: completed.generation.clone(),
            expected_previous_generation: completed.previous_generation.clone(),
        })
        .await?)
}

fn manifest_diff_has_changes(diff: &SourceManifestDiff) -> bool {
    diff.counts.added > 0
        || diff.counts.modified > 0
        || diff.counts.removed > 0
        || diff.counts.skipped > 0
        || diff.counts.failed > 0
}

#[cfg(test)]
#[path = "local_source_tests.rs"]
mod tests;
