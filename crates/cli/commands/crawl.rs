mod audit;
mod manifest;
mod runtime;

pub(crate) use audit::discover_sitemap_urls_with_robots;

use crate::axon_cli::crates::cli::commands::run_doctor;
use crate::axon_cli::crates::core::config::{Config, RenderMode};
use crate::axon_cli::crates::core::http::validate_url;
use crate::axon_cli::crates::core::logging::log_done;
use crate::axon_cli::crates::core::ui::{
    accent, confirm_destructive, muted, primary, print_kv, print_option, print_phase, status_text,
    symbol_for_status, Spinner,
};
use crate::axon_cli::crates::crawl::engine::{
    append_sitemap_backfill, run_crawl_once, should_fallback_to_chrome,
};
use crate::axon_cli::crates::jobs::crawl_jobs_v2::{
    cancel_job, cleanup_jobs, clear_jobs, get_job, list_jobs, recover_stale_crawl_jobs, run_worker,
    start_crawl_job,
};
use crate::axon_cli::crates::jobs::embed_jobs::start_embed_job;
use std::collections::HashSet;
use std::error::Error;
use std::time::SystemTime;
use uuid::Uuid;

pub async fn run_crawl(cfg: &Config, start_url: &str) -> Result<(), Box<dyn Error>> {
    if maybe_handle_subcommand(cfg, start_url).await? {
        return Ok(());
    }
    validate_url(start_url)?;
    if cfg.wait {
        run_sync_crawl(cfg, start_url).await
    } else {
        run_async_enqueue(cfg, start_url).await
    }
}

async fn maybe_handle_subcommand(cfg: &Config, start_url: &str) -> Result<bool, Box<dyn Error>> {
    let Some(subcmd) = cfg.positional.first().map(|s| s.as_str()) else {
        return Ok(false);
    };
    match subcmd {
        "status" => handle_status_subcommand(cfg).await?,
        "cancel" => handle_cancel_subcommand(cfg).await?,
        "errors" => handle_errors_subcommand(cfg).await?,
        "list" => handle_list_subcommand(cfg).await?,
        "cleanup" => handle_cleanup_subcommand(cfg).await?,
        "clear" => handle_clear_subcommand(cfg).await?,
        "worker" => run_worker(cfg).await?,
        "recover" => handle_recover_subcommand(cfg).await?,
        "doctor" => handle_doctor_subcommand(cfg).await?,
        "audit" => audit::run_crawl_audit(cfg, start_url).await?,
        "diff" => audit::run_crawl_audit_diff(cfg).await?,
        _ => return Ok(false),
    }
    Ok(true)
}

fn parse_required_job_id(cfg: &Config, action: &str) -> Result<Uuid, Box<dyn Error>> {
    let id = cfg
        .positional
        .get(1)
        .ok_or_else(|| format!("crawl {action} requires <job-id>"))?;
    Ok(Uuid::parse_str(id)?)
}

fn print_status_metrics(metrics: &serde_json::Value) {
    let md_created = metrics
        .get("md_created")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let filtered_urls = metrics
        .get("filtered_urls")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let pages_crawled = metrics
        .get("pages_crawled")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let pages_discovered = metrics
        .get("pages_discovered")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let sitemap_written = metrics
        .get("sitemap_written")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let sitemap_candidates = metrics
        .get("sitemap_candidates")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let pages_target = pages_discovered.saturating_sub(filtered_urls);
    let thin_md = metrics.get("thin_md").and_then(|v| v.as_u64()).unwrap_or(0);
    let thin_pct = if pages_discovered > 0 {
        (thin_md as f64 / pages_discovered as f64) * 100.0
    } else {
        0.0
    };
    println!("  {} {}", muted("md created:"), md_created);
    println!("  {} {}", muted("pages target:"), pages_target);
    println!("  {} {:.1}%", muted("thin % of discovered:"), thin_pct);
    println!("  {} {}", muted("filtered urls:"), filtered_urls);
    println!("  {} {}", muted("pages crawled:"), pages_crawled);
    println!("  {} {}", muted("pages discovered:"), pages_discovered);
    if sitemap_candidates > 0 || sitemap_written > 0 {
        println!(
            "  {} {}/{}",
            muted("sitemap written/candidates:"),
            sitemap_written,
            sitemap_candidates
        );
    }
}

fn print_job_not_found(id: Uuid) {
    println!(
        "{} {}",
        symbol_for_status("error"),
        muted(&format!("job not found: {id}"))
    );
}

