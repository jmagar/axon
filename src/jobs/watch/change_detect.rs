//! Detect whether one watched URL changed and persist its new snapshot.
//!
//! Flow: conditional probe (304 = unchanged) → scrape → normalize + ignore
//! filter → fast-equal hash skip → reuse `services::diff::compute_diff` →
//! threshold. First-seen is forced Changed (seed). Errors preserve prior state.

use crate::core::config::Config;
use crate::core::http::{Probe, conditional_probe};
use crate::jobs::store::now_ms;
use crate::jobs::watch::filter::{apply_ignore, content_hash, normalize_markdown};
use crate::jobs::watch::url_state::{UrlState, get_url_state, upsert_url_state};
use crate::services::diff::{compute_diff, extract_links_from_payload};
use crate::services::types::{DiffResult, DiffStatus, LinkEntry};
use regex::Regex;
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct UrlOutcome {
    pub url: String,
    pub meaningful: bool,
    pub diff: Option<DiffResult>,
    pub error: Option<String>,
    pub prior_crawl_job_id: Option<Uuid>,
}

/// A change is meaningful if content changed AND (links changed OR the word-count
/// delta clears the threshold). Links always count.
pub fn is_meaningful(diff: &DiffResult, threshold_words: i64) -> bool {
    if !matches!(diff.status, DiffStatus::Changed) {
        return false;
    }
    if !diff.links_added.is_empty() || !diff.links_removed.is_empty() {
        return true;
    }
    diff.word_count_delta.abs() >= threshold_words.max(0)
}

#[allow(clippy::too_many_arguments)]
pub async fn detect_url_change(
    cfg: &Config,
    pool: &SqlitePool,
    watch_id: Uuid,
    url: &str,
    ignore: &[Regex],
    threshold_words: i64,
) -> UrlOutcome {
    let prior = get_url_state(pool, watch_id, url)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let now = now_ms();

    let unchanged = |err: Option<String>, state: UrlState| UrlOutcome {
        url: url.to_string(),
        meaningful: false,
        diff: None,
        error: err,
        prior_crawl_job_id: state.last_crawl_job_id,
    };

    // 1) Conditional probe.
    let (etag, last_modified) =
        match conditional_probe(url, prior.etag.as_deref(), prior.last_modified.as_deref()).await {
            Probe::NotModified => {
                let mut s = prior.clone();
                s.last_checked_at = Some(now);
                let _ = upsert_url_state(pool, watch_id, url, &s).await;
                return unchanged(None, prior);
            }
            Probe::Failed(msg) => {
                let mut s = prior.clone();
                s.last_checked_at = Some(now);
                let _ = upsert_url_state(pool, watch_id, url, &s).await;
                return unchanged(Some(msg), prior);
            }
            Probe::Modified {
                etag,
                last_modified,
            } => (etag, last_modified),
        };

    // 2) Scrape + 3) filter.
    let scraped = match crate::services::scrape::scrape(cfg, url, None).await {
        Ok(r) => r,
        Err(e) => {
            let mut s = prior.clone();
            s.last_checked_at = Some(now);
            let _ = upsert_url_state(pool, watch_id, url, &s).await;
            return unchanged(Some(format!("scrape failed: {e}")), prior);
        }
    };
    let filtered = apply_ignore(&normalize_markdown(&scraped.markdown), ignore);
    let fresh_hash = content_hash(&filtered);
    let fresh_links = extract_links_from_payload(&scraped.payload);
    let fresh_links_json = serde_json::to_string(&fresh_links).unwrap_or_else(|_| "[]".into());

    // 4) Fast-equal skip.
    if prior.content_hash.as_deref() == Some(fresh_hash.as_str()) {
        let s = UrlState {
            etag,
            last_modified,
            content_hash: Some(fresh_hash),
            last_markdown: Some(filtered),
            last_links_json: Some(fresh_links_json),
            last_checked_at: Some(now),
            last_changed_at: prior.last_changed_at,
            last_crawl_job_id: prior.last_crawl_job_id,
        };
        let _ = upsert_url_state(pool, watch_id, url, &s).await;
        return unchanged(None, prior);
    }

    // 5) Diff: prior snapshot vs fresh. First-seen → force Changed (seed).
    let prior_md = prior.last_markdown.clone().unwrap_or_default();
    let prior_links: Vec<LinkEntry> = prior
        .last_links_json
        .as_deref()
        .and_then(|j| serde_json::from_str(j).ok())
        .unwrap_or_default();
    let empty = serde_json::json!({});
    let mut diff = compute_diff(
        url,
        &prior_md,
        &prior_links,
        &empty,
        url,
        &filtered,
        &fresh_links,
        &empty,
    );
    let first_seen = prior.content_hash.is_none();
    if first_seen {
        diff.status = DiffStatus::Changed;
    }

    // 6) Threshold.
    let meaningful = first_seen || is_meaningful(&diff, threshold_words);

    // 7) Persist snapshot.
    let s = UrlState {
        etag,
        last_modified,
        content_hash: Some(fresh_hash),
        last_markdown: Some(filtered),
        last_links_json: Some(fresh_links_json),
        last_checked_at: Some(now),
        last_changed_at: if meaningful {
            Some(now)
        } else {
            prior.last_changed_at
        },
        last_crawl_job_id: prior.last_crawl_job_id,
    };
    let _ = upsert_url_state(pool, watch_id, url, &s).await;

    UrlOutcome {
        url: url.to_string(),
        meaningful,
        diff: Some(diff),
        error: None,
        prior_crawl_job_id: prior.last_crawl_job_id,
    }
}

#[cfg(test)]
#[path = "change_detect_tests.rs"]
mod tests;
