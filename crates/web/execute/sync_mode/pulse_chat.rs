use std::env;
use std::hash::{DefaultHasher, Hasher};
use std::sync::Arc;

use serde_json::json;
use tokio::sync::{mpsc, oneshot};

use crate::crates::core::config::Config;
use crate::crates::services::acp::{self as acp_svc, AcpConnectionHandle};
use crate::crates::services::events::{LogLevel, ServiceEvent};
use crate::crates::services::types::AcpPromptTurnRequest;

use super::super::events::{CommandContext, acp_bridge_event_json, serialize_raw_output_event};
use super::super::mcp_config::read_axon_mcp_servers;
use super::acp_adapter::resolve_acp_adapter_command;
use super::service_calls::send_json_owned;
use super::types::{AcpConn, PulseChatAgent};

/// Send a single ACP `ServiceEvent` to the WS channel.
async fn dispatch_acp_event(
    event: ServiceEvent,
    tx: &mpsc::Sender<String>,
    ws_ctx: &CommandContext,
) {
    match event {
        ServiceEvent::Log { level, message } => {
            let truncated: String = message.chars().take(200).collect();
            match level {
                LogLevel::Info => log::info!("[pulse_chat] {truncated}"),
                LogLevel::Warn => log::warn!("[pulse_chat] {truncated}"),
                LogLevel::Error => log::error!("[pulse_chat] {truncated}"),
            }
            send_json_owned(
                tx.clone(),
                ws_ctx.clone(),
                json!({"type": "status", "level": level, "message": message}),
            )
            .await;
        }
        ServiceEvent::AcpBridge { event } => {
            let raw_json = acp_bridge_event_json(&event);
            let event_type = raw_json
                .strip_prefix(r#"{"type":""#)
                .and_then(|rest| rest.find('"').map(|e| &rest[..e]));
            if !matches!(
                event_type,
                Some("assistant_delta") | Some("thinking_content") | Some("user_delta")
            ) {
                log::info!(
                    "[pulse_chat] ACP event: type={}",
                    event_type.unwrap_or("unknown")
                );
            }
            if let Some(envelope) = serialize_raw_output_event(ws_ctx, &raw_json) {
                let _ = tx.send(envelope).await;
            }
        }
        ServiceEvent::EditorWrite { content, operation } => {
            log::info!(
                "[pulse_chat] editor_update: op={operation} content_len={}",
                content.len()
            );
            // `editor_update` is a standalone top-level WS message per the protocol
            // contract in docs/WS-PROTOCOL.md — it is NOT wrapped in command.output.json.
            // Wrapping it would mismatch the documented shape:
            //   { "type": "editor_update", "content": "...", "operation": "replace"|"append" }
            let standalone = json!({
                "type": "editor_update",
                "content": content,
                "operation": operation,
            })
            .to_string();
            let _ = tx.send(standalone).await;
        }
    }
}

/// Drive the ACP event loop for a persistent-connection turn.
///
/// Polls `result_rx` and `event_rx` concurrently; forwards each `ServiceEvent`
/// to the WS channel as it arrives. Returns after the result is received and
/// the event channel is drained.
async fn drive_turn_events(
    mut result_rx: oneshot::Receiver<Result<(), String>>,
    mut event_rx: mpsc::Receiver<ServiceEvent>,
    tx: mpsc::Sender<String>,
    ws_ctx: CommandContext,
) -> Result<(), String> {
    loop {
        tokio::select! {
            biased;
            maybe_event = event_rx.recv() => {
                match maybe_event {
                    Some(event) => dispatch_acp_event(event, &tx, &ws_ctx).await,
                    None => {
                        // Event channel closed — drain complete.
                        let run_result = result_rx
                            .try_recv()
                            .map_err(|_| "ACP turn result unavailable after channel close")?;
                        return run_result;
                    }
                }
            }
            result = &mut result_rx => {
                let run_result = result.map_err(|_| "ACP turn result channel dropped".to_string())?;
                // Drain any remaining events.
                while let Ok(event) = event_rx.try_recv() {
                    dispatch_acp_event(event, &tx, &ws_ctx).await;
                }
                return run_result;
            }
        }
    }
}

/// Get the existing `AcpConnectionHandle` for this WS connection, or create
/// one by spawning a fresh adapter process.
///
/// If the requested agent differs from the stored agent, the old adapter is
/// dropped (killing the process) and a new one is spawned. This prevents
/// Gemini sessions from reusing a Claude adapter (and vice-versa).
async fn get_or_create_acp_connection(
    acp_connection: &AcpConn,
    req: &AcpPromptTurnRequest,
    agent: PulseChatAgent,
    assistant_mode: bool,
    cfg: &Arc<Config>,
    permission_responders: &acp_svc::PermissionResponderMap,
) -> Result<Arc<AcpConnectionHandle>, String> {
    let mut guard = acp_connection.lock().await; // MutexGuard<Option<(String, Arc<AcpConnectionHandle>)>>
    // Include MCP server fingerprint in the connection key so edits to mcp.json
    // hot-reload by forcing a fresh ACP session setup with updated MCP servers.
    let mcp_fingerprint = fingerprint_mcp_servers(&req.mcp_servers);
    let agent_key = if assistant_mode {
        format!("{agent:?}:assistant:mcp={mcp_fingerprint}")
    } else {
        format!("{agent:?}:mcp={mcp_fingerprint}")
    };

    if let Some((stored_agent, existing)) = guard.as_ref() {
        if stored_agent == &agent_key {
            return Ok(Arc::clone(existing));
        }
        // Agent changed — drop old adapter so its process is killed.
        log::info!("[pulse_chat] agent changed {stored_agent} → {agent_key}, respawning adapter");
        *guard = None;
    }

    // First turn or agent change — spawn the persistent adapter.
    let adapter = resolve_acp_adapter_command(cfg, agent)?;
    // Log the basename only — avoid leaking full filesystem paths (e.g. /home/user/...).
    let adapter_name = std::path::Path::new(&adapter.program)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&adapter.program);
    log::info!(
        "[pulse_chat] spawning persistent adapter: program={adapter_name} args={:?}",
        adapter.args
    );
    let scaffold = acp_svc::AcpClientScaffold::new(adapter.clone());
    let initialize = scaffold.prepare_initialize().map_err(|e| e.to_string())?;
    let cwd = if assistant_mode {
        let base = env::var("AXON_DATA_DIR").unwrap_or_else(|_| {
            let home = env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
            format!("{home}/.local/share/axon")
        });
        let assistant_path = std::path::PathBuf::from(base)
            .join("axon")
            .join("assistant");
        tokio::fs::create_dir_all(&assistant_path)
            .await
            .map_err(|e| format!("failed to create assistant dir: {e}"))?;
        assistant_path
    } else {
        env::current_dir().map_err(|e| e.to_string())?
    };
    let session_setup = scaffold
        .prepare_session_setup(req, cwd)
        .map_err(|e| e.to_string())?;

    let handle = Arc::new(AcpConnectionHandle::spawn(
        adapter,
        initialize,
        session_setup,
        permission_responders.clone(),
    ));
    *guard = Some((agent_key, Arc::clone(&handle)));
    Ok(handle)
}

