use super::config::load_mcp_config;
use super::schema::{
    ArtifactsRequest, ArtifactsSubaction, AskRequest, AxonRequest, AxonToolResponse, CrawlRequest,
    CrawlSubaction, DiscoverRequest, DiscoverSubaction, EmbedRequest, EmbedSubaction,
    ExtractRequest, ExtractSubaction, HelpRequest, IngestRequest, IngestSourceType,
    IngestSubaction, McpRenderMode, OpsRequest, OpsSubaction, RagRequest, RagSubaction,
    ResearchRequest, ResponseMode, ScrapeRequest, ScreenshotRequest, SearchTimeRange,
    SessionsIngestOptions, StatusRequest, parse_axon_request,
};
use crate::crates::cli::commands::crawl::discover_sitemap_urls_with_robots;
use crate::crates::cli::commands::screenshot::{
    cdp_screenshot, resolve_browser_ws_url, url_to_screenshot_filename,
};
use crate::crates::core::config::{Config, RenderMode};
use crate::crates::core::content::{extract_meta_description, find_between, to_markdown};
use crate::crates::core::http::{fetch_html, http_client, normalize_url, validate_url};
use crate::crates::crawl::engine::crawl_and_collect_map;
use crate::crates::jobs::crawl::{
    cancel_job, cleanup_jobs, clear_jobs, get_job, list_jobs, recover_stale_crawl_jobs,
    start_crawl_job, start_crawl_jobs_batch,
};
use crate::crates::jobs::embed::{
    cancel_embed_job, cleanup_embed_jobs, clear_embed_jobs, get_embed_job, list_embed_jobs,
    recover_stale_embed_jobs, start_embed_job,
};
use crate::crates::jobs::extract::{
    cancel_extract_job, cleanup_extract_jobs, clear_extract_jobs, get_extract_job,
    list_extract_jobs, recover_stale_extract_jobs, start_extract_job,
};
use crate::crates::jobs::ingest::{
    IngestSource, cancel_ingest_job, cleanup_ingest_jobs, clear_ingest_jobs, get_ingest_job,
    list_ingest_jobs, recover_stale_ingest_jobs, start_ingest_job,
};
use crate::crates::vector::ops::input::url_lookup_candidates;
use crate::crates::vector::ops::qdrant::{
    qdrant_base, qdrant_domain_facets, qdrant_retrieve_by_url, qdrant_search, query_snippet,
    render_full_doc_from_points,
};
use crate::crates::vector::ops::tei::tei_embed;
use rmcp::{
    ErrorData, RoleServer, ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{
        AnnotateAble, ListResourcesResult, PaginatedRequestParams, RawResource,
        ReadResourceRequestParams, ReadResourceResult, Resource, ResourceContents,
        ServerCapabilities, ServerInfo,
    },
    service::RequestContext,
    tool, tool_handler, tool_router,
    transport::stdio,
};
use sha2::{Digest, Sha256};
use spider_agent::{Agent, SearchOptions, TimeRange};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::process::Command;
use uuid::Uuid;

const MCP_TOOL_SCHEMA_URI: &str = "axon://schema/mcp-tool";

#[derive(Clone)]
pub struct AxonMcpServer {
    cfg: Arc<Config>,
    tool_router: ToolRouter<Self>,
}

impl AxonMcpServer {
    async fn scrape_payload(&self, url: &str) -> Result<serde_json::Value, ErrorData> {
        validate_url(url).map_err(|e| invalid_params(e.to_string()))?;
        let client = http_client().map_err(|e| internal_error(e.to_string()))?;
        let html = fetch_html(client, url)
            .await
            .map_err(|e| internal_error(e.to_string()))?;
        let markdown = to_markdown(&html);
        let title = find_between(&html, "<title>", "</title>")
            .unwrap_or("")
            .to_string();
        let description = extract_meta_description(&html).unwrap_or_default();
        Ok(serde_json::json!({
            "url": url,
            "title": title,
            "description": description,
            "markdown": markdown,
        }))
    }

    fn parse_viewport(viewport: Option<&str>, fallback_w: u32, fallback_h: u32) -> (u32, u32) {
        let Some(v) = viewport else {
            return (fallback_w, fallback_h);
        };
        let mut parts = v.split('x');
        let Some(w) = parts.next().and_then(|n| n.parse::<u32>().ok()) else {
            return (fallback_w, fallback_h);
        };
        let Some(h) = parts.next().and_then(|n| n.parse::<u32>().ok()) else {
            return (fallback_w, fallback_h);
        };
        if w == 0 || h == 0 {
            return (fallback_w, fallback_h);
        }
        (w, h)
    }

    pub fn new(cfg: Config) -> Self {
        Self {
            cfg: Arc::new(cfg),
            tool_router: Self::tool_router(),
        }
    }
}

fn invalid_params(msg: impl Into<String>) -> ErrorData {
    ErrorData::invalid_params(msg.into(), None)
}

fn internal_error(msg: impl Into<String>) -> ErrorData {
    ErrorData::internal_error(msg.into(), None)
}

fn parse_job_id(job_id: Option<&String>) -> Result<Uuid, ErrorData> {
    let raw = job_id.ok_or_else(|| invalid_params("job_id is required for this subaction"))?;
    Uuid::parse_str(raw).map_err(|e| invalid_params(format!("invalid job_id: {e}")))
}

fn parse_limit(limit: Option<i64>, default: i64) -> i64 {
    limit.unwrap_or(default).clamp(1, 500)
}

fn parse_limit_usize(limit: Option<usize>, default: usize, max: usize) -> usize {
    limit.unwrap_or(default).clamp(1, max)
}

fn parse_offset(offset: Option<usize>) -> usize {
    offset.unwrap_or(0)
}

fn parse_response_mode(mode: Option<ResponseMode>) -> ResponseMode {
    mode.unwrap_or(ResponseMode::Path)
}

fn paginate_vec<T: Clone>(items: &[T], offset: usize, limit: usize) -> Vec<T> {
    items.iter().skip(offset).take(limit).cloned().collect()
}

fn artifact_root() -> PathBuf {
    PathBuf::from(".cache/axon-mcp")
}

fn ensure_artifact_root() -> Result<PathBuf, ErrorData> {
    let root = artifact_root();
    fs::create_dir_all(&root).map_err(|e| internal_error(e.to_string()))?;
    Ok(root)
}

fn slugify(value: &str, max_len: usize) -> String {
    let mut out = String::with_capacity(value.len().min(max_len));
    let mut prev_dash = false;
    for ch in value.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
        if out.len() >= max_len {
            break;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "artifact".to_string()
    } else {
        trimmed
    }
}

