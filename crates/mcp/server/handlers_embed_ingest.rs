use super::AxonMcpServer;
use super::common::{
    internal_error, invalid_params, parse_job_id, parse_limit, parse_offset, parse_response_mode,
    respond_with_mode,
};
use crate::crates::jobs::embed::{
    cancel_embed_job, cleanup_embed_jobs, clear_embed_jobs, get_embed_job, list_embed_jobs,
    recover_stale_embed_jobs, start_embed_job,
};
use crate::crates::jobs::ingest::{
    IngestSource, cancel_ingest_job, cleanup_ingest_jobs, clear_ingest_jobs, get_ingest_job,
    list_ingest_jobs, recover_stale_ingest_jobs, start_ingest_job,
};
use crate::crates::mcp::schema::{
    AxonToolResponse, EmbedRequest, EmbedSubaction, IngestRequest, IngestSourceType,
    IngestSubaction, SessionsIngestOptions,
};
use rmcp::ErrorData;

fn parse_ingest_source(req: &mut IngestRequest) -> Result<IngestSource, ErrorData> {
    let source_type = req
        .source_type
        .take()
        .ok_or_else(|| invalid_params("source_type is required for ingest.start"))?;
    match source_type {
        IngestSourceType::Github => {
            let repo = req
                .target
                .take()
                .ok_or_else(|| invalid_params("target repo is required for github ingest"))?;
            Ok(IngestSource::Github {
                repo,
                include_source: req.include_source.unwrap_or(false),
            })
        }
        IngestSourceType::Reddit => {
            let target = req
                .target
                .take()
                .ok_or_else(|| invalid_params("target is required for reddit ingest"))?;
            Ok(IngestSource::Reddit { target })
        }
        IngestSourceType::Youtube => {
            let target = req
                .target
                .take()
                .ok_or_else(|| invalid_params("target is required for youtube ingest"))?;
            Ok(IngestSource::Youtube { target })
        }
        IngestSourceType::Sessions => {
            let sessions = req.sessions.take().unwrap_or(SessionsIngestOptions {
                claude: None,
                codex: None,
                gemini: None,
                project: None,
            });
            Ok(IngestSource::Sessions {
                sessions_claude: sessions.claude.unwrap_or(false),
                sessions_codex: sessions.codex.unwrap_or(false),
                sessions_gemini: sessions.gemini.unwrap_or(false),
                sessions_project: sessions.project,
            })
        }
    }
}

impl AxonMcpServer {
    pub(super) async fn handle_embed(
        &self,
        req: EmbedRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let response_mode = parse_response_mode(req.response_mode);
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
                respond_with_mode(
                    "embed",
                    "status",
                    response_mode,
                    &format!("embed-status-{id}"),
                    serde_json::json!({ "job": job }),
                )
                .await
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
                let jobs = list_embed_jobs(self.cfg.as_ref(), limit, offset as i64)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                respond_with_mode(
                    "embed",
                    "list",
                    response_mode,
                    "embed-list",
                    serde_json::json!({ "jobs": jobs, "limit": limit, "offset": offset }),
                )
                .await
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

    pub(super) async fn handle_ingest(
        &self,
        mut req: IngestRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let response_mode = parse_response_mode(req.response_mode);
        match req.subaction {
            IngestSubaction::Start => {
                let source = parse_ingest_source(&mut req)?;
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
                respond_with_mode(
                    "ingest",
                    "status",
                    response_mode,
                    &format!("ingest-status-{id}"),
                    serde_json::json!({ "job": job }),
                )
                .await
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
                let jobs = list_ingest_jobs(self.cfg.as_ref(), limit, offset as i64)
                    .await
                    .map_err(|e| internal_error(e.to_string()))?;
                respond_with_mode(
                    "ingest",
                    "list",
                    response_mode,
                    "ingest-list",
                    serde_json::json!({ "jobs": jobs, "limit": limit, "offset": offset }),
                )
                .await
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
}
