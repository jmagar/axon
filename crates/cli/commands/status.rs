use crate::axon_cli::crates::core::config::Config;
use crate::axon_cli::crates::core::ui::{accent, muted, primary, status_text, symbol_for_status};
use crate::axon_cli::crates::jobs::batch_jobs::list_batch_jobs;
use crate::axon_cli::crates::jobs::crawl_jobs::list_jobs;
use crate::axon_cli::crates::jobs::embed_jobs::list_embed_jobs;
use crate::axon_cli::crates::jobs::extract_jobs::list_extract_jobs;
use std::error::Error;

pub async fn run_status(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let (crawl_jobs, batch_jobs, extract_jobs, embed_jobs) = spider::tokio::try_join!(
        async { list_jobs(cfg, 20).await.map_err(|e| format!("crawl status lookup failed: {e}")) },
        async { list_batch_jobs(cfg, 20).await.map_err(|e| format!("batch status lookup failed: {e}")) },
        async { list_extract_jobs(cfg, 20).await.map_err(|e| format!("extract status lookup failed: {e}")) },
        async { list_embed_jobs(cfg, 20).await.map_err(|e| format!("embed status lookup failed: {e}")) },
    )?;

    if cfg.json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "local_crawl_jobs": crawl_jobs,
                "local_batch_jobs": batch_jobs,
                "local_extract_jobs": extract_jobs,
                "local_embed_jobs": embed_jobs
            }))?
        );
    } else {
        println!("{}", primary("Job Status (all)"));
        println!(
            "  {} {} | {} {} | {} {} | {} {}",
            muted("Crawl:"),
            crawl_jobs.len(),
            muted("Batch:"),
            batch_jobs.len(),
            muted("Extract:"),
            extract_jobs.len(),
            muted("Embed:"),
            embed_jobs.len()
        );
        println!();

        println!("{}", primary("◐ Crawls"));
        println!(
            "  {}",
            muted("m=md_created t=thin_md f=filtered c=crawled d=discovered")
        );
        if crawl_jobs.is_empty() {
            println!("  {}", muted("None."));
        } else {
            for job in crawl_jobs.iter().take(5) {
                let mut metrics_suffix = String::new();
                if job.status == "completed" {
                    if let Some(metrics) = job.result_json.as_ref() {
                        let md_created = metrics
                            .get("md_created")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        let thin_md = metrics
                            .get("thin_md")
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
                        metrics_suffix = format!(
                            " {}",
                            muted(&format!(
                                "m{} t{} f{} c{} d{}",
                                md_created, thin_md, filtered_urls, pages_crawled, pages_discovered
                            ))
                        );
                    }
                }
                println!(
                    "  {} {} {} {}{}",
                    symbol_for_status(&job.status),
                    accent(&job.id.to_string()),
                    status_text(&job.status),
                    muted(&job.url),
                    metrics_suffix
                );
            }
        }
        println!();

        println!("{}", primary("◐ Batches"));
        if batch_jobs.is_empty() {
            println!("  {}", muted("None."));
        } else {
            for job in batch_jobs.iter().take(5) {
                println!(
                    "  {} {} {}",
                    symbol_for_status(&job.status),
                    accent(&job.id.to_string()),
                    status_text(&job.status)
                );
            }
        }
        println!();

        println!("{}", primary("◐ Extracts"));
        if extract_jobs.is_empty() {
            println!("  {}", muted("None."));
        } else {
            for job in extract_jobs.iter().take(5) {
                println!(
                    "  {} {} {}",
                    symbol_for_status(&job.status),
                    accent(&job.id.to_string()),
                    status_text(&job.status)
                );
            }
        }
        println!();

        println!("{}", primary("◐ Embeds"));
        if embed_jobs.is_empty() {
            println!("  {}", muted("None."));
        } else {
            for job in embed_jobs.iter().take(5) {
                println!(
                    "  {} {} {}",
                    symbol_for_status(&job.status),
                    accent(&job.id.to_string()),
                    status_text(&job.status)
                );
            }
        }
    }
    Ok(())
}
