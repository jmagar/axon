use super::{
    canonicalize_url_for_dedupe, is_excluded_url_path, CrawlSummary, SitemapBackfillStats,
};
use crate::axon_cli::crates::core::config::Config;
use crate::axon_cli::crates::core::content::{extract_loc_values, to_markdown, url_to_filename};
use crate::axon_cli::crates::core::http::validate_url;
use crate::axon_cli::crates::core::logging::log_info;
use spider::tokio;
use spider::url::Url;
use std::collections::{HashSet, VecDeque};
use std::error::Error;
use std::path::Path;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

fn should_retry_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

async fn fetch_text_with_retry(
    client: &reqwest::Client,
    url: &str,
    retries: usize,
    backoff_ms: u64,
) -> Option<String> {
    if validate_url(url).is_err() {
        return None;
    }
    let mut attempt = 0usize;
    loop {
        match client.get(url).send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    return resp.text().await.ok();
                }
                if attempt >= retries || !should_retry_status(status) {
                    return None;
                }
            }
            Err(_) if attempt >= retries => return None,
            Err(_) => {}
        }

        attempt = attempt.saturating_add(1);
        tokio::time::sleep(Duration::from_millis(
            backoff_ms.saturating_mul(attempt as u64).max(1),
        ))
        .await;
    }
}

pub async fn crawl_sitemap_urls(
    cfg: &Config,
    start_url: &str,
) -> Result<Vec<String>, Box<dyn Error>> {
    let parsed = Url::parse(start_url)?;
    let scheme = parsed.scheme().to_string();
    let host = parsed.host_str().ok_or("missing host")?.to_string();

    let mut queue = VecDeque::new();
    queue.push_back(format!("{scheme}://{host}/sitemap.xml"));
    queue.push_back(format!("{scheme}://{host}/sitemap_index.xml"));
    queue.push_back(format!("{scheme}://{host}/sitemap-index.xml"));

    let mut seen_sitemaps = HashSet::new();
    let mut out = HashSet::new();
    let timeout = Duration::from_millis(cfg.request_timeout_ms.unwrap_or(30_000));
    let client = reqwest::Client::builder().timeout(timeout).build()?;
    let start_host = host.clone();
    let start_path = parsed.path().trim_end_matches('/').to_string();
    let scoped_to_root = start_path.is_empty();
    let worker_limit = cfg.sitemap_concurrency_limit.unwrap_or(64).clamp(1, 1024);
    let max_sitemaps = cfg.max_sitemaps.max(1);
    let mut parsed_sitemaps = 0usize;

    while !queue.is_empty() && parsed_sitemaps < max_sitemaps {
        let mut batch = Vec::new();
        while batch.len() < worker_limit && parsed_sitemaps + batch.len() < max_sitemaps {
            let Some(url) = queue.pop_front() else {
                break;
            };
            if seen_sitemaps.insert(url.clone()) {
                batch.push(url);
            }
        }
        if batch.is_empty() {
            break;
        }

        let mut joins = tokio::task::JoinSet::new();
        for sitemap_url in batch {
            let http = client.clone();
            let retries = cfg.fetch_retries;
            let backoff = cfg.retry_backoff_ms;
            joins.spawn(async move {
                fetch_text_with_retry(&http, &sitemap_url, retries, backoff)
                    .await
                    .map(|xml| (sitemap_url, xml))
            });
        }

        while let Some(joined) = joins.join_next().await {
            let Ok(Some((_sitemap_url, xml))) = joined else {
                continue;
            };
            parsed_sitemaps += 1;
            let is_index = xml.to_ascii_lowercase().contains("<sitemapindex");
            for loc in extract_loc_values(&xml) {
                let Ok(u) = Url::parse(&loc) else {
                    continue;
                };
                let Some(h) = u.host_str() else {
                    continue;
                };
                let in_scope = if cfg.include_subdomains {
                    h == start_host || h.ends_with(&format!(".{start_host}"))
                } else {
                    h == start_host
                };
                if !in_scope {
                    continue;
                }
                if is_excluded_url_path(&loc, &cfg.exclude_path_prefix) {
                    continue;
                }
                if !scoped_to_root {
                    let p = u.path();
                    let exact = p == start_path;
                    let nested = p.starts_with(&(start_path.clone() + "/"));
                    if !exact && !nested {
                        continue;
                    }
                }

                let Some(canonical_loc) = canonicalize_url_for_dedupe(&loc) else {
                    continue;
                };

                if is_index {
                    if !seen_sitemaps.contains(&canonical_loc) {
                        queue.push_back(canonical_loc);
                    }
                } else {
                    out.insert(canonical_loc);
                }
            }
            if parsed_sitemaps.is_multiple_of(64) {
                log_info(&format!(
                    "command=sitemap parsed={} discovered_urls={} queue={}",
                    parsed_sitemaps,
                    out.len(),
                    queue.len()
                ));
            }
        }
    }

    let mut urls: Vec<String> = out.into_iter().collect();
    urls.sort();
    Ok(urls)
}

