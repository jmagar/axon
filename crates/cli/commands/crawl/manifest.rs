use serde::Serialize;
use std::collections::HashSet;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
struct CrawlAuditDiff {
    generated_at_epoch_ms: u128,
    start_url: String,
    previous_count: usize,
    current_count: usize,
    added_count: usize,
    removed_count: usize,
    unchanged_count: usize,
    cache_hit: bool,
    cache_source: Option<String>,
}

fn now_epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub(super) async fn read_manifest_urls(path: &Path) -> Result<HashSet<String>, Box<dyn Error>> {
    if !tokio::fs::try_exists(path).await.unwrap_or(false) {
        return Ok(HashSet::new());
    }
    let content = tokio::fs::read_to_string(path).await?;
    let mut out = HashSet::new();
    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(json) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let Some(url) = json.get("url").and_then(|v| v.as_str()) else {
            continue;
        };
        out.insert(url.to_string());
    }
    Ok(out)
}

pub(super) async fn write_audit_diff(
    output_dir: &Path,
    start_url: &str,
    previous: &HashSet<String>,
    current: &HashSet<String>,
    cache_hit: bool,
    cache_source: Option<String>,
) -> Result<PathBuf, Box<dyn Error>> {
    let now = now_epoch_ms();
    let unchanged_count = previous.intersection(current).count();
    let added_count = current.difference(previous).count();
    let removed_count = previous.difference(current).count();
    let report = CrawlAuditDiff {
        generated_at_epoch_ms: now,
        start_url: start_url.to_string(),
        previous_count: previous.len(),
        current_count: current.len(),
        added_count,
        removed_count,
        unchanged_count,
        cache_hit,
        cache_source,
    };

    let audit_dir = output_dir.join("reports").join("crawl-diff");
    tokio::fs::create_dir_all(&audit_dir).await?;
    let report_path = audit_dir.join(format!("diff-report-{now}.json"));
    let payload = serde_json::to_string_pretty(&report)?;
    tokio::fs::write(&report_path, payload).await?;
    Ok(report_path)
}
