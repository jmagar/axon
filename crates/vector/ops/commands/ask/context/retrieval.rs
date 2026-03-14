use super::heuristics::{
    authoritative_ratio, candidate_has_topical_overlap, is_low_signal_source_url,
    query_requests_low_signal_sources, top_domains, url_matches_domain_list,
};
use crate::crates::core::config::Config;
use crate::crates::vector::ops::sparse;
use crate::crates::vector::ops::tei::qdrant_store::{VectorMode, get_or_fetch_vector_mode};
use crate::crates::vector::ops::{qdrant, ranking, tei};
use anyhow::{Result, anyhow};

pub(super) struct AskRetrieval {
    pub(super) candidates: Vec<ranking::AskCandidate>,
    pub(super) reranked: Vec<ranking::AskCandidate>,
    pub(super) top_chunk_indices: Vec<usize>,
    pub(super) top_full_doc_indices: Vec<usize>,
    pub(super) retrieval_elapsed_ms: u128,
    pub(super) top_domains: Vec<String>,
    pub(super) authoritative_ratio: f64,
    pub(super) dropped_by_allowlist: usize,
}

pub(super) async fn retrieve_ask_candidates(cfg: &Config, query: &str) -> Result<AskRetrieval> {
    let retrieval_started = std::time::Instant::now();
    let mut ask_vectors = tei::tei_embed(cfg, &[query.to_string()])
        .await
        .map_err(|e| anyhow!(e.to_string()))?;
    if ask_vectors.is_empty() {
        return Err(anyhow!("TEI returned no vector for ask query"));
    }
    let vecq = ask_vectors.remove(0);
    let query_tokens = ranking::tokenize_query(query);
    let allow_low_signal = query_requests_low_signal_sources(&query_tokens, query);
    let mode = get_or_fetch_vector_mode(cfg)
        .await
        .unwrap_or(VectorMode::Unnamed);
    let hits = match mode {
        VectorMode::Unnamed => qdrant::qdrant_search(cfg, &vecq, cfg.ask_candidate_limit)
            .await
            .map_err(|e| anyhow!(e.to_string()))?,
        VectorMode::Named => {
            if cfg.hybrid_search_enabled {
                let sparse_vec = sparse::compute_sparse_vector(query);
                if !sparse_vec.is_empty() {
                    qdrant::qdrant_hybrid_search(cfg, &vecq, &sparse_vec, cfg.ask_candidate_limit)
                        .await
                        .map_err(|e| anyhow!(e.to_string()))?
                } else {
                    qdrant::qdrant_named_dense_search(cfg, &vecq, cfg.ask_candidate_limit)
                        .await
                        .map_err(|e| anyhow!(e.to_string()))?
                }
            } else {
                qdrant::qdrant_named_dense_search(cfg, &vecq, cfg.ask_candidate_limit)
                    .await
                    .map_err(|e| anyhow!(e.to_string()))?
            }
        }
    };
    let mut candidates = Vec::new();
    let mut dropped_by_allowlist = 0usize;
    for hit in hits {
        let url = qdrant::payload_url_typed(&hit.payload).to_string();
        let chunk_text = qdrant::payload_text_typed(&hit.payload).to_string();
        if url.is_empty() || chunk_text.len() < 40 {
            continue;
        }
        if !allow_low_signal && is_low_signal_source_url(&url) {
            continue;
        }
        if !cfg.ask_authoritative_allowlist.is_empty()
            && !url_matches_domain_list(&url, &cfg.ask_authoritative_allowlist)
        {
            dropped_by_allowlist += 1;
            continue;
        }
        let path = ranking::extract_path_from_url(&url);
        candidates.push(ranking::AskCandidate {
            score: hit.score,
            url: url.clone(),
            path: path.clone(),
            chunk_text: chunk_text.clone(),
            url_tokens: ranking::tokenize_path_set(&path),
            chunk_tokens: ranking::tokenize_text_set(&chunk_text),
            rerank_score: hit.score,
        });
    }
    if candidates.is_empty() {
        return Err(anyhow!("No relevant documents found for ask query"));
    }

    let reranked = ranking::rerank_ask_candidates(
        &candidates,
        &query_tokens,
        &cfg.ask_authoritative_domains,
        cfg.ask_authoritative_boost,
    )
    .into_iter()
    .filter(|candidate| {
        candidate.rerank_score >= cfg.ask_min_relevance_score
            && candidate_has_topical_overlap(candidate, &query_tokens)
    })
    .collect::<Vec<_>>();
    if reranked.is_empty() {
        return Err(anyhow!(
            "No candidates met relevance threshold {:.3}; lower AXON_ASK_MIN_RELEVANCE_SCORE",
            cfg.ask_min_relevance_score
        ));
    }

    Ok(AskRetrieval {
        top_chunk_indices: ranking::select_diverse_candidates(&reranked, cfg.ask_chunk_limit, 1),
        top_full_doc_indices: ranking::select_diverse_candidates(&reranked, cfg.ask_full_docs, 1),
        top_domains: top_domains(&reranked, 5),
        authoritative_ratio: authoritative_ratio(&reranked, &cfg.ask_authoritative_domains),
        dropped_by_allowlist,
        candidates,
        reranked,
        retrieval_elapsed_ms: retrieval_started.elapsed().as_millis(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crates::jobs::common::test_config;
    use httpmock::Mock;
    use httpmock::prelude::*;

    fn mock_tei_response(server: &MockServer, dim: usize) {
        server.mock(|when, then| {
            when.method(POST).path("/embed");
            then.status(200)
                .json_body(serde_json::json!([vec![0.1f32; dim]]));
        });
    }

    /// Mock GET /collections/{col} → Named vector config (has "dense" key inside "vectors").
    fn mock_named_collection(server: &MockServer, col: &str) {
        let col_path = format!("/collections/{col}");
        server.mock(|when, then| {
            when.method(GET).path(col_path);
            then.status(200).json_body(serde_json::json!({
                "result": {
                    "config": {
                        "params": {
                            "vectors": {"dense": {"size": 4, "distance": "Cosine"}}
                        }
                    }
                }
            }));
        });
    }

    /// Mock POST /collections/{col}/points/query → returns a hit with enough
    /// chunk_text to pass the >=40-char filter and a high score.
    fn mock_qdrant_query_response<'a>(server: &'a MockServer, collection: &str) -> Mock<'a> {
        let path = format!("/collections/{collection}/points/query");
        server.mock(|when, then| {
            when.method(POST).path(path);
            then.status(200).json_body(serde_json::json!({
                "result": [{
                    "id": "test-id",
                    "score": 0.95,
                    "payload": {
                        "url": "https://docs.example.com/retrieval-page",
                        "chunk_text": "This is a substantial chunk of text about retrieval dispatch testing that exceeds the forty character minimum filter"
                    }
                }]
            }));
        })
    }

    #[tokio::test]
    async fn retrieve_ask_candidates_named_hybrid_calls_query_endpoint() {
        let col = "retrieval_named_hybrid";
        let qdrant_server = MockServer::start_async().await;
        let tei_server = MockServer::start_async().await;
        mock_tei_response(&tei_server, 4);
        mock_named_collection(&qdrant_server, col);
        let query_mock = mock_qdrant_query_response(&qdrant_server, col);

        let mut cfg = test_config("postgresql://dummy@127.0.0.1:1/dummy");
        cfg.collection = col.to_string();
        cfg.qdrant_url = qdrant_server.base_url();
        cfg.tei_url = tei_server.base_url();
        cfg.hybrid_search_enabled = true;
        cfg.ask_min_relevance_score = 0.0;

        // Content-bearing query produces a non-empty sparse vector → hybrid path
        let result = retrieve_ask_candidates(&cfg, "retrieval dispatch testing").await;
        assert!(
            result.is_ok(),
            "named+hybrid retrieval must succeed: {:?}",
            result.err()
        );
        // /points/query was called (not /points/search)
        query_mock.assert_async().await;
        let retrieval = result.unwrap();
        assert!(!retrieval.candidates.is_empty());
    }

    #[tokio::test]
    async fn retrieve_ask_candidates_named_sparse_empty_uses_dense_query() {
        let col = "retrieval_named_sparse_empty";
        let qdrant_server = MockServer::start_async().await;
        let tei_server = MockServer::start_async().await;
        mock_tei_response(&tei_server, 4);
        mock_named_collection(&qdrant_server, col);
        let query_mock = mock_qdrant_query_response(&qdrant_server, col);

        let mut cfg = test_config("postgresql://dummy@127.0.0.1:1/dummy");
        cfg.collection = col.to_string();
        cfg.qdrant_url = qdrant_server.base_url();
        cfg.tei_url = tei_server.base_url();
        cfg.hybrid_search_enabled = true;
        cfg.ask_min_relevance_score = 0.0;

        // All tokens are stopwords → compute_sparse_vector returns empty →
        // must fall through to qdrant_named_dense_search (/points/query),
        // NOT qdrant_search (/points/search) which has no mock and would fail.
        let result = retrieve_ask_candidates(&cfg, "the and for").await;
        assert!(
            result.is_ok(),
            "named+hybrid with empty sparse must succeed: {:?}",
            result.err()
        );
        // /points/query was called (dense-only path, not RRF, not /points/search)
        query_mock.assert_async().await;
    }
}
