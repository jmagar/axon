use super::AxonMcpServer;
use super::common::{
    invalid_params, logged_internal_error, parse_job_id, parse_limit, parse_offset,
    respond_with_mode,
};
use crate::crates::core::http::validate_url;
use crate::crates::mcp::schema::{
    AxonToolResponse, RefreshRequest, RefreshSubaction, ResponseMode, StatusRequest,
};
use crate::crates::services::refresh::{self as refresh_service, RefreshScheduleCreate};
use rmcp::ErrorData;

impl AxonMcpServer {
    pub(super) async fn handle_status(
        &self,
        req: StatusRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let response_mode = req.response_mode;
        let result = crate::crates::services::system::full_status(self.cfg.as_ref())
            .await
            .map_err(|e| logged_internal_error("status", e))?;

        respond_with_mode(
            "status",
            "status",
            response_mode,
            "status",
            serde_json::json!({
                "text": result.text,
                "json": result.payload,
            }),
        )
        .await
    }

    pub(super) async fn handle_refresh(
        &self,
        req: RefreshRequest,
    ) -> Result<AxonToolResponse, ErrorData> {
        let response_mode = req.response_mode;
        match req.subaction {
            RefreshSubaction::Start => {
                let urls = req
                    .urls
                    .or_else(|| req.url.map(|u| vec![u]))
                    .ok_or_else(|| invalid_params("urls or url is required for refresh.start"))?;
                if urls.is_empty() {
                    return Err(invalid_params("urls cannot be empty"));
                }
                let result = refresh_service::refresh_start(self.cfg.as_ref(), &urls)
                    .await
                    .map_err(|e| logged_internal_error("refresh.start", e))?;
                Ok(AxonToolResponse::ok(
                    "refresh",
                    "start",
                    serde_json::json!({ "job_id": result.job_id }),
                ))
            }
            RefreshSubaction::Status => {
                let id = parse_job_id(req.job_id.as_ref())?;
                let job = refresh_service::refresh_status(self.cfg.as_ref(), id)
                    .await
                    .map_err(|e| logged_internal_error("refresh.status", e))?;
                respond_with_mode(
                    "refresh",
                    "status",
                    response_mode,
                    &format!("refresh-status-{id}"),
                    serde_json::json!({ "job": job.map(|j| j.payload) }),
                )
                .await
            }
            RefreshSubaction::Cancel => {
                let id = parse_job_id(req.job_id.as_ref())?;
                let canceled = refresh_service::refresh_cancel(self.cfg.as_ref(), id)
                    .await
                    .map_err(|e| logged_internal_error("refresh.cancel", e))?;
                Ok(AxonToolResponse::ok(
                    "refresh",
                    "cancel",
                    serde_json::json!({ "job_id": id.to_string(), "canceled": canceled }),
                ))
            }
            RefreshSubaction::List => {
                let limit = parse_limit(req.limit, 20);
                let offset = parse_offset(req.offset);
                let jobs = refresh_service::refresh_list(self.cfg.as_ref(), limit, offset as i64)
                    .await
                    .map_err(|e| logged_internal_error("refresh.list", e))?;
                respond_with_mode(
                    "refresh",
                    "list",
                    response_mode,
                    "refresh-list",
                    serde_json::json!({ "jobs": jobs.payload, "limit": limit, "offset": offset }),
                )
                .await
            }
            RefreshSubaction::Cleanup => {
                let deleted = refresh_service::refresh_cleanup(self.cfg.as_ref())
                    .await
                    .map_err(|e| logged_internal_error("refresh.cleanup", e))?;
                Ok(AxonToolResponse::ok(
                    "refresh",
                    "cleanup",
                    serde_json::json!({ "deleted": deleted }),
                ))
            }
            RefreshSubaction::Clear => {
                let deleted = refresh_service::refresh_clear(self.cfg.as_ref())
                    .await
                    .map_err(|e| logged_internal_error("refresh.clear", e))?;
                Ok(AxonToolResponse::ok(
                    "refresh",
                    "clear",
                    serde_json::json!({ "deleted": deleted }),
                ))
            }
            RefreshSubaction::Recover => {
                let recovered = refresh_service::refresh_recover(self.cfg.as_ref())
                    .await
                    .map_err(|e| logged_internal_error("refresh.recover", e))?;
                Ok(AxonToolResponse::ok(
                    "refresh",
                    "recover",
                    serde_json::json!({ "recovered": recovered }),
                ))
            }
            RefreshSubaction::Schedule => self.handle_refresh_schedule(req, response_mode).await,
        }
    }

