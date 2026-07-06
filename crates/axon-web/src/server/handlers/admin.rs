use axon_core::config::Config;
use axon_services as services;
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::post,
};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

use super::super::error::HttpError;

type WebState = (super::super::state::AppState, Arc<Config>);

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub(crate) struct WatchListQuery {
    limit: Option<i64>,
}

pub(crate) type WatchCreateRequest = services::watch::WatchDefCreateRequest;

const MAX_TASK_PAYLOAD_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
pub(crate) struct MigrateRequest {
    pub from: String,
    pub to: String,
}

// migrate_router is unused — migrate is wired directly in routing.rs
#[allow(dead_code)]
pub(crate) fn migrate_router<S: Clone + Send + Sync + 'static>() -> Router<S>
where
    (super::super::state::AppState, Arc<Config>): axum::extract::FromRef<S>,
{
    Router::new().route("/v1/migrate", post(migrate))
}

pub(crate) async fn migrate(
    State((_state, cfg)): State<WebState>,
    Json(req): Json<MigrateRequest>,
) -> Result<Json<serde_json::Value>, HttpError> {
    if req.from.trim().is_empty() {
        return Err(HttpError::bad_request("from is required"));
    }
    if req.to.trim().is_empty() {
        return Err(HttpError::bad_request("to is required"));
    }
    if req.from == req.to {
        return Err(HttpError::bad_request("from and to must be different"));
    }
    // Validate before Qdrant URL interpolation — migrate builds URLs like
    // {qdrant_url}/collections/{from}/points/scroll without percent-encoding.
    axon_core::config::validate_collection_name(&req.from)
        .map_err(|e| HttpError::bad_request(format!("from: {e}").as_str()))?;
    axon_core::config::validate_collection_name(&req.to)
        .map_err(|e| HttpError::bad_request(format!("to: {e}").as_str()))?;
    let mut req_cfg = (*cfg).clone();
    req_cfg.positional = vec![req.from.clone(), req.to.clone()];
    let result = services::migrate::migrate(&req_cfg)
        .await
        .map_err(HttpError::from_box)?;
    Ok(Json(serde_json::json!({
        "from": result.from,
        "to": result.to,
        "points_migrated": result.points_migrated,
        "pages_processed": result.pages_processed,
    })))
}

#[utoipa::path(
    get,
    path = "/v1/watch",
    params(WatchListQuery),
    responses(
        (status = 200, description = "Watch definitions", body = serde_json::Value),
        (status = 502, description = "Watch storage unavailable", body = crate::server::error::ErrorBody)
    ),
    tag = "watch"
)]
pub(crate) async fn list_watch(
    State((_state, cfg)): State<WebState>,
    Query(query): Query<WatchListQuery>,
) -> Result<Json<serde_json::Value>, HttpError> {
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let watches = services::watch::list_watch_defs(&cfg, limit)
        .await
        .map_err(HttpError::from_box)?;
    Ok(Json(json!({ "watches": watches, "limit": limit })))
}

#[utoipa::path(
    post,
    path = "/v1/watch",
    request_body = WatchCreateRequest,
    responses(
        (status = 200, description = "Created watch definition", body = serde_json::Value),
        (status = 400, description = "Invalid watch request", body = crate::server::error::ErrorBody),
        (status = 502, description = "Watch storage unavailable", body = crate::server::error::ErrorBody)
    ),
    tag = "watch"
)]
pub(crate) async fn create_watch(
    State((_state, cfg)): State<WebState>,
    Json(req): Json<WatchCreateRequest>,
) -> Result<Json<services::watch::WatchDef>, HttpError> {
    if req
        .task_payload
        .as_str()
        .map_or_else(|| req.task_payload.to_string(), |s| s.to_string())
        .len()
        > MAX_TASK_PAYLOAD_BYTES
    {
        return Err(HttpError::bad_request("task_payload exceeds 64 KiB limit"));
    }
    let input = req
        .into_create()
        .map_err(|msg| HttpError::bad_request(&msg))?;
    services::watch::create_watch_def(&cfg, &input)
        .await
        .map(Json)
        .map_err(HttpError::from_box)
}
