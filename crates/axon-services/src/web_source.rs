mod vectorize;

use std::path::PathBuf;

use axon_adapters::{SourceAdapter, web::WebSourceAdapter};
use axon_api::source::*;
use axon_embedding::provider::EmbeddingProvider;
use axon_ledger::store::LedgerStore;
use axon_route::{AdapterRegistry, InMemoryAuthorityRegistry, SourceResolver, SourceRouter};
use axon_vectors::store::VectorStore;

use self::vectorize::{collection_spec, published_status, vectorize_changed_documents};

const WEB_LEASE_TTL_SECONDS: u64 = 30 * 60;

#[derive(Debug, Clone)]
pub struct WebSourceIndexInput {
    pub source: String,
    pub scope: SourceScope,
    pub manifest_path: PathBuf,
    pub markdown_root: PathBuf,
    pub collection: String,
    pub owner_id: String,
    pub job_id: JobId,
    pub embedding_provider_id: ProviderId,
    pub vector_provider_id: ProviderId,
    pub embedding_model: String,
    pub embedding_dimensions: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebSourceIndexOutput {
    pub job_id: JobId,
    pub source_id: SourceId,
    pub generation: SourceGenerationId,
    pub documents_prepared: u64,
    pub chunks_prepared: u64,
    pub vector_points_written: u64,
    pub removed_pages: u64,
}

pub async fn index_web_source(
    input: WebSourceIndexInput,
    ledger: &dyn LedgerStore,
    embedding_provider: &dyn EmbeddingProvider,
    vector_store: &dyn VectorStore,
) -> anyhow::Result<WebSourceIndexOutput> {
    let run = resolve_web_run(&input)?;
    let previous_source = ledger.get_source(run.source_id.clone()).await?;
    ledger.upsert_source(source_summary(&input, &run)).await?;
    let lease = ledger
        .acquire_lease(LeaseRequest {
            lease_key: format!("source:{}", run.source_id.0),
            owner_id: input.owner_id.clone(),
            ttl_seconds: WEB_LEASE_TTL_SECONDS,
            job_id: Some(input.job_id),
            metadata: MetadataMap::new(),
        })
        .await?
        .ok_or_else(|| {
            anyhow::anyhow!("web source refresh already running for {}", run.source_id.0)
        })?;
    let result = index_web_source_with_lease(
        &input,
        ledger,
        embedding_provider,
        vector_store,
        previous_source,
        run,
        &lease,
    )
    .await;
    let release = ledger.release_lease(lease.lease_id, input.owner_id).await;
    match (result, release) {
        (Ok(output), Ok(())) => Ok(output),
        (Err(err), Ok(())) => Err(err),
        (Ok(_), Err(err)) => {
            Err(anyhow::Error::new(err).context("failed to release web source lease"))
        }
        (Err(err), Err(release_err)) => Err(err.context(format!(
            "additionally failed to release web source lease: {release_err}"
        ))),
    }
}

async fn index_web_source_with_lease(
    input: &WebSourceIndexInput,
    ledger: &dyn LedgerStore,
    embedding_provider: &dyn EmbeddingProvider,
    vector_store: &dyn VectorStore,
    previous_source: Option<SourceSummary>,
    run: WebAdapterRun,
    lease: &LeaseGuard,
) -> anyhow::Result<WebSourceIndexOutput> {
    let mut manifest = WebSourceAdapter::new().discover(&run.plan).await?;
    let diff = ledger.diff_manifest(manifest.clone()).await?;
    if let Some(output) =
        unchanged_refresh_output(input, ledger, previous_source, &run, &manifest, &diff).await?
    {
        return Ok(output);
    }

    let generation = ledger.create_generation(run.source_id.clone()).await?;
    manifest.generation = generation.generation.clone();
    ledger.put_manifest(manifest.clone()).await?;
    let collection = collection_spec(input);
    vector_store.ensure_collection(collection.clone()).await?;
    let vectorized = vectorize_changed_documents(
        input,
        &run,
        &diff,
        &generation.generation,
        ledger,
        embedding_provider,
        vector_store,
        collection.clone(),
    )
    .await
    .map_err(|err| err.context("failed to vectorize web source generation"))?;
    ensure_lease_before_publish(ledger, input, lease, generation.clone()).await?;
    let completed =
        complete_generation(ledger, generation, &diff, manifest.items.len() as u64).await?;
    let publish_stats =
        mark_generation_committed(vector_store, &collection, &run.source_id, &completed).await?;
    let published = publish_generation(ledger, completed).await?;
    for status in &vectorized.document_statuses {
        ledger
            .update_document_status(published_status(status))
            .await?;
    }
    ledger
        .upsert_source(completed_source_summary(
            input,
            &run,
            manifest.items.len() as u64,
            &diff,
            publish_stats.points_written,
        ))
        .await?;

    Ok(WebSourceIndexOutput {
        job_id: input.job_id,
        source_id: run.source_id,
        generation: published.generation,
        documents_prepared: vectorized.documents_prepared,
        chunks_prepared: vectorized.chunks_prepared,
        vector_points_written: publish_stats.points_written,
        removed_pages: diff.counts.removed,
    })
}

#[derive(Debug, Clone)]
struct WebAdapterRun {
    source_id: SourceId,
    canonical_uri: String,
    adapter: AdapterRef,
    scope: SourceScope,
    plan: SourcePlan,
}

fn resolve_web_run(input: &WebSourceIndexInput) -> anyhow::Result<WebAdapterRun> {
    let mut request = SourceRequest::new(input.source.clone());
    request.scope = Some(input.scope);
    request.adapter = Some("web".to_string());
    request.options.values.insert(
        "manifest_path".to_string(),
        input.manifest_path.display().to_string().into(),
    );
    request.options.values.insert(
        "markdown_root".to_string(),
        input.markdown_root.display().to_string().into(),
    );
    let registry = AdapterRegistry::target_defaults();
    let resolver = SourceResolver::new(InMemoryAuthorityRegistry::default(), registry.clone());
    let resolved = resolver.resolve(&request)?;
    let route = SourceRouter::new(registry).route(&request, resolved)?;
    let source_id = route.source.source_id.clone();
    let canonical_uri = route.source.canonical_uri.clone();
    let adapter = route.adapter.clone();
    let scope = route.scope;
    Ok(WebAdapterRun {
        source_id,
        canonical_uri,
        adapter,
        scope,
        plan: source_plan(input, request, route),
    })
}

fn source_plan(
    input: &WebSourceIndexInput,
    request: SourceRequest,
    route: RoutePlan,
) -> SourcePlan {
    SourcePlan {
        job_id: input.job_id,
        request,
        route,
        stage_plan: Vec::new(),
        limits: EffectiveLimits {
            request: SourceLimits::default(),
            adapter_defaults: SourceLimits::default(),
            config_defaults: SourceLimits::default(),
            effective: SourceLimits::default(),
        },
        config_snapshot_id: ConfigSnapshotId::new("cfg_web_source"),
        provider_reservations: Vec::new(),
    }
}

#[derive(Debug, Clone, Copy)]
struct PublishStats {
    points_written: u64,
}

async fn unchanged_refresh_output(
    input: &WebSourceIndexInput,
    ledger: &dyn LedgerStore,
    previous_source: Option<SourceSummary>,
    run: &WebAdapterRun,
    manifest: &SourceManifest,
    diff: &SourceManifestDiff,
) -> anyhow::Result<Option<WebSourceIndexOutput>> {
    if manifest_diff_has_changes(diff) {
        return Ok(None);
    }
    let Some(committed_generation) = diff.previous_generation.clone() else {
        return Ok(None);
    };
    ledger
        .upsert_source(unchanged_source_summary(
            input,
            run,
            previous_source,
            manifest.items.len() as u64,
        ))
        .await?;
    Ok(Some(WebSourceIndexOutput {
        job_id: input.job_id,
        source_id: run.source_id.clone(),
        generation: committed_generation,
        documents_prepared: 0,
        chunks_prepared: 0,
        vector_points_written: 0,
        removed_pages: 0,
    }))
}

fn manifest_diff_has_changes(diff: &SourceManifestDiff) -> bool {
    diff.counts.added > 0
        || diff.counts.modified > 0
        || diff.counts.removed > 0
        || diff.counts.skipped > 0
        || diff.counts.failed > 0
}

async fn ensure_lease_before_publish(
    ledger: &dyn LedgerStore,
    input: &WebSourceIndexInput,
    lease: &LeaseGuard,
    generation: SourceGeneration,
) -> anyhow::Result<()> {
    if ledger
        .heartbeat_lease(
            lease.lease_id.clone(),
            input.owner_id.clone(),
            WEB_LEASE_TTL_SECONDS,
        )
        .await?
        .is_some()
    {
        return Ok(());
    }
    let _ = ledger.fail_generation(generation).await;
    Err(anyhow::anyhow!(
        "web source refresh lost lease before publish"
    ))
}

async fn complete_generation(
    ledger: &dyn LedgerStore,
    generation: SourceGeneration,
    diff: &SourceManifestDiff,
    discovered_count: u64,
) -> anyhow::Result<SourceGeneration> {
    Ok(ledger
        .complete_generation(SourceGeneration {
            status: LifecycleStatus::Completed,
            publish_state: PublishState::Publishing,
            item_counts: ItemCounts {
                added: diff.counts.added,
                modified: diff.counts.modified,
                removed: diff.counts.removed,
                unchanged: diff.counts.unchanged,
                failed: diff.counts.failed,
            },
            document_counts: DocumentCounts {
                discovered: discovered_count,
                prepared: discovered_count,
                embedded: discovered_count,
                published: discovered_count,
                failed: 0,
            },
            ..generation
        })
        .await?)
}

async fn mark_generation_committed(
    vector_store: &dyn VectorStore,
    collection: &CollectionSpec,
    source_id: &SourceId,
    generation: &SourceGeneration,
) -> anyhow::Result<PublishStats> {
    let write = vector_store
        .mark_generation_committed(
            collection.collection.clone(),
            source_id.clone(),
            generation.generation.clone(),
        )
        .await?;
    Ok(PublishStats {
        points_written: write.points_written,
    })
}

async fn publish_generation(
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

fn source_summary(input: &WebSourceIndexInput, run: &WebAdapterRun) -> SourceSummary {
    SourceSummary {
        source_id: run.source_id.clone(),
        canonical_uri: run.canonical_uri.clone(),
        display_name: run.canonical_uri.clone(),
        source_kind: SourceKind::Web,
        adapter: run.adapter.clone(),
        authority: AuthorityLevel::Inferred,
        status: LifecycleStatus::Running,
        counts: SourceCounts {
            items_total: 0,
            items_changed: 0,
            documents_total: 0,
            chunks_total: 0,
            vector_points_total: 0,
            bytes_total: 0,
        },
        created_at: timestamp(),
        updated_at: timestamp(),
        tags: vec![format!("{:?}", run.scope).to_ascii_lowercase()],
        watch_id: None,
        last_job_id: Some(input.job_id),
    }
}

fn completed_source_summary(
    input: &WebSourceIndexInput,
    run: &WebAdapterRun,
    item_count: u64,
    diff: &SourceManifestDiff,
    points_written: u64,
) -> SourceSummary {
    let mut summary = source_summary(input, run);
    summary.status = LifecycleStatus::Completed;
    summary.counts = SourceCounts {
        items_total: item_count,
        items_changed: diff.counts.added + diff.counts.modified + diff.counts.removed,
        documents_total: item_count,
        chunks_total: points_written,
        vector_points_total: points_written,
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

fn unchanged_source_summary(
    input: &WebSourceIndexInput,
    run: &WebAdapterRun,
    previous: Option<SourceSummary>,
    item_count: u64,
) -> SourceSummary {
    if let Some(mut summary) = previous {
        summary.status = LifecycleStatus::Completed;
        summary.counts.items_total = item_count;
        summary.counts.items_changed = 0;
        summary.updated_at = timestamp();
        return summary;
    }
    let mut summary = source_summary(input, run);
    summary.status = LifecycleStatus::Completed;
    summary.counts.items_total = item_count;
    summary.updated_at = timestamp();
    summary
}

fn timestamp() -> Timestamp {
    Timestamp(chrono::Utc::now().to_rfc3339())
}

#[cfg(test)]
#[path = "web_source_tests.rs"]
mod tests;
