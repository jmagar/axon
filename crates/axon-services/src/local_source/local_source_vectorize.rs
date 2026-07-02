use axon_api::source::*;
use axon_document::{DocumentPreparer, PrepareSourceDocumentRequest};
use axon_embedding::batch::EmbeddingBatchBuilder;
use axon_embedding::provider::EmbeddingProvider;
use axon_ledger::store::LedgerStore;
use axon_vectors::point::{VectorPointBatchBuildContext, VectorPointBatchBuilder};
use axon_vectors::store::VectorStore;
use uuid::Uuid;

use super::LocalSourceIndexInput;
use super::local_source_adapter::{
    LocalAdapterRun, normalize_changed_documents, stable_token, timestamp,
};
use super::local_source_progress::{LocalSourceProgress, record_progress, record_progress_error};

const LOCAL_CHANGED_DOCUMENT_BATCH_SIZE: usize = 64;

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct VectorizeStats {
    pub(super) documents_prepared: u64,
    pub(super) chunks_prepared: u64,
    pub(super) points_written: u64,
}

impl VectorizeStats {
    fn add(&mut self, other: VectorizeStats) {
        self.documents_prepared += other.documents_prepared;
        self.chunks_prepared += other.chunks_prepared;
        self.points_written += other.points_written;
    }
}

pub(super) async fn cleanup_replaced_vector_points(
    vector_store: &dyn VectorStore,
    collection: &str,
    diff: &SourceManifestDiff,
) -> Result<u64, ApiError> {
    let Some(previous_generation) = diff.previous_generation.clone() else {
        return Ok(0);
    };
    let mut deleted = 0;
    for chunk in diff
        .removed
        .iter()
        .chain(diff.modified.iter())
        .collect::<Vec<_>>()
        .chunks(LOCAL_CHANGED_DOCUMENT_BATCH_SIZE)
    {
        if chunk.is_empty() {
            continue;
        }
        let document_ids = chunk
            .iter()
            .map(|item| local_document_id(&diff.source_id, &item.source_item_key).0)
            .collect::<Vec<_>>();
        let result = vector_store
            .delete(VectorDeleteSelector::Filter {
                collection: collection.to_string(),
                filter: serde_json::json!({
                    "source_generation": previous_generation.0,
                    "document_id": document_ids,
                }),
            })
            .await?;
        deleted += result.points_deleted;
    }
    Ok(deleted)
}

pub(super) async fn vectorize_changed_documents(
    input: &LocalSourceIndexInput,
    run: &LocalAdapterRun,
    diff: &SourceManifestDiff,
    generation: &SourceGenerationId,
    ledger: &dyn LedgerStore,
    embedding_provider: &dyn EmbeddingProvider,
    vector_store: &dyn VectorStore,
    progress: Option<&dyn LocalSourceProgress>,
    collection: CollectionSpec,
) -> anyhow::Result<VectorizeStats> {
    let mut stats = VectorizeStats::default();
    for batch_diff in changed_diff_batches(diff, LOCAL_CHANGED_DOCUMENT_BATCH_SIZE) {
        let documents = prepare_changed_documents(run, &batch_diff, generation).await?;
        let batch_stats = vectorize_documents(
            input,
            ledger,
            embedding_provider,
            vector_store,
            progress,
            collection.clone(),
            documents,
        )
        .await?;
        stats.add(batch_stats);
    }
    Ok(stats)
}

async fn prepare_changed_documents(
    run: &LocalAdapterRun,
    diff: &SourceManifestDiff,
    generation: &SourceGenerationId,
) -> anyhow::Result<Vec<PreparedDocument>> {
    let source_documents = normalize_changed_documents(run, diff).await?;
    let mut documents = Vec::with_capacity(source_documents.len());
    let preparer = DocumentPreparer::default();
    for document in source_documents {
        let item_key = document.source_item_key.0.clone();
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
            .map_err(|err| anyhow::anyhow!("failed to prepare {item_key}: {err}"))?
            .document;
        documents.push(prepared);
    }
    Ok(documents)
}

