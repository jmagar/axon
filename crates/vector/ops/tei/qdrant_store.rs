use crate::crates::core::config::Config;
use crate::crates::core::http::http_client;
use crate::crates::vector::ops::qdrant::{env_usize_clamped, qdrant_base};
use reqwest::StatusCode;
use std::collections::HashSet;
use std::error::Error;
use std::sync::{Mutex, OnceLock};

static INITIALIZED_COLLECTIONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

pub(super) fn collection_needs_init(name: &str) -> bool {
    let map = INITIALIZED_COLLECTIONS.get_or_init(|| Mutex::new(HashSet::new()));
    let mut set = map.lock().expect("INITIALIZED_COLLECTIONS mutex poisoned");
    if set.contains(name) {
        return false;
    }
    set.insert(name.to_owned());
    true
}

pub(super) async fn ensure_collection(cfg: &Config, dim: usize) -> Result<(), Box<dyn Error>> {
    let client = http_client()?;
    let url = format!("{}/collections/{}", qdrant_base(cfg), cfg.collection);

    let get_resp = client.get(&url).send().await?;
    if get_resp.status().is_success() {
        let body: serde_json::Value = get_resp.json().await?;
        let existing_dim = body
            .pointer("/result/config/params/vectors/size")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;
        if existing_dim == dim {
            return Ok(());
        }
    }

    let create = serde_json::json!({
        "vectors": {"size": dim, "distance": "Cosine"}
    });
    let resp = client.put(&url).json(&create).send().await?;
    if resp.status() != StatusCode::CONFLICT {
        resp.error_for_status()?;
    }

    Ok(())
}

pub(super) async fn qdrant_upsert(
    cfg: &Config,
    points: &[serde_json::Value],
) -> Result<(), Box<dyn Error>> {
    if points.is_empty() {
        return Ok(());
    }
    let client = http_client()?;
    let upsert_batch_size = env_usize_clamped("AXON_QDRANT_UPSERT_BATCH_SIZE", 256, 1, 4096);
    let url = format!(
        "{}/collections/{}/points?wait=true",
        qdrant_base(cfg),
        cfg.collection
    );
    for batch in points.chunks(upsert_batch_size) {
        client
            .put(&url)
            .json(&serde_json::json!({"points": batch}))
            .send()
            .await?
            .error_for_status()?;
    }
    Ok(())
}