    async fn handle_refresh_schedule(
        &self,
        req: RefreshRequest,
        response_mode: Option<ResponseMode>,
    ) -> Result<AxonToolResponse, ErrorData> {
        let sub = req.schedule_subaction.as_deref().unwrap_or("list");
        match sub {
            "list" => {
                let limit = parse_limit(req.limit, 20);
                let schedules = refresh_service::refresh_schedule_list(self.cfg.as_ref(), limit)
                    .await
                    .map_err(|e| logged_internal_error("refresh.schedule.list", e))?;
                respond_with_mode(
                    "refresh",
                    "schedule",
                    response_mode,
                    "refresh-schedules",
                    serde_json::json!({ "schedules": schedules }),
                )
                .await
            }
            "create" => {
                let name = req.schedule_name.ok_or_else(|| {
                    invalid_params("schedule_name is required for schedule create")
                })?;
                let urls = req.urls.or_else(|| req.url.map(|u| vec![u]));
                let urls = urls.unwrap_or_default();
                if urls.is_empty() {
                    return Err(invalid_params(
                        "refresh schedule create requires at least one URL",
                    ));
                }
                for url in &urls {
                    validate_url(url).map_err(|e| invalid_params(e.to_string()))?;
                }
                let schedule = refresh_service::refresh_schedule_create(
                    self.cfg.as_ref(),
                    &RefreshScheduleCreate {
                        name,
                        seed_url: None,
                        urls: Some(urls),
                        every_seconds: 3600,
                        enabled: true,
                        next_run_at: chrono::Utc::now(),
                        source_type: None,
                        target: None,
                    },
                )
                .await
                .map_err(|e| logged_internal_error("refresh.schedule.create", e))?;
                Ok(AxonToolResponse::ok(
                    "refresh",
                    "schedule",
                    serde_json::json!({ "created": schedule }),
                ))
            }
            "delete" => {
                let name = req.schedule_name.ok_or_else(|| {
                    invalid_params("schedule_name is required for schedule delete")
                })?;
                let deleted = refresh_service::refresh_schedule_delete(self.cfg.as_ref(), &name)
                    .await
                    .map_err(|e| logged_internal_error("refresh.schedule.delete", e))?;
                Ok(AxonToolResponse::ok(
                    "refresh",
                    "schedule",
                    serde_json::json!({ "name": name, "deleted": deleted }),
                ))
            }
            "enable" => {
                let name = req.schedule_name.ok_or_else(|| {
                    invalid_params("schedule_name is required for schedule enable")
                })?;
                let updated = refresh_service::refresh_schedule_enable(self.cfg.as_ref(), &name)
                    .await
                    .map_err(|e| logged_internal_error("refresh.schedule.enable", e))?;
                Ok(AxonToolResponse::ok(
                    "refresh",
                    "schedule",
                    serde_json::json!({ "name": name, "enabled": true, "updated": updated }),
                ))
            }
            "disable" => {
                let name = req.schedule_name.ok_or_else(|| {
                    invalid_params("schedule_name is required for schedule disable")
                })?;
                let updated = refresh_service::refresh_schedule_disable(self.cfg.as_ref(), &name)
                    .await
                    .map_err(|e| logged_internal_error("refresh.schedule.disable", e))?;
                Ok(AxonToolResponse::ok(
                    "refresh",
                    "schedule",
                    serde_json::json!({ "name": name, "enabled": false, "updated": updated }),
                ))
            }
            other => Err(invalid_params(format!(
                "unknown schedule_subaction: {other}; expected list, create, delete, enable, disable"
            ))),
        }
    }
}
