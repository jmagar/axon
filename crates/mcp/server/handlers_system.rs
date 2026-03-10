use super::AxonMcpServer;
use super::artifacts::{
    artifact_root, clean_artifact_files, delete_artifact_file, ensure_artifact_root, line_count,
    list_artifact_files, resolve_artifact_output_path, respond_with_mode, search_artifact_files,
    validate_artifact_path,
};
use super::common::{
    MCP_TOOL_SCHEMA_URI, invalid_params, logged_internal_error, parse_limit_usize, parse_offset,
    parse_response_mode, to_pagination,
};
use crate::crates::cli::commands::screenshot::{
    spider_screenshot_with_options, url_to_screenshot_filename,
};
use crate::crates::core::http::{normalize_url, validate_url};
use crate::crates::mcp::schema::{
    ArtifactsRequest, ArtifactsSubaction, AxonToolResponse, DoctorRequest, DomainsRequest,
    HelpRequest, ScreenshotRequest, SourcesRequest, StatsRequest,
};
use crate::crates::services::system;
use regex::Regex;
use rmcp::ErrorData;
use std::path::Path;

// --- Private helpers for artifact inspection ---

impl AxonMcpServer {
    fn artifacts_grep_file(
        path: &Path,
        text: &str,
        pattern: &str,
        limit: usize,
        offset: usize,
        ctx: usize,
    ) -> Result<AxonToolResponse, ErrorData> {
        let re = Regex::new(pattern)
            .map_err(|e| invalid_params(format!("invalid regex pattern: {e}")))?;
        let lines: Vec<&str> = text.lines().collect();
        let matches: Vec<_> = lines
            .iter()
            .enumerate()
            .filter(|(_, line)| re.is_match(line))
            .skip(offset)
            .take(limit)
            .map(|(idx, line)| {
                let before = lines[idx.saturating_sub(ctx)..idx].to_vec();
                let after_end = (idx + ctx + 1).min(lines.len());
                let after = lines[(idx + 1)..after_end].to_vec();
                serde_json::json!({
                    "line": idx + 1,
                    "text": line,
                    "context_before": before,
                    "context_after": after,
                })
            })
            .collect();
        Ok(AxonToolResponse::ok(
            "artifacts",
            "grep",
            serde_json::json!({
                "path": path,
                "pattern": pattern,
                "context_lines": ctx,
                "limit": limit,
                "offset": offset,
                "matches": matches,
            }),
        ))
    }

    fn artifacts_read_file(
        path: &Path,
        text: &str,
        pattern: Option<&str>,
        full: bool,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<AxonToolResponse, ErrorData> {
        match (pattern, full) {
            (Some(pattern), _) => {
                let re = Regex::new(pattern)
                    .map_err(|e| invalid_params(format!("invalid regex pattern: {e}")))?;
                let limit = parse_limit_usize(limit, 200, 5_000);
                let offset = parse_offset(offset);
                let content: Vec<_> = text
                    .lines()
                    .enumerate()
                    .filter(|(_, line)| re.is_match(line))
                    .skip(offset)
                    .take(limit)
                    .map(|(idx, line)| serde_json::json!({ "line": idx + 1, "text": line }))
                    .collect();
                Ok(AxonToolResponse::ok(
                    "artifacts",
                    "read",
                    serde_json::json!({
                        "path": path,
                        "filter": "pattern",
                        "pattern": pattern,
                        "offset": offset,
                        "limit": limit,
                        "matches": content,
                    }),
                ))
            }
            (None, true) => {
                let limit = parse_limit_usize(limit, 2_000, 20_000);
                let offset = parse_offset(offset);
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
                        "filter": "full",
                        "offset": offset,
                        "limit": limit,
                        "line_count": line_count(text),
                        "content": content,
                    }),
                ))
            }
            (None, false) => Err(invalid_params(
                "artifacts.read requires either \
                 pattern (filtered read) or full: true (complete content)",
            )),
        }
    }
}

// --- Public handlers ---

