//! WebSocket connection state and message dispatch.
//!
//! Extracted from `web.rs` to stay under the 500-line module limit.
//! Contains `WsConnState`, the WS read/forward loops, and message routing
//! (execute, cancel, permission_response, read_file, acp_resume).

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::{Mutex, mpsc};

use crate::crates::core::config::Config;
use crate::crates::services::acp::{PermissionResponderMap, SESSION_CACHE};

use super::AppState;
use super::execute;

/// Incoming WS message from the browser.
#[derive(Deserialize)]
struct WsClientMsg {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(default)]
    mode: String,
    #[serde(default)]
    input: String,
    #[serde(default)]
    flags: serde_json::Value,
    #[serde(default)]
    id: String,
    #[serde(default)]
    path: String,
    /// Permission response: the tool_call_id being responded to.
    #[serde(default)]
    tool_call_id: String,
    /// Permission response: the chosen option_id.
    #[serde(default)]
    option_id: String,
    /// Session ID context for permission_response validation (SEC-7).
    #[serde(default)]
    session_id: String,
}

/// Per-connection state shared across the read loop and spawned tasks.
struct WsConnState {
    exec_tx: mpsc::Sender<String>,
    tracking_tx: mpsc::Sender<String>,
    crawl_job_id: Arc<Mutex<Option<String>>>,
    crawl_base_dir: Arc<Mutex<Option<PathBuf>>>,
    permission_responders: PermissionResponderMap,
    conn_cfg: Arc<Config>,
}

/// Create a fresh `PermissionResponderMap` for a new WS connection.
fn init_permission_responders() -> PermissionResponderMap {
    Arc::new(dashmap::DashMap::new())
}

/// Main WS connection handler — runs the read/forward loops until disconnect.
pub(super) async fn handle_ws(socket: WebSocket, state: Arc<AppState>) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    let (exec_tx, mut exec_rx) = mpsc::channel::<String>(256);
    let (tracking_tx, mut tracking_rx) = mpsc::channel::<String>(256);

    let crawl_base_dir: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
    let crawl_job_id: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let permission_responders = init_permission_responders();

    let job_dirs = state.job_dirs.clone();
    let mut stats_rx = state.stats_tx.subscribe();

    // Forward task: sends exec output + stats to the WS client,
    // and tracks crawl_files messages to capture base_dir + register job_dirs
    let base_dir_tracker = crawl_base_dir.clone();
    let job_dirs_tracker = job_dirs.clone();
    let forward = tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(msg) = exec_rx.recv() => {
                    if msg.contains("\"crawl_files\"")
                        && let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&msg) {
                            if let Some(dir) = parsed.get("output_dir").and_then(|v| v.as_str()) {
                                *base_dir_tracker.lock().await = Some(PathBuf::from(dir));
                            }
                            if let (Some(job_id), Some(dir)) = (
                                parsed.get("job_id").and_then(|v| v.as_str()),
                                parsed.get("output_dir").and_then(|v| v.as_str()),
                            ) {
                                job_dirs_tracker.insert(job_id.to_string(), PathBuf::from(dir));
                            }
                        }
                    if ws_tx.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                Some(msg) = tracking_rx.recv() => {
                    if ws_tx.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                Ok(stats_msg) = stats_rx.recv() => {
                    if ws_tx.send(Message::Text(stats_msg.into())).await.is_err() {
                        break;
                    }
                }
                else => break,
            }
        }
    });

    let conn = WsConnState {
        exec_tx,
        tracking_tx,
        crawl_job_id,
        crawl_base_dir,
        permission_responders,
        conn_cfg: state.cfg.clone(),
    };

    // Read loop: receives commands from the browser
    while let Some(Ok(msg)) = ws_rx.next().await {
        if let Message::Text(text) = msg {
            let Ok(client_msg) = serde_json::from_str::<WsClientMsg>(&text) else {
                let _ = conn
                    .exec_tx
                    .send(r#"{"type":"error","message":"invalid JSON"}"#.to_string())
                    .await;
                continue;
            };
            handle_ws_message(&conn, client_msg).await;
        }
    }

    forward.abort();
}

