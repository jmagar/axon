use crate::crates::core::config::Config;
use crate::crates::core::logging::{log_done, log_warn};
use crate::crates::core::ui::{muted, primary, print_phase};
use spider_agent::{Agent, SearchOptions, TimeRange};
use std::error::Error;

pub async fn run_search(cfg: &Config) -> Result<(), Box<dyn Error>> {
    if cfg.tavily_api_key.is_empty() {
        return Err("search requires TAVILY_API_KEY — set it in .env".into());
    }

    let query = if let Some(q) = &cfg.query {
        q.clone()
    } else if !cfg.positional.is_empty() {
        cfg.positional.join(" ")
    } else {
        return Err("search requires a query (positional or --query)".into());
    };

    print_phase("◐", "Searching", &query);

    let agent = Agent::builder()
        .with_search_tavily(&cfg.tavily_api_key)
        .build()?;

    let mut search_opts = SearchOptions::new().with_limit(cfg.search_limit);
    if let Some(ref range) = cfg.search_time_range {
        let tr = match range.as_str() {
            "day" => Some(TimeRange::Day),
            "week" => Some(TimeRange::Week),
            "month" => Some(TimeRange::Month),
            "year" => Some(TimeRange::Year),
            other => {
                log_warn(&format!("Unknown search_time_range '{other}'; ignoring"));
                None
            }
        };
        if let Some(tr) = tr {
            search_opts = search_opts.with_time_range(tr);
        }
    }

    let results = agent.search_with_options(&query, search_opts).await?;

    println!("{}", primary(&format!("Search Results for \"{}\"", query)));
    println!("{} {}", muted("Found"), results.results.len());
    println!();

    for result in &results.results {
        println!("{}. {}", result.position, primary(&result.title));
        println!("   {}", muted(&result.url));
        if let Some(ref snippet) = result.snippet {
            println!("   {snippet}");
        }
        println!();
    }

    log_done("command=search complete");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crates::core::config::CommandKind;
    use crate::crates::jobs::common::test_config;

    fn make_search_cfg(key: &str, query: &str) -> Config {
        let mut cfg = test_config("");
        cfg.command = CommandKind::Search;
        cfg.positional = vec![query.to_string()];
        cfg.tavily_api_key = key.to_string();
        cfg
    }

    #[tokio::test]
    async fn test_run_search_rejects_empty_tavily_key() {
        let cfg = make_search_cfg("", "rust async");
        let err = run_search(&cfg).await.unwrap_err();
        assert!(
            err.to_string().contains("TAVILY_API_KEY"),
            "expected TAVILY_API_KEY error, got: {err}"
        );
    }

    #[test]
    fn search_cfg_time_range_defaults_to_none() {
        let cfg = make_search_cfg("tvly-key", "rust async");
        assert!(
            cfg.search_time_range.is_none(),
            "search_time_range should default to None"
        );
    }
}
