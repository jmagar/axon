//! Query DTOs for the retrieval boundary fake.

use axon_api::source::{ChunkId, DocumentId, SourceGenerationId, SourceId, Visibility};

use crate::citation::Citation;
use crate::context::ContextBundle;
use crate::plan::RetrievalPlan;

pub const MODULE_NAME: &str = "query";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetrievalRequest {
    pub query: String,
    pub collection: String,
    pub limit: u32,
    pub source_id: Option<SourceId>,
    pub generation: Option<SourceGenerationId>,
    pub namespace_filters: Vec<String>,
    pub byte_budget: u64,
    pub token_budget: u32,
}

impl RetrievalRequest {
    pub fn plan(&self) -> RetrievalPlan {
        RetrievalPlan::from_request(
            self,
            vec![
                Visibility::Public,
                Visibility::Internal,
                Visibility::Derived,
            ],
        )
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RetrievalMatch {
    pub chunk_id: ChunkId,
    pub document_id: DocumentId,
    pub source_id: SourceId,
    pub score: f64,
    pub canonical_uri: String,
    pub text: String,
    pub citation: Citation,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RetrievalResult {
    pub plan: RetrievalPlan,
    pub matches: Vec<RetrievalMatch>,
    pub context: ContextBundle,
    pub citations: Vec<Citation>,
}

pub type SearchResult = RetrievalResult;
