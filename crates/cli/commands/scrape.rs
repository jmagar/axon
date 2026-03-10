use super::common::parse_urls;
use crate::crates::core::config::Config;
use crate::crates::core::content::{
    build_selector_config, extract_meta_description, find_between, to_markdown, url_to_filename,
};
use crate::crates::core::http::{normalize_url, validate_url};
use crate::crates::core::logging::{log_done, log_info, log_warn};
use crate::crates::core::ui::{muted, primary, print_option, print_phase};
use crate::crates::crawl::scrape::{build_scrape_website, fetch_single_page, select_output};
use crate::crates::vector::ops::embed_path_native;
use futures_util::future::join_all;
use std::error::Error;
use uuid::Uuid;

pub async fn run_scrape(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let urls = parse_urls(cfg);
    if urls.is_empty() {
        return Err("scrape requires at least one URL (positional or --urls)".into());
    }
    if cfg.output_path.is_some() && urls.len() > 1 {
        return Err(
            "--output cannot be used with multiple URLs (each would overwrite the same file)"
                .into(),
        );
    }
    log_info(&format!(
        "command=scrape urls={} format={:?} wait={}",
        urls.len(),
        cfg.format,
        cfg.wait
    ));

    // Phase 1: scrape all URLs concurrently — each prints its result as it lands.
    let tasks: Vec<_> = urls.iter().map(|url| scrape_one(cfg, url)).collect();
    let mut to_embed: Vec<(String, String)> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    for result in join_all(tasks).await {
        match result {
            Ok(Some(pair)) => to_embed.push(pair),
            Ok(None) => {}
            Err(e) => {
                log_warn(&format!("scrape error={e}"));
                errors.push(e.to_string());
            }
        }
    }

    // Phase 2: embed all collected markdowns in one batch (single embed_path_native call).
    // Important: write this run's files into an isolated directory so `scrape --embed`
    // only indexes current outputs, not every historical file in scrape-markdown.
    if cfg.embed && !to_embed.is_empty() {
        let run_id = Uuid::new_v4().to_string();
        let embed_dir = cfg
            .output_dir
            .join("scrape-markdown")
            .join("runs")
            .join(run_id);
        tokio::fs::create_dir_all(&embed_dir).await?;
        for (normalized, markdown) in &to_embed {
            tokio::fs::write(embed_dir.join(url_to_filename(normalized, 1)), markdown).await?;
        }
        embed_path_native(cfg, &embed_dir.to_string_lossy()).await?;
    }

    if !errors.is_empty() {
        return Err(format!("{} scrape(s) failed: {}", errors.len(), errors.join("; ")).into());
    }

    Ok(())
}

/// Returns `Some((normalized_url, markdown))` when `cfg.embed` is true so the
/// caller can batch-embed after all scrapes complete. Returns `None` otherwise.
async fn scrape_one(cfg: &Config, url: &str) -> Result<Option<(String, String)>, Box<dyn Error>> {
    let normalized = normalize_url(url);

    print_phase("◐", "Scraping", &normalized);
    println!("  {}", primary("Options:"));
    print_option("format", &format!("{:?}", cfg.format));
    print_option("renderMode", &cfg.render_mode.to_string());
    print_option("proxy", cfg.chrome_proxy.as_deref().unwrap_or("none"));
    print_option(
        "userAgent",
        cfg.chrome_user_agent.as_deref().unwrap_or("spider-default"),
    );
    print_option(
        "timeoutMs",
        &cfg.request_timeout_ms.unwrap_or(20_000).to_string(),
    );
    print_option("fetchRetries", &cfg.fetch_retries.to_string());
    print_option("retryBackoffMs", &cfg.retry_backoff_ms.to_string());
    print_option("chromeAntiBot", &cfg.chrome_anti_bot.to_string());
    print_option("chromeStealth", &cfg.chrome_stealth.to_string());
    print_option("chromeIntercept", &cfg.chrome_intercept.to_string());
    print_option("embed", &cfg.embed.to_string());
    println!();

    // SSRF guard: validate before creating Website — must run before any
    // network activity so private-IP seeds are rejected immediately.
    validate_url(&normalized)?;

    let mut website = build_scrape_website(cfg, &normalized)?;
    let page = fetch_single_page(cfg, &mut website, &normalized).await?;
    let html = page.html;
    let status_code = page.status_code;

    // Surface non-success HTTP codes as errors so callers can handle them.
    if !(200..300).contains(&status_code) {
        return Err(format!("scrape failed: HTTP {} for {}", status_code, normalized).into());
    }

    let sel_cfg = build_selector_config(cfg);
    let markdown = to_markdown(&html, sel_cfg.as_ref());
    let output = select_output(
        cfg.format,
        &normalized,
        &html,
        status_code,
        sel_cfg.as_ref(),
    )?;

    let bytes = output.len();
    if cfg.json_output {
        // Structured JSON output for web UI / machine consumers.
        // Reuse the `markdown` already computed above to avoid duplicate
        // HTML→markdown conversion.
        let json = serde_json::json!({
            "url": normalized,
            "status_code": status_code,
            "markdown": &markdown,
            "title": find_between(&html, "<title>", "</title>").unwrap_or(""),
            "description": extract_meta_description(&html).unwrap_or_default(),
        });
        println!("{json}");
        log_done(&format!(
            "command=scrape url={normalized} bytes={bytes} format={:?}",
            cfg.format
        ));
    } else if let Some(path) = &cfg.output_path {
        tokio::fs::write(path, &output).await?;
        log_done(&format!(
            "wrote output: {} url={normalized} bytes={bytes} format={:?}",
            path.to_string_lossy(),
            cfg.format
        ));
    } else {
        println!("{} {}", primary("Scrape Results for"), normalized);
        println!("{}\n", muted("As of: now"));
        println!("{output}");
        log_done(&format!(
            "command=scrape url={normalized} bytes={bytes} format={:?}",
            cfg.format
        ));
    }

    if cfg.embed {
        Ok(Some((normalized, markdown)))
    } else {
        Ok(None)
    }
}
