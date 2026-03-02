mod common;
mod handlers_crawl_extract;
mod handlers_embed_ingest;
mod handlers_query;
mod handlers_refresh_status;
mod handlers_system;

use super::config::load_mcp_config;
use super::schema::{AxonRequest, parse_axon_request};
use crate::crates::core::config::Config;
use common::{MCP_TOOL_SCHEMA_URI, internal_error, invalid_params};
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
use std::sync::Arc;

#[derive(Clone)]
pub struct AxonMcpServer {
    cfg: Arc<Config>,
    tool_router: ToolRouter<Self>,
}

impl AxonMcpServer {
    pub fn new(cfg: Config) -> Self {
        Self {
            cfg: Arc::new(cfg),
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl AxonMcpServer {
    #[tool(
        name = "axon",
        description = "Unified Axon MCP tool. Use action/subaction routing. Use action:help to list actions/subactions/defaults. Exposes schema resource axon://schema/mcp-tool. Actions: status, help, crawl, extract, embed, ingest, refresh, query, retrieve, search, map, doctor, domains, sources, stats, artifacts, scrape, research, ask, screenshot."
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
            AxonRequest::Query(req) => self.handle_query(req).await?,
            AxonRequest::Retrieve(req) => self.handle_retrieve(req).await?,
            AxonRequest::Search(req) => self.handle_search(req).await?,
            AxonRequest::Map(req) => self.handle_map(req).await?,
            AxonRequest::Doctor(req) => self.handle_doctor(req).await?,
            AxonRequest::Domains(req) => self.handle_domains(req).await?,
            AxonRequest::Sources(req) => self.handle_sources(req).await?,
            AxonRequest::Stats(req) => self.handle_stats(req).await?,
            AxonRequest::Help(req) => self.handle_help(req).await?,
            AxonRequest::Artifacts(req) => self.handle_artifacts(req).await?,
            AxonRequest::Scrape(req) => self.handle_scrape(req).await?,
            AxonRequest::Research(req) => self.handle_research(req).await?,
            AxonRequest::Ask(req) => self.handle_ask(req).await?,
            AxonRequest::Screenshot(req) => self.handle_screenshot(req).await?,
            AxonRequest::Refresh(req) => self.handle_refresh(req).await?,
        };
        serde_json::to_string(&response).map_err(|e| internal_error(e.to_string()))
    }
}

fn mcp_tool_schema_markdown() -> String {
    let schema = rmcp::schemars::schema_for!(AxonRequest);
    let schema_json = serde_json::to_string_pretty(&schema).unwrap_or_else(|_| "{}".to_string());
    format!(
        "# Axon MCP Tool Schema\n\nURI: `{}`\n\nSingle tool name: `axon`\n\nRouting contract:\n- `action` is required\n- `subaction` is required for lifecycle actions\n- `response_mode` supports `path|inline|both` and defaults to `path`\n\n## JSON Schema\n\n```json\n{}\n```\n",
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
