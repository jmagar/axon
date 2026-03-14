use super::{EmbedProgress, EmbedSummary, PreparedDoc, qdrant_store, tei_client::tei_embed};
use crate::crates::core::config::Config;
use crate::crates::core::logging::{log_debug, log_info, log_warn};
use crate::crates::vector::ops::qdrant::{env_usize_clamped, qdrant_delete_by_url_filter};
use chrono::Utc;
use futures_util::stream::{FuturesUnordered, StreamExt};
use std::error::Error;
use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;
use std::time::Duration;
use uuid::Uuid;

type EmbedFuture<'a> = Pin<
    Box<dyn Future<Output = Result<(usize, Vec<serde_json::Value>), Box<dyn Error>>> + Send + 'a>,
>;

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

/// Rebuild pre-built points with a different `VectorMode`.
///
/// Extracts the dense vector and chunk text from each point's JSON, then calls
/// `build_point` with the new mode. Used when the collection didn't exist at
/// pre-fetch time (Unnamed fallback) but was created as Named by
/// `collection_init_or_cached`.
fn rebuild_points_with_mode(
    points: &[serde_json::Value],
    mode: qdrant_store::VectorMode,
) -> Result<Vec<serde_json::Value>, Box<dyn Error>> {
    let mut rebuilt = Vec::with_capacity(points.len());
    for point in points {
        let id_str = point["id"].as_str().ok_or("rebuild: point missing 'id'")?;
        let point_id: Uuid = id_str
            .parse()
            .map_err(|e| format!("rebuild: bad uuid: {e}"))?;
        let payload = point["payload"].clone();
        let chunk = match point["payload"]["chunk_text"].as_str() {
            Some(s) => s,
            None => {
                log_warn(&format!(
                    "rebuild_points_with_mode: missing chunk_text for point {:?}",
                    point["id"]
                ));
                ""
            }
        };

        // Extract dense vector — may be flat array (Unnamed) or nested under "dense" (Named).
        let dense: Vec<f32> = if let Some(arr) = point["vector"].as_array() {
            arr.iter()
                .filter_map(|v| v.as_f64().map(|f| f as f32))
                .collect()
        } else if let Some(arr) = point["vector"]["dense"].as_array() {
            arr.iter()
                .filter_map(|v| v.as_f64().map(|f| f as f32))
                .collect()
        } else {
            return Err("rebuild: cannot extract dense vector from point".into());
        };

        rebuilt.push(super::build_point(point_id, dense, chunk, payload, mode));
    }
    Ok(rebuilt)
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
    let mut inflight: FuturesUnordered<EmbedFuture<'_>> = FuturesUnordered::new();
    if let Some(tx) = &progress_tx {
        let _ = tx
            .send(EmbedProgress {
                docs_total: docs_embedded,
                docs_completed: 0,
                chunks_embedded: 0,
            })
            .await;
    }

    // Phase 1: Embed one doc serially to discover dim + resolve VectorMode before
    // seeding the concurrent batch (avoids P0 Qdrant 400 on Named collections).
    let mut chunks_embedded = 0usize;
    let mut docs_completed = 0usize;
    let mut pending_points: Vec<serde_json::Value> = Vec::new();

    let first_doc = match work.next() {
        Some(doc) => doc,
        None => {
            return Ok(EmbedSummary {
                docs_embedded: 0,
                chunks_embedded: 0,
            });
        }
    };

    // Pre-fetch mode for existing collections so the first doc uses the right format.
    // For new collections this returns Unnamed (collection doesn't exist yet), which
    // is corrected after we get dim from the first embed and call collection_init_or_cached.
    let pre_fetched_mode = qdrant_store::get_or_fetch_vector_mode(cfg)
        .await
        .unwrap_or(qdrant_store::VectorMode::Unnamed);

    let (first_dim, mut first_points) =
        embed_prepared_doc_with_timeout(cfg, first_doc, doc_timeout_secs, pre_fetched_mode).await?;

    // Ensure collection exists and resolve authoritative mode (may differ from pre-fetch).
    let collection_mode = qdrant_store::collection_init_or_cached(cfg, first_dim).await?;

    if collection_mode != pre_fetched_mode {
        // Pre-fetch was Unnamed (new collection) but init created Named — rebuild.
        log_info("embed_pipeline rebuilding first doc points after collection creation");
        first_points = rebuild_points_with_mode(&first_points, collection_mode)?;
    }

    chunks_embedded += first_points.len();
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
    pending_points.append(&mut first_points);

    // Phase 2: Seed the concurrent batch with the known-correct VectorMode.
    for _ in 0..doc_concurrency {
        if let Some(doc) = work.next() {
            inflight.push(Box::pin(embed_prepared_doc_with_timeout(
                cfg,
                doc,
                doc_timeout_secs,
                collection_mode,
            )));
        }
    }

    let (total_chunks, total_docs) = drain_embed_inflight(
        cfg,
        &mut inflight,
        &mut work,
        first_dim,
        doc_timeout_secs,
        collection_mode,
        flush_point_threshold,
        progress_tx.as_ref(),
        docs_embedded,
        chunks_embedded,
        docs_completed,
        &mut pending_points,
    )
    .await?;

    Ok(EmbedSummary {
        docs_embedded: total_docs,
        chunks_embedded: total_chunks,
    })
}

