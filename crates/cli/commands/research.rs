use crate::crates::core::config::Config;
use crate::crates::core::logging::log_done;
use crate::crates::core::ui::{muted, primary, print_phase};
use spider_agent::{Agent, ResearchOptions, SearchOptions};
use std::error::Error;

pub async fn run_research(cfg: &Config) -> Result<(), Box<dyn Error>> {
    if cfg.tavily_api_key.is_empty() {
        return Err("research requires TAVILY_API_KEY — set it in .env".into());
    }
    if cfg.openai_base_url.is_empty() || cfg.openai_model.is_empty() {
        return Err("research requires OPENAI_BASE_URL and OPENAI_MODEL — set them in .env".into());
    }

    let query = if let Some(q) = &cfg.query {
        q.clone()
    } else if !cfg.positional.is_empty() {
        cfg.positional.join(" ")
    } else {
        return Err("research requires a query (positional or --query)".into());
    };

    print_phase("◐", "Researching", &query);
    println!("  {} {}", muted("provider=tavily model="), cfg.openai_model);
    println!();

    // spider_agent's with_openai_compatible expects the full endpoint URL.
    let llm_url = format!(
        "{}/chat/completions",
        cfg.openai_base_url.trim_end_matches('/')
    );

    let agent = Agent::builder()
        .with_openai_compatible(llm_url, &cfg.openai_api_key, &cfg.openai_model)
        .with_search_tavily(&cfg.tavily_api_key)
        .build()?;

    let extraction_prompt =
        format!("Extract key facts, details, and insights relevant to: {query}");

    let research = agent
        .research(
            &query,
            ResearchOptions::new()
                .with_max_pages(cfg.search_limit)
                .with_search_options(SearchOptions::new().with_limit(cfg.search_limit))
                .with_extraction_prompt(extraction_prompt)
                .with_synthesize(true),
        )
        .await?;

    println!(
        "{} {}",
        primary("Search Results:"),
        research.search_results.results.len()
    );
    println!();

    println!(
        "{} {}",
        primary("Pages Extracted:"),
        research.extractions.len()
    );
    println!();

    for (i, extraction) in research.extractions.iter().enumerate() {
        println!("{}. {}", i + 1, primary(&extraction.title));
        println!("   {}", muted(&extraction.url));
        let preview = serde_json::to_string(&extraction.extracted)
            .unwrap_or_default()
            .chars()
            .take(200)
            .collect::<String>();
        let preview = preview.trim();
        if preview.is_empty() || preview == "null" || preview == "{}" {
            println!("   {}", muted("(no data extracted)"));
        } else {
            println!("   {preview}");
        }
        println!();
    }

    if let Some(summary) = &research.summary {
        println!("{}", primary("=== Summary ==="));
        println!("{summary}");
        println!();
    }

    if research.usage.total_tokens > 0 {
        println!(
            "  {} prompt={} completion={} total={}",
            muted("tokens"),
            research.usage.prompt_tokens,
            research.usage.completion_tokens,
            research.usage.total_tokens
        );
    }

    log_done("command=research complete");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crates::core::config::parse::normalize_local_service_url;

    fn make_cfg(tavily_key: &str, openai_url: &str, openai_model: &str) -> Config {
        use crate::crates::core::config::{
            CommandKind, PerformanceProfile, RenderMode, ScrapeFormat,
        };
        use std::path::PathBuf;

        Config {
            command: CommandKind::Research,
            start_url: String::new(),
            positional: vec!["test query".to_string()],
            urls_csv: None,
            url_glob: vec![],
            query: None,
            search_limit: 5,
            max_pages: 0,
            max_depth: 5,
            include_subdomains: true,
            exclude_path_prefix: vec![],
            output_dir: PathBuf::from(".cache"),
            output_path: None,
            render_mode: RenderMode::Http,
            chrome_remote_url: None,
            chrome_proxy: None,
            chrome_user_agent: None,
            chrome_headless: true,
            chrome_anti_bot: true,
            chrome_intercept: true,
            chrome_stealth: true,
            chrome_bootstrap: true,
            chrome_bootstrap_timeout_ms: 3000,
            chrome_bootstrap_retries: 2,
            webdriver_url: None,
            respect_robots: false,
            min_markdown_chars: 200,
            drop_thin_markdown: true,
            discover_sitemaps: true,
            cache: true,
            cache_skip_browser: false,
            format: ScrapeFormat::Markdown,
            collection: "cortex".into(),
            embed: false,
            batch_concurrency: 16,
            wait: false,
            yes: true,
            performance_profile: PerformanceProfile::HighStable,
            crawl_concurrency_limit: Some(64),
            backfill_concurrency_limit: Some(32),
            sitemap_only: false,
            delay_ms: 0,
            request_timeout_ms: Some(20_000),
            fetch_retries: 2,
            retry_backoff_ms: 250,
            shared_queue: true,
            pg_url: normalize_local_service_url("postgresql://axon:x@127.0.0.1:53432/axon".into()),
            redis_url: "redis://127.0.0.1:53379".into(),
            amqp_url: "amqp://axon:x@127.0.0.1:45535/%2f".into(),
            crawl_queue: "axon.crawl.jobs".into(),
            batch_queue: "axon.batch.jobs".into(),
            extract_queue: "axon.extract.jobs".into(),
            embed_queue: "axon.embed.jobs".into(),
            ingest_queue: "axon.ingest.jobs".into(),
            sessions_claude: false,
            sessions_codex: false,
            sessions_gemini: false,
            sessions_project: None,
            github_token: None,
            github_include_source: false,
            reddit_client_id: None,
            reddit_client_secret: None,
            tei_url: String::new(),
            qdrant_url: "http://127.0.0.1:53333".into(),
            openai_base_url: openai_url.to_string(),
            openai_api_key: "test-key".to_string(),
            openai_model: openai_model.to_string(),
            tavily_api_key: tavily_key.to_string(),
            ask_diagnostics: false,
            ask_max_context_chars: 120_000,
            ask_candidate_limit: 64,
            ask_chunk_limit: 10,
            ask_full_docs: 4,
            ask_backfill_chunks: 3,
            ask_doc_fetch_concurrency: 4,
            ask_doc_chunk_limit: 192,
            ask_min_relevance_score: 0.45,
            cron_every_seconds: None,
            cron_max_runs: None,
            watchdog_stale_timeout_secs: 300,
            watchdog_confirm_secs: 60,
            json_output: false,
        }
    }

    #[tokio::test]
    async fn test_run_research_rejects_empty_tavily_key() {
        let cfg = make_cfg("", "http://localhost/v1", "gpt-4o-mini");
        let err = run_research(&cfg).await.unwrap_err();
        assert!(
            err.to_string().contains("TAVILY_API_KEY"),
            "expected TAVILY_API_KEY error, got: {err}"
        );
    }

    #[tokio::test]
    async fn test_run_research_rejects_empty_openai_config() {
        let cfg = make_cfg("tvly-key", "", "gpt-4o-mini");
        let err = run_research(&cfg).await.unwrap_err();
        assert!(
            err.to_string().contains("OPENAI_BASE_URL"),
            "expected OPENAI_BASE_URL error, got: {err}"
        );
    }

    #[tokio::test]
    async fn test_run_research_rejects_empty_openai_model() {
        let cfg = make_cfg("tvly-key", "http://localhost/v1", "");
        let err = run_research(&cfg).await.unwrap_err();
        assert!(
            err.to_string().contains("OPENAI_MODEL"),
            "expected OPENAI_MODEL error, got: {err}"
        );
    }

    #[tokio::test]
    async fn test_run_research_rejects_missing_query() {
        let mut cfg = make_cfg("tvly-key", "http://localhost/v1", "gpt-4o-mini");
        cfg.positional = vec![];
        cfg.query = None;
        let err = run_research(&cfg).await.unwrap_err();
        assert!(
            err.to_string().contains("query"),
            "expected query error, got: {err}"
        );
    }
}
