mod github;
mod resolve;
mod schedule;

use crate::crates::core::config::Config;
use crate::crates::core::ui::confirm_destructive;
use crate::crates::core::ui::{accent, muted, primary, status_text, symbol_for_status};
use crate::crates::services::refresh as refresh_service;
use resolve::resolve_refresh_urls;
use schedule::handle_refresh_schedule;
use std::error::Error;
use uuid::Uuid;

pub async fn run_refresh(cfg: &Config) -> Result<(), Box<dyn Error>> {
    if maybe_handle_refresh_subcommand(cfg).await? {
        return Ok(());
    }

    let urls = resolve_refresh_urls(cfg).await?;
    if urls.is_empty() {
        return Err("refresh requires at least one URL or a crawl manifest seed URL".into());
    }

    if cfg.wait {
        let result = refresh_service::refresh_now(cfg, &urls).await?.payload;
        if cfg.json_output {
            println!("{}", serde_json::to_string_pretty(&result)?);
        } else {
            let checked = result.get("checked").and_then(|v| v.as_u64()).unwrap_or(0);
            let changed = result.get("changed").and_then(|v| v.as_u64()).unwrap_or(0);
            let unchanged = result
                .get("unchanged")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let failed = result.get("failed").and_then(|v| v.as_u64()).unwrap_or(0);
            println!(
                "{} checked={} changed={} unchanged={} failed={}",
                symbol_for_status("completed"),
                checked,
                changed,
                unchanged,
                failed
            );
            if let Some(path) = result.get("manifest_path").and_then(|v| v.as_str()) {
                println!("  {} {}", muted("Manifest:"), path);
            }
        }
        return Ok(());
    }

    let job_id = refresh_service::refresh_start(cfg, &urls).await?.job_id;
    if cfg.json_output {
        println!(
            "{}",
            serde_json::json!({
                "job_id": job_id,
                "status": "pending",
                "urls": urls,
            })
        );
    } else {
        println!(
            "  {} {}",
            primary("Refresh Job"),
            accent(&job_id.to_string())
        );
        println!("  {} {}", muted("Targets:"), urls.len());
        println!("Job ID: {job_id}");
    }
    Ok(())
}

#[cfg(test)]
#[path = "refresh/schedule_compat_tests.rs"]
mod schedule_compat_tests;

async fn maybe_handle_refresh_subcommand(cfg: &Config) -> Result<bool, Box<dyn Error>> {
    let Some(subcmd) = cfg.positional.first().map(|s| s.as_str()) else {
        return Ok(false);
    };

    match subcmd {
        "schedule" => handle_refresh_schedule(cfg).await?,
        "status" => handle_refresh_status(cfg).await?,
        "cancel" => handle_refresh_cancel(cfg).await?,
        "errors" => handle_refresh_errors(cfg).await?,
        "list" => handle_refresh_list(cfg).await?,
        "cleanup" => handle_refresh_cleanup(cfg).await?,
        "clear" => handle_refresh_clear(cfg).await?,
        "worker" => refresh_service::refresh_worker(cfg).await?,
        "recover" => handle_refresh_recover(cfg).await?,
        _ => return Ok(false),
    }

    Ok(true)
}

fn parse_refresh_job_id(cfg: &Config, action: &str) -> Result<Uuid, Box<dyn Error>> {
    let id = cfg
        .positional
        .get(1)
        .ok_or_else(|| format!("refresh {action} requires <job-id>"))?;
    Ok(Uuid::parse_str(id)?)
}

