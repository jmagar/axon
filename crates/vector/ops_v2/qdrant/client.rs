use crate::axon_cli::crates::core::config::Config;
use crate::axon_cli::crates::core::http::http_client;
use std::collections::HashSet;
use std::error::Error;

use super::types::{QdrantPoint, QdrantScrollResponse, QdrantSearchHit, QdrantSearchResponse};
use super::utils::retrieve_max_points;

fn qdrant_base(cfg: &Config) -> String {
    cfg.qdrant_url.trim_end_matches('/').to_string()
}

pub(crate) async fn qdrant_scroll_pages(
    cfg: &Config,
    mut process_page: impl FnMut(&[serde_json::Value]),
) -> Result<(), Box<dyn Error>> {
    let client = http_client()?;
    let mut offset: Option<serde_json::Value> = None;

    loop {
        let mut body = serde_json::json!({
            "limit": 256,
            "with_payload": true,
            "with_vector": false
        });
        if let Some(off) = offset.take() {
            body["offset"] = off;
        }

        let url = format!(
            "{}/collections/{}/points/scroll",
            qdrant_base(cfg),
            cfg.collection
        );
        let val = client
            .post(url)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json::<serde_json::Value>()
            .await?;

        let points = val["result"]["points"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        if points.is_empty() {
            break;
        }
        process_page(points);

        offset = val["result"].get("next_page_offset").cloned();
        if offset.as_ref().is_none() || offset == Some(serde_json::Value::Null) {
            break;
        }
    }

    Ok(())
}

/// Scroll the collection keeping only the URL field (one entry per unique URL via chunk_index==0
/// filter) and collect into a HashSet. The `filter` value is passed directly as the Qdrant
/// filter body so callers control which subset of documents is scanned.
async fn scroll_url_set(
    cfg: &Config,
    filter: serde_json::Value,
) -> Result<HashSet<String>, Box<dyn Error>> {
    let client = http_client()?;
    let endpoint = format!(
        "{}/collections/{}/points/scroll",
        qdrant_base(cfg),
        cfg.collection
    );
    let mut seen = HashSet::new();
    let mut body = serde_json::json!({
        "limit": 1000,
        "with_payload": {"include": ["url"]},
        "with_vector": false,
        "filter": filter,
    });
    loop {
        let val = client
            .post(&endpoint)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json::<serde_json::Value>()
            .await?;
        let points = val["result"]["points"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        if points.is_empty() {
            break;
        }
        for p in points {
            if let Some(url) = p
                .get("payload")
                .and_then(|pl| pl.get("url"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                seen.insert(url.to_string());
            }
        }
        let next = val["result"].get("next_page_offset").cloned();
        if next.is_none() || next == Some(serde_json::Value::Null) {
            break;
        }
        body["offset"] = next.unwrap();
    }
    Ok(seen)
}

pub async fn qdrant_indexed_urls(cfg: &Config) -> Result<Vec<String>, Box<dyn Error>> {
    let filter = serde_json::json!({
        "must": [{"key": "chunk_index", "match": {"value": 0}}]
    });
    scroll_url_set(cfg, filter)
        .await
        .map(|s| s.into_iter().collect())
}

pub(crate) async fn qdrant_urls_for_domain(
    cfg: &Config,
    domain: &str,
) -> Result<HashSet<String>, Box<dyn Error>> {
    let filter = serde_json::json!({
        "must": [
            {"key": "domain", "match": {"value": domain}},
            {"key": "chunk_index", "match": {"value": 0}}
        ]
    });
    scroll_url_set(cfg, filter).await
}

/// Delete all Qdrant points matching `url` via payload filter.
pub(crate) async fn qdrant_delete_by_url_filter(
    cfg: &Config,
    url: &str,
) -> Result<(), Box<dyn Error>> {
    let client = http_client()?;
    client
        .post(format!(
            "{}/collections/{}/points/delete?wait=true",
            qdrant_base(cfg),
            cfg.collection
        ))
        .json(&serde_json::json!({
            "filter": {"must": [{"key": "url", "match": {"value": url}}]}
        }))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// Delete all Qdrant points for URLs that belong to `domain` but are NOT in `current_urls`.
/// Returns the number of stale URLs whose points were deleted.
pub async fn qdrant_delete_stale_domain_urls(
    cfg: &Config,
    domain: &str,
    current_urls: &HashSet<String>,
) -> Result<usize, Box<dyn Error>> {
    let indexed = qdrant_urls_for_domain(cfg, domain).await?;
    let stale: Vec<String> = indexed
        .into_iter()
        .filter(|url| !current_urls.contains(url))
        .collect();
    for url in &stale {
        qdrant_delete_by_url_filter(cfg, url).await?;
    }
    Ok(stale.len())
}

pub(crate) async fn qdrant_delete_points(
    cfg: &Config,
    ids: &[String],
) -> Result<usize, Box<dyn Error>> {
    if ids.is_empty() {
        return Ok(0);
    }
    let client = http_client()?;
    let url = format!(
        "{}/collections/{}/points/delete?wait=true",
        qdrant_base(cfg),
        cfg.collection
    );
    for batch in ids.chunks(1000) {
        client
            .post(&url)
            .json(&serde_json::json!({"points": batch}))
            .send()
            .await?
            .error_for_status()?;
    }
    Ok(ids.len())
}

pub(crate) async fn qdrant_domain_facets(
    cfg: &Config,
    limit: usize,
) -> Result<Vec<(String, usize)>, Box<dyn Error>> {
    let client = http_client()?;
    let url = format!("{}/collections/{}/facet", qdrant_base(cfg), cfg.collection);
    let value = client
        .post(url)
        .json(&serde_json::json!({
            "key": "domain",
            "limit": limit,
        }))
        .send()
        .await?
        .error_for_status()?
        .json::<serde_json::Value>()
        .await?;

    let mut out = Vec::new();
    if let Some(hits) = value["result"]["hits"].as_array() {
        for hit in hits {
            let domain = hit
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let vectors = hit.get("count").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            out.push((domain, vectors));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

pub(crate) async fn qdrant_search(
    cfg: &Config,
    vector: &[f32],
    limit: usize,
) -> Result<Vec<QdrantSearchHit>, Box<dyn Error>> {
    let client = http_client()?;
    let url = format!(
        "{}/collections/{}/points/search",
        qdrant_base(cfg),
        cfg.collection
    );
    let res = client
        .post(url)
        .json(&serde_json::json!({
            "vector": vector,
            "limit": limit,
            "with_payload": true,
            "with_vector": false
        }))
        .send()
        .await?
        .error_for_status()?
        .json::<QdrantSearchResponse>()
        .await?;
    Ok(res.result)
}

pub(crate) async fn qdrant_retrieve_by_url(
    cfg: &Config,
    url_match: &str,
    max_points: Option<usize>,
) -> Result<Vec<QdrantPoint>, Box<dyn Error>> {
    let client = http_client()?;
    let mut out = Vec::new();
    let mut offset: Option<serde_json::Value> = None;
    let max_points = retrieve_max_points(max_points);

    loop {
        let mut body = serde_json::json!({
            "limit": 256,
            "with_payload": true,
            "with_vector": false,
            "filter": {
                "must": [
                    {
                        "key": "url",
                        "match": {"value": url_match}
                    }
                ]
            }
        });
        if let Some(off) = offset.take() {
            body["offset"] = off;
        }

        let val = client
            .post(format!(
                "{}/collections/{}/points/scroll",
                qdrant_base(cfg),
                cfg.collection
            ))
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json::<QdrantScrollResponse>()
            .await?;

        let points = val.result.points;
        if points.is_empty() {
            break;
        }
        out.extend(points);
        if out.len() >= max_points {
            out.truncate(max_points);
            break;
        }

        offset = val.result.next_page_offset;
        if offset.as_ref().is_none() {
            break;
        }
    }

    Ok(out)
}
