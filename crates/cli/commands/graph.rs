use crate::crates::core::config::Config;
use crate::crates::core::logging::log_info;
use crate::crates::core::ui::{accent, muted, primary};
use crate::crates::jobs::graph::run_graph_worker;
use crate::crates::services::graph as graph_svc;
use std::error::Error;

pub async fn run_graph(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let sub = cfg.positional.first().map(String::as_str);
    match sub {
        Some("build") => handle_build(cfg).await,
        Some("status") => handle_status(cfg).await,
        Some("explore") => handle_explore(cfg).await,
        Some("stats") => handle_stats(cfg).await,
        Some("worker") => handle_worker(cfg).await,
        _ => {
            eprintln!("Usage: axon graph <build|status|explore|stats|worker>");
            Ok(())
        }
    }
}

async fn handle_build(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let mut url: Option<String> = None;
    let mut domain: Option<String> = None;
    let mut all = false;

    let mut i = 1usize;
    while i < cfg.positional.len() {
        match cfg.positional[i].as_str() {
            "--url" => {
                if let Some(val) = cfg.positional.get(i + 1) {
                    if val.starts_with("--") {
                        return Err("Expected value after --url".into());
                    }
                    url = Some(val.clone());
                    i += 2;
                } else {
                    return Err("Expected value after --url".into());
                }
            }
            "--domain" => {
                if let Some(val) = cfg.positional.get(i + 1) {
                    if val.starts_with("--") {
                        return Err("Expected value after --domain".into());
                    }
                    domain = Some(val.clone());
                    i += 2;
                } else {
                    return Err("Expected value after --domain".into());
                }
            }
            "--all" => {
                all = true;
                i += 1;
            }
            other => {
                if url.is_none() {
                    url = Some(other.to_string());
                }
                i += 1;
            }
        }
    }

    log_info(&format!(
        "command=graph.build url={} domain={} all={all}",
        url.as_deref().unwrap_or(""),
        domain.as_deref().unwrap_or("")
    ));
    let result = graph_svc::graph_build(cfg, url.as_deref(), domain.as_deref(), all).await?;

    if cfg.json_output {
        println!("{}", serde_json::to_string_pretty(&result.payload)?);
        return Ok(());
    }

    let queued = result.payload["queued"].as_u64().unwrap_or(0);
    println!(
        "{} {}",
        primary("Graph build queued:"),
        accent(&queued.to_string())
    );
    if let Some(urls) = result.payload["urls"].as_array()
        && !urls.is_empty()
    {
        for url in urls.iter().take(10) {
            if let Some(url) = url.as_str() {
                println!("  {}", muted(url));
            }
        }
        if urls.len() > 10 {
            println!("  {}", muted("..."));
        }
    }
    Ok(())
}

async fn handle_status(cfg: &Config) -> Result<(), Box<dyn Error>> {
    log_info("command=graph.status");
    let result = graph_svc::graph_status(cfg).await?;

    if cfg.json_output {
        println!("{}", serde_json::to_string_pretty(&result.payload)?);
        return Ok(());
    }

    println!("{}", primary("Graph Extraction Status:"));
    if let Some(counts) = result.payload["counts"].as_object() {
        for key in ["completed", "running", "pending", "failed", "canceled"] {
            let count = counts.get(key).and_then(|v| v.as_u64()).unwrap_or(0);
            println!("  {:<10} {}", format!("{key}:"), accent(&count.to_string()));
        }
    }
    if let Some(recent) = result.payload["recent"].as_array()
        && !recent.is_empty()
    {
        println!();
        println!("{}", primary("Recent jobs:"));
        for item in recent.iter().take(10) {
            let url = item["url"].as_str().unwrap_or("?");
            let status = item["status"].as_str().unwrap_or("unknown");
            println!("  {} {}", accent(status), muted(url));
        }
    }
    Ok(())
}

async fn handle_explore(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let entity = cfg
        .positional
        .get(1)
        .ok_or("Usage: axon graph explore <entity>")?;
    log_info(&format!("command=graph.explore entity={entity}"));
    let result = graph_svc::graph_explore(cfg, entity).await?;

    if cfg.json_output {
        println!("{}", serde_json::to_string_pretty(&result.payload)?);
        return Ok(());
    }

    println!("{} {}", primary("Graph explore:"), accent(entity));
    if let Some(rows) = result.payload["rows"].as_array() {
        if rows.is_empty() {
            println!("  {}", muted("No graph entity found."));
            return Ok(());
        }
        for row in rows.iter().take(5) {
            println!("  {}", serde_json::to_string_pretty(row)?);
        }
    }
    Ok(())
}

async fn handle_stats(cfg: &Config) -> Result<(), Box<dyn Error>> {
    log_info("command=graph.stats");
    let result = graph_svc::graph_stats(cfg).await?;

    if cfg.json_output {
        println!("{}", serde_json::to_string_pretty(&result.payload)?);
        return Ok(());
    }

    println!("{}", primary("Graph stats:"));
    if let Some(rows) = result.payload["rows"].as_array() {
        if rows.is_empty() {
            println!("  {}", muted("No graph stats available."));
        } else {
            for row in rows.iter().take(5) {
                println!("  {}", serde_json::to_string_pretty(row)?);
            }
        }
    }
    Ok(())
}

async fn handle_worker(cfg: &Config) -> Result<(), Box<dyn Error>> {
    log_info("command=graph.worker");
    run_graph_worker(cfg)
        .await
        .map_err(|err| -> Box<dyn Error> { err.into() })
}
