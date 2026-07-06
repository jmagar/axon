//! Vector-backed memory recall boundary.
//!
//! SQLite remains the metadata source of truth. This wrapper adds the contract
//! memory vector namespace on top of any [`MemoryStore`], preserving vector
//! result order by batch-loading SQLite records with `load_many`.

use std::sync::Arc;

use async_trait::async_trait;
use axon_api::source::*;
use axon_embedding::provider::EmbeddingProvider;
use axon_vectors::payload::VECTOR_PAYLOAD_CONTRACT_VERSION;
use axon_vectors::store::VectorStore;
use serde_json::json;
use uuid::Uuid;

use crate::store::{MemoryStore, Result};

pub const MEMORY_VECTOR_NAMESPACE: &str = "memory";
pub const MEMORY_COLLECTION_ALIAS: &str = "memory";

#[derive(Clone)]
pub struct MemoryVectorConfig {
    pub collection: String,
    pub embedding_provider_id: ProviderId,
    pub embedding_model: String,
    pub embedding_dimensions: u32,
}

pub struct VectorBackedMemoryStore {
    inner: Arc<dyn MemoryStore>,
    embeddings: Arc<dyn EmbeddingProvider>,
    vectors: Arc<dyn VectorStore>,
    config: MemoryVectorConfig,
}

impl VectorBackedMemoryStore {
    pub fn new(
        inner: Arc<dyn MemoryStore>,
        embeddings: Arc<dyn EmbeddingProvider>,
        vectors: Arc<dyn VectorStore>,
        config: MemoryVectorConfig,
    ) -> Self {
        Self {
            inner,
            embeddings,
            vectors,
            config,
        }
    }

    async fn ensure_collection(&self) -> Result<()> {
        self.vectors
            .ensure_collection(memory_collection_spec(&self.config))
            .await
    }

    async fn upsert_record(&self, record: &MemoryRecord) -> Result<Vec<VectorPointId>> {
        self.ensure_collection().await?;
        let chunk_id = ChunkId::new(format!("memory:{}", record.memory_id.0));
        let batch_id = BatchId::new(Uuid::new_v4());
        let job_id = JobId::new(Uuid::new_v4());
        let embedding = self
            .embeddings
            .embed(EmbeddingBatch {
                batch_id,
                job_id,
                provider_id: self.config.embedding_provider_id.clone(),
                model: self.config.embedding_model.clone(),
                items: vec![EmbeddingInput {
                    chunk_id: chunk_id.clone(),
                    text: record.body.clone(),
                    content_kind: ContentKind::PlainText,
                    metadata: MetadataMap::new(),
                }],
                instruction: None,
                priority: JobPriority::Normal,
                metadata: MetadataMap::new(),
            })
            .await?;
        let vector = embedding
            .vectors
            .iter()
            .find(|vector| vector.chunk_id == chunk_id)
            .cloned()
            .ok_or_else(|| {
                ApiError::new(
                    "memory.embedding_missing",
                    axon_error::ErrorStage::Embedding,
                    format!(
                        "embedding provider did not return memory {}",
                        record.memory_id.0
                    ),
                )
            })?;
        let point_id = VectorPointId::new(format!("memory:{}", record.memory_id.0));
        let payload = memory_payload(record, &point_id, &embedding, &self.config.collection);
        self.vectors
            .upsert(VectorPointBatch {
                batch_id: embedding.batch_id,
                collection: self.config.collection.clone(),
                points: vec![VectorPoint {
                    point_id: point_id.clone(),
                    chunk_id,
                    vector: vector.values,
                    sparse_vector: None,
                    payload,
                }],
                model: embedding.model,
                dimensions: embedding.dimensions,
                sparse_vectors: None,
                payload_indexes: memory_payload_indexes(),
            })
            .await?;
        Ok(vec![point_id])
    }

