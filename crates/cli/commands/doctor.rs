use crate::axon_cli::crates::core::config::Config;
use crate::axon_cli::crates::core::content::redact_url;
use crate::axon_cli::crates::core::ui::{muted, primary, status_text, symbol_for_status};
use crate::axon_cli::crates::jobs::batch_jobs::batch_doctor;
use crate::axon_cli::crates::jobs::crawl_jobs::doctor as crawl_doctor;
use crate::axon_cli::crates::jobs::embed_jobs::embed_doctor;
use crate::axon_cli::crates::jobs::extract_jobs::extract_doctor;
use std::error::Error;
use std::time::Duration;

fn with_path(base: &str, path: &str) -> String {
    let trimmed = base.trim_end_matches('/');
    if path.starts_with('/') {
        format!("{trimmed}{path}")
    } else {
        format!("{trimmed}/{path}")
    }
}

async fn probe_http(url: &str, paths: &[&str]) -> (bool, Option<String>) {
    if url.trim().is_empty() {
        return (false, Some("not configured".to_string()));
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
    {
        Ok(c) => c,
        Err(err) => return (false, Some(err.to_string())),
    };

    let mut last_error = None;
    for path in paths {
        let endpoint = with_path(url, path);
        match client.get(endpoint).send().await {
            Ok(resp) => return (true, Some(format!("http {}", resp.status().as_u16()))),
            Err(err) => last_error = Some(err.to_string()),
        }
    }

    (false, last_error)
}

fn openai_state(cfg: &Config) -> (&'static str, bool) {
    let has_key = !cfg.openai_api_key.trim().is_empty();
    let has_model = !cfg.openai_model.trim().is_empty();
    let has_base = !cfg.openai_base_url.trim().is_empty();

    if has_key && has_model && has_base {
        ("configured", true)
    } else if has_key && has_model {
        ("configured (default base URL)", true)
    } else {
        ("not configured", false)
    }
}

pub async fn run_doctor(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let (crawl_report, batch_report, extract_report, embed_report, tei_probe, qdrant_probe) = spider::tokio::join!(
        crawl_doctor(cfg),
        batch_doctor(cfg),
        extract_doctor(cfg),
        embed_doctor(cfg),
        probe_http(&cfg.tei_url, &["/health", "/"]),
        probe_http(&cfg.qdrant_url, &["/healthz", "/"]),
    );

    let crawl_report = crawl_report?;
    let batch_report = batch_report?;
    let extract_report = extract_report?;
    let embed_report = embed_report?;

    let postgres_ok = crawl_report["postgres_ok"].as_bool().unwrap_or(false);
    let redis_ok = crawl_report["redis_ok"].as_bool().unwrap_or(false);
    let amqp_ok = crawl_report["amqp_ok"].as_bool().unwrap_or(false);
    let tei_ok = tei_probe.0;
    let tei_detail = tei_probe.1;
    let qdrant_ok = qdrant_probe.0;
    let qdrant_detail = qdrant_probe.1;

    let openai = openai_state(cfg);

    let pipelines = serde_json::json!({
        "crawl": crawl_report["all_ok"].as_bool().unwrap_or(false),
        "batch": batch_report["all_ok"].as_bool().unwrap_or(false),
        "extract": extract_report["all_ok"].as_bool().unwrap_or(false),
        "embed": embed_report["all_ok"].as_bool().unwrap_or(false),
    });

    let services = serde_json::json!({
        "postgres": { "ok": postgres_ok, "url": redact_url(&cfg.pg_url) },
        "redis": { "ok": redis_ok, "url": redact_url(&cfg.redis_url) },
        "amqp": { "ok": amqp_ok, "url": redact_url(&cfg.amqp_url) },
        "tei": { "ok": tei_ok, "url": cfg.tei_url, "detail": tei_detail },
        "qdrant": { "ok": qdrant_ok, "url": cfg.qdrant_url, "detail": qdrant_detail },
        "openai": { "ok": openai.1, "state": openai.0, "base_url": cfg.openai_base_url, "model": cfg.openai_model },
    });

    let all_ok = pipelines["crawl"].as_bool().unwrap_or(false)
        && pipelines["batch"].as_bool().unwrap_or(false)
        && pipelines["extract"].as_bool().unwrap_or(false)
        && pipelines["embed"].as_bool().unwrap_or(false)
        && tei_ok
        && qdrant_ok;

    if cfg.json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "services": services,
                "pipelines": pipelines,
                "all_ok": all_ok
            }))?
        );
        return Ok(());
    }

    println!("{}", primary("Doctor Report"));
    println!();
    println!("{}", primary("Services"));
    println!(
        "  {} postgres {} {}",
        symbol_for_status(if postgres_ok { "completed" } else { "failed" }),
        status_text(if postgres_ok { "completed" } else { "failed" }),
        muted(&redact_url(&cfg.pg_url)),
    );
    println!(
        "  {} redis {} {}",
        symbol_for_status(if redis_ok { "completed" } else { "failed" }),
        status_text(if redis_ok { "completed" } else { "failed" }),
        muted(&redact_url(&cfg.redis_url)),
    );
    println!(
        "  {} amqp {} {}",
        symbol_for_status(if amqp_ok { "completed" } else { "failed" }),
        status_text(if amqp_ok { "completed" } else { "failed" }),
        muted(&redact_url(&cfg.amqp_url)),
    );
    println!(
        "  {} tei {} {}",
        symbol_for_status(if tei_ok { "completed" } else { "failed" }),
        status_text(if tei_ok { "completed" } else { "failed" }),
        muted(&tei_detail.unwrap_or_else(|| "unreachable".to_string())),
    );
    println!(
        "  {} qdrant {} {}",
        symbol_for_status(if qdrant_ok { "completed" } else { "failed" }),
        status_text(if qdrant_ok { "completed" } else { "failed" }),
        muted(&qdrant_detail.unwrap_or_else(|| "unreachable".to_string())),
    );
    println!(
        "  {} openai {} {}",
        symbol_for_status(if openai.1 { "completed" } else { "failed" }),
        status_text(if openai.1 { "completed" } else { "failed" }),
        muted(openai.0),
    );
    println!();
    println!("{}", primary("Pipelines"));
    for (name, ok) in [
        ("crawl", pipelines["crawl"].as_bool().unwrap_or(false)),
        ("batch", pipelines["batch"].as_bool().unwrap_or(false)),
        ("extract", pipelines["extract"].as_bool().unwrap_or(false)),
        ("embed", pipelines["embed"].as_bool().unwrap_or(false)),
    ] {
        println!(
            "  {} {} {}",
            symbol_for_status(if ok { "completed" } else { "failed" }),
            name,
            status_text(if ok { "completed" } else { "failed" }),
        );
    }
    println!();
    println!(
        "{} overall {}",
        symbol_for_status(if all_ok { "completed" } else { "failed" }),
        status_text(if all_ok { "completed" } else { "failed" }),
    );

    Ok(())
}
