use super::audit;
use crate::crates::cli::commands::common::truncate_chars;
use crate::crates::cli::commands::job_contracts::{
    JobCancelResponse, JobErrorsResponse, JobStatusResponse, JobSummaryEntry,
};
use crate::crates::core::config::Config;
use crate::crates::core::ui::{
    accent, confirm_destructive, muted, primary, print_kv, status_text, symbol_for_status,
};
use crate::crates::jobs::crawl::{
    CrawlJob, cancel_job, cleanup_jobs, clear_jobs, get_job, list_jobs, recover_stale_crawl_jobs,
    run_worker,
};
use std::error::Error;
use uuid::Uuid;

pub(super) async fn maybe_handle_subcommand(cfg: &Config) -> Result<bool, Box<dyn Error>> {
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
        "audit" => {
            let url = cfg.positional.get(1).map(|s| s.as_str()).unwrap_or("");
            if url.is_empty() {
                return Err("crawl audit requires a URL argument".into());
            }
            audit::run_crawl_audit(cfg, url).await?;
        }
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
            let response = JobStatusResponse::from_crawl(&job);
            println!("{}", serde_json::to_string_pretty(&response)?);
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
            serde_json::json!(JobCancelResponse::new(id, canceled))
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
            "{} no cancellable crawl job found for ID: {}",
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
                serde_json::json!(JobErrorsResponse::from_job(
                    id,
                    job.status.clone(),
                    job.error_text.clone()
                ))
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

/// Returns a compact inline progress string for a crawl job list row.
///
/// - running:   "127 crawled · 43 docs"
/// - completed: "342 docs · 5.2s"
/// - failed:    first 60 chars of error_text
/// - other:     None
fn job_progress_summary(job: &CrawlJob) -> Option<String> {
    match job.status.as_str() {
        "running" => {
            let metrics = job.result_json.as_ref()?;
            let crawled = metrics
                .get("pages_crawled")
                .and_then(|v: &serde_json::Value| v.as_u64())
                .unwrap_or(0);
            let docs = metrics
                .get("md_created")
                .and_then(|v: &serde_json::Value| v.as_u64())
                .unwrap_or(0);
            if crawled == 0 && docs == 0 {
                return None;
            }
            if docs > 0 {
                Some(format!("{crawled} crawled · {docs} docs"))
            } else {
                Some(format!("{crawled} crawled"))
            }
        }
        "completed" => {
            let metrics = job.result_json.as_ref()?;
            let docs = metrics
                .get("md_created")
                .and_then(|v: &serde_json::Value| v.as_u64())
                .unwrap_or(0);
            let elapsed_ms = metrics
                .get("elapsed_ms")
                .and_then(|v: &serde_json::Value| v.as_u64())
                .unwrap_or(0);
            let time = if elapsed_ms >= 1000 {
                format!("{:.1}s", elapsed_ms as f64 / 1000.0)
            } else {
                format!("{elapsed_ms}ms")
            };
            Some(format!("{docs} docs · {time}"))
        }
        "failed" => {
            let err = job.error_text.as_deref().unwrap_or("unknown error");
            let truncated = if err.chars().count() > 60 {
                format!("{}…", truncate_chars(err, 60))
            } else {
                err.to_string()
            };
            Some(truncated)
        }
        _ => None,
    }
}

async fn handle_list_subcommand(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let jobs = list_jobs(cfg, 50).await?;
    if cfg.json_output {
        let entries: Vec<JobSummaryEntry> = jobs.iter().map(JobSummaryEntry::from_crawl).collect();
        println!("{}", serde_json::to_string_pretty(&entries)?);
    } else {
        println!("{}", primary("Crawl Jobs"));
        if jobs.is_empty() {
            println!("  {}", muted("No crawl jobs found."));
        } else {
            for job in &jobs {
                let progress = job_progress_summary(job);
                if let Some(p) = progress {
                    println!(
                        "  {} {} {} {}  {}",
                        symbol_for_status(&job.status),
                        accent(&job.id.to_string()),
                        status_text(&job.status),
                        muted(&job.url),
                        muted(&p),
                    );
                } else {
                    println!(
                        "  {} {} {} {}",
                        symbol_for_status(&job.status),
                        accent(&job.id.to_string()),
                        status_text(&job.status),
                        muted(&job.url),
                    );
                }
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