    async fn search_vectors(&self, request: &MemorySearchRequest) -> Result<MemorySearchResult> {
        self.ensure_collection().await?;
        let query_chunk = ChunkId::new("memory-query");
        let embedding = self
            .embeddings
            .embed(EmbeddingBatch {
                batch_id: BatchId::new(Uuid::new_v4()),
                job_id: JobId::new(Uuid::new_v4()),
                provider_id: self.config.embedding_provider_id.clone(),
                model: self.config.embedding_model.clone(),
                items: vec![EmbeddingInput {
                    chunk_id: query_chunk.clone(),
                    text: request.query.clone(),
                    content_kind: ContentKind::PlainText,
                    metadata: MetadataMap::new(),
                }],
                instruction: None,
                priority: JobPriority::Interactive,
                metadata: MetadataMap::new(),
            })
            .await?;
        let dense_vector = embedding
            .vectors
            .into_iter()
            .find(|vector| vector.chunk_id == query_chunk)
            .map(|vector| vector.values)
            .ok_or_else(|| {
                ApiError::new(
                    "memory.query_embedding_missing",
                    axon_error::ErrorStage::Retrieving,
                    "embedding provider did not return a memory query vector",
                )
            })?;
        let mut filters = request.filters.clone();
        filters.insert(
            "vector_namespace".to_string(),
            json!(MEMORY_VECTOR_NAMESPACE),
        );
        filters.insert("memory_status".to_string(), json!("active"));
        if !request.include_archived {
            filters.insert("memory_recallable".to_string(), json!(true));
        }
        let search = self
            .vectors
            .search(VectorSearchRequest {
                collection: self.config.collection.clone(),
                query: request.query.clone(),
                limit: request.limit,
                dense_vector: Some(dense_vector),
                sparse_vector: None,
                filters,
                hybrid: Some(false),
                generation: None,
                graph_refs: Vec::new(),
                metadata: MetadataMap::new(),
            })
            .await?;
        let memory_ids = search
            .results
            .iter()
            .filter_map(|hit| {
                hit.payload
                    .get("memory_id")
                    .and_then(serde_json::Value::as_str)
                    .map(MemoryId::new)
            })
            .collect::<Vec<_>>();
        let records = self.inner.load_many(memory_ids).await?;
        let mut warnings = search.warnings;
        let mut results = Vec::new();
        for (hit, record) in search.results.into_iter().zip(records.into_iter()) {
            let Some(record) = record else {
                warnings.push(SourceWarning {
                    code: "memory.metadata_missing".to_string(),
                    severity: Severity::Warning,
                    message: "memory vector hit had no SQLite metadata row".to_string(),
                    source_item_key: None,
                    retryable: true,
                });
                continue;
            };
            if !request.include_archived && record.status != MemoryStatus::Active {
                continue;
            }
            results.push(MemorySearchMatch {
                record,
                score: hit.score as f32,
            });
        }
        Ok(MemorySearchResult {
            results,
            query_embedding_model: Some(self.config.embedding_model.clone()),
            graph: None,
            warnings,
        })
    }

    async fn hide_vectors(&self, memory_id: &MemoryId) -> Result<()> {
        self.vectors
            .delete(VectorDeleteSelector::Filter {
                collection: self.config.collection.clone(),
                filter: json!({
                    "vector_namespace": MEMORY_VECTOR_NAMESPACE,
                    "memory_id": memory_id.0,
                }),
            })
            .await?;
        Ok(())
    }
}

#[async_trait]
impl MemoryStore for VectorBackedMemoryStore {
    async fn remember(&self, request: MemoryRequest) -> Result<MemoryResult> {
        let should_embed = request.embed;
        let mut result = self.inner.remember(request).await?;
        if should_embed {
            let record = self
                .inner
                .get(result.memory_id.clone())
                .await?
                .ok_or_else(|| missing_memory(&result.memory_id))?;
            result.vector_point_ids = self.upsert_record(&record).await?;
        }
        Ok(result)
    }

    async fn get(&self, memory_id: MemoryId) -> Result<Option<MemoryRecord>> {
        self.inner.get(memory_id).await
    }

    async fn load_many(&self, memory_ids: Vec<MemoryId>) -> Result<Vec<Option<MemoryRecord>>> {
        self.inner.load_many(memory_ids).await
    }

    async fn search(&self, request: MemorySearchRequest) -> Result<MemorySearchResult> {
        if request.query.trim().is_empty() {
            return self.inner.search(request).await;
        }
        self.search_vectors(&request).await
    }

    async fn context(&self, request: MemoryContextRequest) -> Result<MemoryContextResult> {
        self.inner.context(request).await
    }