async fn handle_refresh_status(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let id = parse_refresh_job_id(cfg, "status")?;
    match refresh_service::refresh_status(cfg, id).await? {
        Some(result) => {
            let job = result.payload;
            if cfg.json_output {
                println!("{}", serde_json::to_string_pretty(&job)?);
            } else {
                println!(
                    "{} {}",
                    primary("Refresh Status for"),
                    accent(job["id"].as_str().unwrap_or_default())
                );
                println!(
                    "  {} {}",
                    symbol_for_status(job["status"].as_str().unwrap_or_default()),
                    status_text(job["status"].as_str().unwrap_or_default())
                );
                if let Some(result) = job.get("result_json") {
                    let checked = result.get("checked").and_then(|v| v.as_u64()).unwrap_or(0);
                    let changed = result.get("changed").and_then(|v| v.as_u64()).unwrap_or(0);
                    let unchanged = result
                        .get("unchanged")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let failed = result.get("failed").and_then(|v| v.as_u64()).unwrap_or(0);
                    println!(
                        "  {} checked={} changed={} unchanged={} failed={}",
                        muted("Progress:"),
                        checked,
                        changed,
                        unchanged,
                        failed
                    );
                }
                if let Some(err) = job.get("error_text").and_then(|v| v.as_str()) {
                    println!("  {} {}", muted("Error:"), err);
                }
                println!("Job ID: {}", job["id"].as_str().unwrap_or_default());
            }
        }
        None => println!(
            "{} {}",
            symbol_for_status("error"),
            muted(&format!("job not found: {id}"))
        ),
    }
    Ok(())
}

async fn handle_refresh_cancel(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let id = parse_refresh_job_id(cfg, "cancel")?;
    let canceled = refresh_service::refresh_cancel(cfg, id).await?;
    if cfg.json_output {
        println!("{}", serde_json::json!({"id": id, "canceled": canceled}));
    } else if canceled {
        println!(
            "{} canceled refresh job {}",
            symbol_for_status("canceled"),
            accent(&id.to_string())
        );
        println!("Job ID: {id}");
    } else {
        println!(
            "{} no cancellable refresh job found for {}",
            symbol_for_status("error"),
            accent(&id.to_string())
        );
        println!("Job ID: {id}");
    }
    Ok(())
}

async fn handle_refresh_errors(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let id = parse_refresh_job_id(cfg, "errors")?;
    match refresh_service::refresh_status(cfg, id).await? {
        Some(result) => {
            let job = result.payload;
            if cfg.json_output {
                println!(
                    "{}",
                    serde_json::json!({"id": id, "status": job["status"], "error": job["error_text"]})
                );
            } else {
                println!(
                    "{} {} {}",
                    symbol_for_status(job["status"].as_str().unwrap_or_default()),
                    accent(&id.to_string()),
                    status_text(job["status"].as_str().unwrap_or_default())
                );
                println!(
                    "  {} {}",
                    muted("Error:"),
                    job["error_text"].as_str().unwrap_or("None")
                );
                println!("Job ID: {id}");
            }
        }
        None => println!(
            "{} {}",
            symbol_for_status("error"),
            muted(&format!("job not found: {id}"))
        ),
    }
    Ok(())
}

async fn handle_refresh_list(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let jobs = refresh_service::refresh_list(cfg, 50, 0).await?.payload;
    if cfg.json_output {
        println!("{}", serde_json::to_string_pretty(&jobs)?);
        return Ok(());
    }

    println!("{}", primary("Refresh Jobs"));
    let jobs = jobs
        .as_array()
        .ok_or("refresh list payload should be an array")?;
    if jobs.is_empty() {
        println!("  {}", muted("No refresh jobs found."));
        return Ok(());
    }

    for job in jobs {
        println!(
            "  {} {} {}",
            symbol_for_status(job["status"].as_str().unwrap_or_default()),
            accent(job["id"].as_str().unwrap_or_default()),
            status_text(job["status"].as_str().unwrap_or_default())
        );
    }
    Ok(())
}

async fn handle_refresh_cleanup(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let removed = refresh_service::refresh_cleanup(cfg).await?;
    if cfg.json_output {
        println!("{}", serde_json::json!({"removed": removed}));
    } else {
        println!(
            "{} removed {} refresh jobs",
            symbol_for_status("completed"),
            removed
        );
    }
    Ok(())
}

