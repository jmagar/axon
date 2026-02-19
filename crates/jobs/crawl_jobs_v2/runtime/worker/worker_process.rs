use crate::axon_cli::crates::core::config::Config;
use crate::axon_cli::crates::core::logging::{log_done, log_info, log_warn};
use crate::axon_cli::crates::crawl::engine::{
    append_sitemap_backfill, run_crawl_once, CrawlSummary, SitemapBackfillStats,
};
use crate::axon_cli::crates::jobs::batch_jobs::apply_queue_injection;
use crate::axon_cli::crates::jobs::embed_jobs::start_embed_job;
use redis::AsyncCommands;
use sqlx::PgPool;
use std::collections::HashSet;
use std::error::Error;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

use super::super::robots::{append_robots_backfill, RobotsBackfillStats, RobotsDiscoveryStats};
use super::super::{
    latest_completed_result_for_url, read_manifest_candidates, read_manifest_urls,
    resolve_initial_mode, write_audit_diff, CrawlJobConfig, MID_CRAWL_INJECTION_MIN_CANDIDATES,
    MID_CRAWL_INJECTION_TRIGGER_PAGES,
};

pub(super) async fn process_job(
    cfg: &Config,
    pool: &PgPool,
    id: Uuid,
) -> Result<(), Box<dyn Error>> {
    let row = sqlx::query_as::<_, (String, serde_json::Value)>(
        "SELECT url, config_json FROM axon_crawl_jobs WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    let Some((url, cfg_json)) = row else {
        return Ok(());
    };

    let redis_client = redis::Client::open(cfg.redis_url.clone())?;
    let mut redis_conn = redis_client.get_multiplexed_async_connection().await?;
    let cancel_key = format!("axon:crawl:cancel:{id}");
    let cancel_before: Option<String> = redis_conn.get(&cancel_key).await.ok();
    if cancel_before.is_some() {
        sqlx::query("UPDATE axon_crawl_jobs SET status='canceled', updated_at=NOW(), finished_at=NOW() WHERE id=$1")
            .bind(id)
            .execute(pool)
            .await?;
        return Ok(());
    }

    let parsed: CrawlJobConfig = serde_json::from_value(cfg_json)?;
    let extraction_prompt = parsed.extraction_prompt.clone();
    let mut job_cfg = cfg.clone();
    job_cfg.max_pages = parsed.max_pages;
    job_cfg.max_depth = parsed.max_depth;
    job_cfg.include_subdomains = parsed.include_subdomains;
    job_cfg.exclude_path_prefix = parsed.exclude_path_prefix;
    job_cfg.respect_robots = parsed.respect_robots;
    job_cfg.min_markdown_chars = parsed.min_markdown_chars;
    job_cfg.drop_thin_markdown = parsed.drop_thin_markdown;
    job_cfg.discover_sitemaps = parsed.discover_sitemaps;
    job_cfg.embed = parsed.embed;
    job_cfg.render_mode = parsed.render_mode;
    job_cfg.collection = parsed.collection;
    job_cfg.crawl_concurrency_limit = parsed.crawl_concurrency_limit;
    job_cfg.sitemap_concurrency_limit = parsed.sitemap_concurrency_limit;
    job_cfg.backfill_concurrency_limit = parsed.backfill_concurrency_limit;
    job_cfg.max_sitemaps = parsed.max_sitemaps.max(1);
    job_cfg.delay_ms = parsed.delay_ms;
    job_cfg.request_timeout_ms = parsed.request_timeout_ms;
    job_cfg.fetch_retries = parsed.fetch_retries;
    job_cfg.retry_backoff_ms = parsed.retry_backoff_ms;
    job_cfg.shared_queue = parsed.shared_queue;
    job_cfg.query = parsed.extraction_prompt;
    job_cfg.cache = parsed.cache;
    job_cfg.cache_skip_browser = parsed.cache_skip_browser;
    job_cfg.output_dir = PathBuf::from(parsed.output_dir)
        .join("jobs")
        .join(id.to_string());

    let mut previous_urls = HashSet::new();
    let mut cache_source: Option<String> = None;
    if job_cfg.cache {
        if let Some((previous_job_id, previous_result_json)) =
            latest_completed_result_for_url(pool, &url, id).await?
        {
            let previous_output_dir = previous_result_json
                .get("output_dir")
                .and_then(|value| value.as_str())
                .map(PathBuf::from);
            if let Some(previous_output_dir) = previous_output_dir {
                let previous_manifest = previous_output_dir.join("manifest.jsonl");
                previous_urls = read_manifest_urls(&previous_manifest).await?;
                if !previous_urls.is_empty() {
                    cache_source = Some(format!(
                        "job:{} manifest:{}",
                        previous_job_id,
                        previous_manifest.to_string_lossy()
                    ));
                }
            }
        }
    }

    if job_cfg.cache && !previous_urls.is_empty() {
        let (report_path, diff_report) = write_audit_diff(
            &job_cfg.output_dir,
            &url,
            &previous_urls,
            &previous_urls,
            true,
            cache_source.clone(),
        )
        .await?;

        let result_json = serde_json::json!({
            "phase": "completed",
            "cache_hit": true,
            "cache_skip_browser": job_cfg.cache_skip_browser,
            "md_created": previous_urls.len(),
            "thin_md": 0,
            "filtered_urls": 0,
            "pages_crawled": 0,
            "pages_discovered": previous_urls.len(),
            "crawl_stream_pages": 0,
            "sitemap_discovered": 0,
            "sitemap_candidates": 0,
            "sitemap_processed": 0,
            "sitemap_fetched_ok": 0,
            "sitemap_written": 0,
            "sitemap_failed": 0,
            "sitemap_filtered": 0,
            "elapsed_ms": 0,
            "output_dir": job_cfg.output_dir.to_string_lossy(),
            "audit_diff": diff_report,
            "audit_report_path": report_path.to_string_lossy(),
        });

        sqlx::query(
            "UPDATE axon_crawl_jobs SET status='completed', updated_at=NOW(), finished_at=NOW(), error_text=NULL, result_json=$2 WHERE id=$1 AND status='running'",
        )
        .bind(id)
        .bind(result_json)
        .execute(pool)
        .await?;
        log_done(&format!("worker completed crawl job {id} (cache hit)"));
        return Ok(());
    }

    let manifest_path = job_cfg.output_dir.join("manifest.jsonl");
    let mid_injection_state = Arc::new(tokio::sync::Mutex::new(None::<serde_json::Value>));
    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel::<CrawlSummary>();
    let progress_pool = pool.clone();
    let progress_job_id = id;
    let progress_cfg = job_cfg.clone();
    let progress_prompt = extraction_prompt.clone();
    let progress_manifest_path = manifest_path.clone();
    let progress_injection_state = Arc::clone(&mid_injection_state);
    let progress_task = tokio::spawn(async move {
        let mut injection_attempted = false;
        while let Some(progress) = progress_rx.recv().await {
            let pages_crawled = progress.pages_seen as u64;
            let filtered_urls = pages_crawled.saturating_sub(progress.markdown_files as u64);

            if !injection_attempted && progress.pages_seen >= MID_CRAWL_INJECTION_TRIGGER_PAGES {
                match read_manifest_candidates(&progress_manifest_path).await {
                    Ok(candidates) if candidates.len() >= MID_CRAWL_INJECTION_MIN_CANDIDATES => {
                        let injection = match apply_queue_injection(
                            &progress_cfg,
                            &candidates,
                            progress_prompt.as_deref(),
                            "mid-crawl",
                            true,
                        )
                        .await
                        {
                            Ok(value) => value,
                            Err(err) => serde_json::json!({
                                "phase": "mid-crawl",
                                "queue_status": "failed",
                                "error": err.to_string(),
                            }),
                        };
                        *progress_injection_state.lock().await = Some(injection);
                        injection_attempted = true;
                    }
                    Ok(_) => {}
                    Err(err) => {
                        log_warn(&format!(
                            "mid-crawl queue injection probe failed for crawl job {progress_job_id}: {err}"
                        ));
                    }
                }
            }

            let mid_queue_injection = progress_injection_state.lock().await.clone();
            let progress_json = serde_json::json!({
                "phase": "crawling",
                "md_created": progress.markdown_files,
                "thin_md": progress.thin_pages,
                "filtered_urls": filtered_urls,
                "pages_crawled": pages_crawled,
                "crawl_stream_pages": progress.pages_seen,
                "mid_queue_injection": mid_queue_injection,
            });
            let _ = sqlx::query(
                "UPDATE axon_crawl_jobs SET updated_at=NOW(), result_json=$2 WHERE id=$1 AND status='running'",
            )
            .bind(progress_job_id)
            .bind(progress_json)
            .execute(&progress_pool)
            .await;
        }
    });

    let final_prompt = extraction_prompt.clone();
    let result = async {
        let initial_mode = resolve_initial_mode(job_cfg.render_mode, job_cfg.cache_skip_browser);
        let (summary, seen_urls) = run_crawl_once(
            &job_cfg,
            &url,
            initial_mode,
            &job_cfg.output_dir,
            Some(progress_tx),
        )
        .await?;
        let mut final_summary = summary.clone();
        let mut backfill_stats = SitemapBackfillStats::default();
        let mut robots_backfill_stats = RobotsBackfillStats::default();
        let mut robots_discovery_stats = RobotsDiscoveryStats::default();

        if job_cfg.discover_sitemaps {
            backfill_stats = append_sitemap_backfill(
                &job_cfg,
                &url,
                &job_cfg.output_dir,
                &seen_urls,
                &mut final_summary,
            )
            .await?;
            (robots_backfill_stats, robots_discovery_stats) = append_robots_backfill(
                &job_cfg,
                &url,
                &job_cfg.output_dir,
                &seen_urls,
                &mut final_summary,
            )
            .await?;
        }

        if job_cfg.embed {
            let markdown_dir = job_cfg.output_dir.join("markdown");
            let embed_job_id = start_embed_job(&job_cfg, &markdown_dir.to_string_lossy()).await?;
            log_info(&format!(
                "command=crawl enqueue_embed crawl_job_id={} embed_job_id={}",
                id, embed_job_id
            ));
        }

        let crawl_discovered = summary.pages_seen as u64;
        let sitemap_discovered = backfill_stats.sitemap_candidates as u64;
        let robots_extra = robots_backfill_stats.candidates as u64;
        let pages_discovered = crawl_discovered
            .saturating_add(sitemap_discovered)
            .saturating_add(robots_extra);
        let filtered_urls = pages_discovered.saturating_sub(final_summary.markdown_files as u64);
        let pages_crawled = summary.pages_seen as u64;
        let current_urls = read_manifest_urls(&manifest_path).await?;
        let candidates = read_manifest_candidates(&manifest_path).await?;
        let mid_queue_injection = mid_injection_state.lock().await.clone();
        let mid_enqueued = mid_queue_injection
            .as_ref()
            .and_then(|value| value.get("queue_status"))
            .and_then(|value| value.as_str())
            == Some("enqueued");
        let queue_injection = apply_queue_injection(
            &job_cfg,
            &candidates,
            final_prompt.as_deref(),
            if mid_enqueued {
                "post-crawl-review"
            } else {
                "post-crawl"
            },
            !mid_enqueued,
        )
        .await?;
        let (report_path, diff_report) = write_audit_diff(
            &job_cfg.output_dir,
            &url,
            &previous_urls,
            &current_urls,
            false,
            cache_source,
        )
        .await?;

        Ok::<serde_json::Value, Box<dyn Error>>(serde_json::json!({
            "phase": "completed",
            "cache_hit": false,
            "cache_skip_browser": job_cfg.cache_skip_browser,
            "md_created": final_summary.markdown_files,
            "thin_md": final_summary.thin_pages,
            "filtered_urls": filtered_urls,
            "pages_crawled": pages_crawled,
            "pages_discovered": pages_discovered,
            "crawl_stream_pages": summary.pages_seen,
            "sitemap_discovered": backfill_stats.sitemap_discovered,
            "sitemap_candidates": backfill_stats.sitemap_candidates,
            "sitemap_processed": backfill_stats.processed,
            "sitemap_fetched_ok": backfill_stats.fetched_ok,
            "sitemap_written": backfill_stats.written,
            "sitemap_failed": backfill_stats.failed,
            "sitemap_filtered": backfill_stats.filtered,
            "robots_sitemap_docs_parsed": robots_discovery_stats.parsed_sitemap_documents,
            "robots_declared_sitemaps": robots_discovery_stats.robots_declared_sitemaps,
            "robots_discovered_urls": robots_backfill_stats.discovered_urls,
            "robots_candidates": robots_backfill_stats.candidates,
            "robots_written": robots_backfill_stats.written,
            "robots_failed": robots_backfill_stats.failed,
            "robots_filtered_existing": robots_backfill_stats.filtered_existing,
            "elapsed_ms": final_summary.elapsed_ms,
            "output_dir": job_cfg.output_dir.to_string_lossy(),
            "audit_diff": diff_report,
            "audit_report_path": report_path.to_string_lossy(),
            "mid_queue_injection": mid_queue_injection,
            "queue_injection": queue_injection,
            "extraction_observability": queue_injection["observability"].clone(),
        }))
    }
    .await;

    if let Err(err) = progress_task.await {
        log_warn(&format!(
            "progress_task panicked while serializing progress for crawl job {id}: {err:?}"
        ));
    }

    match result {
        Ok(result_json) => {
            sqlx::query(
                "UPDATE axon_crawl_jobs SET status='completed', updated_at=NOW(), finished_at=NOW(), error_text=NULL, result_json=$2 WHERE id=$1 AND status='running'",
            )
            .bind(id)
            .bind(result_json)
            .execute(pool)
            .await?;
            log_done(&format!("worker completed crawl job {id}"));
        }
        Err(err) => {
            let msg = err.to_string();
            sqlx::query(
                "UPDATE axon_crawl_jobs SET status='failed', updated_at=NOW(), finished_at=NOW(), error_text=$2 WHERE id=$1 AND status='running'",
            )
            .bind(id)
            .bind(msg)
            .execute(pool)
            .await?;
            log_warn(&format!("worker failed crawl job {id}"));
        }
    }

    Ok(())
}
