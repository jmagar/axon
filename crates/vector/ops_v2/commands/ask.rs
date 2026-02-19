use crate::axon_cli::crates::core::config::Config;
use crate::axon_cli::crates::core::http::http_client;
use crate::axon_cli::crates::core::logging::log_warn;
use crate::axon_cli::crates::core::ui::{muted, primary};
use crate::axon_cli::crates::vector::ops_v2::{qdrant, ranking, tei};
use futures_util::stream::{self, StreamExt};
use std::collections::HashSet;
use std::error::Error;
use std::io::Write;
use std::sync::Arc;

use super::streaming::{ask_llm_non_streaming, ask_llm_streaming};

fn push_context_entry(
    entries: &mut Vec<String>,
    context_char_count: &mut usize,
    entry: String,
    separator: &str,
    max_chars: usize,
) -> bool {
    let projected = if entries.is_empty() {
        entry.len()
    } else {
        *context_char_count + separator.len() + entry.len()
    };
    if projected > max_chars {
        return false;
    }
    entries.push(entry);
    *context_char_count = projected;
    true
}

pub(crate) struct AskContext {
    pub context: String,
    pub candidate_count: usize,
    pub reranked_count: usize,
    pub chunks_selected: usize,
    pub full_docs_selected: usize,
    pub supplemental_count: usize,
    pub retrieval_elapsed_ms: u128,
    pub context_elapsed_ms: u128,
    /// Pre-built source descriptions for diagnostics display.
    pub diagnostic_sources: Vec<String>,
}