impl AxonMcpServer {
    pub(super) fn parse_viewport(
        viewport: Option<&str>,
        fallback_w: u32,
        fallback_h: u32,
    ) -> Result<(u32, u32), ErrorData> {
        let Some(v) = viewport else {
            return Ok((fallback_w, fallback_h));
        };
        let mut parts = v.split('x');
        let w = parts
            .next()
            .and_then(|n| n.parse::<u32>().ok())
            .ok_or_else(|| {
                invalid_params(format!(
                    "invalid viewport '{v}': expected WxH format (e.g. 1280x720)"
                ))
            })?;
        let h = parts
            .next()
            .and_then(|n| n.parse::<u32>().ok())
            .ok_or_else(|| {
                invalid_params(format!(
                    "invalid viewport '{v}': expected WxH format (e.g. 1280x720)"
                ))
            })?;
        if w == 0 || h == 0 {
            return Err(invalid_params(format!(
                "invalid viewport '{v}': width and height must be greater than zero"
            )));
        }
        // Reject unreasonably large dimensions to prevent resource exhaustion.
        if w > 7680 || h > 4320 {
            return Err(invalid_params(format!(
                "invalid viewport '{v}': dimensions exceed maximum allowed (7680x4320)"
            )));
        }
        Ok((w, h))
    }

