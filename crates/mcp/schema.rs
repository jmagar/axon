use rmcp::schemars;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum AxonRequest {
    Status(StatusRequest),
    Crawl(CrawlRequest),
    Extract(ExtractRequest),
    Embed(EmbedRequest),
    Ingest(IngestRequest),
    Rag(RagRequest),
    Discover(DiscoverRequest),
    Ops(OpsRequest),
    Help(HelpRequest),
    Artifacts(ArtifactsRequest),
    Scrape(ScrapeRequest),
    Research(ResearchRequest),
    Ask(AskRequest),
    Screenshot(ScreenshotRequest),
}

#[derive(Debug, Clone, Copy, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ResponseMode {
    Path,
    Inline,
    Both,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CrawlRequest {
    pub subaction: CrawlSubaction,
    pub urls: Option<Vec<String>>,
    pub job_id: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<usize>,
    pub response_mode: Option<ResponseMode>,
    pub max_pages: Option<u32>,
    pub max_depth: Option<usize>,
    pub include_subdomains: Option<bool>,
    pub respect_robots: Option<bool>,
    pub discover_sitemaps: Option<bool>,
    pub render_mode: Option<McpRenderMode>,
    pub delay_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CrawlSubaction {
    Start,
    Status,
    Cancel,
    List,
    Cleanup,
    Clear,
    Recover,
}

#[derive(Debug, Clone, Copy, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum McpRenderMode {
    Http,
    Chrome,
    AutoSwitch,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ExtractRequest {
    pub subaction: ExtractSubaction,
    pub urls: Option<Vec<String>>,
    pub prompt: Option<String>,
    pub job_id: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<usize>,
    pub response_mode: Option<ResponseMode>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExtractSubaction {
    Start,
    Status,
    Cancel,
    List,
    Cleanup,
    Clear,
    Recover,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EmbedRequest {
    pub subaction: EmbedSubaction,
    pub input: Option<String>,
    pub job_id: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<usize>,
    pub response_mode: Option<ResponseMode>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EmbedSubaction {
    Start,
    Status,
    Cancel,
    List,
    Cleanup,
    Clear,
    Recover,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct IngestRequest {
    pub subaction: IngestSubaction,
    pub source_type: Option<IngestSourceType>,
    pub target: Option<String>,
    pub include_source: Option<bool>,
    pub sessions: Option<SessionsIngestOptions>,
    pub job_id: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<usize>,
    pub response_mode: Option<ResponseMode>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum IngestSubaction {
    Start,
    Status,
    Cancel,
    List,
    Cleanup,
    Clear,
    Recover,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum IngestSourceType {
    Github,
    Reddit,
    Youtube,
    Sessions,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SessionsIngestOptions {
    pub claude: Option<bool>,
    pub codex: Option<bool>,
    pub gemini: Option<bool>,
    pub project: Option<String>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RagRequest {
    pub subaction: RagSubaction,
    pub query: Option<String>,
    pub url: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub max_points: Option<usize>,
    pub response_mode: Option<ResponseMode>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RagSubaction {
    Query,
    Retrieve,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DiscoverRequest {
    pub subaction: DiscoverSubaction,
    pub url: Option<String>,
    pub query: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub search_time_range: Option<SearchTimeRange>,
    pub response_mode: Option<ResponseMode>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiscoverSubaction {
    Scrape,
    Map,
    Search,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SearchTimeRange {
    Day,
    Week,
    Month,
    Year,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct OpsRequest {
    pub subaction: OpsSubaction,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub response_mode: Option<ResponseMode>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HelpRequest {
    pub response_mode: Option<ResponseMode>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StatusRequest {}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ArtifactsRequest {
    pub subaction: ArtifactsSubaction,
    pub path: Option<String>,
    pub pattern: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactsSubaction {
    Head,
    Grep,
    Wc,
    Read,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum OpsSubaction {
    Doctor,
    Domains,
    Sources,
    Stats,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ScrapeRequest {
    pub url: Option<String>,
    pub response_mode: Option<ResponseMode>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ResearchRequest {
    pub query: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub search_time_range: Option<SearchTimeRange>,
    pub response_mode: Option<ResponseMode>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AskRequest {
    pub query: Option<String>,
    pub response_mode: Option<ResponseMode>,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ScreenshotRequest {
    pub url: Option<String>,
    pub full_page: Option<bool>,
    pub viewport: Option<String>,
    pub output: Option<String>,
    pub response_mode: Option<ResponseMode>,
}

#[derive(Debug, Clone, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AxonToolResponse {
    pub ok: bool,
    pub action: String,
    pub subaction: String,
    pub data: Value,
}

impl AxonToolResponse {
    pub fn ok(action: &str, subaction: &str, data: Value) -> Self {
        Self {
            ok: true,
            action: action.to_string(),
            subaction: subaction.to_string(),
            data,
        }
    }
}

fn normalize_token(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['-', ' '], "_")
}

fn ensure_string_field(raw: &mut Map<String, Value>, key: &str, value: &str) {
    raw.insert(key.to_string(), Value::String(value.to_string()));
}

fn resolve_action(raw: &mut Map<String, Value>) -> Result<String, String> {
    let direct = raw
        .get("action")
        .and_then(Value::as_str)
        .map(normalize_token);
    if let Some(action) = direct {
        return Ok(action);
    }

    for alias in ["command", "op", "operation"] {
        if let Some(action) = raw.get(alias).and_then(Value::as_str).map(normalize_token) {
            ensure_string_field(raw, "action", &action);
            return Ok(action);
        }
    }

    Err("missing required field: action".to_string())
}

fn ensure_default_subaction(raw: &mut Map<String, Value>, default_value: &str) {
    if !raw.contains_key("subaction") {
        ensure_string_field(raw, "subaction", default_value);
    }
}

fn normalize_action_aliases(raw: &mut Map<String, Value>, action: &str) -> Result<String, String> {
    let normalized = match action {
        "query" => {
            ensure_string_field(raw, "subaction", "query");
            "rag"
        }
        "retrieve" => {
            ensure_string_field(raw, "subaction", "retrieve");
            "rag"
        }
        "map" => {
            ensure_string_field(raw, "subaction", "map");
            "discover"
        }
        "search" => {
            ensure_string_field(raw, "subaction", "search");
            "discover"
        }
        "doctor" | "domains" | "sources" | "stats" => {
            ensure_string_field(raw, "subaction", action);
            "ops"
        }
        "head" | "grep" | "wc" | "read" => {
            ensure_string_field(raw, "subaction", action);
            "artifacts"
        }
        "github" => {
            ensure_string_field(raw, "subaction", "start");
            ensure_string_field(raw, "source_type", "github");
            "ingest"
        }
        "reddit" => {
            ensure_string_field(raw, "subaction", "start");
            ensure_string_field(raw, "source_type", "reddit");
            "ingest"
        }
        "youtube" => {
            ensure_string_field(raw, "subaction", "start");
            ensure_string_field(raw, "source_type", "youtube");
            "ingest"
        }
        "sessions" => {
            ensure_string_field(raw, "subaction", "start");
            ensure_string_field(raw, "source_type", "sessions");
            "ingest"
        }
        other => other,
    };

    match normalized {
        "crawl" | "extract" | "embed" | "ingest" => ensure_default_subaction(raw, "start"),
        "rag" => {
            if !raw.contains_key("subaction") {
                let default_subaction = if raw.get("url").and_then(Value::as_str).is_some() {
                    "retrieve"
                } else {
                    "query"
                };
                ensure_string_field(raw, "subaction", default_subaction);
            }
        }
        "discover" => {
            if !raw.contains_key("subaction") {
                let default_subaction = if raw.get("query").and_then(Value::as_str).is_some() {
                    "search"
                } else {
                    "scrape"
                };
                ensure_string_field(raw, "subaction", default_subaction);
            }
        }
        "ops" => ensure_default_subaction(raw, "doctor"),
        "artifacts" => ensure_default_subaction(raw, "head"),
        "status" | "help" | "scrape" | "research" | "ask" | "screenshot" => {}
        unsupported => {
            return Err(format!("unsupported action: {unsupported}"));
        }
    }

    Ok(normalized.to_string())
}

pub fn parse_axon_request(mut raw: Map<String, Value>) -> Result<AxonRequest, String> {
    let action = resolve_action(&mut raw)?;
    let normalized = normalize_action_aliases(&mut raw, &action)?;
    ensure_string_field(&mut raw, "action", &normalized);
    if let Some(subaction) = raw
        .get("subaction")
        .and_then(Value::as_str)
        .map(normalize_token)
    {
        ensure_string_field(&mut raw, "subaction", &subaction);
    }
    if let Some(response_mode) = raw
        .get("response_mode")
        .and_then(Value::as_str)
        .map(normalize_token)
    {
        ensure_string_field(&mut raw, "response_mode", &response_mode);
    }
    raw.remove("command");
    raw.remove("op");
    raw.remove("operation");
    serde_json::from_value(Value::Object(raw)).map_err(|e| format!("invalid request shape: {e}"))
}
