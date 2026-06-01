//! Detect whether one watched URL changed and persist its new snapshot.
//!
//! Flow: conditional probe (304 = unchanged) → scrape → normalize + ignore
//! filter → fast-equal hash skip → reuse `services::diff::compute_diff` →
//! threshold. First-seen is forced Changed (seed). DB read errors preserve the
//! existing row (no phantom upsert); transient probe/scrape errors stamp
//! `last_checked_at` only.

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

/// Outcome of detecting a change for one URL. Enum so illegal states (e.g.
/// "meaningful but no diff") are unrepresentable.
#[derive(Debug, Clone)]
pub enum UrlOutcome {
    /// No meaningful change (304, sub-threshold, or hash-equal).
    Unchanged,
    /// A meaningful change was detected; carries the diff for summary/artifact.
    Changed { diff: DiffResult },
    /// The probe/scrape/persist failed; carries the error message.
    Failed { error: String },
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

/// Persist a "checked but unchanged" snapshot: clone the prior state (or a fresh
/// default when first-seen with no prior row), stamp `last_checked_at`, and
/// upsert. Best-effort — a write failure is logged but does not change the
/// returned outcome. Folds the repeated NotModified/Failed/scrape-fail paths.
async fn persist_unchanged(
    pool: &SqlitePool,
    watch_id: Uuid,
    url: &str,
    prior: Option<&UrlState>,
    now: i64,
) {
    let mut s = prior.cloned().unwrap_or_default();
    s.last_checked_at = Some(now);
    if let Err(e) = upsert_url_state(pool, watch_id, url, &s).await {
        tracing::warn!(%watch_id, url, error = %e, "watch: upsert_url_state (unchanged) failed");
    }
}

pub async fn detect_url_change(
    cfg: &Config,
    pool: &SqlitePool,
    watch_id: Uuid,
    url: &str,
    ignore: &[Regex],
    threshold_words: i64,
) -> UrlOutcome {
    // A DB read error must NOT be collapsed into a blank prior: doing so would
    // upsert a full blank row over a just-saved snapshot and re-trigger crawls.
    // Skip persistence entirely and surface the error.
    let prior = match get_url_state(pool, watch_id, url).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(%watch_id, url, error = %e, "watch: get_url_state failed; skipping URL");
            return UrlOutcome::Failed {
                error: format!("read prior state failed: {e}"),
            };
        }
    };
    let now = now_ms();

    // 1) Conditional probe.
    let (etag, last_modified) = match conditional_probe(
        url,
        prior.as_ref().and_then(|p| p.etag.as_deref()),
        prior.as_ref().and_then(|p| p.last_modified.as_deref()),
    )
    .await
    {
        Probe::NotModified => {
            persist_unchanged(pool, watch_id, url, prior.as_ref(), now).await;
            return UrlOutcome::Unchanged;
        }
        Probe::Failed(msg) => {
            persist_unchanged(pool, watch_id, url, prior.as_ref(), now).await;
            return UrlOutcome::Failed { error: msg };
        }
        Probe::Modified {
            etag,
            last_modified,
        } => (etag, last_modified),
    };

    // 2) Scrape + 3) filter.
    // Map the (non-Send) boxed scrape error to a String at the await boundary so
    // the resulting non-Send type never enters this future's state machine — it
    // must stay Send for the scheduler's tokio::spawn.
    let scraped = match crate::services::scrape::scrape(cfg, url, None)
        .await
        .map_err(|e| format!("scrape failed: {e}"))
    {
        Ok(r) => r,
        Err(msg) => {
            persist_unchanged(pool, watch_id, url, prior.as_ref(), now).await;
            return UrlOutcome::Failed { error: msg };
        }
    };
    let filtered = apply_ignore(&normalize_markdown(&scraped.markdown), ignore);
    let fresh_hash = content_hash(&filtered);
    let fresh_links = extract_links_from_payload(&scraped.payload);
    let fresh_links_json = serde_json::to_string(&fresh_links).unwrap_or_else(|_| "[]".into());

    let prior_hash = prior.as_ref().and_then(|p| p.content_hash.clone());
    let prior_changed_at = prior.as_ref().and_then(|p| p.last_changed_at);

    // 4) Fast-equal skip.
    if prior_hash.as_deref() == Some(fresh_hash.as_str()) {
        let s = UrlState {
            etag,
            last_modified,
            content_hash: Some(fresh_hash),
            last_markdown: Some(filtered),
            last_links_json: Some(fresh_links_json),
            last_checked_at: Some(now),
            last_changed_at: prior_changed_at,
            last_crawl_job_id: prior.as_ref().and_then(|p| p.last_crawl_job_id),
        };
        if let Err(e) = upsert_url_state(pool, watch_id, url, &s).await {
            tracing::warn!(%watch_id, url, error = %e, "watch: upsert_url_state (hash-equal) failed");
        }
        return UrlOutcome::Unchanged;
    }

    // 5) Diff: prior snapshot vs fresh. First-seen → force Changed (seed).
    let prior_md = prior
        .as_ref()
        .and_then(|p| p.last_markdown.clone())
        .unwrap_or_default();
    let prior_links: Vec<LinkEntry> = prior
        .as_ref()
        .and_then(|p| p.last_links_json.as_deref())
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
    let first_seen = prior_hash.is_none();
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
            prior_changed_at
        },
        last_crawl_job_id: prior.as_ref().and_then(|p| p.last_crawl_job_id),
    };
    if let Err(e) = upsert_url_state(pool, watch_id, url, &s).await {
        tracing::warn!(%watch_id, url, error = %e, "watch: upsert_url_state (changed) failed");
    }

    if meaningful {
        UrlOutcome::Changed { diff }
    } else {
        UrlOutcome::Unchanged
    }
}

#[cfg(test)]
#[path = "change_detect_tests.rs"]
mod tests;