/// Dispatch a single parsed WS client message to the appropriate handler.
async fn handle_ws_message(conn: &WsConnState, client_msg: WsClientMsg) {
    match client_msg.msg_type.as_str() {
        "execute" => {
            let tx = conn.exec_tx.clone();
            let job_id = conn.crawl_job_id.clone();
            let cmd_cfg = conn.conn_cfg.clone();
            let perm_map = conn.permission_responders.clone();
            let exec_mode = client_msg.mode;
            let exec_input = client_msg.input;
            let exec_flags = client_msg.flags;
            tokio::spawn(async move {
                execute::handle_command(
                    exec_mode, exec_input, exec_flags, tx, job_id, cmd_cfg, perm_map,
                )
                .await;
            });
        }
        "acp_resume" => {
            handle_acp_resume(conn, &client_msg.session_id).await;
        }
        "cancel" => {
            let tx = conn.exec_tx.clone();
            let job_id_arc = conn.crawl_job_id.clone();
            let cancel_mode = client_msg.mode;
            let cancel_cfg = conn.conn_cfg.clone();
            let cancel_id = client_msg.id;
            tokio::spawn(async move {
                let stored = job_id_arc.lock().await.clone();
                let id = stored.or(if cancel_id.is_empty() {
                    None
                } else {
                    Some(cancel_id)
                });
                if let Some(id) = id {
                    execute::handle_cancel(&cancel_mode, &id, tx, cancel_cfg).await;
                }
            });
        }
        "permission_response" => {
            route_permission_response(
                &conn.permission_responders,
                client_msg.tool_call_id,
                client_msg.option_id,
                client_msg.session_id,
            );
        }
        "read_file" => {
            if !client_msg.path.is_empty() {
                let tx = conn.tracking_tx.clone();
                let path = client_msg.path;
                let base = conn.crawl_base_dir.clone();
                tokio::spawn(async move {
                    let guard = base.lock().await;
                    if let Some(base_dir) = guard.as_ref() {
                        execute::handle_read_file(&path, base_dir, tx).await;
                    } else {
                        let _ = tx
                            .send(
                                r#"{"type":"error","message":"no crawl output available"}"#
                                    .to_string(),
                            )
                            .await;
                    }
                });
            }
        }
        _ => {}
    }
}

/// Handle `acp_resume` — reconnect to a cached ACP session and replay buffered events.
async fn handle_acp_resume(conn: &WsConnState, session_id: &str) {
    let tx = &conn.exec_tx;
    if session_id.is_empty() {
        let _ = tx
            .send(
                r#"{"type":"acp_resume_result","success":false,"reason":"missing session_id"}"#
                    .to_string(),
            )
            .await;
        return;
    }
    if let Some(cached) = SESSION_CACHE.get_by_session_id(session_id).await {
        let buffered = cached.drain_replay_buffer().await;
        let replayed = buffered.len();
        for msg in buffered {
            let _ = tx.send(msg).await;
        }
        let _ = tx
            .send(format!(
                r#"{{"type":"acp_resume_result","success":true,"session_id":"{session_id}","replayed":{replayed}}}"#
            ))
            .await;
        log::info!(
            "[ws] acp_resume: session_id={session_id}, replayed {replayed} buffered event(s)"
        );
    } else {
        let _ = tx
            .send(format!(
                r#"{{"type":"acp_resume_result","success":false,"reason":"session not found","session_id":"{session_id}"}}"#
            ))
            .await;
        log::info!("[ws] acp_resume: session_id={session_id} not found in cache");
    }
}

/// Route a `permission_response` message to the waiting ACP session.
///
/// Looks up `(session_id, tool_call_id)` in the per-WS permission responders
/// first, then falls back to the global session cache for resumed sessions.
fn route_permission_response(
    permission_responders: &PermissionResponderMap,
    tool_call_id: String,
    option_id: String,
    session_id: String,
) {
    if tool_call_id.is_empty() || option_id.is_empty() {
        log::warn!("permission_response with empty tool_call_id or option_id — ignoring");
        return;
    }
    log::debug!("permission_response: session_id={session_id} tool_call_id={tool_call_id}");

    // Try the per-WS permission responders first.
    if let Some((_, sender)) =
        permission_responders.remove(&(session_id.clone(), tool_call_id.clone()))
    {
        let _ = sender.send(option_id);
        return;
    }

    // Fallback: check the global session cache for resumed sessions whose
    // permission responders live in the CachedSession, not this WS conn.
    if let Some(cached) = SESSION_CACHE.get_by_session_id_sync(&session_id)
        && let Some((_, sender)) = cached
            .permission_responders
            .remove(&(session_id.clone(), tool_call_id.clone()))
    {
        let _ = sender.send(option_id);
        return;
    }

    log::warn!(
        "permission_response for unknown key: session_id={session_id} \
         tool_call_id={tool_call_id} (already responded or wrong session)"
    );
}