fn short_preview(text: &str, max_chars: usize) -> (String, bool) {
    if text.chars().count() <= max_chars {
        return (text.to_string(), false);
    }
    (text.chars().take(max_chars).collect::<String>(), true)
}

fn line_count(text: &str) -> usize {
    text.lines().count()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn build_artifact_path(stem: &str, ext: &str) -> Result<PathBuf, ErrorData> {
    let root = ensure_artifact_root()?;
    Ok(root.join(format!("{stem}.{ext}")))
}

fn write_text_artifact(stem: &str, text: &str) -> Result<serde_json::Value, ErrorData> {
    let path = build_artifact_path(stem, "json")?;
    fs::write(&path, text.as_bytes()).map_err(|e| internal_error(e.to_string()))?;
    let bytes = text.as_bytes();
    let (preview, preview_truncated) = short_preview(text, 600);
    Ok(serde_json::json!({
        "path": path,
        "bytes": bytes.len(),
        "line_count": line_count(text),
        "sha256": sha256_hex(bytes),
        "preview": preview,
        "preview_truncated": preview_truncated,
    }))
}

fn validate_artifact_path(raw: &str) -> Result<PathBuf, ErrorData> {
    let root = ensure_artifact_root()?
        .canonicalize()
        .map_err(|e| internal_error(e.to_string()))?;
    let candidate = PathBuf::from(raw);
    let canonical = if candidate.is_absolute() {
        candidate
            .canonicalize()
            .map_err(|e| invalid_params(format!("artifact path not found: {e}")))?
    } else {
        // Resolve relative to current working dir first, then fallback to artifact root.
        let cwd = std::env::current_dir().map_err(|e| internal_error(e.to_string()))?;
        let from_cwd = cwd.join(&candidate);
        match from_cwd.canonicalize() {
            Ok(p) => p,
            Err(_) => root
                .join(&candidate)
                .canonicalize()
                .map_err(|e| invalid_params(format!("artifact path not found: {e}")))?,
        }
    };
    if !canonical.starts_with(&root) {
        return Err(invalid_params(
            "artifact path must be inside .cache/axon-mcp",
        ));
    }
    Ok(canonical)
}

fn clip_inline_json(value: &serde_json::Value, max_chars: usize) -> (serde_json::Value, bool) {
    match serde_json::to_string(value) {
        Ok(raw) if raw.chars().count() <= max_chars => (value.clone(), false),
        Ok(raw) => {
            let clipped = raw.chars().take(max_chars).collect::<String>();
            (serde_json::json!({ "clipped_json": clipped }), true)
        }
        Err(_) => (
            serde_json::json!({ "clipped_json": "(serialization error)" }),
            true,
        ),
    }
}

fn respond_with_mode(
    action: &str,
    subaction: &str,
    mode: ResponseMode,
    artifact_stem: &str,
    payload: serde_json::Value,
) -> Result<AxonToolResponse, ErrorData> {
    let text = serde_json::to_string_pretty(&payload).map_err(|e| internal_error(e.to_string()))?;
    let artifact = write_text_artifact(artifact_stem, &text)?;
    match mode {
        ResponseMode::Path => Ok(AxonToolResponse::ok(
            action,
            subaction,
            serde_json::json!({
                "response_mode": "path",
                "artifact": artifact,
                "status": "saved",
            }),
        )),
        ResponseMode::Inline => {
            let (inline, truncated) = clip_inline_json(&payload, 12_000);
            Ok(AxonToolResponse::ok(
                action,
                subaction,
                serde_json::json!({
                    "response_mode": "inline",
                    "inline": inline,
                    "truncated": truncated,
                    "artifact": artifact,
                }),
            ))
        }
        ResponseMode::Both => {
            let (inline, truncated) = clip_inline_json(&payload, 12_000);
            Ok(AxonToolResponse::ok(
                action,
                subaction,
                serde_json::json!({
                    "response_mode": "both",
                    "inline": inline,
                    "truncated": truncated,
                    "artifact": artifact,
                }),
            ))
        }
    }
}

fn apply_crawl_overrides(cfg: &Config, req: &CrawlRequest) -> Config {
    let mut out = cfg.clone();
    if let Some(max_pages) = req.max_pages {
        out.max_pages = max_pages;
    }
    if let Some(max_depth) = req.max_depth {
        out.max_depth = max_depth;
    }
    if let Some(include_subdomains) = req.include_subdomains {
        out.include_subdomains = include_subdomains;
    }
    if let Some(respect_robots) = req.respect_robots {
        out.respect_robots = respect_robots;
    }
    if let Some(discover_sitemaps) = req.discover_sitemaps {
        out.discover_sitemaps = discover_sitemaps;
    }
    if let Some(render_mode) = req.render_mode {
        out.render_mode = map_render_mode(render_mode);
    }
    if let Some(delay_ms) = req.delay_ms {
        out.delay_ms = delay_ms;
    }
    out
}

fn map_render_mode(mode: McpRenderMode) -> RenderMode {
    match mode {
        McpRenderMode::Http => RenderMode::Http,
        McpRenderMode::Chrome => RenderMode::Chrome,
        McpRenderMode::AutoSwitch => RenderMode::AutoSwitch,
    }
}

fn map_search_time_range(range: &SearchTimeRange) -> TimeRange {
    match range {
        SearchTimeRange::Day => TimeRange::Day,
        SearchTimeRange::Week => TimeRange::Week,
        SearchTimeRange::Month => TimeRange::Month,
        SearchTimeRange::Year => TimeRange::Year,
    }
}

#[tool_router]
impl AxonMcpServer {
    #[tool(
        name = "axon",
        description = "Unified Axon MCP tool. Use action/subaction routing. Use action:help to list actions/subactions/defaults. Exposes schema resource axon://schema/mcp-tool. Actions: status, help, crawl, extract, embed, ingest, rag, discover, ops, artifacts, scrape, research, ask, screenshot."
    )]
    async fn axon(
        &self,
        Parameters(raw): Parameters<serde_json::Map<String, serde_json::Value>>,
    ) -> Result<String, ErrorData> {
        let request: AxonRequest =
            parse_axon_request(raw).map_err(|e| invalid_params(format!("invalid request: {e}")))?;
        let response = match request {
            AxonRequest::Status(req) => self.handle_status(req).await?,
            AxonRequest::Crawl(req) => self.handle_crawl(req).await?,
            AxonRequest::Extract(req) => self.handle_extract(req).await?,
            AxonRequest::Embed(req) => self.handle_embed(req).await?,
            AxonRequest::Ingest(req) => self.handle_ingest(req).await?,
            AxonRequest::Rag(req) => self.handle_rag(req).await?,
            AxonRequest::Discover(req) => self.handle_discover(req).await?,
            AxonRequest::Ops(req) => self.handle_ops(req).await?,
            AxonRequest::Help(req) => self.handle_help(req).await?,
            AxonRequest::Artifacts(req) => self.handle_artifacts(req).await?,
            AxonRequest::Scrape(req) => self.handle_scrape(req).await?,
            AxonRequest::Research(req) => self.handle_research(req).await?,
            AxonRequest::Ask(req) => self.handle_ask(req).await?,
            AxonRequest::Screenshot(req) => self.handle_screenshot(req).await?,
        };
        serde_json::to_string(&response).map_err(|e| internal_error(e.to_string()))
    }
}

