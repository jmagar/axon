use crate::crates::core::config::Config;
use crate::crates::vector::ops::input;
use crate::crates::vector::ops::qdrant::qdrant_delete_by_url_filter;
use std::error::Error;

mod pipeline;
mod prepare;
mod qdrant_store;
mod tei_client;
mod tei_manifest;
#[cfg(test)]
mod tests;
pub(crate) use tei_client::tei_embed;

#[derive(Debug, Clone, Copy)]
pub struct EmbedSummary {
    pub docs_embedded: usize,
    pub chunks_embedded: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct EmbedProgress {
    pub docs_total: usize,
    pub docs_completed: usize,
    pub chunks_embedded: usize,
}

#[derive(Debug)]
pub(super) struct PreparedDoc {
    url: String,
    domain: String,
    chunks: Vec<String>,
}

/// Shared implementation for text embedding with optional extra payload fields.
async fn embed_text_impl(
    cfg: &Config,
    content: &str,
    url: &str,
    source_type: &str,
    title: Option<&str>,
    extra: Option<&serde_json::Value>,
) -> Result<usize, Box<dyn Error>> {
    if content.trim().is_empty() {
        return Ok(0);
    }
    let chunks = input::chunk_text(content);
    if chunks.is_empty() {
        return Ok(0);
    }
    let vectors = tei_embed(cfg, &chunks).await?;
    if vectors.is_empty() {
        return Err(format!("TEI returned no vectors for {url}").into());
    }
    if vectors.len() != chunks.len() {
        return Err(format!(
            "TEI vector count mismatch for {url}: {} vectors for {} chunks",
            vectors.len(),
            chunks.len()
        )
        .into());
    }
    let dim = vectors[0].len();
    if qdrant_store::collection_needs_init(&cfg.collection) {
        qdrant_store::ensure_collection(cfg, dim).await?;
    }
    // Pre-delete all existing points for this URL before upserting fresh chunks.
    // Prevents stale orphan chunks when chunk count changes between re-ingests.
    qdrant_delete_by_url_filter(cfg, url).await?;
    let domain = spider::url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string());
    let timestamp = chrono::Utc::now().to_rfc3339();
    let mut points = Vec::with_capacity(vectors.len());
    for (idx, (chunk, vecv)) in chunks.into_iter().zip(vectors.into_iter()).enumerate() {
        let point_id = uuid::Uuid::new_v5(
            &uuid::Uuid::NAMESPACE_URL,
            format!("{url}:{idx}").as_bytes(),
        );
        let mut payload = serde_json::json!({
            "url": url,
            "domain": domain,
            "source_type": source_type,
            "source_command": source_type,
            "content_type": "text",
            "chunk_index": idx,
            "chunk_text": chunk,
            "scraped_at": timestamp,
        });
        if let Some(t) = title {
            payload["title"] = serde_json::Value::String(t.to_string());
        }
        // Merge source-specific extra fields (e.g. YouTube channel, upload date)
        if let Some(serde_json::Value::Object(map)) = extra {
            for (k, v) in map {
                payload[k] = v.clone();
            }
        }
        points.push(serde_json::json!({
            "id": point_id.to_string(),
            "vector": vecv,
            "payload": payload,
        }));
    }
    qdrant_store::qdrant_upsert(cfg, &points).await?;
    Ok(points.len())
}

/// Embed arbitrary text content with explicit source metadata into Qdrant.
pub async fn embed_text_with_metadata(
    cfg: &Config,
    content: &str,
    url: &str,
    source_type: &str,
    title: Option<&str>,
) -> Result<usize, Box<dyn Error>> {
    embed_text_impl(cfg, content, url, source_type, title, None).await
}

/// Like `embed_text_with_metadata` but merges `extra` fields into every chunk's Qdrant payload.
/// `extra` must be a JSON object; non-object values are ignored.
/// Use this for source-specific metadata (e.g. YouTube channel, upload date, tags).
pub async fn embed_text_with_extra_payload(
    cfg: &Config,
    content: &str,
    url: &str,
    source_type: &str,
    title: Option<&str>,
    extra: &serde_json::Value,
) -> Result<usize, Box<dyn Error>> {
    embed_text_impl(cfg, content, url, source_type, title, Some(extra)).await
}

pub async fn embed_path_native(cfg: &Config, input: &str) -> Result<EmbedSummary, Box<dyn Error>> {
    embed_path_native_with_progress(cfg, input, None).await
}

pub async fn embed_path_native_with_progress(
    cfg: &Config,
    input: &str,
    progress_tx: Option<tokio::sync::mpsc::Sender<EmbedProgress>>,
) -> Result<EmbedSummary, Box<dyn Error>> {
    if cfg.tei_url.is_empty() {
        return Err("TEI_URL not configured".into());
    }
    if cfg.qdrant_url.is_empty() {
        return Err("QDRANT_URL not configured".into());
    }
    let prepared = prepare::prepare_embed_docs(input, &cfg.exclude_path_prefix).await?;
    if prepared.is_empty() {
        return prepare::emit_empty_embed(progress_tx);
    }
    let summary = pipeline::run_embed_pipeline(cfg, prepared, progress_tx).await?;
    prepare::emit_embed_summary(cfg, summary.chunks_embedded);
    Ok(summary)
}
