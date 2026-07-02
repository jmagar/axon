//! Feed acquisition (network fetch) for `axon source <feed-url>`.
//!
//! Mirrors [`crate::git_acquire`]: SSRF-validate the target, fetch the raw feed
//! bytes (streaming, size-capped so a hostile endpoint can't OOM us), and write
//! them to a throwaway [`tempfile::NamedTempFile`]. The feed bridge
//! ([`crate::index_feed_source_with_job`]) then reads that prepared path — this
//! helper does NOT parse the feed; the `axon_adapters::feed` adapter does that
//! from `feed_path`.
//!
//! Kept dependency-free of the legacy `axon-ingest` crate. Fetch-URL derivation
//! is a pure function ([`normalize_feed_target`]) so callers can assert the
//! resolved target without spawning a request.

use std::io::Write;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use axon_core::content::redact_url;
use axon_core::http::validate_url;
use futures_util::StreamExt;
use tempfile::NamedTempFile;

use crate::feed_target::normalize_feed_target;

/// Wall-clock cap for a single feed fetch before it is aborted.
const FETCH_TIMEOUT: Duration = Duration::from_secs(60);

/// Maximum feed document size. Feeds are link/entry indexes, not content dumps,
/// so 16 MiB is generous; the cap defends against a hostile or misconfigured
/// endpoint streaming a multi-GB body.
const MAX_FEED_BYTES: usize = 16 * 1024 * 1024;

/// SSRF-validate `feed_input`, fetch the raw feed document, and write it to a
/// fresh temp file.
///
/// `feed_input` may carry an `rss:`/`feed:`/`atom:` prefix; it is normalized to
/// the real https URL before validation and fetch. The URL is SSRF-validated
/// before any request is sent. On success the returned [`NamedTempFile`] owns
/// the prepared feed document (keep it alive across indexing; drop it to clean
/// up). Fetch/write errors are URL-redacted before being surfaced.
pub async fn fetch_feed_to_file(feed_input: &str) -> Result<NamedTempFile> {
    let feed_url = normalize_feed_target(feed_input);
    validate_url(&feed_url)
        .map_err(|err| anyhow::anyhow!("refusing to fetch {}: {err}", redact_url(&feed_url)))?;

    let bytes = fetch_feed_bytes(&feed_url).await?;

    let mut file = NamedTempFile::new().context("failed to create temp file for feed document")?;
    file.write_all(&bytes).with_context(|| {
        format!(
            "failed to write feed document for {}",
            redact_url(&feed_url)
        )
    })?;
    file.flush().with_context(|| {
        format!(
            "failed to flush feed document for {}",
            redact_url(&feed_url)
        )
    })?;
    Ok(file)
}

/// Fetch the feed document, enforcing the size cap while streaming so a hostile
/// or misconfigured endpoint can't OOM us by returning a multi-GB body.
async fn fetch_feed_bytes(feed_url: &str) -> Result<Vec<u8>> {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .context("failed to build feed http client")?;

    let resp = client
        .get(feed_url)
        .send()
        .await
        .map_err(|err| anyhow::anyhow!("feed fetch failed for {}: {err}", redact_url(feed_url)))?
        .error_for_status()
        .map_err(|err| {
            anyhow::anyhow!(
                "feed endpoint returned error for {}: {err}",
                redact_url(feed_url)
            )
        })?;

    // Reject early when the server advertises an over-cap body.
    if let Some(len) = resp.content_length()
        && len > MAX_FEED_BYTES as u64
    {
        bail!(
            "feed at {} advertises {len} bytes, exceeds {MAX_FEED_BYTES} byte cap",
            redact_url(feed_url)
        );
    }

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|err| {
            anyhow::anyhow!(
                "feed fetch stream failed for {}: {err}",
                redact_url(feed_url)
            )
        })?;
        if buf.len() + chunk.len() > MAX_FEED_BYTES {
            bail!(
                "feed at {} exceeds {MAX_FEED_BYTES} byte cap while streaming",
                redact_url(feed_url)
            );
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

#[cfg(test)]
#[path = "feed_acquire_tests.rs"]
mod tests;