    async fn link(&self, request: MemoryLinkRequest) -> Result<MemoryResult> {
        self.inner.link(request).await
    }

    async fn reinforce(
        &self,
        memory_id: MemoryId,
        signal: MemoryReinforcement,
    ) -> Result<MemoryResult> {
        self.inner.reinforce(memory_id, signal).await
    }

    async fn supersede(&self, request: MemorySupersedeRequest) -> Result<MemoryResult> {
        let result = self.inner.supersede(request.clone()).await?;
        self.hide_vectors(&request.memory_id).await?;
        Ok(result)
    }

    async fn contradict(&self, request: MemoryContradictRequest) -> Result<MemoryResult> {
        self.inner.contradict(request).await
    }

    async fn set_status(&self, request: MemoryStatusRequest) -> Result<MemoryResult> {
        let result = self.inner.set_status(request.clone()).await?;
        if matches!(
            request.status,
            MemoryStatus::Forgotten | MemoryStatus::Archived | MemoryStatus::Superseded
        ) {
            self.hide_vectors(&request.memory_id).await?;
        }
        Ok(result)
    }

    async fn review(&self, request: MemoryReviewRequest) -> Result<MemoryReviewResult> {
        self.inner.review(request).await
    }

    async fn reset(&self) -> Result<()> {
        self.inner.reset().await
    }

    async fn capabilities(&self) -> Result<MemoryStoreCapability> {
        let mut capability = self.inner.capabilities().await?;
        capability.0.features.push("vector_recall".to_string());
        capability.0.limits.insert(
            "vector_namespace".to_string(),
            json!(MEMORY_VECTOR_NAMESPACE),
        );
        Ok(capability)
    }
}

fn memory_collection_spec(config: &MemoryVectorConfig) -> CollectionSpec {
    CollectionSpec {
        collection: config.collection.clone(),
        dense: VectorConfig {
            name: "dense".to_string(),
            dimensions: config.embedding_dimensions,
            distance: VectorDistance::Cosine,
        },
        payload_indexes: memory_payload_indexes(),
        sparse: None,
        aliases: vec![MEMORY_COLLECTION_ALIAS.to_string()],
        metadata: MetadataMap::new(),
        distance: Some(VectorDistance::Cosine),
    }
}

fn memory_payload_indexes() -> Vec<PayloadIndexSpec> {
    [
        ("vector_namespace", PayloadFieldSchema::Keyword),
        ("memory_id", PayloadFieldSchema::Keyword),
        ("memory_type", PayloadFieldSchema::Keyword),
        ("memory_status", PayloadFieldSchema::Keyword),
        ("memory_scope_kind", PayloadFieldSchema::Keyword),
        ("memory_scope_value", PayloadFieldSchema::Keyword),
        ("redaction_status", PayloadFieldSchema::Keyword),
        ("visibility", PayloadFieldSchema::Keyword),
    ]
    .into_iter()
    .map(|(field_name, field_schema)| PayloadIndexSpec {
        field_name: field_name.to_string(),
        field_schema,
        required_for_filters: true,
    })
    .collect()
}

