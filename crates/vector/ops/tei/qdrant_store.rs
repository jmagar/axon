use crate::crates::core::config::Config;
use crate::crates::core::http::http_client;
use crate::crates::core::logging::{log_debug, log_info, log_warn};
use crate::crates::vector::ops::qdrant::{env_usize_clamped, qdrant_base};
use reqwest::StatusCode;
use std::collections::HashMap;
use std::error::Error;
use std::sync::{Mutex, OnceLock};

/// Describes how a Qdrant collection's vectors are configured.
///
/// - `Unnamed`: legacy single unnamed dense vector (`"vectors": {"size": N}`)
///   — hybrid search is disabled, `/points/search` is used.
/// - `Named`: named `dense` + named `bm42` sparse vectors
///   — hybrid search is enabled, `/points/query` with RRF is used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VectorMode {
    Unnamed,
    Named,
}

static COLLECTION_MODES: OnceLock<Mutex<HashMap<String, VectorMode>>> = OnceLock::new();

/// Return the cached `VectorMode` for `name`, or `None` if not yet initialized.
pub(super) fn cached_vector_mode(name: &str) -> Option<VectorMode> {
    COLLECTION_MODES
        .get()
        .and_then(|m| m.lock().ok())
        .and_then(|map| map.get(name).copied())
}

/// Store `mode` in the collection-mode cache for `name`.
pub(super) fn cache_vector_mode(name: &str, mode: VectorMode) {
    let map = COLLECTION_MODES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut m) = map.lock() {
        m.insert(name.to_owned(), mode);
    }
}

/// Return the `VectorMode` for `cfg.collection`, initializing the Qdrant collection
/// if this is the first call for that collection in this process.
///
/// Subsequent calls return the cached mode without hitting Qdrant.
///
/// # Concurrency note
/// There is a TOCTOU window: two concurrent first-time callers can both see `None`
/// from `cached_vector_mode` and both call `ensure_collection`. This is safe because
/// `ensure_collection` is idempotent — the second PUT gets a 409 CONFLICT that is
/// explicitly ignored, and both callers end up with a consistent `VectorMode`.
/// The eventual-consistency guarantee is sufficient for this use case.
pub(super) async fn collection_init_or_cached(
    cfg: &Config,
    dim: usize,
) -> Result<VectorMode, Box<dyn Error>> {
    if let Some(mode) = cached_vector_mode(&cfg.collection) {
        return Ok(mode);
    }
    let mode = ensure_collection(cfg, dim).await?;
    cache_vector_mode(&cfg.collection, mode);
    Ok(mode)
}

/// Return the `VectorMode` for `cfg.collection` by inspecting the live Qdrant schema.
///
/// Used by search-only paths (query/ask) where `collection_init_or_cached` may not
/// have been called yet. Checks cache first; falls back to a GET if not cached.
///
/// # Degradation policy
/// If Qdrant is unreachable or returns a non-2xx response, falls back to
/// `VectorMode::Unnamed` (dense-only search) rather than propagating an error.
/// This is a deliberate degradation choice: a transient connection failure causes
/// silent fallback to legacy search rather than a hard query failure.
pub(crate) async fn get_or_fetch_vector_mode(cfg: &Config) -> Result<VectorMode, Box<dyn Error>> {
    if let Some(mode) = cached_vector_mode(&cfg.collection) {
        return Ok(mode);
    }
    let client = http_client()?;
    let url = format!("{}/collections/{}", qdrant_base(cfg), cfg.collection);

    // Transport error (connection refused, timeout) -> degrade to Unnamed
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            log_warn(&format!(
                "qdrant unreachable for collection '{}', degrading to dense-only: {e}",
                cfg.collection
            ));
            cache_vector_mode(&cfg.collection, VectorMode::Unnamed);
            return Ok(VectorMode::Unnamed);
        }
    };

    // Non-2xx -> degrade to Unnamed
    if !resp.status().is_success() {
        let status = resp.status();
        log_warn(&format!(
            "qdrant returned {} for collection '{}', degrading to dense-only",
            status, cfg.collection
        ));
        // Auth failures (401/403) are likely misconfiguration — don't cache permanently
        if status != StatusCode::UNAUTHORIZED && status != StatusCode::FORBIDDEN {
            cache_vector_mode(&cfg.collection, VectorMode::Unnamed);
        }
        return Ok(VectorMode::Unnamed);
    }

    // JSON parse error -> degrade to Unnamed
    let mode = match resp.json::<serde_json::Value>().await {
        Ok(body) => detect_vector_mode(&body),
        Err(e) => {
            log_warn(&format!(
                "qdrant malformed JSON for collection '{}', degrading to dense-only: {e}",
                cfg.collection
            ));
            VectorMode::Unnamed
        }
    };
    cache_vector_mode(&cfg.collection, mode);
    Ok(mode)
}