fn changed_diff_batches(diff: &SourceManifestDiff, batch_size: usize) -> Vec<SourceManifestDiff> {
    let changed = diff
        .added
        .iter()
        .chain(diff.modified.iter())
        .cloned()
        .collect::<Vec<_>>();
    changed
        .chunks(batch_size.max(1))
        .map(|chunk| SourceManifestDiff {
            header: diff.header.clone(),
            source_id: diff.source_id.clone(),
            previous_generation: diff.previous_generation.clone(),
            next_generation: diff.next_generation.clone(),
            added: chunk.to_vec(),
            modified: Vec::new(),
            removed: Vec::new(),
            unchanged: Vec::new(),
            skipped: Vec::new(),
            failed: Vec::new(),
            counts: DiffCounts {
                added: chunk.len() as u64,
                modified: 0,
                removed: 0,
                unchanged: 0,
                skipped: 0,
                failed: 0,
            },
        })
        .collect()
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
    if documents.is_empty() {
        return Ok(stats);
    }
    let batch = embedding_batch_for_documents(input, &documents)?;
    let embeddings = match embedding_provider.embed(batch).await {
        Ok(embeddings) => embeddings,
        Err(err) => {
            record_progress_error(progress, PipelinePhase::Embedding, &err).await?;
            return Err(anyhow::Error::new(err));
        }
    };
    record_progress(progress, PipelinePhase::Embedding, None).await?;
    let point_batch = vector_point_batch_for_documents(collection, &documents, &embeddings)?;
    let write = match vector_store.upsert(point_batch).await {
        Ok(write) => write,
        Err(err) => {
            record_progress_error(progress, PipelinePhase::Vectorizing, &err).await?;
            return Err(anyhow::Error::new(err));
        }
    };
    record_progress(progress, PipelinePhase::Vectorizing, None).await?;
    stats.points_written += write.points_written;
    for document in documents {
        stats.chunks_prepared += document.chunks.len() as u64;
        stats.documents_prepared += 1;
        ledger
            .update_document_status(document_status(&document, document.chunks.len() as u64))
            .await?;
    }
    Ok(stats)
}

fn embedding_batch_for_documents(
    input: &LocalSourceIndexInput,
    documents: &[PreparedDocument],
) -> anyhow::Result<EmbeddingBatch> {
    let batch_id = BatchId::new(Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        documents
            .iter()
            .map(|document| document.document_id.0.as_str())
            .collect::<Vec<_>>()
            .join(":")
            .as_bytes(),
    ));
    let mut builder = EmbeddingBatchBuilder::new(
        batch_id,
        input.job_id,
        input.embedding_provider_id.clone(),
        input.embedding_model.clone(),
    )
    .priority(JobPriority::Background);
    for document in documents {
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
    }
    Ok(builder.build()?)
}

fn vector_point_batch_for_documents(
    collection: CollectionSpec,
    documents: &[PreparedDocument],
    embeddings: &EmbeddingResult,
) -> anyhow::Result<VectorPointBatch> {
    let mut points = Vec::new();
    for document in documents {
        let document_embeddings = embedding_result_for_document(embeddings, document);
        let batch = VectorPointBatchBuilder::new(
            collection.clone(),
            document.clone(),
            document_embeddings,
            VectorPointBatchBuildContext {
                embedded_at: timestamp(),
            },
        )
        .build()?;
        points.extend(batch.points);
    }
    Ok(VectorPointBatch {
        batch_id: embeddings.batch_id.clone(),
        collection: collection.collection,
        points,
        model: embeddings.model.clone(),
        dimensions: embeddings.dimensions,
        sparse_vectors: None,
        payload_indexes: collection.payload_indexes,
    })
}

fn embedding_result_for_document(
    embeddings: &EmbeddingResult,
    document: &PreparedDocument,
) -> EmbeddingResult {
    let chunk_ids = document
        .chunks
        .iter()
        .map(|chunk| chunk.chunk_id.clone())
        .collect::<std::collections::BTreeSet<_>>();
    EmbeddingResult {
        batch_id: embeddings.batch_id.clone(),
        job_id: embeddings.job_id,
        provider_id: embeddings.provider_id.clone(),
        model: embeddings.model.clone(),
        dimensions: embeddings.dimensions,
        vectors: embeddings
            .vectors
            .iter()
            .filter(|vector| chunk_ids.contains(&vector.chunk_id))
            .cloned()
            .collect(),
        usage: embeddings.usage.clone(),
        warnings: embeddings.warnings.clone(),
    }
}

fn local_document_id(source_id: &SourceId, item_key: &SourceItemKey) -> DocumentId {
    DocumentId::from(format!(
        "doc_local_{}",
        stable_token(&format!("{}\0{}", source_id.0, item_key.0))
    ))
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
