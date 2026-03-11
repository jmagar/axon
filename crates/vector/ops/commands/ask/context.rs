use crate::crates::core::config::Config;
use crate::crates::core::logging::log_warn;
use crate::crates::core::neo4j::Neo4jClient;
use crate::crates::jobs::graph::context::build_graph_context;
use anyhow::Result;

mod build;
mod heuristics;
mod retrieval;
#[cfg(test)]
mod tests;

use build::build_context_from_candidates;
use retrieval::retrieve_ask_candidates;

pub(crate) struct AskContext {
    pub context: String,
    pub graph_context_text: String,
    pub graph_entities_found: usize,
    pub candidate_count: usize,
    pub reranked_count: usize,
    pub chunks_selected: usize,
    pub full_docs_selected: usize,
    pub supplemental_count: usize,
    pub retrieval_elapsed_ms: u128,
    pub context_elapsed_ms: u128,
    pub graph_elapsed_ms: u128,
    pub diagnostic_sources: Vec<String>,
    pub top_domains: Vec<String>,
    pub authoritative_ratio: f64,
    pub dropped_by_allowlist: usize,
}

pub(crate) async fn build_ask_context(cfg: &Config, query: &str) -> Result<AskContext> {
    let retrieval = retrieve_ask_candidates(cfg, query).await?;
    let built = build_context_from_candidates(
        cfg,
        &retrieval.reranked,
        &retrieval.top_chunk_indices,
        &retrieval.top_full_doc_indices,
    )
    .await?;

    let mut graph_context_text = String::new();
    let mut graph_entities_found = 0usize;
    let mut graph_elapsed_ms = 0u128;
    let mut context = built.context;

    let neo4j_opt = if cfg.ask_graph && !cfg.neo4j_url.trim().is_empty() {
        match Neo4jClient::from_parts(&cfg.neo4j_url, &cfg.neo4j_user, &cfg.neo4j_password) {
            Ok(client) => client,
            Err(e) => {
                log_warn(&format!("Failed to init Neo4j client: {}", e));
                None
            }
        }
    } else {
        None
    };

    if let Some(neo4j) = neo4j_opt {
        let graph_started = std::time::Instant::now();
        let chunk_texts = retrieval
            .top_chunk_indices
            .iter()
            .filter_map(|&idx| retrieval.reranked.get(idx))
            .map(|candidate| candidate.chunk_text.clone())
            .collect::<Vec<_>>();

        match build_graph_context(cfg, &neo4j, &chunk_texts).await {
            Ok(graph_ctx) => {
                graph_elapsed_ms = graph_started.elapsed().as_millis();
                graph_entities_found = graph_ctx.entities.len();
                graph_context_text = graph_ctx.context_text;
                if !graph_context_text.is_empty() {
                    context = format!("{}\n\n---\n\n{}", graph_context_text, context);
                }
            }
            Err(err) => {
                graph_elapsed_ms = graph_started.elapsed().as_millis();
                log_warn(&format!(
                    "ask: graph context unavailable, falling back to vector-only retrieval: {err}"
                ));
            }
        }
    }

    Ok(AskContext {
        context,
        graph_context_text,
        graph_entities_found,
        candidate_count: retrieval.candidates.len(),
        reranked_count: retrieval.reranked.len(),
        chunks_selected: built.chunks_selected,
        full_docs_selected: built.full_docs_selected,
        supplemental_count: built.supplemental_count,
        retrieval_elapsed_ms: retrieval.retrieval_elapsed_ms,
        context_elapsed_ms: built.context_elapsed_ms,
        graph_elapsed_ms,
        diagnostic_sources: built.diagnostic_sources,
        top_domains: retrieval.top_domains,
        authoritative_ratio: retrieval.authoritative_ratio,
        dropped_by_allowlist: retrieval.dropped_by_allowlist,
    })
}
