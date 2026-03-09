use serde_json::json;
use tokio::sync::mpsc;

use crate::crates::services::acp as acp_svc;
use crate::crates::services::types::{
    DomainsResult, MapOptions, Pagination, RetrieveOptions, SearchOptions, SourcesResult,
};

use super::super::events::CommandContext;
use super::super::files;
use super::pulse_chat::{handle_pulse_chat, handle_pulse_chat_probe};
use super::service_calls::{
    call_ask, call_doctor, call_domains, call_map, call_query, call_research, call_retrieve,
    call_scrape, call_search, call_sources, call_stats, call_status, send_json_owned,
};
use super::types::{AcpConn, DirectParams, ServiceMode, SvcError};

fn format_sources_payload(result: SourcesResult) -> serde_json::Value {
    let urls_json: Vec<serde_json::Value> = result
        .urls
        .into_iter()
        .map(|(u, c)| json!({"url": u, "chunks": c}))
        .collect();
    json!({
        "count": result.count,
        "limit": result.limit,
        "offset": result.offset,
        "urls": urls_json,
    })
}

fn format_domains_payload(result: DomainsResult) -> serde_json::Value {
    let domains_json: Vec<serde_json::Value> = result
        .domains
        .into_iter()
        .map(|d| json!({"domain": d.domain, "vectors": d.vectors}))
        .collect();
    json!({
        "limit": result.limit,
        "offset": result.offset,
        "domains": domains_json,
    })
}

/// Inner dispatch — routes a pre-classified `ServiceMode` to the appropriate
/// service call and streams the result back over the WS channel.
///
/// Uses a `ServiceMode` enum rather than `match mode.as_str()` to prevent any
/// `&str` borrow from entering the async state machine, which would trigger an
/// HRTB `Send` diagnostic when the future is submitted to `tokio::task::spawn`.
pub(super) async fn dispatch_service(
    params: DirectParams,
    tx: mpsc::Sender<String>,
    ws_ctx: CommandContext,
    permission_responders: acp_svc::PermissionResponderMap,
    acp_connection: AcpConn,
) -> Result<(), SvcError> {
    let DirectParams {
        mode,
        input,
        cfg,
        limit,
        offset,
        max_points,
        agent,
        session_id,
        model,
    } = params;

    match mode {
        ServiceMode::Scrape => {
            let result = call_scrape(cfg, input).await?;
            send_json_owned(tx.clone(), ws_ctx.clone(), result.payload).await;
            files::send_scrape_file(tx, ws_ctx).await;
        }
        ServiceMode::Map => {
            let result = call_map(cfg, input, MapOptions { limit, offset }).await?;
            send_json_owned(tx, ws_ctx, result.payload).await;
        }
        ServiceMode::Query => {
            let result = call_query(cfg, input, Pagination { limit, offset }).await?;
            send_json_owned(tx, ws_ctx, json!({ "results": result.results })).await;
        }
        ServiceMode::Retrieve => {
            let result = call_retrieve(cfg, input, RetrieveOptions { max_points }).await?;
            send_json_owned(tx, ws_ctx, json!({ "chunks": result.chunks })).await;
        }
        ServiceMode::Ask => {
            let result = call_ask(cfg, input).await?;
            send_json_owned(tx, ws_ctx, result.payload).await;
        }
        ServiceMode::Search => {
            let opts = SearchOptions {
                limit,
                offset,
                time_range: None,
            };
            let result = call_search(cfg, input, opts).await?;
            send_json_owned(tx, ws_ctx, json!({ "results": result.results })).await;
        }
        ServiceMode::Research => {
            let opts = SearchOptions {
                limit,
                offset,
                time_range: None,
            };
            let result = call_research(cfg, input, opts).await?;
            send_json_owned(tx, ws_ctx, result.payload).await;
        }
        ServiceMode::Stats => {
            let result = call_stats(cfg).await?;
            send_json_owned(tx, ws_ctx, result.payload).await;
        }
        ServiceMode::Sources => {
            let result = call_sources(cfg, Pagination { limit, offset }).await?;
            send_json_owned(tx, ws_ctx, format_sources_payload(result)).await;
        }
        ServiceMode::Domains => {
            let result = call_domains(cfg, Pagination { limit, offset }).await?;
            send_json_owned(tx, ws_ctx, format_domains_payload(result)).await;
        }
        ServiceMode::Doctor => {
            let result = call_doctor(cfg).await?;
            send_json_owned(tx, ws_ctx, result.payload).await;
        }
        ServiceMode::Status => {
            let result = call_status(cfg).await?;
            send_json_owned(tx, ws_ctx, result.payload).await;
        }
        ServiceMode::PulseChat => {
            handle_pulse_chat(
                cfg,
                input,
                session_id,
                model,
                agent,
                tx,
                ws_ctx,
                permission_responders,
                acp_connection,
            )
            .await?;
        }
        ServiceMode::PulseChatProbe => {
            handle_pulse_chat_probe(
                cfg,
                session_id,
                model,
                agent,
                tx,
                ws_ctx,
                permission_responders,
            )
            .await?;
        }
    }

    Ok(())
}