    pub(super) async fn handle_screenshot(
        &self,
        req: ScreenshotRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let url = req
            .url
            .ok_or_else(|| invalid_params("url is required for screenshot"))?;
        let response_mode = parse_response_mode(req.response_mode);
        let normalized = normalize_url(&url);
        validate_url(&normalized).map_err(|e| invalid_params(e.to_string()))?;

        let (width, height) = Self::parse_viewport(
            req.viewport.as_deref(),
            self.cfg.viewport_width,
            self.cfg.viewport_height,
        )?;
        let full_page = req.full_page.unwrap_or(self.cfg.screenshot_full_page);

        let bytes =
            spider_screenshot_with_options(&self.cfg, &normalized, width, height, full_page)
                .await
                .map_err(|e| logged_internal_error("operation", e))?;

        let path = if let Some(output) = req.output {
            resolve_artifact_output_path(&output).await?
        } else {
            ensure_artifact_root()
                .await?
                .join("screenshots")
                .join(url_to_screenshot_filename(&normalized, 1))
        };
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| logged_internal_error("operation", e))?;
        }
        tokio::fs::write(&path, &bytes)
            .await
            .map_err(|e| logged_internal_error("operation", e))?;

        let payload = serde_json::json!({
            "url": normalized,
            "path": path,
            "size_bytes": bytes.len(),
            "full_page": full_page,
            "viewport": format!("{}x{}", width, height),
        });
        respond_with_mode(
            "screenshot",
            "screenshot",
            response_mode,
            "screenshot",
            payload,
        )
        .await
    }

    pub(super) async fn handle_artifacts(
        &self,
        req: ArtifactsRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let response_mode = parse_response_mode(req.response_mode);
        match req.subaction {
            ArtifactsSubaction::List => {
                let limit = parse_limit_usize(req.limit, 50, 500);
                let offset = parse_offset(req.offset);
                let result = list_artifact_files(limit, offset).await?;
                respond_with_mode("artifacts", "list", response_mode, "artifacts-list", result)
                    .await
            }
            ArtifactsSubaction::Search => {
                let pattern = req
                    .pattern
                    .as_deref()
                    .ok_or_else(|| invalid_params("pattern is required for artifacts.search"))?;
                let limit = parse_limit_usize(req.limit, 25, 500);
                let result = search_artifact_files(pattern, limit).await?;
                respond_with_mode(
                    "artifacts",
                    "search",
                    response_mode,
                    "artifacts-search",
                    result,
                )
                .await
            }
            ArtifactsSubaction::Clean => {
                let max_age_hours = req.max_age_hours.ok_or_else(|| {
                    invalid_params(
                        "max_age_hours is required for artifacts.clean \
                         (e.g. 24 to target files older than 24 hours)",
                    )
                })?;
                // dry_run defaults to true — never delete without explicit opt-in
                let dry_run = req.dry_run.unwrap_or(true);
                let result = clean_artifact_files(max_age_hours, dry_run).await?;
                Ok(AxonToolResponse::ok("artifacts", "clean", result))
            }
            _ => self.handle_artifacts_path_op(req).await,
        }
    }

    async fn handle_artifacts_path_op(
        &self,
        req: ArtifactsRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let raw_path = req
            .path
            .as_deref()
            .ok_or_else(|| invalid_params("path is required for this artifacts operation"))?;

        if matches!(req.subaction, ArtifactsSubaction::Delete) {
            let path = validate_artifact_path(raw_path).await?;
            let bytes_freed = delete_artifact_file(&path).await?;
            return Ok(AxonToolResponse::ok(
                "artifacts",
                "delete",
                serde_json::json!({ "deleted": path, "bytes_freed": bytes_freed }),
            ));
        }

        // Head / Grep / Wc / Read — all need the file text
        let path = validate_artifact_path(raw_path).await?;
        let text = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| logged_internal_error("operation", e))?;

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
                let ctx = req.context_lines.unwrap_or(0).min(20);
                Self::artifacts_grep_file(&path, &text, pattern, limit, offset, ctx)
            }
            ArtifactsSubaction::Wc => Ok(AxonToolResponse::ok(
                "artifacts",
                "wc",
                serde_json::json!({
                    "path": path,
                    "bytes": text.len(),
                    "lines": line_count(&text),
                }),
            )),
            ArtifactsSubaction::Read => Self::artifacts_read_file(
                &path,
                &text,
                req.pattern.as_deref(),
                req.full.unwrap_or(false),
                req.limit,
                req.offset,
            ),
            // Already handled above
            ArtifactsSubaction::List
            | ArtifactsSubaction::Search
            | ArtifactsSubaction::Clean
            | ArtifactsSubaction::Delete => unreachable!(),
        }
    }

    pub(super) async fn handle_help(
        &self,
        req: HelpRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        respond_with_mode(
            "help",
            "help",
            parse_response_mode(req.response_mode),
            "help-actions",
            serde_json::json!({
                "tool": "axon",
                "actions": {
                    "status": [],
                    "help": [],
                    "scrape": ["scrape"],
                    "research": ["research"],
                    "ask": ["ask"],
                    "screenshot": ["screenshot"],
                    "crawl": ["start", "status", "cancel", "list", "cleanup", "clear", "recover"],
                    "extract": ["start", "status", "cancel", "list", "cleanup", "clear", "recover"],
                    "embed": ["start", "status", "cancel", "list", "cleanup", "clear", "recover"],
                    "ingest": ["start", "status", "cancel", "list", "cleanup", "clear", "recover"],
                    "refresh": ["start", "status", "cancel", "list", "cleanup", "clear", "recover", "schedule"],
                    "query": ["query"],
                    "retrieve": ["retrieve"],
                    "search": ["search"],
                    "map": ["map"],
                    "doctor": ["doctor"],
                    "domains": ["domains"],
                    "sources": ["sources"],
                    "stats": ["stats"],
                    "artifacts": ["head", "grep", "wc", "read", "list", "delete", "clean", "search"]
                },
                "resources": [
                    MCP_TOOL_SCHEMA_URI
                ],
                "defaults": {
                    "response_mode": "path",
                    "artifact_dir": artifact_root()
                }
            }),
        )
        .await
    }

    pub(super) async fn handle_doctor(
        &self,
        req: DoctorRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let response_mode = parse_response_mode(req.response_mode);
        let result = system::doctor(self.cfg.as_ref())
            .await
            .map_err(|e| logged_internal_error("operation", e))?;
        respond_with_mode("doctor", "doctor", response_mode, "doctor", result.payload).await
    }

    pub(super) async fn handle_domains(
        &self,
        req: DomainsRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let pagination = to_pagination(req.limit.or(Some(25)), req.offset);
        let response_mode = parse_response_mode(req.response_mode);
        let result = system::domains(self.cfg.as_ref(), pagination)
            .await
            .map_err(|e| logged_internal_error("operation", e))?;
        let payload = serde_json::json!({
            "limit": result.limit,
            "offset": result.offset,
            "domains": result.domains.iter().map(|d| serde_json::json!({
                "domain": d.domain,
                "vectors": d.vectors,
            })).collect::<Vec<_>>(),
        });
        respond_with_mode("domains", "domains", response_mode, "domains", payload).await
    }

    pub(super) async fn handle_sources(
        &self,
        req: SourcesRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let pagination = to_pagination(req.limit.or(Some(25)), req.offset);
        let response_mode = parse_response_mode(req.response_mode);
        let result = system::sources(self.cfg.as_ref(), pagination)
            .await
            .map_err(|e| logged_internal_error("operation", e))?;
        let payload = serde_json::json!({
            "count": result.count,
            "limit": result.limit,
            "offset": result.offset,
            "urls": result.urls.iter().map(|(url, _chunks)| url).collect::<Vec<_>>(),
        });
        respond_with_mode("sources", "sources", response_mode, "sources", payload).await
    }

    pub(super) async fn handle_stats(
        &self,
        req: StatsRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let response_mode = parse_response_mode(req.response_mode);
        let result = system::stats(self.cfg.as_ref())
            .await
            .map_err(|e| logged_internal_error("operation", e))?;
        respond_with_mode("stats", "stats", response_mode, "stats", result.payload).await
    }
}