async fn handle_refresh_clear(cfg: &Config) -> Result<(), Box<dyn Error>> {
    if !confirm_destructive(cfg, "Clear all refresh jobs and purge refresh queue?")? {
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

    let removed = refresh_service::refresh_clear(cfg).await?;
    if cfg.json_output {
        println!(
            "{}",
            serde_json::json!({"removed": removed, "queue_purged": true})
        );
    } else {
        println!(
            "{} cleared {} refresh jobs and purged queue",
            symbol_for_status("completed"),
            removed
        );
    }
    Ok(())
}

async fn handle_refresh_recover(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let reclaimed = refresh_service::refresh_recover(cfg).await?;
    if cfg.json_output {
        println!("{}", serde_json::json!({"reclaimed": reclaimed}));
    } else {
        println!(
            "{} reclaimed {} stale refresh jobs",
            symbol_for_status("completed"),
            reclaimed
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::schedule::{
        handle_refresh_schedule_run_due, refresh_schedule_tick_secs_default, tier_to_seconds,
    };
    use crate::crates::jobs::common::{make_pool, test_config};
    use crate::crates::services::refresh::{
        RefreshScheduleCreate, create_refresh_schedule, delete_refresh_schedule,
        schedule_list_jobs as list_refresh_jobs,
    };
    use chrono::{Duration, Utc};
    use std::env;
    use std::error::Error;
    use tempfile::TempDir;
    use uuid::Uuid;

    #[test]
    fn refresh_tier_maps_to_expected_seconds() {
        assert_eq!(tier_to_seconds("high"), Some(1800));
        assert_eq!(tier_to_seconds("medium"), Some(21600));
        assert_eq!(tier_to_seconds("low"), Some(86400));
    }

    #[test]
    fn refresh_schedule_worker_default_tick_is_30_seconds() {
        assert_eq!(refresh_schedule_tick_secs_default(), 30);
    }

    fn pg_url() -> Option<String> {
        // Do not fall through to AXON_PG_URL — that is the production database.
        // If AXON_TEST_PG_URL is not set, tests that require Postgres are skipped.
        env::var("AXON_TEST_PG_URL")
            .ok()
            .filter(|v| !v.trim().is_empty())
    }

    #[tokio::test]
    async fn schedule_run_due_uses_seed_manifest_when_urls_missing() -> Result<(), Box<dyn Error>> {
        let Some(pg_url) = pg_url() else {
            return Ok(());
        };

        let temp_dir = TempDir::new()?;
        let mut cfg = test_config(&pg_url);
        cfg.output_dir = temp_dir.path().to_path_buf();

        // Skip when AXON_TEST_PG_URL is set but unavailable/misconfigured in this env.
        let pool = match make_pool(&cfg).await {
            Ok(pool) => pool,
            Err(_) => return Ok(()),
        };

        let seed_url = "https://example.com";
        let manifest_urls = vec![
            "https://example.com/docs/a".to_string(),
            "https://example.com/docs/b".to_string(),
        ];
        let manifest_path = cfg
            .output_dir
            .join("domains")
            .join("example.com")
            .join("latest")
            .join("manifest.jsonl");
        tokio::fs::create_dir_all(
            manifest_path
                .parent()
                .ok_or("manifest path missing parent directory")?,
        )
        .await?;
        let manifest_body = manifest_urls
            .iter()
            .enumerate()
            .map(|(idx, url)| {
                serde_json::json!({
                    "url": url,
                    "relative_path": format!("markdown/{idx}.md"),
                    "markdown_chars": 100,
                    "content_hash": format!("hash-{idx}"),
                    "changed": true,
                })
                .to_string()
            })
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        tokio::fs::write(&manifest_path, manifest_body).await?;

        let schedule_name = format!("refresh-seed-fallback-{}", Uuid::new_v4());
        let _ = create_refresh_schedule(
            &cfg,
            &RefreshScheduleCreate {
                name: schedule_name.clone(),
                seed_url: Some(seed_url.to_string()),
                urls: None,
                every_seconds: 300,
                enabled: true,
                next_run_at: Utc::now() - Duration::minutes(1),
                source_type: None,
                target: None,
            },
        )
        .await?;

        handle_refresh_schedule_run_due(&cfg).await?;

        let jobs = list_refresh_jobs(&cfg, 50, 0).await?;
        let matching_job = jobs.iter().find(|job| {
            serde_json::from_value::<Vec<String>>(job.urls_json.clone())
                .map(|urls| urls == manifest_urls)
                .unwrap_or(false)
        });
        assert!(matching_job.is_some());

        if let Some(job) = matching_job {
            let _ = sqlx::query("DELETE FROM axon_refresh_jobs WHERE id = $1")
                .bind(job.id)
                .execute(&pool)
                .await?;
        }
        let _ = delete_refresh_schedule(&cfg, &schedule_name).await?;
        Ok(())
    }
}