async fn handle_status_subcommand(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let id = parse_required_job_id(cfg, "status")?;
    match get_job(cfg, id).await? {
        Some(job) if cfg.json_output => {
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "id": job.id,
                    "url": job.url,
                    "status": job.status,
                    "created_at": job.created_at,
                    "updated_at": job.updated_at,
                    "started_at": job.started_at,
                    "finished_at": job.finished_at,
                    "error": job.error_text,
                    "metrics": job.result_json,
                }))?
            );
        }
        Some(job) => {
            print_kv("Crawl Status for", &job.id.to_string());
            println!(
                "  {} {}",
                symbol_for_status(&job.status),
                status_text(&job.status)
            );
            println!("  {} {}", muted("URL:"), job.url);
            println!("  {} {}", muted("Created:"), job.created_at);
            println!("  {} {}", muted("Updated:"), job.updated_at);
            if let Some(err) = job.error_text.as_deref() {
                println!("  {} {}", muted("Error:"), err);
            }
            if let Some(metrics) = job.result_json.as_ref() {
                print_status_metrics(metrics);
            }
            println!();
            println!("Job ID: {}", job.id);
        }
        None => print_job_not_found(id),
    }
    Ok(())
}

async fn handle_cancel_subcommand(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let id = parse_required_job_id(cfg, "cancel")?;
    let canceled = cancel_job(cfg, id).await?;
    if cfg.json_output {
        println!(
            "{}",
            serde_json::json!({"id": id, "canceled": canceled, "source": "rust"})
        );
    } else if canceled {
        println!(
            "{} canceled crawl job {}",
            symbol_for_status("canceled"),
            accent(&id.to_string())
        );
        println!("Job ID: {id}");
    } else {
        println!(
            "{} no cancellable crawl job found for {}",
            symbol_for_status("error"),
            accent(&id.to_string())
        );
        println!("Job ID: {id}");
    }
    Ok(())
}

async fn handle_errors_subcommand(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let id = parse_required_job_id(cfg, "errors")?;
    match get_job(cfg, id).await? {
        Some(job) if cfg.json_output => {
            println!(
                "{}",
                serde_json::json!({"id": id, "status": job.status, "error": job.error_text})
            );
        }
        Some(job) => {
            println!(
                "{} {} {}",
                symbol_for_status(&job.status),
                accent(&id.to_string()),
                status_text(&job.status)
            );
            println!(
                "  {} {}",
                muted("Error:"),
                job.error_text.unwrap_or_else(|| "None".to_string())
            );
            println!("Job ID: {id}");
        }
        None => print_job_not_found(id),
    }
    Ok(())
}

async fn handle_list_subcommand(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let jobs = list_jobs(cfg, 50).await?;
    if cfg.json_output {
        println!("{}", serde_json::to_string_pretty(&jobs)?);
    } else {
        println!("{}", primary("Crawl Jobs"));
        if jobs.is_empty() {
            println!("  {}", muted("No crawl jobs found."));
        } else {
            for job in jobs {
                println!(
                    "  {} {} {} {}",
                    symbol_for_status(&job.status),
                    accent(&job.id.to_string()),
                    status_text(&job.status),
                    muted(&job.url)
                );
            }
        }
    }
    Ok(())
}

async fn handle_cleanup_subcommand(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let removed = cleanup_jobs(cfg).await?;
    if cfg.json_output {
        println!("{}", serde_json::json!({"removed": removed}));
    } else {
        println!(
            "{} removed {} crawl jobs",
            symbol_for_status("completed"),
            removed
        );
    }
    Ok(())
}

async fn handle_clear_subcommand(cfg: &Config) -> Result<(), Box<dyn Error>> {
    if !confirm_destructive(cfg, "Clear all crawl jobs and purge crawl queue?")? {
        if cfg.json_output {
            println!(
                "{}",
                serde_json::json!({"removed": 0, "queue_purged": false})
            );
        } else {
            println!("{} aborted", symbol_for_status("canceled"));
        }
        return Ok(());
    }
    let removed = clear_jobs(cfg).await?;
    if cfg.json_output {
        println!(
            "{}",
            serde_json::json!({"removed": removed, "queue_purged": true})
        );
    } else {
        println!(
            "{} cleared {} crawl jobs and purged queue",
            symbol_for_status("completed"),
            removed
        );
    }
    Ok(())
}