/// Drain the concurrent embed queue, flushing points to Qdrant in batches.
///
/// Consumes results from `inflight`, accumulates points into `pending_points`,
/// flushes when the threshold is reached, and refills from `work`. Returns
/// the final `(chunks_embedded, docs_completed)` totals.
#[allow(clippy::too_many_arguments)]
async fn drain_embed_inflight<'a>(
    cfg: &'a Config,
    inflight: &mut FuturesUnordered<EmbedFuture<'a>>,
    work: &mut impl Iterator<Item = PreparedDoc>,
    expected_dim: usize,
    doc_timeout_secs: u64,
    collection_mode: qdrant_store::VectorMode,
    flush_point_threshold: usize,
    progress_tx: Option<&tokio::sync::mpsc::Sender<EmbedProgress>>,
    docs_total: usize,
    mut chunks_embedded: usize,
    mut docs_completed: usize,
    pending_points: &mut Vec<serde_json::Value>,
) -> Result<(usize, usize), Box<dyn Error>> {
    while let Some(result) = inflight.next().await {
        let (dim, mut points) = result?;
        if dim != expected_dim {
            return Err(format!(
                "TEI embedding dimension mismatch: expected {expected_dim}, got {dim}",
            )
            .into());
        }
        chunks_embedded += points.len();
        docs_completed += 1;
        if let Some(tx) = progress_tx {
            tx.send(EmbedProgress {
                docs_total,
                docs_completed,
                chunks_embedded,
            })
            .await
            .ok();
        }
        pending_points.append(&mut points);
        if pending_points.len() >= flush_point_threshold {
            qdrant_store::qdrant_upsert(cfg, pending_points).await?;
            pending_points.clear();
        }

        if let Some(doc) = work.next() {
            inflight.push(Box::pin(embed_prepared_doc_with_timeout(
                cfg,
                doc,
                doc_timeout_secs,
                collection_mode,
            )));
        }
    }
    if !pending_points.is_empty() {
        qdrant_store::qdrant_upsert(cfg, pending_points).await?;
    }
    Ok((chunks_embedded, docs_completed))
}

#[cfg(test)]
mod tests {
    use super::rebuild_points_with_mode;
    use crate::crates::vector::ops::tei::build_point_for_test;
    use crate::crates::vector::ops::tei::qdrant_store::VectorMode;

    /// Verifies that `build_point` — the helper called by `embed_prepared_doc` with
    /// the `mode` parameter it receives — produces the named-vector shape when given
    /// `VectorMode::Named`. This covers the point-construction logic exercised by the
    /// pipeline; the pipeline orchestration itself (TEI calls, Qdrant upsert) requires
    /// live services and is covered by integration tests.
    #[test]
    fn build_point_produces_named_format_for_named_mode() {
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

    #[test]
    fn rebuild_unnamed_to_named_produces_named_format() {
        let unnamed = build_point_for_test(
            vec![0.1f32, 0.2, 0.3],
            "rebuild test chunk content words",
            "https://rebuild.example/a",
            0,
            VectorMode::Unnamed,
        );
        assert!(
            unnamed["vector"].is_array(),
            "precondition: Unnamed = flat array"
        );

        let rebuilt =
            rebuild_points_with_mode(&[unnamed], VectorMode::Named).expect("rebuild must succeed");
        assert_eq!(rebuilt.len(), 1);
        let point = &rebuilt[0];
        assert!(
            point["vector"].is_object(),
            "rebuilt point must have object vector (Named)"
        );
        assert!(point["vector"]["dense"].is_array());
        assert!(point["vector"]["bm42"]["indices"].is_array());
    }

    #[test]
    fn rebuild_named_to_unnamed_produces_flat_array() {
        let named = build_point_for_test(
            vec![0.4f32, 0.5, 0.6],
            "another rebuild test chunk",
            "https://rebuild.example/b",
            0,
            VectorMode::Named,
        );
        assert!(named["vector"].is_object(), "precondition: Named = object");

        let rebuilt =
            rebuild_points_with_mode(&[named], VectorMode::Unnamed).expect("rebuild must succeed");
        assert_eq!(rebuilt.len(), 1);
        assert!(
            rebuilt[0]["vector"].is_array(),
            "rebuilt point must have flat array vector (Unnamed)"
        );
    }

    #[test]
    fn rebuild_preserves_payload_and_id() {
        let original = build_point_for_test(
            vec![0.7f32, 0.8, 0.9],
            "payload preservation test",
            "https://rebuild.example/c",
            2,
            VectorMode::Unnamed,
        );
        let original_id = original["id"].as_str().unwrap().to_string();
        let original_url = original["payload"]["url"].as_str().unwrap().to_string();

        let rebuilt =
            rebuild_points_with_mode(&[original], VectorMode::Named).expect("rebuild must succeed");
        assert_eq!(rebuilt[0]["id"].as_str().unwrap(), original_id);
        assert_eq!(rebuilt[0]["payload"]["url"].as_str().unwrap(), original_url);
        assert_eq!(rebuilt[0]["payload"]["chunk_index"], 2);
    }

    #[test]
    fn rebuild_empty_points_returns_empty() {
        let rebuilt =
            rebuild_points_with_mode(&[], VectorMode::Named).expect("empty rebuild must succeed");
        assert!(rebuilt.is_empty());
    }
}
