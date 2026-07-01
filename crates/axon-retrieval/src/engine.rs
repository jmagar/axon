//! Minimal retrieval engine for the boundary fake.

use std::sync::Arc;

use axon_api::source::{
    BatchId, ChunkId, ContentKind, EmbeddingBatch, EmbeddingInput, JobId, JobPriority, MetadataMap,
    ProviderId, VectorSearchMatch, VectorSearchRequest,
};
use axon_embedding::provider::EmbeddingProvider;
use axon_error::{ApiError, ErrorStage};
use axon_vectors::store::VectorStore;
use uuid::Uuid;

use crate::citation::Citation;
use crate::context::ContextBundle;
use crate::plan::RetrievalPlan;
use crate::query::{RetrievalMatch, RetrievalRequest, RetrievalResult};

pub const MODULE_NAME: &str = "engine";

#[derive(Clone)]
pub struct RetrievalEngine<S, E> {
    store: Arc<S>,
    embedding_provider: Arc<E>,
}

impl<S, E> RetrievalEngine<S, E>
where
    S: VectorStore + 'static,
    E: EmbeddingProvider + 'static,
{
    pub fn new(store: Arc<S>, embedding_provider: Arc<E>) -> Self {
        Self {
            store,
            embedding_provider,
        }
    }

    pub async fn retrieve(&self, request: RetrievalRequest) -> Result<RetrievalResult, ApiError> {
        let plan = request.plan();
        let dense_vector = self.embed_query(&request.query).await?;
        let search = self
            .store
            .search(VectorSearchRequest {
                collection: plan.collection.clone(),
                query: request.query,
                limit: plan.limit,
                dense_vector: Some(dense_vector),
                sparse_vector: None,
                filters: search_filters(&plan),
                hybrid: Some(false),
                generation: plan.generation.clone(),
                graph_refs: Vec::new(),
                metadata: MetadataMap::new(),
            })
            .await?;

        let matches = search
            .results
            .iter()
            .map(match_from_vector)
            .collect::<Result<Vec<_>, _>>()?;
        let context = ContextBundle::from_matches(&matches, plan.byte_budget, plan.token_budget);
        let allowed_ids = context
            .chunk_ids
            .iter()
            .collect::<std::collections::BTreeSet<_>>();
        let citations = matches
            .iter()
            .filter(|item| allowed_ids.contains(&item.chunk_id))
            .map(|item| item.citation.clone())
            .collect();

        Ok(RetrievalResult {
            plan,
            matches,
            context,
            citations,
        })
    }

    async fn embed_query(&self, query: &str) -> Result<Vec<f32>, ApiError> {
        let result = self
            .embedding_provider
            .embed(EmbeddingBatch {
                batch_id: BatchId::new(Uuid::from_u128(1)),
                job_id: JobId::new(Uuid::from_u128(2)),
                provider_id: ProviderId::new("retrieval-fake"),
                model: "retrieval-fake".to_string(),
                items: vec![EmbeddingInput {
                    chunk_id: ChunkId::new("query"),
                    text: query.to_string(),
                    content_kind: ContentKind::PlainText,
                    metadata: MetadataMap::new(),
                }],
                instruction: None,
                priority: JobPriority::Interactive,
                metadata: MetadataMap::new(),
            })
            .await?;
        result
            .vectors
            .into_iter()
            .next()
            .map(|vector| vector.values)
            .ok_or_else(|| {
                ApiError::new(
                    "retrieval.missing_query_vector",
                    ErrorStage::Retrieving,
                    "embedding provider returned no query vector",
                )
            })
    }
}

fn search_filters(plan: &RetrievalPlan) -> MetadataMap {
    let mut filters = MetadataMap::new();
    filters.insert(
        "visibility".to_string(),
        serde_json::json!(match plan.visibility {
            axon_api::source::Visibility::Public => "public",
            axon_api::source::Visibility::Internal => "internal",
            axon_api::source::Visibility::Sensitive => "sensitive",
            axon_api::source::Visibility::Redacted => "redacted",
            axon_api::source::Visibility::Derived => "derived",
        }),
    );
    if let Some(source_id) = &plan.source_id {
        filters.insert("source_id".to_string(), serde_json::json!(source_id.0));
    }
    if !plan.namespace_filters.is_empty() {
        filters.insert(
            "vector_namespace".to_string(),
            serde_json::json!(plan.namespace_filters),
        );
    }
    filters
}

fn match_from_vector(item: &VectorSearchMatch) -> Result<RetrievalMatch, ApiError> {
    let citation = Citation::from_vector_match(item)?;
    Ok(RetrievalMatch {
        chunk_id: citation.chunk_id.clone(),
        document_id: citation.document_id.clone(),
        source_id: citation.source_id.clone(),
        score: item.score,
        canonical_uri: citation.canonical_uri.clone(),
        text: item
            .text
            .clone()
            .or_else(|| payload_string(&item.payload, "chunk_text"))
            .unwrap_or_default(),
        citation,
    })
}

fn payload_string(payload: &MetadataMap, field: &str) -> Option<String> {
    payload.get(field)?.as_str().map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axon_api::source::{DocumentId, SourceId, VectorPointId};
    use serde_json::json;

    #[test]
    fn vector_match_text_falls_back_to_chunk_text_payload() {
        let mut payload = MetadataMap::new();
        payload.insert("chunk_text".to_string(), json!("payload body"));
        payload.insert(
            "chunk_locator".to_string(),
            json!({
                "canonical_uri": "https://example.com/docs",
                "range": { "line_start": 1, "line_end": 2 }
            }),
        );
        payload.insert(
            "source_range".to_string(),
            json!({ "line_start": 1, "line_end": 2 }),
        );

        let item = VectorSearchMatch {
            point_id: VectorPointId::new("point"),
            score: 1.0,
            chunk_id: Some(ChunkId::new("chunk")),
            document_id: Some(DocumentId::new("doc")),
            source_id: Some(SourceId::new("src")),
            source_item_key: None,
            text: None,
            payload,
        };

        let matched = match_from_vector(&item).unwrap();

        assert_eq!(matched.text, "payload body");
    }
}