async fn handle_recover_subcommand(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let reclaimed = recover_stale_crawl_jobs(cfg).await?;
    if cfg.json_output {
        println!("{}", serde_json::json!({"reclaimed": reclaimed}));
    } else {
        println!(
            "{} reclaimed {} stale crawl jobs",
            symbol_for_status("completed"),
            reclaimed
        );
    }
    Ok(())
}

async fn handle_doctor_subcommand(cfg: &Config) -> Result<(), Box<dyn Error>> {
    eprintln!("{}", muted("`crawl doctor` is deprecated; use `doctor`."));
    run_doctor(cfg).await
}

fn print_async_options(
    cfg: &Config,
    start_url: &str,
    chrome_bootstrap: &runtime::ChromeBootstrapOutcome,
) {
    print_phase("◐", "Crawling", start_url);
    println!("  {}", primary("Options:"));
    print_option("maxDepth", &cfg.max_depth.to_string());
    print_option("allowSubdomains", &cfg.include_subdomains.to_string());
    print_option("respectRobotsTxt", &cfg.respect_robots.to_string());
    print_option("renderMode", &format!("{:?}", cfg.render_mode));
    print_option("discoverSitemaps", &cfg.discover_sitemaps.to_string());
    print_option("cache", &cfg.cache.to_string());
    print_option("cacheSkipBrowser", &cfg.cache_skip_browser.to_string());
    print_option(
        "chromeRemote",
        cfg.chrome_remote_url.as_deref().unwrap_or("auto/local"),
    );
    print_option("chromeProxy", cfg.chrome_proxy.as_deref().unwrap_or("none"));
    print_option(
        "chromeUserAgent",
        cfg.chrome_user_agent.as_deref().unwrap_or("spider-default"),
    );
    print_option("chromeHeadless", &cfg.chrome_headless.to_string());
    print_option("chromeAntiBot", &cfg.chrome_anti_bot.to_string());
    print_option("chromeStealth", &cfg.chrome_stealth.to_string());
    print_option("chromeIntercept", &cfg.chrome_intercept.to_string());
    print_option("chromeBootstrap", &cfg.chrome_bootstrap.to_string());
    print_option(
        "webdriverFallbackUrl",
        cfg.webdriver_url.as_deref().unwrap_or("none"),
    );
    print_option("embed", &cfg.embed.to_string());
    print_option("wait", &cfg.wait.to_string());
    if runtime::chrome_runtime_requested(cfg) {
        print_option(
            "chromeBootstrapReady",
            &chrome_bootstrap.remote_ready.to_string(),
        );
        print_option(
            "chromeRuntimeMode",
            match chrome_bootstrap.mode {
                runtime::ChromeRuntimeMode::Chrome => "chrome",
                runtime::ChromeRuntimeMode::WebDriverFallback => "webdriver-fallback",
            },
        );
    }
}

async fn run_async_enqueue(cfg: &Config, start_url: &str) -> Result<(), Box<dyn Error>> {
    let chrome_bootstrap = runtime::bootstrap_chrome_runtime(cfg).await;
    print_async_options(cfg, start_url, &chrome_bootstrap);
    println!();
    for warning in &chrome_bootstrap.warnings {
        println!("{} {}", muted("[Chrome Bootstrap]"), warning);
    }

    let job_id = start_crawl_job(cfg, start_url).await?;
    println!(
        "  {}",
        muted(
            "Async enqueue mode skips sitemap preflight; worker performs discovery during crawl."
        )
    );
    if cfg.embed {
        println!(
            "  {}",
            muted("Embedding job will be queued automatically after crawl completion.")
        );
    }
    println!("  {} {}", primary("Crawl Job"), accent(&job_id.to_string()));
    println!(
        "  {}",
        muted(&format!("Check status: axon crawl status {job_id}"))
    );
    println!();
    println!("Job ID: {job_id}");
    Ok(())
}

fn manifest_cache_is_stale(manifest_path: &std::path::Path, ttl_secs: u64) -> bool {
    manifest_path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|mtime| SystemTime::now().duration_since(mtime).ok())
        .is_some_and(|age| age.as_secs() > ttl_secs)
}