impl AxonMcpServer {
    async fn handle_status(&self, _req: StatusRequest) -> Result<AxonToolResponse, ErrorData> {
        let json = crate::crates::cli::commands::status::status_snapshot(self.cfg.as_ref())
            .await
            .map_err(|e| internal_error(e.to_string()))?;

        let axon_bin = std::env::current_exe()
            .map_err(|e| internal_error(e.to_string()))?
            .with_file_name("axon");
        let output = Command::new(&axon_bin)
            .arg("status")
            .output()
            .await
            .map_err(|e| internal_error(format!("failed to execute {:?}: {e}", axon_bin)))?;
        if !output.status.success() {
            return Err(internal_error(format!(
                "status command failed with code {:?}",
                output.status.code()
            )));
        }
        let mut text = String::from_utf8(output.stdout)
            .map_err(|e| internal_error(format!("invalid utf8 from status output: {e}")))?;
        if text.ends_with('\n') {
            text.pop();
            if text.ends_with('\r') {
                text.pop();
            }
        }

        Ok(AxonToolResponse::ok(
            "status",
            "run",
            serde_json::json!({
                "text": text,
                "json": json,
            }),
        ))
    }

    async fn handle_crawl(&self, req: CrawlRequest) -> Result<AxonToolResponse, ErrorData> {
        let cfg = apply_crawl_overrides(self.cfg.as_ref(), &req);
        let response_mode = parse_response_mode(req.response_mode);
        match req.subaction {
            CrawlSubaction::Start => {
                let urls = req
                    .urls
                    .ok_or_else(|| invalid_params("urls is required for crawl.start"))?;
                if urls.is_empty() {
                    return Err(invalid_params("urls cannot be empty"));
                }
                for url in &urls {
                    validate_url(url).map_err(|e| invalid_params(e.to_string()))?;
                }
                let ids = if urls.len() == 1 {
                    let id = start_crawl_job(&cfg, &urls[0])
                        .await
                        .map_err(|e| internal_error(e.to_string()))?;
                    vec![id]
                } else {
                    let url_refs = urls.iter().map(String::as_str).collect::<Vec<_>>();
                    start_crawl_jobs_batch(&cfg, &url_refs)
                        .await
                        .map_err(|e| internal_error(e.to_string()))?
                        .into_iter()
                        .map(|(_, id)| id)
                        .collect::<Vec<_>>()
                };
                Ok(AxonToolResponse::ok(
                    "crawl",
                    "start",
                    serde_json::json!({
                        "job_ids": ids.iter().map(Uuid::to_string).collect::<Vec<_>>()
                    }),
                ))
            }
            CrawlSubaction::Status => {
                let id = parse_job_id(req.job_id.as_ref())?;
                let job = get_job(&cfg, id)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                respond_with_mode(
                    "crawl",
                    "status",
                    response_mode,
                    &format!("crawl-status-{id}"),
                    serde_json::json!({ "job": job }),
                )
            }
            CrawlSubaction::Cancel => {
                let id = parse_job_id(req.job_id.as_ref())?;
                let canceled = cancel_job(&cfg, id)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "crawl",
                    "cancel",
                    serde_json::json!({ "job_id": id.to_string(), "canceled": canceled }),
                ))
            }
            CrawlSubaction::List => {
                let limit = parse_limit(req.limit, 20);
                let offset = parse_offset(req.offset);
                let fetch_limit = ((offset as i64) + limit).clamp(1, 500);
                let jobs = list_jobs(&cfg, fetch_limit)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                let jobs = jobs
                    .into_iter()
                    .skip(offset)
                    .take(limit as usize)
                    .collect::<Vec<_>>();
                respond_with_mode(
                    "crawl",
                    "list",
                    response_mode,
                    "crawl-list",
                    serde_json::json!({ "jobs": jobs, "limit": limit, "offset": offset }),
                )
            }
            CrawlSubaction::Cleanup => {
                let deleted = cleanup_jobs(&cfg)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "crawl",
                    "cleanup",
                    serde_json::json!({ "deleted": deleted }),
                ))
            }
            CrawlSubaction::Clear => {
                let deleted = clear_jobs(&cfg)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "crawl",
                    "clear",
                    serde_json::json!({ "deleted": deleted }),
                ))
            }
            CrawlSubaction::Recover => {
                let recovered = recover_stale_crawl_jobs(&cfg)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "crawl",
                    "recover",
                    serde_json::json!({ "recovered": recovered }),
                ))
            }
        }
    }

    async fn handle_extract(&self, req: ExtractRequest) -> Result<AxonToolResponse, ErrorData> {
        let _response_mode = parse_response_mode(req.response_mode);
        match req.subaction {
            ExtractSubaction::Start => {
                let urls = req
                    .urls
                    .ok_or_else(|| invalid_params("urls is required for extract.start"))?;
                if urls.is_empty() {
                    return Err(invalid_params("urls cannot be empty"));
                }
                for url in &urls {
                    validate_url(url).map_err(|e| invalid_params(e.to_string()))?;
                }
                let id = start_extract_job(self.cfg.as_ref(), &urls, req.prompt)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "extract",
                    "start",
                    serde_json::json!({ "job_id": id.to_string() }),
                ))
            }
            ExtractSubaction::Status => {
                let id = parse_job_id(req.job_id.as_ref())?;
                let job = get_extract_job(self.cfg.as_ref(), id)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "extract",
                    "status",
                    serde_json::json!({ "job": job }),
                ))
            }
            ExtractSubaction::Cancel => {
                let id = parse_job_id(req.job_id.as_ref())?;
                let canceled = cancel_extract_job(self.cfg.as_ref(), id)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "extract",
                    "cancel",
                    serde_json::json!({ "job_id": id.to_string(), "canceled": canceled }),
                ))
            }
            ExtractSubaction::List => {
                let limit = parse_limit(req.limit, 20);
                let offset = parse_offset(req.offset);
                let fetch_limit = ((offset as i64) + limit).clamp(1, 500);
                let jobs = list_extract_jobs(self.cfg.as_ref(), fetch_limit)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                let jobs = jobs
                    .into_iter()
                    .skip(offset)
                    .take(limit as usize)
                    .collect::<Vec<_>>();
                Ok(AxonToolResponse::ok(
                    "extract",
                    "list",
                    serde_json::json!({ "jobs": jobs, "limit": limit, "offset": offset }),
                ))
            }
            ExtractSubaction::Cleanup => {
                let deleted = cleanup_extract_jobs(self.cfg.as_ref())
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "extract",
                    "cleanup",
                    serde_json::json!({ "deleted": deleted }),
                ))
            }
            ExtractSubaction::Clear => {
                let deleted = clear_extract_jobs(self.cfg.as_ref())
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "extract",
                    "clear",
                    serde_json::json!({ "deleted": deleted }),
                ))
            }
            ExtractSubaction::Recover => {
                let recovered = recover_stale_extract_jobs(self.cfg.as_ref())
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "extract",
                    "recover",
                    serde_json::json!({ "recovered": recovered }),
                ))
            }
        }
    }

    async fn handle_embed(&self, req: EmbedRequest) -> Result<AxonToolResponse, ErrorData> {
        let _response_mode = parse_response_mode(req.response_mode);
        match req.subaction {
            EmbedSubaction::Start => {
                let input = req
                    .input
                    .ok_or_else(|| invalid_params("input is required for embed.start"))?;
                let id = start_embed_job(self.cfg.as_ref(), &input)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "embed",
                    "start",
                    serde_json::json!({ "job_id": id.to_string() }),
                ))
            }
            EmbedSubaction::Status => {
                let id = parse_job_id(req.job_id.as_ref())?;
                let job = get_embed_job(self.cfg.as_ref(), id)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "embed",
                    "status",
                    serde_json::json!({ "job": job }),
                ))
            }
            EmbedSubaction::Cancel => {
                let id = parse_job_id(req.job_id.as_ref())?;
                let canceled = cancel_embed_job(self.cfg.as_ref(), id)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "embed",
                    "cancel",
                    serde_json::json!({ "job_id": id.to_string(), "canceled": canceled }),
                ))
            }
            EmbedSubaction::List => {
                let limit = parse_limit(req.limit, 20);
                let offset = parse_offset(req.offset);
                let fetch_limit = ((offset as i64) + limit).clamp(1, 500);
                let jobs = list_embed_jobs(self.cfg.as_ref(), fetch_limit)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                let jobs = jobs
                    .into_iter()
                    .skip(offset)
                    .take(limit as usize)
                    .collect::<Vec<_>>();
                Ok(AxonToolResponse::ok(
                    "embed",
                    "list",
                    serde_json::json!({ "jobs": jobs, "limit": limit, "offset": offset }),
                ))
            }
            EmbedSubaction::Cleanup => {
                let deleted = cleanup_embed_jobs(self.cfg.as_ref())
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "embed",
                    "cleanup",
                    serde_json::json!({ "deleted": deleted }),
                ))
            }
            EmbedSubaction::Clear => {
                let deleted = clear_embed_jobs(self.cfg.as_ref())
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "embed",
                    "clear",
                    serde_json::json!({ "deleted": deleted }),
                ))
            }
            EmbedSubaction::Recover => {
                let recovered = recover_stale_embed_jobs(self.cfg.as_ref())
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "embed",
                    "recover",
                    serde_json::json!({ "recovered": recovered }),
                ))
            }
        }
    }

    async fn handle_ingest(&self, req: IngestRequest) -> Result<AxonToolResponse, ErrorData> {
        let _response_mode = parse_response_mode(req.response_mode);
        match req.subaction {
            IngestSubaction::Start => {
                let source_type = req
                    .source_type
                    .ok_or_else(|| invalid_params("source_type is required for ingest.start"))?;
                let source = match source_type {
                    IngestSourceType::Github => {
                        let repo = req.target.ok_or_else(|| {
                            invalid_params("target repo is required for github ingest")
                        })?;
                        IngestSource::Github {
                            repo,
                            include_source: req.include_source.unwrap_or(false),
                        }
                    }
                    IngestSourceType::Reddit => {
                        let target = req.target.ok_or_else(|| {
                            invalid_params("target is required for reddit ingest")
                        })?;
                        IngestSource::Reddit { target }
                    }
                    IngestSourceType::Youtube => {
                        let target = req.target.ok_or_else(|| {
                            invalid_params("target is required for youtube ingest")
                        })?;
                        IngestSource::Youtube { target }
                    }
                    IngestSourceType::Sessions => {
                        let sessions = req.sessions.unwrap_or(SessionsIngestOptions {
                            claude: None,
                            codex: None,
                            gemini: None,
                            project: None,
                        });
                        IngestSource::Sessions {
                            sessions_claude: sessions.claude.unwrap_or(false),
                            sessions_codex: sessions.codex.unwrap_or(false),
                            sessions_gemini: sessions.gemini.unwrap_or(false),
                            sessions_project: sessions.project,
                        }
                    }
                };
                let id = start_ingest_job(self.cfg.as_ref(), source)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "ingest",
                    "start",
                    serde_json::json!({ "job_id": id.to_string() }),
                ))
            }
            IngestSubaction::Status => {
                let id = parse_job_id(req.job_id.as_ref())?;
                let job = get_ingest_job(self.cfg.as_ref(), id)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "ingest",
                    "status",
                    serde_json::json!({ "job": job }),
                ))
            }
            IngestSubaction::Cancel => {
                let id = parse_job_id(req.job_id.as_ref())?;
                let canceled = cancel_ingest_job(self.cfg.as_ref(), id)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "ingest",
                    "cancel",
                    serde_json::json!({ "job_id": id.to_string(), "canceled": canceled }),
                ))
            }
            IngestSubaction::List => {
                let limit = parse_limit(req.limit, 20);
                let offset = parse_offset(req.offset);
                let fetch_limit = ((offset as i64) + limit).clamp(1, 500);
                let jobs = list_ingest_jobs(self.cfg.as_ref(), fetch_limit)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                let jobs = jobs
                    .into_iter()
                    .skip(offset)
                    .take(limit as usize)
                    .collect::<Vec<_>>();
                Ok(AxonToolResponse::ok(
                    "ingest",
                    "list",
                    serde_json::json!({ "jobs": jobs, "limit": limit, "offset": offset }),
                ))
            }
            IngestSubaction::Cleanup => {
                let deleted = cleanup_ingest_jobs(self.cfg.as_ref())
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "ingest",
                    "cleanup",
                    serde_json::json!({ "deleted": deleted }),
                ))
            }
            IngestSubaction::Clear => {
                let deleted = clear_ingest_jobs(self.cfg.as_ref())
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "ingest",
                    "clear",
                    serde_json::json!({ "deleted": deleted }),
                ))
            }
            IngestSubaction::Recover => {
                let recovered = recover_stale_ingest_jobs(self.cfg.as_ref())
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                Ok(AxonToolResponse::ok(
                    "ingest",
                    "recover",
                    serde_json::json!({ "recovered": recovered }),
                ))
            }
        }
    }

    async fn handle_rag(&self, req: RagRequest) -> Result<AxonToolResponse, ErrorData> {
        match req.subaction {
            RagSubaction::Query => {
                let query = req
                    .query
                    .ok_or_else(|| invalid_params("query is required for rag.query"))?;
                if self.cfg.tei_url.is_empty() {
                    return Err(invalid_params("TEI_URL is required for rag.query"));
                }
                let limit = req.limit.unwrap_or(self.cfg.search_limit).clamp(1, 100);
                let offset = parse_offset(req.offset);
                let fetch_limit = (limit + offset).clamp(1, 200);
                let response_mode = parse_response_mode(req.response_mode);
                let mut vectors = tei_embed(self.cfg.as_ref(), std::slice::from_ref(&query))
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                if vectors.is_empty() {
                    return Err(internal_error("TEI returned no vector for query"));
                }
                let vector = vectors.remove(0);
                let hits = qdrant_search(self.cfg.as_ref(), &vector, fetch_limit)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                let results = hits
                    .into_iter()
                    .skip(offset)
                    .take(limit)
                    .map(|h| {
                        serde_json::json!({
                            "url": h.payload.url,
                            "score": h.score,
                            "snippet": query_snippet(&h.payload),
                            "chunk_index": h.payload.chunk_index,
                        })
                    })
                    .collect::<Vec<_>>();

                respond_with_mode(
                    "rag",
                    "query",
                    response_mode,
                    &format!("rag-query-{}", slugify(&query, 56)),
                    serde_json::json!({
                        "query": query,
                        "limit": limit,
                        "offset": offset,
                        "results": results,
                    }),
                )
            }
            RagSubaction::Retrieve => {
                let target = req
                    .url
                    .ok_or_else(|| invalid_params("url is required for rag.retrieve"))?;
                let response_mode = parse_response_mode(req.response_mode);
                let max_points = req.max_points;
                let candidates = url_lookup_candidates(&target);

                let mut points = Vec::new();
                for candidate in &candidates {
                    let fetched = qdrant_retrieve_by_url(self.cfg.as_ref(), candidate, max_points)
                        .await
                        .map_err(|e| internal_error(e.to_string()))?;
                    if !fetched.is_empty() {
                        points = fetched;
                        break;
                    }
                }

                let chunk_count = points.len();
                let content = if points.is_empty() {
                    String::new()
                } else {
                    render_full_doc_from_points(points)
                };

                respond_with_mode(
                    "rag",
                    "retrieve",
                    response_mode,
                    &format!("rag-retrieve-{}", slugify(&target, 56)),
                    serde_json::json!({
                        "url": target,
                        "chunks": chunk_count,
                        "content": content,
                    }),
                )
            }
        }
    }

    async fn handle_discover(&self, req: DiscoverRequest) -> Result<AxonToolResponse, ErrorData> {
        match req.subaction {
            DiscoverSubaction::Scrape => {
                let url = req
                    .url
                    .ok_or_else(|| invalid_params("url is required for discover.scrape"))?;
                let payload = self.scrape_payload(&url).await?;
                respond_with_mode(
                    "discover",
                    "scrape",
                    parse_response_mode(req.response_mode),
                    &format!("discover-scrape-{}", slugify(&url, 56)),
                    payload,
                )
            }
            DiscoverSubaction::Map => {
                let url = req
                    .url
                    .ok_or_else(|| invalid_params("url is required for discover.map"))?;
                let response_mode = parse_response_mode(req.response_mode);
                let limit = parse_limit_usize(req.limit, 25, 500);
                let offset = parse_offset(req.offset);
                validate_url(&url).map_err(|e| invalid_params(e.to_string()))?;
                let mut cfg = self.cfg.as_ref().clone();
                cfg.render_mode = RenderMode::Http;
                let (summary, mut urls) = crawl_and_collect_map(&cfg, &url, RenderMode::Http)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                if cfg.discover_sitemaps {
                    let mut sitemap = discover_sitemap_urls_with_robots(&cfg, &url)
                        .await
                        .map_err(|e| internal_error(e.to_string()))?
                        .urls;
                    urls.append(&mut sitemap);
                    urls.sort();
                    urls.dedup();
                }
                let paged_urls = paginate_vec(&urls, offset, limit);
                respond_with_mode(
                    "discover",
                    "map",
                    response_mode,
                    &format!("discover-map-{}", slugify(&url, 56)),
                    serde_json::json!({
                        "url": url,
                        "pages_seen": summary.pages_seen,
                        "elapsed_ms": summary.elapsed_ms,
                        "limit": limit,
                        "offset": offset,
                        "total_urls": urls.len(),
                        "urls": paged_urls,
                    }),
                )
            }
            DiscoverSubaction::Search => {
                let query = req
                    .query
                    .ok_or_else(|| invalid_params("query is required for discover.search"))?;
                let response_mode = parse_response_mode(req.response_mode);
                let limit = parse_limit_usize(req.limit, 10, 50);
                let offset = parse_offset(req.offset);
                if self.cfg.tavily_api_key.is_empty() {
                    return Err(invalid_params(
                        "TAVILY_API_KEY is required for discover.search",
                    ));
                }
                let mut options = SearchOptions::new().with_limit((limit + offset).clamp(1, 100));
                if let Some(range) = req.search_time_range.as_ref() {
                    options = options.with_time_range(map_search_time_range(range));
                }
                let agent = Agent::builder()
                    .with_search_tavily(&self.cfg.tavily_api_key)
                    .build()
                    .map_err(|e| internal_error(e.to_string()))?;
                let results = agent
                    .search_with_options(&query, options)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;

                let out = results
                    .results
                    .iter()
                    .skip(offset)
                    .take(limit)
                    .map(|r| {
                        serde_json::json!({
                            "position": r.position,
                            "title": r.title,
                            "url": r.url,
                            "snippet": r.snippet,
                        })
                    })
                    .collect::<Vec<_>>();

                respond_with_mode(
                    "discover",
                    "search",
                    response_mode,
                    &format!("discover-search-{}", slugify(&query, 56)),
                    serde_json::json!({
                        "query": query,
                        "limit": limit,
                        "offset": offset,
                        "results": out,
                    }),
                )
            }
        }
    }

    async fn handle_scrape(&self, req: ScrapeRequest) -> Result<AxonToolResponse, ErrorData> {
        let url = req
            .url
            .ok_or_else(|| invalid_params("url is required for scrape"))?;
        let payload = self.scrape_payload(&url).await?;
        respond_with_mode(
            "scrape",
            "run",
            parse_response_mode(req.response_mode),
            &format!("scrape-{}", slugify(&url, 56)),
            payload,
        )
    }

    async fn handle_research(&self, req: ResearchRequest) -> Result<AxonToolResponse, ErrorData> {
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

        let base = self.cfg.openai_base_url.trim_end_matches('/');
        if base.ends_with("/chat/completions") {
            return Err(invalid_params(
                "OPENAI_BASE_URL should not include /chat/completions",
            ));
        }

        let llm_url = format!("{base}/chat/completions");
        let mut search_options = SearchOptions::new().with_limit((limit + offset).clamp(1, 100));
        if let Some(range) = req.search_time_range.as_ref() {
            search_options = search_options.with_time_range(map_search_time_range(range));
        }
        let agent = Agent::builder()
            .with_openai_compatible(llm_url, &self.cfg.openai_api_key, &self.cfg.openai_model)
            .with_search_tavily(&self.cfg.tavily_api_key)
            .build()
            .map_err(|e| internal_error(e.to_string()))?;

        let extraction_prompt =
            format!("Extract key facts, details, and insights relevant to: {query}");

        let research = agent
            .research(
                &query,
                spider_agent::ResearchOptions::new()
                    .with_max_pages((limit + offset).clamp(1, 100))
                    .with_search_options(search_options)
                    .with_extraction_prompt(extraction_prompt)
                    .with_synthesize(true),
            )
            .await
            .map_err(|e| internal_error(e.to_string()))?;

        let search_results = research
            .search_results
            .results
            .iter()
            .skip(offset)
            .take(limit)
            .map(|r| {
                serde_json::json!({
                    "position": r.position,
                    "title": r.title,
                    "url": r.url,
                    "snippet": r.snippet,
                })
            })
            .collect::<Vec<_>>();

        let extractions = research
            .extractions
            .iter()
            .skip(offset)
            .take(limit)
            .map(|e| {
                serde_json::json!({
                    "url": e.url,
                    "title": e.title,
                    "extracted": e.extracted,
                })
            })
            .collect::<Vec<_>>();

        respond_with_mode(
            "research",
            "run",
            response_mode,
            &format!("research-{}", slugify(&query, 56)),
            serde_json::json!({
                "query": query,
                "limit": limit,
                "offset": offset,
                "search_results": search_results,
                "extractions": extractions,
                "summary": research.summary,
                "usage": {
                    "prompt_tokens": research.usage.prompt_tokens,
                    "completion_tokens": research.usage.completion_tokens,
                    "total_tokens": research.usage.total_tokens,
                }
            }),
        )
    }

    async fn handle_ask(&self, req: AskRequest) -> Result<AxonToolResponse, ErrorData> {
        let query = req
            .query
            .ok_or_else(|| invalid_params("query is required for ask"))?;
        let response_mode = parse_response_mode(req.response_mode);
        if self.cfg.openai_base_url.trim().is_empty() || self.cfg.openai_model.trim().is_empty() {
            return Err(invalid_params(
                "OPENAI_BASE_URL and OPENAI_MODEL are required for ask",
            ));
        }
        if self.cfg.tei_url.trim().is_empty() {
            return Err(invalid_params("TEI_URL is required for ask"));
        }

        let mut query_vectors = tei_embed(self.cfg.as_ref(), std::slice::from_ref(&query))
            .await
            .map_err(|e| internal_error(e.to_string()))?;
        if query_vectors.is_empty() {
            return Err(internal_error("TEI returned no vector for ask query"));
        }
        let vector = query_vectors.remove(0);
        let candidate_limit = self.cfg.search_limit.clamp(1, 50);
        let hits = qdrant_search(self.cfg.as_ref(), &vector, candidate_limit)
            .await
            .map_err(|e| internal_error(e.to_string()))?;
        let sources = hits
            .iter()
            .enumerate()
            .map(|(idx, hit)| {
                serde_json::json!({
                    "source": format!("S{}", idx + 1),
                    "url": hit.payload.url,
                    "score": hit.score,
                    "snippet": query_snippet(&hit.payload),
                })
            })
            .collect::<Vec<_>>();
        let context = hits
            .iter()
            .enumerate()
            .map(|(idx, hit)| {
                format!(
                    "[S{}] {}\n{}\n",
                    idx + 1,
                    hit.payload.url,
                    query_snippet(&hit.payload)
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        let mut llm_req = http_client()
            .map_err(|e| internal_error(e.to_string()))?
            .post(format!(
                "{}/chat/completions",
                self.cfg.openai_base_url.trim_end_matches('/')
            ));
        if !self.cfg.openai_api_key.trim().is_empty() {
            llm_req = llm_req.bearer_auth(&self.cfg.openai_api_key);
        }
        let answer_json = llm_req
            .json(&serde_json::json!({
                "model": self.cfg.openai_model,
                "messages": [
                    {
                        "role": "system",
                        "content": "Answer the question using the provided context. Cite sources inline as [S#] and include a short Sources list."
                    },
                    {
                        "role": "user",
                        "content": format!("Question: {}\n\nContext:\n{}", query, context)
                    }
                ],
                "temperature": 0.1
            }))
            .send()
            .await
            .map_err(|e| internal_error(e.to_string()))?
            .error_for_status()
            .map_err(|e| internal_error(e.to_string()))?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| internal_error(e.to_string()))?;
        let answer = answer_json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("(no answer)")
            .to_string();

        let payload = if matches!(response_mode, ResponseMode::Path) {
            serde_json::json!({
                "query": query,
                "answer": answer,
                "diagnostics": {
                    "candidate_pool": sources.len(),
                    "context_chars": context.len(),
                },
                "source_count": sources.len(),
            })
        } else {
            serde_json::json!({
                "query": query,
                "answer": answer,
                "diagnostics": {
                    "candidate_pool": sources.len(),
                    "context_chars": context.len(),
                },
                "sources": sources,
            })
        };
        respond_with_mode(
            "ask",
            "run",
            response_mode,
            &format!("ask-{}", slugify(&query, 56)),
            payload,
        )
    }

    async fn handle_screenshot(
        &self,
        req: ScreenshotRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let url = req
            .url
            .ok_or_else(|| invalid_params("url is required for screenshot"))?;
        let _response_mode = parse_response_mode(req.response_mode);
        let normalized = normalize_url(&url);
        validate_url(&normalized).map_err(|e| invalid_params(e.to_string()))?;

        let remote_url =
            self.cfg.chrome_remote_url.as_deref().ok_or_else(|| {
                invalid_params("AXON_CHROME_REMOTE_URL is required for screenshot")
            })?;
        let browser_ws = resolve_browser_ws_url(remote_url)
            .await
            .map_err(|e| internal_error(e.to_string()))?;
        let (width, height) = Self::parse_viewport(
            req.viewport.as_deref(),
            self.cfg.viewport_width,
            self.cfg.viewport_height,
        );
        let full_page = req.full_page.unwrap_or(self.cfg.screenshot_full_page);

        let bytes = cdp_screenshot(
            &browser_ws,
            &normalized,
            width,
            height,
            full_page,
            self.cfg.chrome_network_idle_timeout_secs,
        )
        .await
        .map_err(|e| internal_error(e.to_string()))?;

        let path = if let Some(output) = req.output {
            PathBuf::from(output)
        } else {
            ensure_artifact_root()?
                .join("screenshots")
                .join(url_to_screenshot_filename(&normalized, 1))
        };
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| internal_error(e.to_string()))?;
        }
        tokio::fs::write(&path, &bytes)
            .await
            .map_err(|e| internal_error(e.to_string()))?;

        Ok(AxonToolResponse::ok(
            "screenshot",
            "run",
            serde_json::json!({
                "url": normalized,
                "path": path,
                "size_bytes": bytes.len(),
                "full_page": full_page,
                "viewport": format!("{}x{}", width, height),
            }),
        ))
    }

    async fn handle_artifacts(&self, req: ArtifactsRequest) -> Result<AxonToolResponse, ErrorData> {
        let path = req
            .path
            .as_deref()
            .ok_or_else(|| invalid_params("path is required for artifacts operations"))?;
        let path = validate_artifact_path(path)?;
        let text = fs::read_to_string(&path).map_err(|e| internal_error(e.to_string()))?;

        match req.subaction {
            ArtifactsSubaction::Head => {
                let limit = parse_limit_usize(req.limit, 25, 500);
                let head = text.lines().take(limit).collect::<Vec<_>>().join("\n");
                Ok(AxonToolResponse::ok(
                    "artifacts",
                    "head",
                    serde_json::json!({
                        "path": path,
                        "limit": limit,
                        "line_count": line_count(&text),
                        "head": head,
                    }),
                ))
            }
            ArtifactsSubaction::Grep => {
                let pattern = req
                    .pattern
                    .as_deref()
                    .ok_or_else(|| invalid_params("pattern is required for artifacts.grep"))?;
                let limit = parse_limit_usize(req.limit, 25, 500);
                let offset = parse_offset(req.offset);
                let matches = text
                    .lines()
                    .enumerate()
                    .filter(|(_, line)| line.contains(pattern))
                    .skip(offset)
                    .take(limit)
                    .map(|(idx, line)| serde_json::json!({ "line": idx + 1, "text": line }))
                    .collect::<Vec<_>>();
                Ok(AxonToolResponse::ok(
                    "artifacts",
                    "grep",
                    serde_json::json!({
                        "path": path,
                        "pattern": pattern,
                        "limit": limit,
                        "offset": offset,
                        "matches": matches,
                    }),
                ))
            }
            ArtifactsSubaction::Wc => Ok(AxonToolResponse::ok(
                "artifacts",
                "wc",
                serde_json::json!({
                    "path": path,
                    "bytes": text.len(),
                    "lines": line_count(&text),
                    "sha256": sha256_hex(text.as_bytes()),
                }),
            )),
            ArtifactsSubaction::Read => {
                let limit = parse_limit_usize(req.limit, 2000, 20_000);
                let offset = parse_offset(req.offset);
                let content = text
                    .lines()
                    .skip(offset)
                    .take(limit)
                    .collect::<Vec<_>>()
                    .join("\n");
                Ok(AxonToolResponse::ok(
                    "artifacts",
                    "read",
                    serde_json::json!({
                        "path": path,
                        "offset": offset,
                        "limit": limit,
                        "content": content,
                    }),
                ))
            }
        }
    }

    async fn handle_help(&self, req: HelpRequest) -> Result<AxonToolResponse, ErrorData> {
        respond_with_mode(
            "help",
            "run",
            parse_response_mode(req.response_mode),
            "help-actions",
            serde_json::json!({
                "tool": "axon",
                "actions": {
                    "status": [],
                    "help": [],
                    "scrape": ["run"],
                    "research": ["run"],
                    "ask": ["run"],
                    "screenshot": ["run"],
                    "crawl": ["start", "status", "cancel", "list", "cleanup", "clear", "recover"],
                    "extract": ["start", "status", "cancel", "list", "cleanup", "clear", "recover"],
                    "embed": ["start", "status", "cancel", "list", "cleanup", "clear", "recover"],
                    "ingest": ["start", "status", "cancel", "list", "cleanup", "clear", "recover"],
                    "rag": ["query", "retrieve"],
                    "discover": ["scrape", "map", "search"],
                    "ops": ["doctor", "domains", "sources", "stats"],
                    "artifacts": ["head", "grep", "wc", "read"]
                },
                "resources": [
                    MCP_TOOL_SCHEMA_URI
                ],
                "defaults": {
                    "response_mode": "path",
                    "artifact_dir": ".cache/axon-mcp"
                }
            }),
        )
    }

    async fn handle_ops(&self, req: OpsRequest) -> Result<AxonToolResponse, ErrorData> {
        match req.subaction {
            OpsSubaction::Doctor => {
                let client = http_client().map_err(|e| internal_error(e.to_string()))?;
                let qdrant_ok = client
                    .get(format!("{}/collections", qdrant_base(self.cfg.as_ref())))
                    .send()
                    .await
                    .map(|r| r.status().is_success())
                    .unwrap_or(false);

                let tei_ok = if self.cfg.tei_url.is_empty() {
                    false
                } else {
                    client
                        .post(format!("{}/embed", self.cfg.tei_url.trim_end_matches('/')))
                        .json(&serde_json::json!({ "inputs": ["healthcheck"] }))
                        .send()
                        .await
                        .map(|r| r.status().is_success())
                        .unwrap_or(false)
                };

                let llm_ok = if self.cfg.openai_base_url.is_empty() {
                    false
                } else {
                    client
                        .get(format!(
                            "{}/models",
                            self.cfg.openai_base_url.trim_end_matches('/')
                        ))
                        .send()
                        .await
                        .map(|r| r.status().is_success())
                        .unwrap_or(false)
                };

                Ok(AxonToolResponse::ok(
                    "ops",
                    "doctor",
                    serde_json::json!({
                        "qdrant_ok": qdrant_ok,
                        "tei_ok": tei_ok,
                        "llm_ok": llm_ok,
                        "pg_configured": !self.cfg.pg_url.is_empty(),
                        "redis_configured": !self.cfg.redis_url.is_empty(),
                        "amqp_configured": !self.cfg.amqp_url.is_empty(),
                    }),
                ))
            }
            OpsSubaction::Domains => {
                let limit = parse_limit_usize(req.limit, 25, 500);
                let offset = parse_offset(req.offset);
                let domains =
                    qdrant_domain_facets(self.cfg.as_ref(), (limit + offset).clamp(1, 500))
                        .await
                        .map_err(|e| internal_error(e.to_string()))?;
                let values = domains
                    .into_iter()
                    .skip(offset)
                    .take(limit)
                    .map(|(domain, vectors)| {
                        serde_json::json!({ "domain": domain, "vectors": vectors })
                    })
                    .collect::<Vec<_>>();
                respond_with_mode(
                    "ops",
                    "domains",
                    parse_response_mode(req.response_mode),
                    "ops-domains",
                    serde_json::json!({ "domains": values, "limit": limit, "offset": offset }),
                )
            }
            OpsSubaction::Sources => {
                let limit = parse_limit_usize(req.limit, 25, 500);
                let offset = parse_offset(req.offset);
                let urls = crate::crates::vector::ops::qdrant::qdrant_indexed_urls(
                    self.cfg.as_ref(),
                    Some((limit + offset).clamp(1, 500)),
                )
                .await
                .map_err(|e| internal_error(e.to_string()))?;
                let total = urls.len();
                let urls = urls
                    .into_iter()
                    .skip(offset)
                    .take(limit)
                    .collect::<Vec<_>>();
                respond_with_mode(
                    "ops",
                    "sources",
                    parse_response_mode(req.response_mode),
                    "ops-sources",
                    serde_json::json!({ "count": total, "limit": limit, "offset": offset, "urls": urls }),
                )
            }
            OpsSubaction::Stats => {
                let client = http_client().map_err(|e| internal_error(e.to_string()))?;
                let info = client
                    .get(format!(
                        "{}/collections/{}",
                        qdrant_base(self.cfg.as_ref()),
                        self.cfg.collection
                    ))
                    .send()
                    .await
                    .map_err(|e| internal_error(e.to_string()))?
                    .error_for_status()
                    .map_err(|e| internal_error(e.to_string()))?
                    .json::<serde_json::Value>()
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                let count = client
                    .post(format!(
                        "{}/collections/{}/points/count",
                        qdrant_base(self.cfg.as_ref()),
                        self.cfg.collection
                    ))
                    .json(&serde_json::json!({"exact": true}))
                    .send()
                    .await
                    .map_err(|e| internal_error(e.to_string()))?
                    .error_for_status()
                    .map_err(|e| internal_error(e.to_string()))?
                    .json::<serde_json::Value>()
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;

                Ok(AxonToolResponse::ok(
                    "ops",
                    "stats",
                    serde_json::json!({ "collection_info": info, "count": count }),
                ))
            }
        }
    }
}

