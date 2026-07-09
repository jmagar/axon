//! Cross-repo activity Feed: fans `GET /repos/{owner}/{repo}/events` out across
//! a bounded set of repos, normalizes each event into a `FeedItem`, merges and
//! sorts by recency. Called from `github_bridge.rs`'s `Feed` branch, which
//! resolves the repo list (via `ListRepos`) before calling `fetch_feed` here.
//!
//! Data source: the GitHub Events API, not the Notifications API — see the
//! "Data source decision" section of `docs/plans/palette-github-enhancements.md`
//! for the full comparison. Short version: Events API scopes to "activity on
//! repos I'm already browsing" (matches how every other `github` browse kind
//! works), works unauthenticated, and needs no extra OAuth scope beyond the
//! `GITHUB_TOKEN` PAT the palette already reads.
//!
//! Known limitation: the Events API's `PushEvent` payload does not include
//! per-commit changed-file lists, so `FeedItem::path` is extracted heuristically
//! from the first backtick-quoted token in the lead commit message (a common
//! but not universal commit-message convention). When no backtick token is
//! found, `path` is `None` and clicking the feed item opens the repo's file
//! tree unscoped rather than jumping to a specific file — a graceful degrade,
//! not an error.

use std::collections::HashSet;

use serde::Serialize;

use crate::github_bridge::GITHUB_API_BASE;

#[path = "github_feed/normalize.rs"]
mod normalize;

pub(crate) use normalize::normalize_event;

/// Repos beyond this count (by the caller's ordering — `ListRepos` already
/// sorts by `updated`, so this means "10 most recently updated repos") are not
/// included in the fan-out. Bounds worst-case unauthenticated rate-limit burn
/// to 10 of the 60 req/hr budget, and keeps authenticated latency reasonable.
const MAX_FEED_REPOS: usize = 10;

/// Repos are fetched in chunks of this size (not all-at-once) to avoid
/// GitHub's secondary/abuse-detection rate limiting, which throttles bursts of
/// concurrent requests independent of the primary `x-ratelimit-*` budget.
const FEED_FANOUT_CHUNK_SIZE: usize = 3;

const MAX_ITEMS_PER_REPO: usize = 30;
const MAX_TOTAL_FEED_ITEMS: usize = 100;

/// One of `"pr"`, `"merge"`, `"review"`, `"comment"`, `"conflict"`, `"deps"`,
/// `"issue"`, `"push"`, `"release"` — the real mock's `FEED_KIND` taxonomy
/// (verified against `palette-mock.html`'s `var FEED_KIND = {...}` object;
/// mock labels are "Pull Request"/"Merged"/"Review"/"Comment"/"Conflict"/
/// "Dependencies"/"Issue"/"Push"/"Release" respectively). `normalize_event`
/// below never emits `"comment"` or `"conflict"` — this plan's Events API
/// source doesn't cover them (see this task's "Mock-verified taxonomy" note
/// in the plan doc); Task 5's TS-side label/icon maps still register both
/// kinds so the taxonomy stays forward-compatible.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedItem {
    pub(crate) kind: String,
    /// `owner/repo`.
    pub(crate) repo: String,
    /// GitHub login of the actor who triggered the event.
    pub(crate) actor: String,
    /// Human-readable title (PR/issue title, or the push's lead commit message).
    pub(crate) title: String,
    /// Best-effort link to view the event on github.com (PR/issue HTML URL, or
    /// the repo's commits page for pushes).
    pub(crate) url: String,
    /// Best-effort file path this event touched, when extractable — see the
    /// module doc's "Known limitation" for how/when this is populated.
    pub(crate) path: Option<String>,
    /// PR/issue number, when the event names one (`None` for pushes/releases,
    /// matching the mock's `num:null` on those rows).
    pub(crate) num: Option<u64>,
    /// Short freeform descriptive line (mock examples: `"opened · main ←
    /// feat/research"`, `"1 update · security advisory"`, `"tagged v5.19.0 ·
    /// 41 commits"`). Populated per event type in the `normalize_*` functions
    /// below — see this task's "open design question" note on how reliably
    /// the real Events API can back this field per kind.
    pub(crate) meta: String,
    /// Either a `{add, del}` line-diff or a short status label (mock
    /// examples: `"Approved"`, `"Closed"`, `"Bug"`, `"Latest"`, `"Patch"`).
    /// `None` when this event type has no reliable single-call source (see
    /// this task's "open design question" note).
    pub(crate) badge: Option<FeedBadge>,
    /// Unix seconds, parsed from the event's `created_at`.
    pub(crate) timestamp_unix: i64,
}

