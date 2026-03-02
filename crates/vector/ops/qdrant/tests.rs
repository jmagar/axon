use crate::crates::jobs::common::{resolve_test_qdrant_url, test_config};
use std::error::Error;
use uuid::Uuid;

use super::client::{qdrant_search, qdrant_url_facets};

/// Helper: create an isolated test collection via the Qdrant REST API.
async fn create_test_collection(
    client: &reqwest::Client,
    base: &str,
    name: &str,
    dim: usize,
) -> Result<(), Box<dyn Error>> {
    client
        .put(format!("{base}/collections/{name}"))
        .json(&serde_json::json!({
            "vectors": {"size": dim, "distance": "Cosine"}
        }))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// Helper: create a keyword payload index on the given field (required for /facet).
async fn create_keyword_index(
    client: &reqwest::Client,
    base: &str,
    name: &str,
    field: &str,
) -> Result<(), Box<dyn Error>> {
    client
        .put(format!("{base}/collections/{name}/index?wait=true"))
        .json(&serde_json::json!({
            "field_name": field,
            "field_schema": "keyword"
        }))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// Helper: upsert points into a collection via the Qdrant REST API.
async fn upsert_points(
    client: &reqwest::Client,
    base: &str,
    name: &str,
    points: serde_json::Value,
) -> Result<(), Box<dyn Error>> {
    client
        .put(format!("{base}/collections/{name}/points?wait=true"))
        .json(&serde_json::json!({"points": points}))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// Helper: delete a test collection (best-effort cleanup).
async fn delete_collection(client: &reqwest::Client, base: &str, name: &str) {
    let _ = client
        .delete(format!("{base}/collections/{name}"))
        .send()
        .await;
}

/// `qdrant_url_facets` must return correct (url, chunk_count) pairs for the indexed data.
#[tokio::test]
async fn qdrant_url_facets_returns_correct_shape() -> Result<(), Box<dyn Error>> {
    let Some(qdrant_url) = resolve_test_qdrant_url() else {
        return Ok(());
    };
    let mut cfg = test_config("postgresql://dummy@127.0.0.1:1/dummy");
    cfg.qdrant_url = qdrant_url;
    cfg.collection = format!("test_{}", Uuid::new_v4().simple());

    let base = cfg.qdrant_url.trim_end_matches('/').to_string();
    let client = reqwest::Client::new();

    create_test_collection(&client, &base, &cfg.collection, 4).await?;
    create_keyword_index(&client, &base, &cfg.collection, "url").await?;

    // 2 points for url-a, 3 points for url-b.
    let points = serde_json::json!([
        {"id": Uuid::new_v4().to_string(), "vector": [1.0f32, 0.0, 0.0, 0.0], "payload": {"url": "https://url-a.example"}},
        {"id": Uuid::new_v4().to_string(), "vector": [0.9f32, 0.1, 0.0, 0.0], "payload": {"url": "https://url-a.example"}},
        {"id": Uuid::new_v4().to_string(), "vector": [0.0f32, 1.0, 0.0, 0.0], "payload": {"url": "https://url-b.example"}},
        {"id": Uuid::new_v4().to_string(), "vector": [0.0f32, 0.9, 0.1, 0.0], "payload": {"url": "https://url-b.example"}},
        {"id": Uuid::new_v4().to_string(), "vector": [0.0f32, 0.8, 0.2, 0.0], "payload": {"url": "https://url-b.example"}},
    ]);
    upsert_points(&client, &base, &cfg.collection, points).await?;

    let facets = qdrant_url_facets(&cfg, 100).await?;

    delete_collection(&client, &base, &cfg.collection).await;

    let url_a = facets.iter().find(|(u, _)| u == "https://url-a.example");
    let url_b = facets.iter().find(|(u, _)| u == "https://url-b.example");
    assert!(url_a.is_some(), "url-a must appear in facets");
    assert!(url_b.is_some(), "url-b must appear in facets");
    assert_eq!(url_a.unwrap().1, 2, "url-a must have 2 chunks");
    assert_eq!(url_b.unwrap().1, 3, "url-b must have 3 chunks");
    Ok(())
}

/// Upsert a point then search with its own vector — top result must match.
#[tokio::test]
async fn upsert_and_search_roundtrip() -> Result<(), Box<dyn Error>> {
    let Some(qdrant_url) = resolve_test_qdrant_url() else {
        return Ok(());
    };
    let mut cfg = test_config("postgresql://dummy@127.0.0.1:1/dummy");
    cfg.qdrant_url = qdrant_url;
    cfg.collection = format!("test_{}", Uuid::new_v4().simple());

    let base = cfg.qdrant_url.trim_end_matches('/').to_string();
    let client = reqwest::Client::new();

    create_test_collection(&client, &base, &cfg.collection, 4).await?;

    let target_url = "https://roundtrip.example/page";
    let vector = [1.0f32, 0.0, 0.0, 0.0];
    let point_id = Uuid::new_v4().to_string();

    let points = serde_json::json!([{
        "id": point_id,
        "vector": vector,
        "payload": {
            "url": target_url,
            "chunk_text": "roundtrip test content",
        }
    }]);
    upsert_points(&client, &base, &cfg.collection, points).await?;

    let hits = qdrant_search(&cfg, &vector, 1).await?;

    delete_collection(&client, &base, &cfg.collection).await;

    assert_eq!(hits.len(), 1, "search must return exactly one hit");
    assert_eq!(
        hits[0].payload.url, target_url,
        "top hit payload url must match the upserted point"
    );
    Ok(())
}
