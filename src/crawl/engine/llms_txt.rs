use super::CrawlSummary;
use super::sitemap::{
    BackfillStats, append_candidate_backfill, fetch_text_with_retry, loc_in_scope,
};
use crate::core::config::Config;
use crate::core::http::build_client;
use crate::core::logging::log_info;
use pulldown_cmark::{Event, Parser, Tag};
use spider::url::Url;
use std::collections::HashSet;
use std::error::Error;
use std::path::Path;

fn request_timeout_secs(cfg: &Config) -> u64 {
    cfg.request_timeout_ms
        .unwrap_or(30_000)
        .div_ceil(1000)
        .max(1)
}

/// Strip a leading UTF-8 BOM and check for a markdown H1 — a cheap soft-404 guard.
/// Many CMS hosts serve an HTML "not found" page at /llms.txt with HTTP 200.
pub(crate) fn looks_like_llms_txt(body: &str) -> bool {
    let s = body.strip_prefix('\u{feff}').unwrap_or(body).trim_start();
    s.starts_with("# ") || s.starts_with("#\t")
}

/// Extract every markdown hyperlink destination, resolve relatives against `base_url`,
/// drop non-fetchable schemes, and strip fragments. Returns absolute http(s) URLs.
pub(crate) fn extract_llms_txt_links(body: &str, base_url: &str) -> Vec<String> {
    let body = body.strip_prefix('\u{feff}').unwrap_or(body);
    let Ok(base) = Url::parse(base_url) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for event in Parser::new(body) {
        let Event::Start(Tag::Link { dest_url, .. }) = event else {
            continue;
        };
        let dest = dest_url.trim();
        // Skip fragments and non-fetchable schemes before resolution.
        if dest.is_empty()
            || dest.starts_with('#')
            || dest.starts_with("mailto:")
            || dest.starts_with("tel:")
            || dest.starts_with("javascript:")
            || dest.starts_with("data:")
        {
            continue;
        }
        // base.join resolves relative, absolute-path, protocol-relative, and absolute URLs.
        let Ok(mut resolved) = base.join(dest) else {
            continue;
        };
        if resolved.scheme() != "http" && resolved.scheme() != "https" {
            continue;
        }
        resolved.set_fragment(None);
        out.push(resolved.to_string());
    }
    out
}

/// Probe `/llms.txt` at the site root, parse links, scope + dedupe + cap them.
pub async fn discover_llms_txt_urls(
    cfg: &Config,
    start_url: &str,
) -> Result<Vec<String>, Box<dyn Error>> {
    let parsed = Url::parse(start_url)
        .map_err(|e| format!("invalid start URL for llms.txt discovery {start_url}: {e}"))?;
    let scheme = parsed.scheme();
    let bare_host = parsed
        .host_str()
        .ok_or_else(|| format!("missing host in llms.txt start URL {start_url}"))?
        .to_string();
    let host = match parsed.port() {
        Some(port) => format!("{bare_host}:{port}"),
        None => bare_host.clone(),
    };
    let llms_url = format!("{scheme}://{host}/llms.txt");

    // SSRF-guarded client (redirect revalidation + DNS-rebind guard live here).
    let client = build_client(request_timeout_secs(cfg), None)
        .map_err(|e| format!("failed to build HTTP client for llms.txt discovery: {e}"))?;

    let Some(body) =
        fetch_text_with_retry(&client, &llms_url, cfg.fetch_retries, cfg.retry_backoff_ms).await
    else {
        return Ok(Vec::new());
    };
    if !looks_like_llms_txt(&body) {
        log_info(&format!("command=llms_txt no_valid_file url={llms_url}"));
        return Ok(Vec::new());
    }

    // Scope: mirror sitemap's scoped_to_root derivation from the start path.
    let start_path = parsed.path().trim_end_matches('/').to_string();
    let segment_count = start_path.split('/').filter(|s| !s.is_empty()).count();
    let scoped_to_root = start_path.is_empty() || segment_count <= 1;

    let mut seen = HashSet::new();
    let mut urls: Vec<String> = extract_llms_txt_links(&body, &llms_url)
        .into_iter()
        .filter_map(|loc| loc_in_scope(cfg, &loc, &bare_host, &start_path, scoped_to_root))
        .filter(|u| seen.insert(u.clone()))
        .collect();

    // Mandatory fan-out cap (0 = unlimited).
    if cfg.max_llms_txt_urls != 0 && urls.len() > cfg.max_llms_txt_urls {
        urls.truncate(cfg.max_llms_txt_urls);
    }
    urls.sort();
    log_info(&format!(
        "command=llms_txt discovered_urls={} url={llms_url}",
        urls.len()
    ));
    Ok(urls)
}

/// Discover llms.txt URLs, fetch new ones, convert to markdown, and append to the manifest.
/// Mirrors `append_sitemap_backfill`. Updates `summary.markdown_files`/`thin_pages`.
pub async fn append_llms_txt_backfill(
    cfg: &Config,
    start_url: &str,
    output_dir: &Path,
    seen_urls: &HashSet<String>,
    summary: &mut CrawlSummary,
) -> Result<BackfillStats, Box<dyn Error>> {
    let urls = discover_llms_txt_urls(cfg, start_url).await?;
    if urls.is_empty() {
        return Ok(BackfillStats::default());
    }
    let discovered = urls.len();
    let (mut stats, _) =
        append_candidate_backfill(cfg, output_dir, seen_urls, urls, summary).await?;
    stats.discovered_urls = discovered;
    log_info(&format!(
        "llms_txt backfill_complete urls_added={}",
        stats.written
    ));
    Ok(stats)
}

#[cfg(test)]
#[path = "llms_txt_tests.rs"]
mod tests;