pub async fn append_sitemap_backfill(
    cfg: &Config,
    start_url: &str,
    output_dir: &Path,
    seen_urls: &HashSet<String>,
    summary: &mut CrawlSummary,
) -> Result<SitemapBackfillStats, Box<dyn Error>> {
    let sitemap_urls = crawl_sitemap_urls(cfg, start_url).await?;
    let sitemap_discovered = sitemap_urls.len();
    log_info(&format!(
        "command=crawl sitemap_backfill_discovered={} concurrency={}",
        sitemap_discovered,
        cfg.backfill_concurrency_limit
            .unwrap_or(cfg.batch_concurrency)
            .max(1)
    ));
    let markdown_dir = output_dir.join("markdown");
    let manifest_path = output_dir.join("manifest.jsonl");
    let manifest_file = tokio::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(&manifest_path)
        .await?;
    let mut manifest = tokio::io::BufWriter::new(manifest_file);

    let timeout = Duration::from_millis(cfg.request_timeout_ms.unwrap_or(30_000));
    let client = reqwest::Client::builder().timeout(timeout).build()?;
    let mut idx = summary.markdown_files;
    let mut processed: usize = 0;
    let mut fetched_ok: usize = 0;
    let mut written: usize = 0;
    let mut failed_fetches: usize = 0;

    let mut pending = tokio::task::JoinSet::new();
    let candidates_vec: Vec<String> = sitemap_urls
        .into_iter()
        .filter(|url| {
            !seen_urls.contains(url) && !is_excluded_url_path(url, &cfg.exclude_path_prefix)
        })
        .collect();
    let sitemap_candidates = candidates_vec.len();
    let mut candidates = candidates_vec.into_iter();
    let concurrency = cfg
        .backfill_concurrency_limit
        .unwrap_or(cfg.batch_concurrency)
        .max(1);

    let push_task = |set: &mut tokio::task::JoinSet<(String, Result<String, String>)>,
                     url: String,
                     http: reqwest::Client,
                     retries: usize,
                     backoff_ms: u64| {
        set.spawn(async move {
            let result = fetch_text_with_retry(&http, &url, retries, backoff_ms)
                .await
                .ok_or_else(|| format!("fetch failed for {url}"));
            (url, result)
        });
    };

    for _ in 0..concurrency {
        if let Some(url) = candidates.next() {
            push_task(
                &mut pending,
                url,
                client.clone(),
                cfg.fetch_retries,
                cfg.retry_backoff_ms,
            );
        }
    }

    while let Some(joined) = pending.join_next().await {
        processed += 1;
        match joined {
            Ok((url, Ok(html))) => {
                fetched_ok += 1;
                let md = to_markdown(&html);
                let chars = md.chars().count();
                if chars < cfg.min_markdown_chars {
                    summary.thin_pages += 1;
                }

                if chars >= cfg.min_markdown_chars || !cfg.drop_thin_markdown {
                    idx += 1;
                    let file = markdown_dir.join(url_to_filename(&url, idx));
                    tokio::fs::write(&file, md).await?;
                    let rec = serde_json::json!({
                        "url": url,
                        "file_path": file.to_string_lossy(),
                        "markdown_chars": chars,
                        "source": "sitemap_backfill"
                    });
                    let mut line = rec.to_string();
                    line.push('\n');
                    manifest.write_all(line.as_bytes()).await?;
                    summary.markdown_files += 1;
                    written += 1;
                }
            }
            Ok((_url, Err(_err))) => {
                failed_fetches += 1;
            }
            Err(_err) => {
                failed_fetches += 1;
            }
        }

        if processed.is_multiple_of(50) {
            log_info(&format!(
                "command=crawl sitemap_backfill_progress processed={} fetched_ok={} written={} failed={}",
                processed, fetched_ok, written, failed_fetches
            ));
        }

        if let Some(url) = candidates.next() {
            push_task(
                &mut pending,
                url,
                client.clone(),
                cfg.fetch_retries,
                cfg.retry_backoff_ms,
            );
        }
    }

    manifest.flush().await?;
    log_info(&format!(
        "command=crawl sitemap_backfill_complete processed={} fetched_ok={} written={} failed={}",
        processed, fetched_ok, written, failed_fetches
    ));
    Ok(SitemapBackfillStats {
        sitemap_discovered,
        sitemap_candidates,
        processed,
        fetched_ok,
        written,
        failed: failed_fetches,
        filtered: processed.saturating_sub(written),
    })
}