/// Infer `VectorMode` from a Qdrant collection GET response body.
fn detect_vector_mode(body: &serde_json::Value) -> VectorMode {
    if body
        .pointer("/result/config/params/vectors/dense")
        .is_some()
    {
        VectorMode::Named
    } else {
        VectorMode::Unnamed
    }
}

/// Check that the existing collection's dense vector dimension matches `expected_dim`.
///
/// Returns `Ok(())` when dimensions match or when the stored dimension cannot be
/// determined (ambiguous schema is not an error — only a confirmed mismatch is).
fn validate_existing_dim(
    body: &serde_json::Value,
    mode: VectorMode,
    expected_dim: usize,
    collection: &str,
) -> Result<(), Box<dyn Error>> {
    let stored = match mode {
        VectorMode::Unnamed => body.pointer("/result/config/params/vectors/size"),
        VectorMode::Named => body.pointer("/result/config/params/vectors/dense/size"),
    };
    if let Some(serde_json::Value::Number(n)) = stored
        && let Some(stored_dim) = n.as_u64()
    {
        let stored_dim = stored_dim as usize;
        if stored_dim != expected_dim {
            return Err(format!(
                "collection '{}' has dense dim={} but current embedder uses dim={} \
                 -- set AXON_COLLECTION to a new name to re-index",
                collection, stored_dim, expected_dim
            )
            .into());
        }
    }
    Ok(())
}

/// Creates keyword payload indexes on `url` and `domain` fields.
///
/// These indexes are required by the Qdrant `/facet` endpoint used by the
/// `domains` and `sources` MCP actions.  The operation is idempotent —
/// Qdrant returns HTTP 200 when the index already exists.
async fn ensure_payload_indexes(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let client = http_client()?;
    let index_url = format!(
        "{}/collections/{}/index?wait=true",
        qdrant_base(cfg),
        cfg.collection
    );
    for field in &["url", "domain"] {
        client
            .put(&index_url)
            .json(&serde_json::json!({
                "field_name": field,
                "field_schema": "keyword"
            }))
            .send()
            .await?
            .error_for_status()?;
    }
    Ok(())
}

/// Ensure the collection exists and is configured with the right vector schema.
///
/// Returns the `VectorMode` that describes the collection after this call.
///
/// | Prior state | Action | Returns |
/// |-------------|--------|---------|
/// | Does not exist | Create with named `dense` + `bm42` sparse | `Named` |
/// | Exists, named `dense` | Ensure sparse; PATCH to add `bm42` if missing | `Named` |
/// | Exists, unnamed dense | Log warning; leave unchanged | `Unnamed` |
pub(super) async fn ensure_collection(
    cfg: &Config,
    dim: usize,
) -> Result<VectorMode, Box<dyn Error>> {
    let client = http_client()?;
    let url = format!("{}/collections/{}", qdrant_base(cfg), cfg.collection);

    let get_resp = client.get(&url).send().await?;
    let get_status = get_resp.status();

    if get_status.is_success() {
        let body: serde_json::Value = get_resp.json().await?;
        let mode = detect_vector_mode(&body);
        validate_existing_dim(&body, mode, dim, &cfg.collection)?;
        match mode {
            VectorMode::Named => {
                let has_sparse = body
                    .pointer("/result/config/params/sparse_vectors/bm42")
                    .is_some();
                if !has_sparse {
                    patch_add_sparse(cfg).await?;
                }
            }
            VectorMode::Unnamed => {
                log_warn(&format!(
                    "collection '{}' uses legacy unnamed dense vectors; \
                     hybrid search is disabled for this collection. \
                     To enable, set AXON_COLLECTION to a new name and re-index.",
                    cfg.collection
                ));
            }
        }
        log_debug(&format!(
            "qdrant collection_exists collection={} mode={:?}",
            cfg.collection, mode
        ));
        ensure_payload_indexes(cfg).await?;
        return Ok(mode);
    } else if get_status != StatusCode::NOT_FOUND {
        // 500, 401, 403, etc. -- do not silently fall through to collection creation.
        let body = get_resp.text().await.unwrap_or_default();
        return Err(format!(
            "Qdrant GET collection/{} failed: {} -- {}",
            cfg.collection, get_status, body
        )
        .into());
    }

    let create = serde_json::json!({
        "vectors": {
            "dense": {"size": dim, "distance": "Cosine"}
        },
        "sparse_vectors": {
            "bm42": {"modifier": "idf"}
        }
    });
    let resp = client.put(&url).json(&create).send().await?;
    if resp.status() != StatusCode::CONFLICT {
        resp.error_for_status()?;
    }
    log_info(&format!(
        "qdrant collection_created collection={} mode=Named",
        cfg.collection
    ));
    ensure_payload_indexes(cfg).await?;
    Ok(VectorMode::Named)
}