async fn maybe_return_cached_result(
    cfg: &Config,
    start_url: &str,
    manifest_path: &std::path::Path,
    previous_urls: &HashSet<String>,
) -> Result<bool, Box<dyn Error>> {
    let cache_stale = manifest_cache_is_stale(manifest_path, 24 * 60 * 60);
    if !cfg.cache || previous_urls.is_empty() || cache_stale {
        return Ok(false);
    }
    let report_path = manifest::write_audit_diff(
        &cfg.output_dir,
        start_url,
        previous_urls,
        previous_urls,
        true,
        Some(manifest_path.to_string_lossy().to_string()),
    )
    .await?;
    log_done(&format!(
        "command=crawl cache_hit=true cached_urls={} output_dir={} audit_report={}",
        previous_urls.len(),
        cfg.output_dir.to_string_lossy(),
        report_path.to_string_lossy()
    ));
    Ok(true)
}

async fn run_sync_crawl(cfg: &Config, start_url: &str) -> Result<(), Box<dyn Error>> {
    let manifest_path = cfg.output_dir.join("manifest.jsonl");
    let previous_urls = if cfg.cache {
        manifest::read_manifest_urls(&manifest_path).await?
    } else {
        HashSet::new()
    };
    if maybe_return_cached_result(cfg, start_url, &manifest_path, &previous_urls).await? {
        return Ok(());
    }

    let initial_mode = runtime::resolve_initial_mode(cfg);
    let chrome_bootstrap = runtime::bootstrap_chrome_runtime(cfg).await;
    for warning in &chrome_bootstrap.warnings {
        println!("{} {}", muted("[Chrome Bootstrap]"), warning);
    }

    let spinner = Spinner::new("running crawl");
    let (http_summary, http_seen_urls) =
        run_crawl_once(cfg, start_url, initial_mode, &cfg.output_dir, None).await?;
    spinner.finish(&format!(
        "crawl phase complete (pages={}, markdown={})",
        http_summary.pages_seen, http_summary.markdown_files
    ));

    // AutoSwitch: if HTTP produced no markdown, retry with Chrome (safe to wipe — nothing to lose).
    let (summary, seen_urls) = if matches!(cfg.render_mode, RenderMode::AutoSwitch)
        && should_fallback_to_chrome(&http_summary, cfg.max_pages)
    {
        let chrome_spinner = Spinner::new("HTTP yielded thin results; retrying with Chrome");
        match run_crawl_once(cfg, start_url, RenderMode::Chrome, &cfg.output_dir, None).await {
            Ok((chrome_summary, chrome_urls)) => {
                chrome_spinner.finish(&format!(
                    "Chrome fallback complete (pages={}, markdown={})",
                    chrome_summary.pages_seen, chrome_summary.markdown_files
                ));
                (chrome_summary, chrome_urls)
            }
            Err(err) => {
                chrome_spinner.finish(&format!(
                    "Chrome fallback failed ({err}), using HTTP result"
                ));
                (http_summary, http_seen_urls)
            }
        }
    } else {
        (http_summary, http_seen_urls)
    };

    let mut final_summary = summary;

    if cfg.discover_sitemaps {
        let spinner = Spinner::new("running sitemap backfill");
        let _ = append_sitemap_backfill(
            cfg,
            start_url,
            &cfg.output_dir,
            &seen_urls,
            &mut final_summary,
        )
        .await?;
        let robots_stats = audit::append_robots_backfill(
            cfg,
            start_url,
            &cfg.output_dir,
            &seen_urls,
            &mut final_summary,
        )
        .await?;
        spinner.finish(&format!(
            "sitemap backfill complete (robots_extra_written={})",
            robots_stats.written
        ));
    }

    if cfg.embed {
        let markdown_dir = cfg.output_dir.join("markdown");
        let embed_job_id = start_embed_job(cfg, &markdown_dir.to_string_lossy()).await?;
        println!(
            "{} {}",
            muted("Queued embed job:"),
            accent(&embed_job_id.to_string())
        );
    }

    let current_urls = manifest::read_manifest_urls(&manifest_path).await?;
    let report_path = manifest::write_audit_diff(
        &cfg.output_dir,
        start_url,
        &previous_urls,
        &current_urls,
        false,
        None,
    )
    .await?;
    log_done(&format!(
        "command=crawl pages_seen={} markdown_files={} thin_pages={} elapsed_ms={} output_dir={} audit_report={}",
        final_summary.pages_seen,
        final_summary.markdown_files,
        final_summary.thin_pages,
        final_summary.elapsed_ms,
        cfg.output_dir.to_string_lossy(),
        report_path.to_string_lossy(),
    ));
    Ok(())
}