fn memory_payload(
    record: &MemoryRecord,
    point_id: &VectorPointId,
    embedding: &EmbeddingResult,
    collection: &str,
) -> MetadataMap {
    let mut payload = MetadataMap::new();
    let canonical_uri = format!("memory://{}", record.memory_id.0);
    let chunk_id = format!("memory:{}", record.memory_id.0);
    let content_hash = stable_hash(&record.body);
    let source_range = json!({ "line_start": 1, "line_end": 1 });
    let chunk_locator = json!({
        "canonical_uri": canonical_uri,
        "path": null,
        "heading_path": [],
        "symbol": null,
        "range": source_range,
    });
    payload.insert(
        "payload_contract_version".to_string(),
        json!(VECTOR_PAYLOAD_CONTRACT_VERSION),
    );
    payload.insert("collection".to_string(), json!(collection));
    payload.insert("vector_point_id".to_string(), json!(point_id.0));
    payload.insert(
        "vector_namespace".to_string(),
        json!(MEMORY_VECTOR_NAMESPACE),
    );
    payload.insert("source_family".to_string(), json!("memory"));
    payload.insert("source_kind".to_string(), json!("memory"));
    payload.insert("source_adapter".to_string(), json!("axon-memory"));
    payload.insert("source_scope".to_string(), json!(record.scope.kind));
    payload.insert("source_id".to_string(), json!(record.memory_id.0));
    payload.insert("source_canonical_uri".to_string(), json!(canonical_uri));
    payload.insert("source_item_key".to_string(), json!(record.memory_id.0));
    payload.insert("item_canonical_uri".to_string(), json!(canonical_uri));
    payload.insert("source_generation".to_string(), json!(0));
    payload.insert("committed_generation".to_string(), json!(0));
    payload.insert("document_id".to_string(), json!(record.memory_id.0));
    payload.insert("chunk_id".to_string(), json!(chunk_id));
    payload.insert("content_kind".to_string(), json!("plain_text"));
    payload.insert("content_hash".to_string(), json!(content_hash));
    payload.insert("chunk_hash".to_string(), json!(content_hash));
    payload.insert("chunk_locator".to_string(), chunk_locator);
    payload.insert("source_range".to_string(), source_range);
    payload.insert("memory_id".to_string(), json!(record.memory_id.0));
    payload.insert(
        "memory_type".to_string(),
        json!(memory_type_str(record.memory_type)),
    );
    payload.insert(
        "memory_status".to_string(),
        json!(memory_status_str(record.status)),
    );
    payload.insert(
        "memory_recallable".to_string(),
        json!(record.status == MemoryStatus::Active),
    );
    payload.insert("memory_scope_kind".to_string(), json!(record.scope.kind));
    payload.insert("memory_scope_value".to_string(), json!(record.scope.value));
    payload.insert("memory_confidence".to_string(), json!(record.confidence));
    payload.insert("memory_salience".to_string(), json!(record.salience));
    payload.insert("redaction_status".to_string(), json!("clean"));
    payload.insert("redaction_version".to_string(), json!("2026-07-04"));
    payload.insert("visibility".to_string(), json!("public"));
    payload.insert("redacted_field_count".to_string(), json!(0));
    payload.insert("dropped_field_count".to_string(), json!(0));
    payload.insert("detector_names".to_string(), json!([]));
    payload.insert("chunk_text".to_string(), json!(record.body));
    payload.insert(
        "embedding_provider".to_string(),
        json!(embedding.provider_id.0),
    );
    payload.insert(
        "embedding_batch_id".to_string(),
        json!(embedding.batch_id.0.to_string()),
    );
    payload.insert("embedding_model".to_string(), json!(embedding.model));
    payload.insert(
        "embedding_dimensions".to_string(),
        json!(embedding.dimensions),
    );
    payload.insert("embedding_profile".to_string(), json!("memory"));
    payload.insert("embedded_at".to_string(), json!("2026-07-04T00:00:00Z"));
    payload.insert("job_id".to_string(), json!(embedding.job_id.0.to_string()));
    payload.insert("document_status".to_string(), json!("published"));
    payload
}

fn memory_type_str(memory_type: MemoryType) -> &'static str {
    match memory_type {
        MemoryType::Decision => "decision",
        MemoryType::Fact => "fact",
        MemoryType::Preference => "preference",
        MemoryType::Task => "task",
        MemoryType::Bug => "bug",
        MemoryType::Procedure => "procedure",
        MemoryType::Incident => "incident",
        MemoryType::Entity => "entity",
        MemoryType::Episode => "episode",
        MemoryType::Working => "working",
    }
}

fn memory_status_str(status: MemoryStatus) -> &'static str {
    match status {
        MemoryStatus::Active => "active",
        MemoryStatus::Review => "review",
        MemoryStatus::Superseded => "superseded",
        MemoryStatus::Contradicted => "contradicted",
        MemoryStatus::Archived => "archived",
        MemoryStatus::Forgotten => "forgotten",
        MemoryStatus::Working => "working",
    }
}

fn missing_memory(memory_id: &MemoryId) -> ApiError {
    ApiError::new(
        "memory.not_found",
        axon_error::ErrorStage::Retrieving,
        format!("memory {} not found after metadata write", memory_id.0),
    )
}

fn stable_hash(input: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv64:{hash:016x}")
}

#[cfg(test)]
#[path = "vector_tests.rs"]
mod tests;
