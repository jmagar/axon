use crate::crates::cli::commands::status::metrics::{
    collection_from_config, display_embed_input, embed_metrics_suffix, format_error,
    job_runtime_text,
};
use crate::crates::core::config::Config;
use crate::crates::core::logging::log_done;
use crate::crates::core::ui::{
    accent, confirm_destructive, error, muted, primary, status_label, status_text, subtle,
    symbol_for_status,
};
use crate::crates::jobs::embed::{
    cancel_embed_job, cleanup_embed_jobs, clear_embed_jobs, get_embed_job, list_embed_jobs,
    recover_stale_embed_jobs, run_embed_worker,
};
use crate::crates::services::embed as embed_service;
use crate::crates::vector::ops::embed_path_native;
use std::error::Error;
use std::path::Path;
use uuid::Uuid;

pub async fn run_embed(cfg: &Config) -> Result<(), Box<dyn Error>> {
    if maybe_handle_embed_subcommand(cfg).await? {
        return Ok(());
    }

    let input = resolve_embed_input(cfg);
    if !cfg.wait {
        return enqueue_embed_job(cfg, &input).await;
    }

    embed_path_native(cfg, &input).await?;
    log_done("command=embed complete");
    Ok(())
}

async fn maybe_handle_embed_subcommand(cfg: &Config) -> Result<bool, Box<dyn Error>> {
    let Some(subcmd) = cfg.positional.first().map(|s| s.as_str()) else {
        return Ok(false);
    };
    if cfg.positional.len() == 1 && Path::new(subcmd).exists() {
        // Allow embedding a local path literally named like a subcommand
        // (for example: "./status").
        return Ok(false);
    }

    match subcmd {
        "status" => handle_embed_status(cfg).await?,
        "cancel" => handle_embed_cancel(cfg).await?,
        "errors" => handle_embed_errors(cfg).await?,
        "list" => handle_embed_list(cfg).await?,
        "cleanup" => handle_embed_cleanup(cfg).await?,
        "clear" => handle_embed_clear(cfg).await?,
        "worker" => run_embed_worker(cfg).await?,
        "recover" => handle_embed_recover(cfg).await?,
        _ => return Ok(false),
    }

    Ok(true)
}

fn parse_embed_job_id(cfg: &Config, action: &str) -> Result<Uuid, Box<dyn Error>> {
    let id = cfg
        .positional
        .get(1)
        .ok_or_else(|| format!("embed {action} requires <job-id>"))?;
    Ok(Uuid::parse_str(id)?)
}