fn fingerprint_mcp_servers(
    mcp_servers: &[crate::crates::services::types::AcpMcpServerConfig],
) -> u64 {
    let raw = serde_json::to_string(mcp_servers).unwrap_or_default();
    let mut hasher = DefaultHasher::new();
    hasher.write(raw.as_bytes());
    hasher.finish()
}

/// Handle the `pulse_chat` service mode: send a prompt turn to the persistent
/// ACP adapter and stream events back over the WS channel.
#[allow(clippy::too_many_arguments)]
pub(super) async fn handle_pulse_chat(
    cfg: Arc<Config>,
    input: String,
    session_id: Option<String>,
    model: Option<String>,
    session_mode: Option<String>,
    enabled_mcp_servers: Option<Vec<String>>,
    blocked_mcp_tools: Vec<String>,
    agent: PulseChatAgent,
    assistant_mode: bool,
    tx: mpsc::Sender<String>,
    ws_ctx: CommandContext,
    permission_responders: acp_svc::PermissionResponderMap,
    acp_connection: AcpConn,
) -> Result<(), String> {
    log::info!(
        "[pulse_chat] starting: agent={:?} assistant_mode={} session_id={:?} model={:?} input_len={}",
        agent,
        assistant_mode,
        session_id,
        model,
        input.len()
    );

    let mut mcp_servers = read_axon_mcp_servers().await;
    if let Some(allowlist) = enabled_mcp_servers {
        let allowed: std::collections::HashSet<String> = allowlist.into_iter().collect();
        mcp_servers.retain(|server| match server {
            crate::crates::services::types::AcpMcpServerConfig::Stdio { name, .. } => {
                allowed.contains(name)
            }
            crate::crates::services::types::AcpMcpServerConfig::Http { name, .. } => {
                allowed.contains(name)
            }
        });
    }
    if !mcp_servers.is_empty() {
        log::info!(
            "[pulse_chat] passing {} MCP server(s) to ACP session",
            mcp_servers.len()
        );
    }

    // For new sessions (no session_id), inject the <axon:editor> syntax guide
    // as a preamble so agents know they can write directly to the editor.
    //
    // IMPORTANT: Do NOT include literal <axon:editor>…</axon:editor> example
    // blocks in this preamble. The parser in persistent_conn.rs scans the
    // agent's full response text for those tags, so any example blocks in the
    // system preamble that an agent might echo back would be misinterpreted as
    // real editor-write commands and incorrectly modify the editor state.
    let prompt_input = if session_id.is_none() {
        format!(
            "[System context — Axon editor integration]\n\
             You have access to the user's Axon editor. To write content \
             directly into the editor, output a block starting with the \
             XML opening tag `<axon:editor op=\"replace\">` (or op=\"append\" \
             to add to the end), followed by your markdown content, followed \
             by the closing tag `</axon:editor>`. Do NOT show this tag in a \
             code fence or explain it unless the user explicitly asks — \
             just use it. The user will see the editor update in real time. \
             Only use axon:editor tags when the user explicitly asks you to \
             write to or update the editor.\n\
             [User message]\n{input}"
        )
    } else {
        input
    };

    let req = AcpPromptTurnRequest {
        session_id,
        prompt: vec![prompt_input],
        model,
        session_mode,
        blocked_mcp_tools,
        mcp_servers,
    };

    let conn_handle = get_or_create_acp_connection(
        &acp_connection,
        &req,
        agent,
        assistant_mode,
        &cfg,
        &permission_responders,
    )
    .await?;

    let (event_tx, event_rx) = mpsc::channel::<ServiceEvent>(256);
    let (result_tx, result_rx) = oneshot::channel::<Result<(), String>>();

    conn_handle
        .run_turn(acp_svc::TurnRequest {
            req,
            service_tx: Some(event_tx),
            result_tx,
        })
        .await?;

    drive_turn_events(result_rx, event_rx, tx, ws_ctx).await
}

