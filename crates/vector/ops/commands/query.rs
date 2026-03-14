use crate::crates::core::config::Config;
use crate::crates::vector::ops::source_display::display_source;
use crate::crates::vector::ops::sparse;
use crate::crates::vector::ops::tei::qdrant_store::{VectorMode, get_or_fetch_vector_mode};
use crate::crates::vector::ops::{qdrant, ranking, tei};
use std::error::Error;

pub async fn query_results(
    cfg: &Config,
    query: &str,
    limit: usize,
    offset: usize,
) -> Result<Vec<serde_json::Value>, Box<dyn Error>> {
    let mut query_vectors = tei::tei_embed(cfg, std::slice::from_ref(&query.to_string())).await?;
    if query_vectors.is_empty() {
        return Err("TEI returned no vector for query".into());
    }
    let vector = query_vectors.remove(0);

    let fetch_limit = ((limit + offset).max(1) * 8).max(limit + offset).min(500);
    let hits = if cfg.hybrid_search_enabled {
        let mode = get_or_fetch_vector_mode(cfg)
            .await
            .unwrap_or(VectorMode::Unnamed);
        let sparse_vec = sparse::compute_sparse_vector(query);
        if mode == VectorMode::Named && !sparse_vec.is_empty() {
            qdrant::qdrant_hybrid_search(cfg, &vector, &sparse_vec, fetch_limit)
                .await
                .map_err(|e| -> Box<dyn Error> { e.to_string().into() })?
        } else {
            qdrant::qdrant_search(cfg, &vector, fetch_limit).await?
        }
    } else {
        qdrant::qdrant_search(cfg, &vector, fetch_limit).await?
    };
    let query_tokens = ranking::tokenize_query(query);
    let candidates: Vec<ranking::AskCandidate> = hits
        .into_iter()
        .filter_map(|h| {
            let url = qdrant::payload_url_typed(&h.payload).to_string();
            let chunk_text = qdrant::payload_text_typed(&h.payload).to_string();
            if url.is_empty() {
                return None;
            }
            let path = ranking::extract_path_from_url(&url);
            Some(ranking::AskCandidate {
                score: h.score,
                url,
                path: path.clone(),
                chunk_text: chunk_text.clone(),
                url_tokens: ranking::tokenize_path_set(&path),
                chunk_tokens: ranking::tokenize_text_set(&chunk_text),
                rerank_score: h.score,
            })
        })
        .collect();
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    let reranked = ranking::rerank_ask_candidates(
        &candidates,
        &query_tokens,
        &cfg.ask_authoritative_domains,
        cfg.ask_authoritative_boost,
    );
    let selected_indices =
        ranking::select_diverse_candidates(&reranked, (limit + offset).max(1), 2);

    Ok(selected_indices
        .into_iter()
        .skip(offset)
        .take(limit)
        .enumerate()
        .map(|(i, hit_idx)| {
            let h = &reranked[hit_idx];
            let url = &h.url;
            let source = display_source(url);
            let preview_idx =
                ranking::select_best_preview_chunk(&reranked, url, &query_tokens, hit_idx);
            let snippet =
                ranking::get_meaningful_snippet(&reranked[preview_idx].chunk_text, &query_tokens);
            serde_json::json!({
                "rank": i + 1,
                "score": h.score,
                "rerank_score": h.rerank_score,
                "url": url,
                "source": source,
                "snippet": snippet,
                "chunk_index": serde_json::Value::Null
            })
        })
        .collect::<Vec<_>>())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crates::jobs::common::test_config;
    use httpmock::prelude::*;

    fn mock_tei_response(server: &MockServer, dim: usize) {
        server.mock(|when, then| {
            when.method(POST).path("/embed");
            then.status(200)
                .json_body(serde_json::json!([vec![0.1f32; dim]]));
        });
    }

    fn mock_qdrant_query_response(server: &MockServer, collection: &str) {
        let path = format!("/collections/{collection}/points/query");
        server.mock(|when, then| {
            when.method(POST).path(path);
            then.status(200).json_body(serde_json::json!({
                "result": [{
                    "id": "test-id",
                    "score": 0.9,
                    "payload": {
                        "url": "https://docs.example.com/page",
                        "chunk_text": "axon hybrid search result content",
                        "chunk_index": 0
                    }
                }]
            }));
        });
    }

    fn mock_qdrant_search_response(server: &MockServer, collection: &str) {
        let path = format!("/collections/{collection}/points/search");
        server.mock(|when, then| {
            when.method(POST).path(path);
            then.status(200).json_body(serde_json::json!({
                "result": [{
                    "id": "test-id",
                    "score": 0.85,
                    "payload": {
                        "url": "https://docs.example.com/page",
                        "chunk_text": "axon dense search result content",
                        "chunk_index": 0
                    }
                }]
            }));
        });
    }

    #[tokio::test]
    async fn query_results_uses_hybrid_search_when_named_collection() {
        let col = "query_hybrid_named";
        let qdrant_server = MockServer::start_async().await;
        let tei_server = MockServer::start_async().await;
        mock_tei_response(&tei_server, 4);
        // Named collection: GET returns named dense vectors config
        let col_path = format!("/collections/{col}");
        qdrant_server.mock(|when, then| {
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
        mock_qdrant_query_response(&qdrant_server, col);

        let mut cfg = test_config("postgresql://dummy@127.0.0.1:1/dummy");
        cfg.collection = col.to_string();
        cfg.qdrant_url = qdrant_server.base_url();
        cfg.tei_url = tei_server.base_url();
        cfg.hybrid_search_enabled = true;

        let result = query_results(&cfg, "axon search query", 5, 0).await;
        assert!(
            result.is_ok(),
            "query_results must succeed: {:?}",
            result.err()
        );
    }

    #[tokio::test]
    async fn query_results_falls_back_to_dense_when_hybrid_disabled() {
        let col = "query_dense_fallback";
        let qdrant_server = MockServer::start_async().await;
        let tei_server = MockServer::start_async().await;
        mock_tei_response(&tei_server, 4);
        mock_qdrant_search_response(&qdrant_server, col);

        let mut cfg = test_config("postgresql://dummy@127.0.0.1:1/dummy");
        cfg.collection = col.to_string();
        cfg.qdrant_url = qdrant_server.base_url();
        cfg.tei_url = tei_server.base_url();
        cfg.hybrid_search_enabled = false;

        let result = query_results(&cfg, "dense only query", 5, 0).await;
        assert!(
            result.is_ok(),
            "dense fallback must succeed: {:?}",
            result.err()
        );
    }
}