/// Mirrors the mock's `feedBadge()` renderer, which branches on whether `b`
/// is an object (`{add, del}`) or a string status label.
///
/// Both variants are struct-shaped (`Label { value: String }`, not a newtype
/// `Label(String)`) — serde's internally-tagged representation
/// (`#[serde(tag = "type")]`) cannot serialize a newtype variant wrapping a
/// primitive (it panics at runtime with "cannot serialize tagged newtype
/// variant ... containing a string"); every variant needs at least one named
/// field for the tag to be inlined alongside it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "type")]
pub(crate) enum FeedBadge {
    Diff { add: u32, del: u32 },
    Label { value: String },
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedFetchResult {
    pub(crate) items: Vec<FeedItem>,
    pub(crate) rate_limit_remaining: Option<u32>,
    pub(crate) rate_limit_reset: Option<i64>,
    /// True when at least one repo's events call failed (e.g. individually
    /// rate-limited) and was dropped rather than failing the whole feed.
    pub(crate) partial: bool,
    /// Human-readable per-repo error messages, present only when `partial`.
    pub(crate) errors: Vec<String>,
}

/// Cap and return the leading `MAX_FEED_REPOS` entries of `repos`, preserving
/// order (callers pass already-sorted-by-recency repo names from `ListRepos`).
pub(crate) fn cap_repos_for_feed(repos: &[String]) -> Vec<String> {
    repos.iter().take(MAX_FEED_REPOS).cloned().collect()
}

/// Fetch and merge events across `repos` (already capped by the caller via
/// `cap_repos_for_feed` — this function does not re-cap, so tests can exercise
/// arbitrary repo counts directly).
pub(crate) async fn fetch_feed(
    client: &reqwest::Client,
    owner: &str,
    repos: &[String],
    token: Option<&str>,
) -> FeedFetchResult {
    let mut all_items = Vec::new();
    let mut errors = Vec::new();
    let mut last_remaining = None;
    let mut last_reset = None;

    for chunk in repos.chunks(FEED_FANOUT_CHUNK_SIZE) {
        let futures = chunk
            .iter()
            .map(|repo| fetch_repo_events(client, owner, repo, token));
        let results = futures::future::join_all(futures).await;
        for (repo, result) in chunk.iter().zip(results) {
            match result {
                Ok((items, remaining, reset)) => {
                    all_items.extend(items);
                    last_remaining = remaining.or(last_remaining);
                    last_reset = reset.or(last_reset);
                }
                Err(message) => {
                    errors.push(format!("{owner}/{repo}: {message}"));
                }
            }
        }
    }

    let mut items = sort_feed_items_desc(all_items);
    items.truncate(MAX_TOTAL_FEED_ITEMS);

    FeedFetchResult {
        items,
        rate_limit_remaining: last_remaining,
        rate_limit_reset: last_reset,
        partial: !errors.is_empty(),
        errors,
    }
}

async fn fetch_repo_events(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    token: Option<&str>,
) -> Result<(Vec<FeedItem>, Option<u32>, Option<i64>), String> {
    let url =
        format!("{GITHUB_API_BASE}/repos/{owner}/{repo}/events?per_page={MAX_ITEMS_PER_REPO}");
    let mut builder = client
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = token {
        builder = builder.bearer_auth(token);
    }

    let response = builder.send().await.map_err(|err| err.to_string())?;
    let status = response.status();
    let remaining = response
        .headers()
        .get("x-ratelimit-remaining")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u32>().ok());
    let reset = response
        .headers()
        .get("x-ratelimit-reset")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok());

    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }

    let body: serde_json::Value = response.json().await.map_err(|err| err.to_string())?;
    let events = body.as_array().cloned().unwrap_or_default();
    let items = events.iter().filter_map(normalize_event).collect();
    Ok((items, remaining, reset))
}

pub(crate) fn sort_feed_items_desc(mut items: Vec<FeedItem>) -> Vec<FeedItem> {
    items.sort_by(|a, b| b.timestamp_unix.cmp(&a.timestamp_unix));
    items
}

/// Distinct repo names referenced by a set of feed items (used by the bridge
/// layer for logging/diagnostics; not required by the happy path).
#[allow(dead_code)]
pub(crate) fn distinct_repos(items: &[FeedItem]) -> HashSet<String> {
    items.iter().map(|item| item.repo.clone()).collect()
}

#[cfg(test)]
#[path = "github_feed_tests.rs"]
mod tests;
