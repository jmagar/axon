#[path = "render_jobs.rs"]
mod jobs;

pub(super) use jobs::extract_status_json_result;

use crate::core::config::{CommandKind, Config};
use crate::core::ui::{accent, muted, primary, status_text};
use crate::services::types::{
    AskResult, DocumentBackend, MapResult, QueryHit, ResearchPayload, RetrieveResult, ScrapeResult,
    ScreenshotResult, SuggestResult, SummarizeResult,
};
use std::error::Error;

pub(super) fn render_server_result(
    cfg: &Config,
    label: &'static str,
    result: &serde_json::Value,
) -> Result<(), Box<dyn Error>> {
    if cfg.json_output {
        let output = if cfg.command == CommandKind::Extract && label == "job status" {
            extract_status_json_result(result)
        } else {
            result.clone()
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
        return Ok(());
    }

    match cfg.command {
        CommandKind::Status => {
            print!("{}", server_status_text(result)?);
            Ok(())
        }
        CommandKind::Stats => render_stats(result),
        CommandKind::Doctor => render_doctor(result),
        CommandKind::Sources => render_sources(cfg, result),
        CommandKind::Domains => render_domains(cfg, result),
        CommandKind::Map => render_map(cfg, result),
        CommandKind::Query => render_query(cfg, result),
        CommandKind::Retrieve => render_retrieve(cfg, result),
        CommandKind::Ask => render_ask(cfg, result),
        CommandKind::Evaluate => render_evaluate(cfg, result),
        CommandKind::Suggest => render_suggest(result),
        CommandKind::Search => render_search(cfg, result),
        CommandKind::Research => render_research(result),
        CommandKind::Scrape => render_scrape(cfg, result),
        CommandKind::Summarize => render_summarize(cfg, result),
        CommandKind::Screenshot => render_screenshot(cfg, result),
        CommandKind::Crawl => jobs::render_crawl(cfg, label, result),
        CommandKind::Extract => jobs::render_extract(cfg, label, result),
        CommandKind::Embed => jobs::render_embed(cfg, label, result),
        CommandKind::Ingest => jobs::render_ingest(cfg, label, result, false),
        CommandKind::Sessions => jobs::render_ingest(cfg, label, result, true),
        _ => Err(format!("{} has no server-mode human renderer", cfg.command).into()),
    }
}

#[cfg(test)]
pub(super) fn server_human_renderer_available(command: CommandKind) -> bool {
    matches!(
        command,
        CommandKind::Status
            | CommandKind::Stats
            | CommandKind::Doctor
            | CommandKind::Sources
            | CommandKind::Domains
            | CommandKind::Map
            | CommandKind::Query
            | CommandKind::Retrieve
            | CommandKind::Ask
            | CommandKind::Evaluate
            | CommandKind::Suggest
            | CommandKind::Search
            | CommandKind::Research
            | CommandKind::Scrape
            | CommandKind::Summarize
            | CommandKind::Screenshot
            | CommandKind::Crawl
            | CommandKind::Extract
            | CommandKind::Embed
            | CommandKind::Ingest
            | CommandKind::Sessions
    )
}

pub(super) fn server_status_text(result: &serde_json::Value) -> Result<String, Box<dyn Error>> {
    crate::cli::commands::status::render_status_payload(result)
}

fn render_scrape(cfg: &Config, result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let scrape: ScrapeResult = serde_json::from_value(result.clone())?;
    crate::cli::commands::scrape::print_scrape_preamble(cfg, &scrape.url);
    crate::cli::commands::scrape::emit_scrape_result(cfg, &scrape)
}

fn render_summarize(cfg: &Config, result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let summary: SummarizeResult = serde_json::from_value(result.clone())?;
    crate::cli::commands::summarize::emit_summarize_result(cfg, &summary)
}

fn render_stats(result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let payload = result.get("payload").unwrap_or(result);
    crate::vector::ops::stats::display::print_stats_human(payload);
    Ok(())
}

fn render_doctor(result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    crate::cli::commands::doctor::render::render_doctor_report_human(result);
    Ok(())
}

fn render_sources(cfg: &Config, result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    if let Some(domain) = cfg.sources_domain.as_deref() {
        println!("{}", primary(&format!("Sources for {domain}")));
        for url in result
            .get("urls")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter_map(|value| value.as_str())
        {
            println!("  {}", accent(url));
        }
        if result
            .get("truncated")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
        {
            println!("{}", muted("Output truncated. Use --all to fetch more."));
        }
        return Ok(());
    }

    println!("{}", primary("Sources"));
    for url in result
        .get("urls")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter_map(|value| value.as_str())
    {
        println!("  {}", accent(url));
    }
    if let Some(count) = result.get("count").and_then(|value| value.as_u64()) {
        println!("{}", muted(&format!("Count: {count}")));
    }
    Ok(())
}

fn render_domains(cfg: &Config, result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    if cfg.domains_domain.is_some() {
        println!("{}", primary("Domain"));
        let domain = result
            .get("domain")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        let indexed = result
            .get("indexed")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        println!(
            "  {} {}",
            accent(domain),
            muted(if indexed {
                "indexed=true"
            } else {
                "indexed=false"
            })
        );
        return Ok(());
    }

    println!("{}", primary("Domains"));
    for row in result
        .get("domains")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
    {
        let domain = row
            .get("domain")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        let vectors = row
            .get("vectors")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        println!(
            "  {} {}",
            accent(domain),
            muted(&format!("vectors={vectors}"))
        );
    }
    Ok(())
}

fn render_map(cfg: &Config, result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let mapped: MapResult = serde_json::from_value(result.clone())?;
    let start_url = cfg
        .positional
        .first()
        .map(String::as_str)
        .unwrap_or(mapped.url.as_str());
    println!("{}", primary(&format!("Map Results for {start_url}")));
    println!(
        "{} {} (source: {})",
        muted("Showing"),
        mapped.returned_url_count,
        mapped.map_source
    );
    if let Some(warning) = mapped.warning.as_deref() {
        println!("{} {}", muted("Warning:"), warning);
    }
    println!();
    for url in &mapped.urls {
        println!("  • {url}");
    }
    Ok(())
}

fn render_query(cfg: &Config, result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let query = crate::cli::commands::resolve_input_text(cfg).ok_or("query requires text")?;
    let results: Vec<QueryHit> = serde_json::from_value(
        result
            .get("results")
            .cloned()
            .unwrap_or_else(|| serde_json::Value::Array(Vec::new())),
    )?;
    println!("{}", primary(&format!("Query Results for \"{query}\"")));
    if results.is_empty() {
        println!("  {}", muted("No results found. Try:"));
        println!("    {}", muted("axon sources       # list indexed URLs"));
        println!(
            "    {}",
            muted("axon stats         # check collection size")
        );
        println!("    {}", muted("axon embed <url>   # add content first"));
        return Ok(());
    }
    println!("{} {}\n", muted("Showing"), results.len());
    for result in &results {
        println!(
            "  • {}. {} rerank={:.3} {}",
            result.rank,
            status_text("completed"),
            result.rerank_score,
            accent(&result.source)
        );
        println!("    {}", result.snippet);
        if cfg.ask_diagnostics {
            println!("    {} vector_score={:.3}", muted("diag"), result.score);
            println!("    {} {}", muted("url"), result.url);
        }
    }
    Ok(())
}

fn render_retrieve(cfg: &Config, result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let target = cfg.positional.first().ok_or("retrieve requires URL")?;
    let result: RetrieveResult = serde_json::from_value(result.clone())?;
    if result.chunk_count == 0 {
        return Err(format!(
            "no content found for URL: {target} — run 'axon sources' to list indexed URLs"
        )
        .into());
    }
    println!("{}", primary(&format!("Retrieve Result for {target}")));
    println!("{} {}\n", muted("Chunks:"), result.chunk_count);
    if let Some(backend) = result.backend {
        println!("{} {}", muted("Backend:"), backend_text(backend));
    }
    if let Some(refresh_status) = result.refresh_status.as_deref() {
        println!("{} {}", muted("Refresh:"), refresh_status);
    }
    if let Some(next_cursor) = result.next_cursor.as_deref() {
        println!("{} {}", muted("Next cursor:"), next_cursor);
    }
    if !result.warnings.is_empty() {
        println!("{} {}", muted("Warnings:"), result.warnings.join(" | "));
    }
    if result.backend.is_some()
        || result.refresh_status.is_some()
        || result.next_cursor.is_some()
        || !result.warnings.is_empty()
    {
        println!();
    }
    println!("{}", result.content.trim());
    Ok(())
}

fn backend_text(backend: DocumentBackend) -> &'static str {
    match backend {
        DocumentBackend::Qdrant => "qdrant",
        DocumentBackend::StoredSource => "stored_source",
        DocumentBackend::LiveScrape => "live_scrape",
    }
}

