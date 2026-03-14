use super::{EmbedProgress, EmbedSummary, PreparedDoc, qdrant_store, tei_client::tei_embed};
use crate::crates::core::config::Config;
use crate::crates::core::logging::{log_debug, log_info, log_warn};
use crate::crates::vector::ops::qdrant::{env_usize_clamped, qdrant_delete_by_url_filter};
use chrono::Utc;
use futures_util::stream::{FuturesUnordered, StreamExt};
use std::error::Error;
use std::sync::OnceLock;
use std::time::Duration;
use uuid::Uuid;

fn env_bool(name: &str, default: bool) -> bool {
    match std::env::var(name) {
        Ok(v) => match v.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => true,
            "0" | "false" | "no" | "off" => false,
            _ => default,
        },
        Err(_) => default,
    }
}

fn strict_predelete() -> bool {
    static STRICT: OnceLock<bool> = OnceLock::new();
    *STRICT.get_or_init(|| env_bool("AXON_EMBED_STRICT_PREDELETE", true))
}

async fn embed_prepared_doc(
    cfg: &Config,
    doc: PreparedDoc,
    mode: qdrant_store::VectorMode,
) -> Result<(usize, Vec<serde_json::Value>), Box<dyn Error>> {
    if let Err(err) = qdrant_delete_by_url_filter(cfg, &doc.url).await {
        if strict_predelete() {
            return Err(format!("embed pre-delete failed for {}: {}", doc.url, err).into());
        }
        log_warn(&format!(
            "embed pre-delete skipped for {} due to qdrant error (strict=false): {}",
            doc.url, err
        ));
    }
    let vectors = tei_embed(cfg, &doc.chunks).await?;
    if vectors.is_empty() {
        return Err(format!("TEI returned no vectors for {}", doc.url).into());
    }
    if vectors.len() != doc.chunks.len() {
        return Err(format!(
            "TEI vector count mismatch for {}: {} vectors for {} chunks",
            doc.url,
            vectors.len(),
            doc.chunks.len()
        )
        .into());
    }
    log_debug(&format!(
        "embed_doc url={} chunk_count={}",
        doc.url,
        doc.chunks.len()
    ));
    let dim = vectors[0].len();
    let timestamp = Utc::now().to_rfc3339();
    let mut points = Vec::with_capacity(vectors.len());
    for (idx, (chunk, vecv)) in doc.chunks.into_iter().zip(vectors.into_iter()).enumerate() {
        let point_id = Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!("{}:{}", doc.url, idx).as_bytes(),
        );
        let payload = serde_json::json!({
            "url": doc.url,
            "domain": doc.domain,
            "source_command": "embed",
            "content_type": "markdown",
            "chunk_index": idx,
            "chunk_text": chunk,
            "scraped_at": timestamp,
        });
        points.push(super::build_point(point_id, vecv, &chunk, payload, mode));
    }
    Ok((dim, points))
}

async fn embed_prepared_doc_with_timeout(
    cfg: &Config,
    doc: PreparedDoc,
    timeout_secs: u64,
    mode: qdrant_store::VectorMode,
) -> Result<(usize, Vec<serde_json::Value>), Box<dyn Error>> {
    let url = doc.url.clone();
    match tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        embed_prepared_doc(cfg, doc, mode),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            log_warn(&format!(
                "embed timed out after {timeout_secs}s for {url}; \
                 pre-delete may have run — Qdrant index is incomplete for this URL until re-embed"
            ));
            Err(format!("embed timed out after {timeout_secs}s while processing {url}").into())
        }
    }
}