/// PATCH an existing Named collection to add the `bm42` sparse vector config.
async fn patch_add_sparse(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let client = http_client()?;
    let url = format!("{}/collections/{}", qdrant_base(cfg), cfg.collection);
    client
        .patch(&url)
        .json(&serde_json::json!({
            "sparse_vectors": {
                "bm42": {"modifier": "idf"}
            }
        }))
        .send()
        .await?
        .error_for_status()?;
    log_info(&format!(
        "qdrant collection_patched_sparse collection={}",
        cfg.collection
    ));
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
    log_debug(&format!(
        "qdrant upsert_start point_count={} collection={}",
        points.len(),
        cfg.collection
    ));
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

#[cfg(test)]
mod tests {
    use super::*;

    // -- detect_vector_mode (pure parsing logic) --

    #[test]
    fn detect_vector_mode_named_collection() {
        let body = serde_json::json!({
            "result": {"config": {"params": {"vectors": {
                "dense": {"size": 384, "distance": "Cosine"}
            }}}}
        });
        assert_eq!(detect_vector_mode(&body), VectorMode::Named);
    }

    #[test]
    fn detect_vector_mode_unnamed_collection() {
        let body = serde_json::json!({
            "result": {"config": {"params": {"vectors": {"size": 384, "distance": "Cosine"}}}}
        });
        assert_eq!(detect_vector_mode(&body), VectorMode::Unnamed);
    }

    // -- VectorMode cache --
    #[test]
    fn cached_vector_mode_returns_none_for_unknown_collection() {
        assert!(cached_vector_mode("test_no_such_collection_xyz_999").is_none());
    }

    #[test]
    fn cache_and_retrieve_named_mode() {
        cache_vector_mode("test_cache_named", VectorMode::Named);
        assert_eq!(
            cached_vector_mode("test_cache_named"),
            Some(VectorMode::Named)
        );
    }

    #[test]
    fn cache_and_retrieve_unnamed_mode() {
        cache_vector_mode("test_cache_unnamed", VectorMode::Unnamed);
        assert_eq!(
            cached_vector_mode("test_cache_unnamed"),
            Some(VectorMode::Unnamed)
        );
    }

    // -- validate_existing_dim --

    #[test]
    fn validate_dim_match_unnamed() {
        let b = serde_json::json!({"result":{"config":{"params":{"vectors":{"size":384}}}}});
        assert!(validate_existing_dim(&b, VectorMode::Unnamed, 384, "c").is_ok());
    }

    #[test]
    fn validate_dim_match_named() {
        let b =
            serde_json::json!({"result":{"config":{"params":{"vectors":{"dense":{"size":384}}}}}});
        assert!(validate_existing_dim(&b, VectorMode::Named, 384, "c").is_ok());
    }

    #[test]
    fn validate_dim_mismatch_unnamed() {
        let b = serde_json::json!({"result":{"config":{"params":{"vectors":{"size":768}}}}});
        let msg = validate_existing_dim(&b, VectorMode::Unnamed, 384, "col")
            .unwrap_err()
            .to_string();
        assert!(msg.contains("dim=768") && msg.contains("dim=384") && msg.contains("col"));
    }

    #[test]
    fn validate_dim_mismatch_named() {
        let b =
            serde_json::json!({"result":{"config":{"params":{"vectors":{"dense":{"size":1024}}}}}});
        let msg = validate_existing_dim(&b, VectorMode::Named, 384, "my_col")
            .unwrap_err()
            .to_string();
        assert!(msg.contains("my_col") && msg.contains("dim=1024") && msg.contains("dim=384"));
        assert!(msg.contains("AXON_COLLECTION"));
    }

    #[test]
    fn validate_dim_missing_is_ok() {
        let b = serde_json::json!({"result":{"config":{"params":{}}}});
        assert!(validate_existing_dim(&b, VectorMode::Unnamed, 384, "c").is_ok());
    }

    // -- ensure_collection (integration -- requires live Qdrant) --

    #[tokio::test(flavor = "multi_thread", worker_threads = 1)]
    #[ignore = "integration test -- requires running Qdrant; run with cargo test -- --ignored"]
    async fn ensure_collection_new_collection_returns_named_mode() -> Result<(), Box<dyn Error>> {
        use crate::crates::jobs::common::resolve_test_qdrant_url;
        let Some(qdrant_url) = resolve_test_qdrant_url() else {
            return Ok(());
        };
        let mut cfg =
            crate::crates::jobs::common::test_config("postgresql://dummy@127.0.0.1:1/dummy");
        cfg.qdrant_url = qdrant_url.clone();
        cfg.collection = format!("test_{}", uuid::Uuid::new_v4().simple());

        let mode = ensure_collection(&cfg, 4).await?;

        let _ = reqwest::Client::new()
            .delete(format!(
                "{}/collections/{}",
                qdrant_url.trim_end_matches('/'),
                cfg.collection
            ))
            .send()
            .await;

        assert_eq!(mode, VectorMode::Named, "new collection must be Named");
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 1)]
    #[ignore = "integration test -- requires running Qdrant; run with cargo test -- --ignored"]
    async fn ensure_collection_existing_unnamed_returns_unnamed_mode() -> Result<(), Box<dyn Error>>
    {
        use crate::crates::jobs::common::resolve_test_qdrant_url;
        let Some(qdrant_url) = resolve_test_qdrant_url() else {
            return Ok(());
        };
        let client = reqwest::Client::new();
        let base = qdrant_url.trim_end_matches('/').to_string();
        let collection = format!("test_{}", uuid::Uuid::new_v4().simple());

        client
            .put(format!("{base}/collections/{collection}"))
            .json(&serde_json::json!({"vectors": {"size": 4, "distance": "Cosine"}}))
            .send()
            .await?
            .error_for_status()?;

        let mut cfg =
            crate::crates::jobs::common::test_config("postgresql://dummy@127.0.0.1:1/dummy");
        cfg.qdrant_url = qdrant_url;
        cfg.collection = collection.clone();

        let mode = ensure_collection(&cfg, 4).await?;

        let _ = client
            .delete(format!("{base}/collections/{collection}"))
            .send()
            .await;

        assert_eq!(
            mode,
            VectorMode::Unnamed,
            "existing unnamed must return Unnamed"
        );
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 1)]
    #[ignore = "integration test -- requires running Qdrant; run with cargo test -- --ignored"]
    async fn ensure_collection_is_idempotent() -> Result<(), Box<dyn Error>> {
        use crate::crates::jobs::common::resolve_test_qdrant_url;
        let Some(qdrant_url) = resolve_test_qdrant_url() else {
            return Ok(());
        };
        let mut cfg =
            crate::crates::jobs::common::test_config("postgresql://dummy@127.0.0.1:1/dummy");
        cfg.qdrant_url = qdrant_url;
        cfg.collection = format!("test_{}", uuid::Uuid::new_v4().simple());

        ensure_collection(&cfg, 4).await?;
        ensure_collection(&cfg, 4).await?;

        let base = cfg.qdrant_url.trim_end_matches('/');
        let _ = reqwest::Client::new()
            .delete(format!("{}/collections/{}", base, cfg.collection))
            .send()
            .await;
        Ok(())
    }
}