fn render_ask(cfg: &Config, result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let mut ask: AskResult = serde_json::from_value(result.clone())?;
    let query = crate::cli::commands::resolve_input_text(cfg)
        .or_else(|| (!ask.query.trim().is_empty()).then(|| ask.query.clone()))
        .ok_or("ask requires a question")?;
    ask.query = query.clone();
    let active_session = cfg
        .ask_session
        .as_deref()
        .or(ask.session.as_deref())
        .unwrap_or("default");
    let mut render_cfg = cfg.clone();
    render_cfg.ask_stream = false;
    crate::cli::commands::ask::print_ask_human(&render_cfg, &query, active_session, &ask);
    Ok(())
}

fn render_evaluate(cfg: &Config, result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let question =
        crate::cli::commands::resolve_input_text(cfg).ok_or("evaluate requires a question")?;
    crate::cli::commands::evaluate::print_evaluate_output(cfg, result, &question)
}

fn render_suggest(result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let result: SuggestResult = serde_json::from_value(result.clone())?;
    for suggestion in &result.suggestions {
        println!("{}\t{}", suggestion.url, suggestion.reason);
    }
    Ok(())
}

fn render_search(cfg: &Config, result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let query = crate::cli::commands::resolve_input_text(cfg).ok_or("search requires a query")?;
    let results = result
        .get("results")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    crate::cli::commands::search::print_search_results(&query, &results);
    Ok(())
}

fn render_research(result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let payload: ResearchPayload = serde_json::from_value(result.clone())?;
    crate::cli::commands::research::print_human_research_output(&payload, payload.timing_ms.total)
}

fn render_screenshot(cfg: &Config, result: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let payload = result
        .get("data")
        .cloned()
        .unwrap_or_else(|| result.clone());
    let shot: ScreenshotResult = serde_json::from_value(payload)?;
    crate::cli::commands::screenshot::print_screenshot_preamble(cfg, &shot.url);
    crate::cli::commands::screenshot::emit_screenshot_result(cfg, &shot.url, &shot)
}