pub(super) async fn run_embed_pipeline(
    cfg: &Config,
    prepared: Vec<PreparedDoc>,
    progress_tx: Option<tokio::sync::mpsc::Sender<EmbedProgress>>,
) -> Result<EmbedSummary, Box<dyn Error>> {
    let docs_embedded = prepared.len();
    log_info(&format!("embed_pipeline docs={}", docs_embedded));
    let doc_timeout_secs = env_usize_clamped("AXON_EMBED_DOC_TIMEOUT_SECS", 300, 10, 7200) as u64;
    let doc_concurrency = env_usize_clamped(
        "AXON_EMBED_DOC_CONCURRENCY",
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(8)
            .clamp(2, 16),
        1,
        64,
    );
    let flush_point_threshold = env_usize_clamped("AXON_QDRANT_POINT_BUFFER", 256, 128, 16384);

    let mut work = prepared.into_iter();
    let mut inflight = FuturesUnordered::new();
    if let Some(tx) = &progress_tx {
        let _ = tx
            .send(EmbedProgress {
                docs_total: docs_embedded,
                docs_completed: 0,
                chunks_embedded: 0,
            })
            .await;
    }
    // Seed the initial concurrent batch with VectorMode::Unnamed.
    // The first document to complete will trigger collection_init_or_cached (below),
    // which sets collection_mode for all subsequent work items.
    //
    // Trade-off: if the collection is Named, the initial batch's points are built
    // in Unnamed format and will be rejected by Qdrant at upsert with a 400 error.
    // This is the intended early-failure behavior — re-run after the collection has
    // been initialized by a prior embed call.
    for _ in 0..doc_concurrency {
        if let Some(doc) = work.next() {
            inflight.push(embed_prepared_doc_with_timeout(
                cfg,
                doc,
                doc_timeout_secs,
                qdrant_store::VectorMode::Unnamed,
            ));
        }
    }

    let mut chunks_embedded = 0usize;
    let mut docs_completed = 0usize;
    let mut pending_points: Vec<serde_json::Value> = Vec::new();
    let mut collection_dim: Option<usize> = None;
    let mut collection_mode: Option<qdrant_store::VectorMode> = None;

    while let Some(result) = inflight.next().await {
        let (dim, mut points) = result?;
        match collection_dim {
            None => {
                let mode = qdrant_store::collection_init_or_cached(cfg, dim).await?;
                collection_mode = Some(mode);
                collection_dim = Some(dim);
            }
            Some(existing) if existing != dim => {
                return Err(format!(
                    "TEI embedding dimension mismatch: expected {}, got {}",
                    existing, dim
                )
                .into());
            }
            _ => {}
        }
        chunks_embedded += points.len();
        docs_completed += 1;
        if let Some(tx) = &progress_tx {
            tx.send(EmbedProgress {
                docs_total: docs_embedded,
                docs_completed,
                chunks_embedded,
            })
            .await
            .ok();
        }
        pending_points.append(&mut points);
        if pending_points.len() >= flush_point_threshold {
            qdrant_store::qdrant_upsert(cfg, &pending_points).await?;
            pending_points.clear();
        }

        if let Some(doc) = work.next() {
            inflight.push(embed_prepared_doc_with_timeout(
                cfg,
                doc,
                doc_timeout_secs,
                collection_mode.unwrap_or(qdrant_store::VectorMode::Unnamed),
            ));
        }
    }
    if !pending_points.is_empty() {
        qdrant_store::qdrant_upsert(cfg, &pending_points).await?;
    }

    Ok(EmbedSummary {
        docs_embedded,
        chunks_embedded,
    })
}

#[cfg(test)]
mod tests {
    use crate::crates::vector::ops::tei::qdrant_store::VectorMode;

    /// Verifies that `build_point` — the helper called by `embed_prepared_doc` with
    /// the `mode` parameter it receives — produces the named-vector shape when given
    /// `VectorMode::Named`. This covers the point-construction logic exercised by the
    /// pipeline; the pipeline orchestration itself (TEI calls, Qdrant upsert) requires
    /// live services and is covered by integration tests.
    #[test]
    fn build_point_produces_named_format_for_named_mode() {
        use crate::crates::vector::ops::tei::build_point_for_test;
        let point = build_point_for_test(
            vec![0.1f32, 0.2, 0.3],
            "pipeline test chunk with content",
            "https://pipeline.example/doc",
            0,
            VectorMode::Named,
        );
        assert!(
            point["vector"].is_object(),
            "Named pipeline point must have object vector"
        );
        assert!(point["vector"]["dense"].is_array());
        assert!(point["vector"]["bm42"]["indices"].is_array());
        assert!(point["vector"]["bm42"]["values"].is_array());
    }
}
