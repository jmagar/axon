use super::AxonMcpServer;
use super::common::{
    internal_error, invalid_params, map_search_time_range, paginate_vec, parse_limit_usize,
    parse_offset, parse_response_mode, respond_with_mode, slugify,
};
use crate::crates::cli::commands::map::map_payload;
use crate::crates::cli::commands::research::research_payload;
use crate::crates::cli::commands::search::search_results;
use crate::crates::mcp::schema::{
    AskRequest, AxonToolResponse, MapRequest, QueryRequest, ResearchRequest, RetrieveRequest,
    ScrapeRequest, SearchRequest,
};
use crate::crates::vector::ops::commands::query_results;
use crate::crates::vector::ops::qdrant::retrieve_result;
use rmcp::ErrorData;
use tokio::process::Command;

impl AxonMcpServer {
    pub(super) async fn handle_query(
        &self,
        req: QueryRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let query = req
            .query
            .ok_or_else(|| invalid_params("query is required for query"))?;
        let limit = req.limit.unwrap_or(self.cfg.search_limit).clamp(1, 100);
        let offset = parse_offset(req.offset);
        let response_mode = parse_response_mode(req.response_mode);
        let results = query_results(self.cfg.as_ref(), &query, limit, offset)
            .await
            .map_err(|e| internal_error(e.to_string()))?;

        respond_with_mode(
            "query",
            "query",
            response_mode,
            &format!("query-{}", slugify(&query, 56)),
            serde_json::json!({
                "query": query,
                "limit": limit,
                "offset": offset,
                "results": results,
            }),
        )
    }

    pub(super) async fn handle_retrieve(
        &self,
        req: RetrieveRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let target = req
            .url
            .ok_or_else(|| invalid_params("url is required for retrieve"))?;
        let response_mode = parse_response_mode(req.response_mode);
        let (chunk_count, content) = retrieve_result(self.cfg.as_ref(), &target, req.max_points)
            .await
            .map_err(|e| internal_error(e.to_string()))?;

        respond_with_mode(
            "retrieve",
            "retrieve",
            response_mode,
            &format!("retrieve-{}", slugify(&target, 56)),
            serde_json::json!({
                "url": target,
                "chunks": chunk_count,
                "content": content,
            }),
        )
    }

    pub(super) async fn handle_map(&self, req: MapRequest) -> Result<AxonToolResponse, ErrorData> {
        let url = req
            .url
            .ok_or_else(|| invalid_params("url is required for map"))?;
        let response_mode = parse_response_mode(req.response_mode);
        let limit = parse_limit_usize(req.limit, 25, 500);
        let offset = parse_offset(req.offset);
        let payload = map_payload(self.cfg.as_ref(), &url)
            .await
            .map_err(|e| internal_error(e.to_string()))?;
        let urls = payload["urls"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| v.as_str().map(ToString::to_string))
            .collect::<Vec<_>>();
        let paged_urls = paginate_vec(&urls, offset, limit);
        respond_with_mode(
            "map",
            "map",
            response_mode,
            &format!("map-{}", slugify(&url, 56)),
            serde_json::json!({
                "url": url,
                "pages_seen": payload["pages_seen"].as_u64().unwrap_or(0),
                "elapsed_ms": payload["elapsed_ms"].as_u64().unwrap_or(0),
                "thin_pages": payload["thin_pages"].as_u64().unwrap_or(0),
                "limit": limit,
                "offset": offset,
                "total_urls": urls.len(),
                "urls": paged_urls,
            }),
        )
    }

    pub(super) async fn handle_search(
        &self,
        req: SearchRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let query = req
            .query
            .ok_or_else(|| invalid_params("query is required for search"))?;
        let response_mode = parse_response_mode(req.response_mode);
        let limit = parse_limit_usize(req.limit, 10, 50);
        let offset = parse_offset(req.offset);
        if self.cfg.tavily_api_key.is_empty() {
            return Err(invalid_params("TAVILY_API_KEY is required for search"));
        }
        let out = search_results(
            self.cfg.as_ref(),
            &query,
            limit,
            offset,
            req.search_time_range.as_ref().map(map_search_time_range),
        )
        .await
        .map_err(|e| internal_error(e.to_string()))?;

        respond_with_mode(
            "search",
            "search",
            response_mode,
            &format!("search-{}", slugify(&query, 56)),
            serde_json::json!({
                "query": query,
                "limit": limit,
                "offset": offset,
                "results": out,
            }),
        )
    }

    pub(super) async fn handle_scrape(
        &self,
        req: ScrapeRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let url = req
            .url
            .ok_or_else(|| invalid_params("url is required for scrape"))?;
        let payload = self.scrape_payload(&url).await?;
        respond_with_mode(
            "scrape",
            "scrape",
            parse_response_mode(req.response_mode),
            &format!("scrape-{}", slugify(&url, 56)),
            payload,
        )
    }

    pub(super) async fn handle_research(
        &self,
        req: ResearchRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        if self.cfg.tavily_api_key.is_empty() {
            return Err(invalid_params("TAVILY_API_KEY is required for research"));
        }
        if self.cfg.openai_base_url.is_empty() || self.cfg.openai_model.is_empty() {
            return Err(invalid_params(
                "OPENAI_BASE_URL and OPENAI_MODEL are required for research",
            ));
        }
        let query = req
            .query
            .ok_or_else(|| invalid_params("query is required for research"))?;
        let response_mode = parse_response_mode(req.response_mode);
        let limit = parse_limit_usize(req.limit, 10, 50);
        let offset = parse_offset(req.offset);

        let payload = research_payload(
            self.cfg.as_ref(),
            &query,
            limit,
            offset,
            req.search_time_range.as_ref().map(map_search_time_range),
        )
        .await
        .map_err(|e| invalid_params(e.to_string()))?;

        respond_with_mode(
            "research",
            "research",
            response_mode,
            &format!("research-{}", slugify(&query, 56)),
            payload,
        )
    }

    pub(super) async fn handle_ask(&self, req: AskRequest) -> Result<AxonToolResponse, ErrorData> {
        let query = req
            .query
            .ok_or_else(|| invalid_params("query is required for ask"))?;
        let response_mode = parse_response_mode(req.response_mode);
        let axon_bin = std::env::current_exe()
            .map_err(|e| internal_error(e.to_string()))?
            .with_file_name("axon");
        let output = Command::new(&axon_bin)
            .arg("ask")
            .arg("--json")
            .arg("--query")
            .arg(&query)
            .output()
            .await
            .map_err(|e| internal_error(format!("failed to execute {:?}: {e}", axon_bin)))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(internal_error(format!(
                "ask command failed with code {:?}: {}",
                output.status.code(),
                stderr.trim()
            )));
        }
        let stdout = String::from_utf8(output.stdout)
            .map_err(|e| internal_error(format!("invalid utf8 from ask output: {e}")))?;
        let payload = serde_json::from_str::<serde_json::Value>(&stdout)
            .map_err(|e| internal_error(format!("invalid ask json output: {e}")))?;
        respond_with_mode(
            "ask",
            "ask",
            response_mode,
            &format!("ask-{}", slugify(&query, 56)),
            payload,
        )
    }
}
