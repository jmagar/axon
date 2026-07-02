mod local_source_discovery;
mod local_source_job;
mod local_source_progress;

use std::path::PathBuf;

use anyhow::Context;
use axon_api::source::*;
use axon_document::{DocumentPreparer, PrepareSourceDocumentRequest};
use axon_embedding::batch::EmbeddingBatchBuilder;
use axon_embedding::provider::EmbeddingProvider;
use axon_ledger::store::LedgerStore;
use axon_vectors::point::{VectorPointBatchBuildContext, VectorPointBatchBuilder};
use axon_vectors::store::VectorStore;
use serde_json::json;
use uuid::Uuid;

use self::local_source_discovery::{
    LocalItem, collection_spec, discover_items, local_adapter_ref, local_source_id, source_summary,
    source_token, stable_token, timestamp,
};
pub use self::local_source_job::index_local_source_with_job;
use self::local_source_progress::{
    LocalSourceProgress, ensure_providers_ready, record_progress, record_progress_error,
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
    pub embedding_model: String,
    pub embedding_dimensions: u32,
    pub selection_policy: LocalSourceSelectionPolicy,
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
    let root = tokio::fs::canonicalize(&input.root)
        .await
        .with_context(|| format!("invalid local source root {}", input.root.display()))?;
    let root_is_file = tokio::fs::metadata(&root)
        .await
        .with_context(|| format!("failed to stat local source root {}", root.display()))?
        .is_file();
    let source_id = local_source_id(&root);
    let source_token = source_token(&root);
    let adapter = local_adapter_ref();
    let scope = if root_is_file {
        SourceScope::File
    } else {
        SourceScope::Directory
    };

    ledger
        .upsert_source(source_summary(&input, &source_id, &source_token, scope))
        .await?;
    let lease = ledger
        .acquire_lease(LeaseRequest {
            lease_key: format!("source:{}", source_id.0),
            owner_id: input.owner_id.clone(),
            ttl_seconds: LOCAL_LEASE_TTL_SECONDS,
            job_id: Some(input.job_id),
            metadata: MetadataMap::new(),
        })
        .await?
        .ok_or_else(|| {
            anyhow::anyhow!("local source refresh already running for {}", source_id.0)
        })?;

    let result = index_local_source_with_lease(
        &input,
        ledger,
        embedding_provider,
        vector_store,
        progress,
        &root,
        root_is_file,
        source_id.clone(),
        source_token,
        adapter,
        scope,
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

#[allow(clippy::too_many_arguments)]
async fn index_local_source_with_lease(
    input: &LocalSourceIndexInput,
    ledger: &dyn LedgerStore,
    embedding_provider: &dyn EmbeddingProvider,
    vector_store: &dyn VectorStore,
    progress: Option<&dyn LocalSourceProgress>,
    root: &std::path::Path,
    root_is_file: bool,
    source_id: SourceId,
    source_token: String,
    adapter: AdapterRef,
    scope: SourceScope,
) -> anyhow::Result<LocalSourceIndexOutput> {
    let items = discover_items(
        root,
        root_is_file,
        &source_id,
        &source_token,
        input.selection_policy,
    )
    .await?;
    record_progress(progress, PipelinePhase::Discovering, None).await?;
    let diff_manifest = source_manifest(
        source_id.clone(),
        SourceGenerationId::new("diff_probe"),
        adapter.clone(),
        scope,
        &items,
    );
    let diff = ledger.diff_manifest(diff_manifest).await?;
    record_progress(progress, PipelinePhase::Diffing, None).await?;
    if !manifest_diff_has_changes(&diff)
        && let Some(committed_generation) = diff.previous_generation
    {
        return Ok(LocalSourceIndexOutput {
            job_id: input.job_id,
            source_id,
            generation: committed_generation,
            documents_prepared: 0,
            chunks_prepared: 0,
            vector_points_written: 0,
        });
    }

    ensure_providers_ready(embedding_provider, vector_store).await?;
    let generation = ledger.create_generation(source_id.clone()).await?;
    let manifest = source_manifest(
        source_id.clone(),
        generation.generation.clone(),
        adapter,
        scope,
        &items,
    );
    ledger.put_manifest(manifest).await?;

    let documents = prepare_changed_documents(&items, &diff, &generation.generation, scope)?;
    record_progress(progress, PipelinePhase::Preparing, None).await?;
    let collection = collection_spec(&input.collection, input.embedding_dimensions);
    vector_store.ensure_collection(collection.clone()).await?;
    let vectorized = vectorize_documents(
        input,
        ledger,
        embedding_provider,
        vector_store,
        progress,
        collection.clone(),
        documents,
    )
    .await?;
    let published =
        publish_generation(ledger, generation, &diff, items.len() as u64, &vectorized).await?;
    if let Err(err) = vector_store
        .mark_generation_committed(
            collection.collection.clone(),
            source_id.clone(),
            published.generation.clone(),
        )
        .await
    {
        record_progress_error(progress, PipelinePhase::Publishing, &err).await?;
        return Err(anyhow::Error::new(err));
    }
    record_progress(progress, PipelinePhase::Publishing, None).await?;
    record_progress(progress, PipelinePhase::Cleaning, None).await?;

    Ok(LocalSourceIndexOutput {
        job_id: input.job_id,
        source_id,
        generation: published.generation,
        documents_prepared: vectorized.documents_prepared,
        chunks_prepared: vectorized.chunks_prepared,
        vector_points_written: vectorized.points_written,
    })
}

fn prepare_changed_documents(
    items: &[LocalItem],
    diff: &SourceManifestDiff,
    generation: &SourceGenerationId,
    scope: SourceScope,
) -> anyhow::Result<Vec<PreparedDocument>> {
    let changed = diff
        .added
        .iter()
        .chain(diff.modified.iter())
        .filter_map(|manifest_item| {
            items
                .iter()
                .find(|item| item.manifest_item.source_item_key == manifest_item.source_item_key)
        })
        .collect::<Vec<_>>();

    let mut documents = Vec::with_capacity(changed.len());
    let preparer = DocumentPreparer::default();
    for item in changed {
        let document = source_document_for_item(item, scope)?;
        let prepared = preparer
            .prepare(PrepareSourceDocumentRequest {
                document,
                generation: generation.clone(),
                profile: None,
                parse_facts: Vec::new(),
                graph_candidates: Vec::new(),
                warnings: Vec::new(),
                errors: Vec::new(),
            })
            .map_err(|err| anyhow::anyhow!("failed to prepare {}: {err}", item.item_key))?
            .document;
        documents.push(prepared);
    }
    Ok(documents)
}

#[derive(Debug, Clone, Copy, Default)]
struct VectorizeStats {
    documents_prepared: u64,
    chunks_prepared: u64,
    points_written: u64,
}

async fn vectorize_documents(
    input: &LocalSourceIndexInput,
    ledger: &dyn LedgerStore,
    embedding_provider: &dyn EmbeddingProvider,
    vector_store: &dyn VectorStore,
    progress: Option<&dyn LocalSourceProgress>,
    collection: CollectionSpec,
    documents: Vec<PreparedDocument>,
) -> anyhow::Result<VectorizeStats> {
    let mut stats = VectorizeStats::default();
    for document in documents {
        let batch = embedding_batch_for_document(input, &document)?;
        let embeddings = match embedding_provider.embed(batch).await {
            Ok(embeddings) => embeddings,
            Err(err) => {
                record_progress_error(progress, PipelinePhase::Embedding, &err).await?;
                return Err(anyhow::Error::new(err));
            }
        };
        record_progress(progress, PipelinePhase::Embedding, None).await?;
        let point_batch = VectorPointBatchBuilder::new(
            collection.clone(),
            document.clone(),
            embeddings,
            VectorPointBatchBuildContext {
                embedded_at: timestamp(),
            },
        )
        .build()?;
        let write = match vector_store.upsert(point_batch).await {
            Ok(write) => write,
            Err(err) => {
                record_progress_error(progress, PipelinePhase::Vectorizing, &err).await?;
                return Err(anyhow::Error::new(err));
            }
        };
        record_progress(progress, PipelinePhase::Vectorizing, None).await?;
        stats.points_written += write.points_written;
        stats.chunks_prepared += document.chunks.len() as u64;
        stats.documents_prepared += 1;
        ledger
            .update_document_status(document_status(&document, write.points_written))
            .await?;
    }
    Ok(stats)
}

async fn publish_generation(
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
    let completed = ledger.complete_generation(completed).await?;
    Ok(ledger
        .publish_generation(PublishGenerationRequest {
            source_id: completed.source_id.clone(),
            generation: completed.generation.clone(),
            expected_previous_generation: completed.previous_generation.clone(),
        })
        .await?)
}

fn source_manifest(
    source_id: SourceId,
    generation: SourceGenerationId,
    adapter: AdapterRef,
    scope: SourceScope,
    items: &[LocalItem],
) -> SourceManifest {
    SourceManifest {
        source_id: source_id.clone(),
        generation,
        adapter,
        scope,
        items: items
            .iter()
            .map(|item| item.manifest_item.clone())
            .collect(),
        created_at: timestamp(),
        metadata: MetadataMap::new(),
    }
}

fn manifest_diff_has_changes(diff: &SourceManifestDiff) -> bool {
    diff.counts.added > 0
        || diff.counts.modified > 0
        || diff.counts.removed > 0
        || diff.counts.skipped > 0
        || diff.counts.failed > 0
}

fn source_document_for_item(
    item: &LocalItem,
    scope: SourceScope,
) -> anyhow::Result<SourceDocument> {
    let document_id = DocumentId::new(format!("doc_{}", stable_token(&item.canonical_uri)));
    let mut metadata = MetadataMap::new();
    metadata.insert("source_family".to_string(), json!("code"));
    metadata.insert("source_kind".to_string(), json!("local"));
    metadata.insert("source_adapter".to_string(), json!("local"));
    metadata.insert("source_scope".to_string(), json!(scope));
    metadata.insert(
        "item_canonical_uri".to_string(),
        json!(item.canonical_uri.clone()),
    );
    metadata.insert("committed_generation".to_string(), json!("uncommitted"));
    metadata.insert("visibility".to_string(), json!("internal"));
    metadata.insert("redaction_status".to_string(), json!("clean"));
    if let Some(language) = &item.language {
        metadata.insert("code_language".to_string(), json!(language));
    }
    Ok(SourceDocument {
        document_id,
        source_id: item.manifest_item.source_id.clone(),
        source_item_key: item.manifest_item.source_item_key.clone(),
        canonical_uri: item.canonical_uri.clone(),
        content_kind: item.content_kind,
        content: ContentRef::InlineText {
            text: item.content.clone(),
        },
        metadata,
        title: Some(item.item_key.clone()),
        language: item.language.clone(),
        path: Some(item.item_key.clone()),
        mime_type: None,
        structured_payload: None,
        artifact_id: None,
        chunk_hints: Vec::new(),
        parser_hints: Vec::new(),
    })
}

fn embedding_batch_for_document(
    input: &LocalSourceIndexInput,
    document: &PreparedDocument,
) -> anyhow::Result<EmbeddingBatch> {
    let batch_id = BatchId::new(Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!(
            "{}:{}:{}",
            document.source_id.0, document.generation.0, document.document_id.0
        )
        .as_bytes(),
    ));
    let mut builder = EmbeddingBatchBuilder::new(
        batch_id,
        input.job_id,
        input.embedding_provider_id.clone(),
        input.embedding_model.clone(),
    )
    .priority(JobPriority::Background);
    for chunk in &document.chunks {
        builder = builder.push_input(EmbeddingInput {
            chunk_id: chunk.chunk_id.clone(),
            text: chunk
                .embedding_text
                .clone()
                .unwrap_or_else(|| chunk.content.clone()),
            content_kind: chunk.content_kind,
            metadata: chunk.metadata.clone(),
        });
    }
    Ok(builder.build()?)
}

fn document_status(document: &PreparedDocument, points_written: u64) -> DocumentStatus {
    DocumentStatus {
        document_id: document.document_id.clone(),
        source_id: document.source_id.clone(),
        source_item_key: document.source_item_key.clone(),
        generation: document.generation.clone(),
        status: DocumentLifecycleStatus::Published,
        updated_at: timestamp(),
        chunk_count: document.chunks.len() as u32,
        vector_point_count: u32::try_from(points_written).unwrap_or(u32::MAX),
        error: None,
        cleanup_status: None,
    }
}

#[cfg(test)]
#[path = "local_source_tests.rs"]
mod tests;