fn mcp_tool_schema_markdown() -> String {
    let schema = rmcp::schemars::schema_for!(AxonRequest);
    let schema_json = serde_json::to_string_pretty(&schema).unwrap_or_else(|_| "{}".to_string());
    format!(
        "# Axon MCP Tool Schema\n\nURI: `{}`\n\nSingle tool name: `axon`\n\nRouting contract:\n- `action` is required\n- `subaction` is required for lifecycle actions and defaulted by parser shim where omitted\n- `response_mode` supports `path|inline|both` and defaults to `path`\n\n## JSON Schema\n\n```json\n{}\n```\n",
        MCP_TOOL_SCHEMA_URI, schema_json
    )
}

#[tool_handler]
impl ServerHandler for AxonMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some(
                "Use the single axon tool with action/subaction to drive crawl and RAG workflows"
                    .into(),
            ),
            capabilities: ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
            ..Default::default()
        }
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        let resource: Resource = RawResource {
            uri: MCP_TOOL_SCHEMA_URI.to_string(),
            name: "mcp-tool-schema".to_string(),
            title: Some("Axon MCP Tool Schema".to_string()),
            description: Some(
                "Source-of-truth schema and routing contract for the unified axon tool".to_string(),
            ),
            mime_type: Some("text/markdown".to_string()),
            size: None,
            icons: None,
            meta: None,
        }
        .no_annotation();

        Ok(ListResourcesResult {
            meta: None,
            resources: vec![resource],
            next_cursor: None,
        })
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResult, ErrorData> {
        if request.uri != MCP_TOOL_SCHEMA_URI {
            return Err(ErrorData::invalid_params(
                format!("resource not found: {}", request.uri),
                None,
            ));
        }
        Ok(ReadResourceResult {
            contents: vec![ResourceContents::TextResourceContents {
                uri: MCP_TOOL_SCHEMA_URI.to_string(),
                mime_type: Some("text/markdown".to_string()),
                text: mcp_tool_schema_markdown(),
                meta: None,
            }],
        })
    }
}

pub async fn run_stdio_server() -> Result<(), Box<dyn std::error::Error>> {
    let cfg = load_mcp_config();
    let service = AxonMcpServer::new(cfg).serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
