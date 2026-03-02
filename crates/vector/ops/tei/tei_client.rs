use crate::crates::core::config::Config;
use crate::crates::core::http::http_client;
use crate::crates::vector::ops::qdrant::env_usize_clamped;
use rand::RngExt as _;
use reqwest::StatusCode;
use std::error::Error;
use std::time::Duration;

pub(crate) async fn tei_embed(
    cfg: &Config,
    inputs: &[String],
) -> Result<Vec<Vec<f32>>, Box<dyn Error>> {
    if inputs.is_empty() {
        return Ok(Vec::new());
    }
    let client = http_client()?;
    let mut vectors = Vec::new();

    let configured = env_usize_clamped("TEI_MAX_CLIENT_BATCH_SIZE", 128, 1, 4096);
    let batch_size = configured.min(128);
    let embed_url = format!("{}/embed", cfg.tei_url.trim_end_matches('/'));

    let mut stack: Vec<&[String]> = inputs.chunks(batch_size).collect();
    stack.reverse();

    while let Some(chunk) = stack.pop() {
        let mut attempt = 0;
        let max_attempts = 10;

        loop {
            let resp = client
                .post(&embed_url)
                .json(&serde_json::json!({"inputs": chunk}))
                .send()
                .await?;

            let status = resp.status();
            if status.is_success() {
                let mut batch_vectors = resp.json::<Vec<Vec<f32>>>().await?;
                vectors.append(&mut batch_vectors);
                break;
            }

            if status == StatusCode::PAYLOAD_TOO_LARGE && chunk.len() > 1 {
                let mid = chunk.len() / 2;
                let (left, right) = chunk.split_at(mid);
                stack.push(right);
                stack.push(left);
                break;
            }

            if (status == StatusCode::TOO_MANY_REQUESTS
                || status == StatusCode::SERVICE_UNAVAILABLE)
                && attempt < max_attempts
            {
                attempt += 1;
                let delay = Duration::from_millis(1000 * (2u64.pow(attempt as u32 - 1)));
                let jitter = Duration::from_millis(rand::rng().random_range(0..500));
                tokio::time::sleep(delay + jitter).await;
                continue;
            }

            return Err(format!(
                "TEI request failed with status {} for {} (attempt {})",
                status, embed_url, attempt
            )
            .into());
        }
    }

    Ok(vectors)
}