async fn handle_embed_status(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let id = parse_embed_job_id(cfg, "status")?;
    match get_embed_job(cfg, id).await? {
        Some(job) => {
            if cfg.json_output {
                println!("{}", serde_json::to_string_pretty(&job)?);
            } else {
                println!(
                    "{} {}",
                    primary("Embed Status for"),
                    accent(&job.id.to_string())
                );
                println!(
                    "  {} {}",
                    symbol_for_status(&job.status),
                    status_text(&job.status)
                );
                println!("  {} {}", muted("Input:"), job.input_text);
                if let Some(err) = job.error_text.as_deref() {
                    println!("  {} {}", muted("Error:"), err);
                }
                println!("Job ID: {}", job.id);
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

async fn handle_embed_cancel(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let id = parse_embed_job_id(cfg, "cancel")?;
    let canceled = cancel_embed_job(cfg, id).await?;
    if cfg.json_output {
        println!(
            "{}",
            serde_json::json!({"id": id, "canceled": canceled, "source": "rust"})
        );
    } else if canceled {
        println!(
            "{} canceled embed job {}",
            symbol_for_status("canceled"),
            accent(&id.to_string())
        );
        println!("Job ID: {id}");
    } else {
        println!(
            "{} no cancellable embed job found for {}",
            symbol_for_status("error"),
            accent(&id.to_string())
        );
        println!("Job ID: {id}");
    }
    Ok(())
}

async fn handle_embed_errors(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let id = parse_embed_job_id(cfg, "errors")?;
    match get_embed_job(cfg, id).await? {
        Some(job) => {
            if cfg.json_output {
                println!(
                    "{}",
                    serde_json::json!({"id": id, "status": job.status, "error": job.error_text})
                );
            } else {
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
        }
        None => println!(
            "{} {}",
            symbol_for_status("error"),
            muted(&format!("job not found: {id}"))
        ),
    }
    Ok(())
}

async fn handle_embed_list(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let jobs = list_embed_jobs(cfg, 50, 0).await?;
    if cfg.json_output {
        println!("{}", serde_json::to_string_pretty(&jobs)?);
        return Ok(());
    }

    println!("{}", primary("Embed Jobs"));
    if jobs.is_empty() {
        println!("  {}", muted("No embed jobs found."));
        return Ok(());
    }

    // Empty map: URLs and paths display as-is; UUID-based paths show parent/markdown.
    let empty_crawl_map = std::collections::HashMap::new();
    for job in &jobs {
        let target = display_embed_input(&job.input_text, &empty_crawl_map);
        let metrics = embed_metrics_suffix(&job.status, job.result_json.as_ref());
        let collection = collection_from_config(&job.config_json);
        let age = job_runtime_text(
            &job.status,
            job.started_at.as_ref(),
            job.finished_at.as_ref(),
            &job.updated_at,
        );
        let collection_str = collection
            .map(|c| format!("{}{}", subtle(" | "), accent(c)))
            .unwrap_or_default();
        let label = status_label(&job.status);
        let prefix = if label.is_empty() {
            format!("  {} ", symbol_for_status(&job.status))
        } else {
            format!("  {} {} ", symbol_for_status(&job.status), label)
        };
        let age_str = format!("{}{}", subtle(" | "), accent(&age));
        println!(
            "{}{}{}{}{} {} {}",
            prefix,
            primary(&target),
            metrics,
            collection_str,
            age_str,
            subtle("|"),
            muted(&job.id.to_string()),
        );
        if let Some(err) = format_error(job.error_text.as_deref()) {
            let err_line = error(&format!("↳ {err}"));
            println!("       {err_line}");
        }
    }
    Ok(())
}

async fn handle_embed_cleanup(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let removed = cleanup_embed_jobs(cfg).await?;
    if cfg.json_output {
        println!("{}", serde_json::json!({"removed": removed}));
    } else {
        println!(
            "{} removed {} embed jobs",
            symbol_for_status("completed"),
            removed
        );
    }
    Ok(())
}

async fn handle_embed_clear(cfg: &Config) -> Result<(), Box<dyn Error>> {
    if !confirm_destructive(cfg, "Clear all embed jobs and purge embed queue?")? {
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

    let removed = clear_embed_jobs(cfg).await?;
    if cfg.json_output {
        println!(
            "{}",
            serde_json::json!({"removed": removed, "queue_purged": true})
        );
    } else {
        println!(
            "{} cleared {} embed jobs and purged queue",
            symbol_for_status("completed"),
            removed
        );
    }
    Ok(())
}

async fn handle_embed_recover(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let reclaimed = recover_stale_embed_jobs(cfg).await?;
    if cfg.json_output {
        println!("{}", serde_json::json!({"reclaimed": reclaimed}));
    } else {
        println!(
            "{} reclaimed {} stale embed jobs",
            symbol_for_status("completed"),
            reclaimed
        );
    }
    Ok(())
}

fn resolve_embed_input(cfg: &Config) -> String {
    cfg.positional.first().cloned().unwrap_or_else(|| {
        cfg.output_dir
            .join("markdown")
            .to_string_lossy()
            .to_string()
    })
}

async fn enqueue_embed_job(cfg: &Config, input: &str) -> Result<(), Box<dyn Error>> {
    // Route through the services layer; the service resolves input from cfg.positional
    // using the same fallback logic, so we temporarily set positional to the resolved input.
    let mut derived = cfg.clone();
    derived.positional = vec![input.to_string()];
    let result = embed_service::embed_start(&derived, None).await?;
    let job_id = result.job_id;
    if cfg.json_output {
        println!(
            "{}",
            serde_json::json!({"job_id": job_id, "status": "pending", "source": "rust"})
        );
    } else {
        println!("  {} {}", primary("Embed Job"), accent(&job_id));
        println!("  {}", muted(&format!("Input: {input}")));
        println!("Job ID: {job_id}");
    }
    Ok(())
}