pub(crate) async fn build_ask_context(
    cfg: &Config,
    query: &str,
) -> Result<AskContext, Box<dyn Error>> {
    let max_context_chars = cfg.ask_max_context_chars;
    let retrieval_started = std::time::Instant::now();
    let mut ask_vectors = tei::tei_embed(cfg, &[query.to_string()]).await?;
    if ask_vectors.is_empty() {
        return Err("TEI returned no vector for ask query".into());
    }
    let vecq = ask_vectors.remove(0);
    let candidate_pool_limit = cfg.ask_candidate_limit;
    let chunk_limit = cfg.ask_chunk_limit;
    let full_docs_limit = cfg.ask_full_docs;
    let backfill_limit = cfg.ask_backfill_chunks;
    let doc_fetch_concurrency = cfg.ask_doc_fetch_concurrency;
    let doc_chunk_limit = cfg.ask_doc_chunk_limit;
    let min_relevance_score = cfg.ask_min_relevance_score;
    let query_tokens = ranking::tokenize_query(query);

    let hits = qdrant::qdrant_search(cfg, &vecq, candidate_pool_limit).await?;
    let mut candidates = Vec::new();
    for hit in hits {
        let score = hit.score;
        let payload = &hit.payload;
        let url = qdrant::payload_url_typed(payload).to_string();
        let path = ranking::extract_path_from_url(&url);
        let chunk_text = qdrant::payload_text_typed(payload).to_string();
        if url.is_empty() || chunk_text.len() < 40 {
            continue;
        }
        candidates.push(ranking::AskCandidate {
            score,
            url: url.clone(),
            path: path.clone(),
            chunk_text: chunk_text.clone(),
            url_tokens: ranking::tokenize_path_set(&path),
            chunk_tokens: ranking::tokenize_text_set(&chunk_text),
            rerank_score: score,
        });
    }
    if candidates.is_empty() {
        return Err("No relevant documents found for ask query".into());
    }

    let reranked = ranking::rerank_ask_candidates(&candidates, &query_tokens)
        .into_iter()
        .filter(|c| c.rerank_score >= min_relevance_score)
        .collect::<Vec<_>>();
    if reranked.is_empty() {
        return Err(format!(
            "No candidates met relevance threshold {:.3}; lower AXON_ASK_MIN_RELEVANCE_SCORE",
            min_relevance_score
        )
        .into());
    }
    let top_chunk_indices = ranking::select_diverse_candidates(&reranked, chunk_limit, 2);
    let top_full_doc_indices = ranking::select_diverse_candidates(&reranked, full_docs_limit, 1);
    let retrieval_elapsed_ms = retrieval_started.elapsed().as_millis();

    let context_started = std::time::Instant::now();
    let mut context_entries: Vec<String> = Vec::new();
    let mut context_char_count = 0usize;
    let separator = "\n\n---\n\n";
    let mut source_idx = 1usize;
    let mut top_chunks_selected = 0usize;
    for &chunk_idx in &top_chunk_indices {
        let chunk = &reranked[chunk_idx];
        let entry = format!(
            "## Top Chunk [S{}]: {}\n\n{}",
            source_idx, chunk.url, chunk.chunk_text
        );
        if !push_context_entry(
            &mut context_entries,
            &mut context_char_count,
            entry,
            separator,
            max_context_chars,
        ) {
            break;
        }
        top_chunks_selected += 1;
        source_idx += 1;
    }

    let mut fetched_docs = Vec::new();
    if context_char_count < max_context_chars {
        let cfg_arc = Arc::new(cfg.clone());
        let mut fetch_stream = stream::iter(top_full_doc_indices.iter().enumerate().map(
            |(order, &doc_idx)| {
                let cfg_for_task = Arc::clone(&cfg_arc);
                let url = reranked[doc_idx].url.clone();
                async move {
                    let points =
                        qdrant::qdrant_retrieve_by_url(&cfg_for_task, &url, Some(doc_chunk_limit))
                            .await;
                    (order, url, points)
                }
            },
        ))
        .buffer_unordered(doc_fetch_concurrency);
        while let Some((order, url, points)) = fetch_stream.next().await {
            fetched_docs.push((order, url, points?));
        }
    }
    fetched_docs.sort_by_key(|(order, _, _)| *order);

    let mut inserted_full_doc_urls: HashSet<String> = HashSet::new();
    let mut full_docs_selected = 0usize;
    for (_idx, url, points) in fetched_docs {
        let text = qdrant::render_full_doc_from_points(points);
        if text.is_empty() {
            continue;
        }
        let entry = format!("## Source Document [S{}]: {}\n\n{}", source_idx, url, text);
        if !push_context_entry(
            &mut context_entries,
            &mut context_char_count,
            entry,
            separator,
            max_context_chars,
        ) {
            break;
        }
        inserted_full_doc_urls.insert(url);
        full_docs_selected += 1;
        source_idx += 1;
    }

    let supplemental_candidate_indices = reranked
        .iter()
        .enumerate()
        .filter(|(_, candidate)| !inserted_full_doc_urls.contains(&candidate.url))
        .map(|(idx, _)| idx)
        .collect::<Vec<_>>();
    let supplemental = ranking::select_diverse_candidates_from_indices(
        &reranked,
        &supplemental_candidate_indices,
        backfill_limit,
        1,
    );

    let mut supplemental_count = 0usize;
    for &chunk_idx in &supplemental {
        let chunk = &reranked[chunk_idx];
        let entry = format!(
            "## Supplemental Chunk [S{}]: {}\n\n{}",
            source_idx, chunk.url, chunk.chunk_text
        );
        if !push_context_entry(
            &mut context_entries,
            &mut context_char_count,
            entry,
            separator,
            max_context_chars,
        ) {
            break;
        }
        supplemental_count += 1;
        source_idx += 1;
    }

    if context_entries.is_empty() {
        return Err("Failed to retrieve any context sources for ask".into());
    }

    let context = format!("Sources:\n{}", context_entries.join(separator));
    let context_elapsed_ms = context_started.elapsed().as_millis();

    let mut diagnostic_sources: Vec<String> = Vec::new();
    diagnostic_sources.extend(
        top_chunk_indices
            .iter()
            .take(top_chunks_selected)
            .map(|&idx| &reranked[idx])
            .map(|c| format!("chunk score={:.3} url={}", c.score, c.url)),
    );
    diagnostic_sources.extend(
        top_full_doc_indices
            .iter()
            .map(|&idx| &reranked[idx])
            .map(|c| format!("full-doc score={:.3} url={}", c.score, c.url)),
    );
    diagnostic_sources.extend(
        supplemental
            .iter()
            .map(|&idx| &reranked[idx])
            .take(supplemental_count)
            .map(|c| format!("chunk score={:.3} url={}", c.score, c.url)),
    );

    Ok(AskContext {
        context,
        candidate_count: candidates.len(),
        reranked_count: reranked.len(),
        chunks_selected: top_chunks_selected,
        full_docs_selected,
        supplemental_count,
        retrieval_elapsed_ms,
        context_elapsed_ms,
        diagnostic_sources,
    })
}