/// Handle the `pulse_chat_probe` service mode: probe an existing session and
/// stream events back over the WS channel.
pub(super) async fn handle_pulse_chat_probe(
    cfg: Arc<Config>,
    session_id: Option<String>,
    model: Option<String>,
    agent: PulseChatAgent,
    tx: mpsc::Sender<String>,
    ws_ctx: CommandContext,
    permission_responders: acp_svc::PermissionResponderMap,
) -> Result<(), String> {
    use crate::crates::services::types::AcpSessionProbeRequest;

    let (event_tx, event_rx) = mpsc::channel::<ServiceEvent>(256);
    let adapter = resolve_acp_adapter_command(&cfg, agent)?;
    let scaffold = acp_svc::AcpClientScaffold::new(adapter);
    let req = AcpSessionProbeRequest { session_id, model };
    let cwd = env::current_dir().map_err(|e| e.to_string())?;
    let task = tokio::spawn(async move {
        scaffold
            .start_session_probe(&req, cwd, Some(event_tx), permission_responders)
            .await
            .map_err(|e| e.to_string())
    });
    run_acp_event_loop(task, event_rx, tx, ws_ctx, "pulse_chat_probe")
        .await
        .map(|_| ())
}

/// Drive the ACP event loop for a non-persistent path (pulse_chat_probe).
///
/// Polls `task` and `event_rx` concurrently; forwards each `ServiceEvent` to
/// the WS channel as it arrives.
async fn run_acp_event_loop(
    mut task: tokio::task::JoinHandle<Result<(), String>>,
    mut event_rx: mpsc::Receiver<ServiceEvent>,
    tx: mpsc::Sender<String>,
    ws_ctx: CommandContext,
    task_name: &'static str,
) -> Result<Option<String>, String> {
    loop {
        tokio::select! {
            biased;
            maybe_event = event_rx.recv() => {
                match maybe_event {
                    Some(event) => dispatch_acp_event(event, &tx, &ws_ctx).await,
                    None => {
                        let run_result = (&mut task)
                            .await
                            .map_err(|e| format!("failed to join {task_name} task: {e}"))?;
                        run_result?;
                        break;
                    }
                }
            }
            join_result = &mut task => {
                let run_result = join_result
                    .map_err(|e| format!("failed to join {task_name} task: {e}"))?;
                run_result?;
                while let Ok(event) = event_rx.try_recv() {
                    dispatch_acp_event(event, &tx, &ws_ctx).await;
                }
                break;
            }
        }
    }
    Ok(None)
}
