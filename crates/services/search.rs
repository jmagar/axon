use crate::crates::cli::commands::research::research_payload;
use crate::crates::cli::commands::search::search_results;
use crate::crates::core::config::Config;
use crate::crates::services::events::{LogLevel, ServiceEvent, emit};
use crate::crates::services::types::{
    ResearchResult, SearchOptions, SearchResult, ServiceTimeRange,
};
use spider_agent::TimeRange;
use std::error::Error;
use tokio::sync::mpsc;

/// Convert a [`ServiceTimeRange`] to the `spider_agent` crate's [`TimeRange`].
///
/// Private — callers use the typed service options, not spider_agent types directly.
fn to_spider_time_range(tr: ServiceTimeRange) -> TimeRange {
    match tr {
        ServiceTimeRange::Day => TimeRange::Day,
        ServiceTimeRange::Week => TimeRange::Week,
        ServiceTimeRange::Month => TimeRange::Month,
        ServiceTimeRange::Year => TimeRange::Year,
    }
}

/// Map a `Vec<serde_json::Value>` of raw search items into a typed [`SearchResult`].
///
/// This is a pure function — no network required. Tests call it with JSON literals.
pub fn map_search_results(results: Vec<serde_json::Value>) -> SearchResult {
    SearchResult { results }
}

/// Map a raw JSON payload into a typed [`ResearchResult`].
///
/// This is a pure function — no network required. Tests call it with JSON literals.
pub fn map_research_payload(payload: serde_json::Value) -> ResearchResult {
    ResearchResult { payload }
}

/// Run a web search via Tavily and return a typed [`SearchResult`].
///
/// Delegates to [`search_results`] from the CLI commands layer. Emits log events
/// when a `tx` sender is provided.
pub async fn search(
    cfg: &Config,
    query: &str,
    opts: SearchOptions,
    tx: Option<mpsc::Sender<ServiceEvent>>,
) -> Result<SearchResult, Box<dyn Error>> {
    search_batch(cfg, &[query], opts, tx).await
}

/// Run multiple Tavily searches in sequence and return merged results.
///
/// Each query is searched independently; results are flattened in order.
/// Emits log events when a `tx` sender is provided.
pub async fn search_batch(
    cfg: &Config,
    queries: &[&str],
    opts: SearchOptions,
    tx: Option<mpsc::Sender<ServiceEvent>>,
) -> Result<SearchResult, Box<dyn Error>> {
    emit(
        &tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: format!("starting search: {}", queries.join(", ")),
        },
    );

    let time_range = opts.time_range.map(to_spider_time_range);
    let mut all: Vec<serde_json::Value> = Vec::new();
    for query in queries {
        let mut raw =
            search_results(cfg, query, opts.limit, opts.offset, time_range.clone()).await?;
        all.append(&mut raw);
    }

    emit(
        &tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: format!("search complete: {} results", all.len()),
        },
    );

    Ok(map_search_results(all))
}

/// Run a Tavily AI research query with LLM synthesis and return a typed [`ResearchResult`].
///
/// Delegates to [`research_payload`] from the CLI commands layer. Emits log events
/// when a `tx` sender is provided.
pub async fn research(
    cfg: &Config,
    query: &str,
    opts: SearchOptions,
    tx: Option<mpsc::Sender<ServiceEvent>>,
) -> Result<ResearchResult, Box<dyn Error>> {
    emit(
        &tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: format!("starting research: {query}"),
        },
    );

    let time_range = opts.time_range.map(to_spider_time_range);
    let payload = research_payload(cfg, query, opts.limit, opts.offset, time_range).await?;

    emit(
        &tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: "research complete".to_string(),
        },
    );

    Ok(map_research_payload(payload))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── to_spider_time_range ──────────────────────────────────────────────────

    #[test]
    fn time_range_all_variants_map_correctly() {
        // TimeRange is already in scope via `use spider_agent::TimeRange` pulled
        // in through `use super::*`.
        assert_eq!(to_spider_time_range(ServiceTimeRange::Day), TimeRange::Day);
        assert_eq!(
            to_spider_time_range(ServiceTimeRange::Week),
            TimeRange::Week
        );
        assert_eq!(
            to_spider_time_range(ServiceTimeRange::Month),
            TimeRange::Month
        );
        assert_eq!(
            to_spider_time_range(ServiceTimeRange::Year),
            TimeRange::Year
        );
    }

    // ── map_search_results ────────────────────────────────────────────────────

    #[test]
    fn map_search_results_empty_vec() {
        let result = map_search_results(vec![]);
        assert!(result.results.is_empty());
    }

    #[test]
    fn map_search_results_nonempty() {
        let item = json!({"title": "Axon docs", "url": "https://example.com"});
        let result = map_search_results(vec![item.clone()]);
        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0], item);
    }

    // ── map_research_payload ──────────────────────────────────────────────────

    #[test]
    fn map_research_payload_stores_value() {
        let value = json!({"answer": "42", "sources": []});
        let result = map_research_payload(value.clone());
        assert_eq!(result.payload, value);
    }

    // ── search_batch (pure path: empty query slice) ───────────────────────────
    //
    // With zero queries the loop body never executes and no network call is
    // made, so this runs without a live Tavily key.  The two emit() calls still
    // fire but they are no-ops when `tx` is None.

    #[tokio::test]
    async fn search_batch_empty_queries_returns_empty() {
        let cfg = Config::default();
        let result = search_batch(
            &cfg,
            &[],
            SearchOptions {
                limit: 10,
                offset: 0,
                time_range: None,
            },
            None,
        )
        .await
        .expect("search_batch with empty queries should not fail");
        assert!(result.results.is_empty());
    }
}