pub async fn run_ask_native(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let ask_started = std::time::Instant::now();

    let query = cfg
        .query
        .clone()
        .or_else(|| {
            if cfg.positional.is_empty() {
                None
            } else {
                Some(cfg.positional.join(" "))
            }
        })
        .ok_or("ask requires query")?;

    if cfg.openai_base_url.is_empty() || cfg.openai_model.is_empty() {
        return Err("OPENAI_BASE_URL and OPENAI_MODEL required for ask".into());
    }

    let ctx = build_ask_context(cfg, &query).await?;

    if cfg.ask_diagnostics {
        if cfg.json_output {
            eprintln!(
                "{}",
                serde_json::json!({
                    "ask_diagnostics": {
                        "candidate_pool": ctx.candidate_count,
                        "reranked_pool": ctx.reranked_count,
                        "chunks_selected": ctx.chunks_selected,
                        "full_docs_selected": ctx.full_docs_selected,
                        "supplemental_selected": ctx.supplemental_count,
                        "context_chars": ctx.context.len(),
                        "min_relevance_score": cfg.ask_min_relevance_score,
                        "doc_fetch_concurrency": cfg.ask_doc_fetch_concurrency,
                        "sources": ctx.diagnostic_sources,
                    }
                })
            );
        } else {
            eprintln!("{}", primary("Ask Diagnostics"));
            eprintln!(
                "  {} candidates={} reranked={} chunks={} full_docs={} supplemental={} context_chars={}",
                muted("Retrieval:"),
                ctx.candidate_count,
                ctx.reranked_count,
                ctx.chunks_selected,
                ctx.full_docs_selected,
                ctx.supplemental_count,
                ctx.context.len()
            );
            for source in &ctx.diagnostic_sources {
                eprintln!("  • {source}");
            }
            eprintln!();
        }
    }

    let client = http_client()?;
    let llm_started = std::time::Instant::now();
    if !cfg.json_output {
        println!("{}", primary("Conversation"));
        println!("  {} {}", primary("You:"), query);
        print!("  {} ", primary("Assistant:"));
        std::io::stdout().flush()?;
    }
    let streamed_answer =
        ask_llm_streaming(cfg, client, &query, &ctx.context, !cfg.json_output).await;
    let answer = match streamed_answer {
        Ok(value) => value,
        Err(e) => {
            log_warn(&format!(
                "streaming failed, falling back to non-streaming: {e}"
            ));
            let fallback = ask_llm_non_streaming(cfg, client, &query, &ctx.context).await?;
            if !cfg.json_output {
                print!("{fallback}");
            }
            fallback
        }
    };
    if !cfg.json_output {
        println!();
    }
    let llm_elapsed_ms = llm_started.elapsed().as_millis();
    let total_elapsed_ms = ask_started.elapsed().as_millis();
    if cfg.json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "query": query,
                "answer": answer,
                "diagnostics": if cfg.ask_diagnostics {
                    serde_json::json!({
                        "candidate_pool": ctx.candidate_count,
                        "reranked_pool": ctx.reranked_count,
                        "chunks_selected": ctx.chunks_selected,
                        "full_docs_selected": ctx.full_docs_selected,
                        "supplemental_selected": ctx.supplemental_count,
                        "context_chars": ctx.context.len(),
                        "min_relevance_score": cfg.ask_min_relevance_score,
                        "doc_fetch_concurrency": cfg.ask_doc_fetch_concurrency,
                    })
                } else {
                    serde_json::Value::Null
                },
                "timing_ms": {
                    "retrieval": ctx.retrieval_elapsed_ms,
                    "context_build": ctx.context_elapsed_ms,
                    "llm": llm_elapsed_ms,
                    "total": total_elapsed_ms,
                }
            }))?
        );
    } else {
        if cfg.ask_diagnostics {
            println!(
                "  {} candidates={} reranked={} chunks={} full_docs={} supplemental={} context_chars={}",
                muted("Diagnostics:"),
                ctx.candidate_count,
                ctx.reranked_count,
                ctx.chunks_selected,
                ctx.full_docs_selected,
                ctx.supplemental_count,
                ctx.context.len()
            );
        }
        println!(
            "  {} retrieval={}ms | context={}ms | llm={}ms | total={}ms",
            muted("Timing:"),
            ctx.retrieval_elapsed_ms,
            ctx.context_elapsed_ms,
            llm_elapsed_ms,
            total_elapsed_ms
        );
    }
    Ok(())
}
