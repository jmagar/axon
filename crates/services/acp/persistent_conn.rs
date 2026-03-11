//! Persistent ACP adapter connection handle for WebSocket connections.
//!
//! One `AcpConnectionHandle` per WebSocket connection keeps a single adapter
//! process alive for the WS connection lifetime, dispatching prompt turns via
//! an `mpsc` channel.
//!
//! Adapts Zed's `AcpConnection` pattern for tokio: `ClientSideConnection` is
//! `!Send` (contains `Rc<RefCell<...>>`), so work is dispatched INTO a dedicated
//! `spawn_blocking` thread via channel. Zed stores `_io_task` in the connection
//! struct — here `_join: JoinHandle<()>` plays the same role.

use std::sync::Arc;

use agent_client_protocol::{
    Agent, ClientSideConnection, ContentBlock, PromptRequest, SessionId,
    SetSessionConfigOptionRequest, StopReason,
};
use tokio::sync::{mpsc, oneshot};

use crate::crates::services::events::{EditorOperation, LogLevel, ServiceEvent, emit};
use crate::crates::services::types::{
    AcpAdapterCommand, AcpBridgeEvent, AcpPromptTurnRequest, AcpTurnResultEvent,
};
use agent_client_protocol::InitializeRequest;

use super::bridge::{AcpRuntimeState, stop_reason_to_str};
use super::runtime::{EstablishedSession, establish_acp_session};
use super::{AcpSessionSetupRequest, PermissionResponderMap};

// ── Public types ──────────────────────────────────────────────────────────────

/// A single prompt turn dispatched to the persistent adapter background thread.
pub struct TurnRequest {
    pub req: AcpPromptTurnRequest,
    pub service_tx: Option<mpsc::Sender<ServiceEvent>>,
    pub result_tx: oneshot::Sender<Result<(), String>>,
}

enum AdapterMessage {
    RunTurn(TurnRequest),
}

/// Handle to a long-lived ACP adapter process for one WebSocket connection.
///
/// Created once on the first `pulse_chat` message; reused for all subsequent
/// turns. Dropping this handle closes the channel → background loop exits →
/// adapter process is killed via `kill_on_drop(true)`.
///
/// This matches Zed's `Drop for AcpConnection { child.kill() }` semantics,
/// adapted for tokio's `!Send` constraint via channel dispatch.
pub struct AcpConnectionHandle {
    tx: mpsc::Sender<AdapterMessage>,
    _join: tokio::task::JoinHandle<()>,
}

impl AcpConnectionHandle {
    /// Spawn the background adapter thread for this WS connection.
    ///
    /// Returns immediately — adapter setup happens on the first `run_turn()`
    /// call so setup progress events appear in the first turn's event stream.
    pub fn spawn(
        adapter: AcpAdapterCommand,
        initialize: InitializeRequest,
        session_setup: AcpSessionSetupRequest,
        permission_responders: PermissionResponderMap,
    ) -> Self {
        let (tx, rx) = mpsc::channel(16);
        let join = tokio::task::spawn_blocking(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("[acp_conn] failed to build tokio runtime");
            let local = tokio::task::LocalSet::new();
            local.block_on(
                &rt,
                adapter_loop(
                    adapter,
                    initialize,
                    session_setup,
                    permission_responders,
                    rx,
                ),
            );
        });
        Self { tx, _join: join }
    }

    /// Dispatch a prompt turn to the background adapter thread.
    ///
    /// Returns `Err` if the channel is closed (adapter exited unexpectedly).
    pub async fn run_turn(&self, turn: TurnRequest) -> Result<(), String> {
        self.tx
            .send(AdapterMessage::RunTurn(turn))
            .await
            .map_err(|_| "ACP adapter channel closed — adapter may have exited".to_string())
    }
}

// ── adapter_loop ──────────────────────────────────────────────────────────────

/// Long-lived adapter loop running on a dedicated `spawn_blocking` thread.
///
/// Waits for the first `RunTurn` message, uses its `service_tx` to forward
/// setup progress events, establishes the ACP session once, then processes
/// all subsequent turns on the same `ClientSideConnection`.
///
/// Exits when the `rx` channel closes (WS connection dropped) or when the
/// adapter process exits unexpectedly.
async fn adapter_loop(
    adapter: AcpAdapterCommand,
    initialize: InitializeRequest,
    session_setup: AcpSessionSetupRequest,
    permission_responders: PermissionResponderMap,
    mut rx: mpsc::Receiver<AdapterMessage>,
) {
    // Wait for the first turn — its service_tx forwards setup progress events.
    let first_turn = match rx.recv().await {
        Some(AdapterMessage::RunTurn(t)) => t,
        None => {
            log::info!("[acp_conn] channel closed before first turn");
            return;
        }
    };

    let setup_tx = first_turn.service_tx.clone();
    let model = first_turn.req.model.as_deref();

    let setup_result = establish_acp_session(
        adapter,
        initialize,
        session_setup,
        model,
        &setup_tx,
        &permission_responders,
    )
    .await;

    let EstablishedSession {
        mut conn,
        session_id,
        mut exit_rx,
        runtime_state,
    } = match setup_result {
        Ok(s) => {
            log::info!("[acp_conn] adapter ready (session_id={})", s.session_id.0);
            s
        }
        Err(e) => {
            log::error!("[acp_conn] adapter setup failed: {e}");
            let _ = first_turn
                .result_tx
                .send(Err(format!("ACP adapter setup failed: {e}")));
            return;
        }
    };

    // OnceLock: set once. No-op if already set by bridge during session setup.
    runtime_state
        .session_id
        .get_or_init(|| session_id.0.to_string());

    // Record the model that was applied at session establishment time.
    // Subsequent turns compare against this to detect mid-session model changes.
    *runtime_state.established_model.borrow_mut() = model.map(str::to_owned);

    // Run the first turn on the established connection.
    run_turn_on_conn(&mut conn, &session_id, &runtime_state, first_turn).await;

    // Process subsequent turns until the channel closes or the adapter exits.
    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Some(AdapterMessage::RunTurn(turn)) => {
                        run_turn_on_conn(&mut conn, &session_id, &runtime_state, turn).await;
                    }
                    None => {
                        log::info!("[acp_conn] channel closed (WS connection ended)");
                        break;
                    }
                }
            }
            exit_result = &mut exit_rx => {
                match exit_result {
                    Ok(msg) => log::error!("[acp_conn] adapter exited unexpectedly: {msg}"),
                    Err(_) => log::info!("[acp_conn] adapter exited cleanly"),
                }
                break;
            }
        }
    }

    log::info!("[acp_conn] adapter loop ended");
}

// ── run_turn_on_conn ──────────────────────────────────────────────────────────

/// Run one prompt turn on an already-established `ClientSideConnection`.
///
/// Resets `runtime_state.assistant_text` before each turn so the `TurnResult`
/// event contains only the current turn's response, not accumulated history.
async fn run_turn_on_conn(
    conn: &mut ClientSideConnection,
    session_id: &SessionId,
    runtime_state: &Arc<AcpRuntimeState>,
    turn: TurnRequest,
) {
    // Increment the turn counter BEFORE touching service_tx or sending the prompt.
    // `session_notification` compares against this value to reject late deltas from
    // a previous timed-out turn.
    let new_turn_id = runtime_state.current_turn_id.get().wrapping_add(1);
    runtime_state.current_turn_id.set(new_turn_id);

    // Clear previous turn's accumulated text before sending prompt.
    *runtime_state.assistant_text.borrow_mut() = String::new();

    let TurnRequest {
        req,
        service_tx,
        result_tx,
    } = turn;

    *runtime_state.blocked_mcp_tools.borrow_mut() = req
        .blocked_mcp_tools
        .iter()
        .map(|name| name.trim().to_lowercase())
        .filter(|name| !name.is_empty())
        .collect();

    if let Err(err) = apply_requested_model_before_prompt(
        conn,
        session_id,
        runtime_state,
        req.model.as_deref(),
        &service_tx,
    )
    .await
    {
        emit(
            &service_tx,
            ServiceEvent::Log {
                level: LogLevel::Warn,
                message: format!("ACP runtime: failed to apply model change mid-session: {err}"),
            },
        );
    }
    if let Err(err) = apply_requested_mode_before_prompt(
        conn,
        session_id,
        runtime_state,
        req.session_mode.as_deref(),
        &service_tx,
    )
    .await
    {
        emit(
            &service_tx,
            ServiceEvent::Log {
                level: LogLevel::Warn,
                message: format!("ACP runtime: failed to apply session_mode mid-session: {err}"),
            },
        );
    }

    // Route the bridge's session_notification / request_permission callbacks to
    // THIS turn's service_tx. Without this, the bridge uses the stale first-turn
    // channel (disconnected after turn 1), dropping all streaming deltas for turns 2+.
    *runtime_state.service_tx.borrow_mut() = service_tx.clone();

    let session_id_str = session_id.0.to_string();
    emit(
        &service_tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: format!(
                "ACP runtime: session ready (session_id={session_id_str}); sending prompt turn"
            ),
        },
    );

    let prompt_blocks: Vec<ContentBlock> = req.prompt.into_iter().map(ContentBlock::from).collect();

    let prompt_result = conn
        .prompt(PromptRequest::new(session_id.clone(), prompt_blocks))
        .await;

    // Clear service_tx after prompt completes so stale events (if any) drop cleanly.
    *runtime_state.service_tx.borrow_mut() = None;

    let result = match prompt_result {
        Err(e) => Err(e.to_string()),
        Ok(response) => finalize_successful_turn(
            response.stop_reason,
            runtime_state,
            &service_tx,
            &session_id_str,
        ),
    };

    let _ = result_tx.send(result);
}

fn finalize_successful_turn(
    stop_reason: StopReason,
    runtime_state: &Arc<AcpRuntimeState>,
    service_tx: &Option<mpsc::Sender<ServiceEvent>>,
    session_id_str: &str,
) -> Result<(), String> {
    let stop_reason_str = stop_reason_to_str(stop_reason);
    let log_level = match stop_reason {
        StopReason::EndTurn => LogLevel::Info,
        StopReason::MaxTokens | StopReason::Refusal | StopReason::Cancelled => LogLevel::Warn,
        _ => LogLevel::Info,
    };
    emit(
        service_tx,
        ServiceEvent::Log {
            level: log_level,
            message: format!(
                "ACP runtime: prompt turn completed \
                 (stop_reason={stop_reason_str}, session_id={session_id_str})"
            ),
        },
    );

    let session = runtime_state
        .session_id
        .get()
        .cloned()
        .unwrap_or_else(|| session_id_str.to_string());
    let text = runtime_state.assistant_text.borrow().clone();

    // Emit editor write events before TurnResult so the editor updates
    // arrive before the turn-complete signal resets the streaming state.
    for (content, op_str) in parse_editor_blocks(&text) {
        let operation = if op_str == "append" {
            EditorOperation::Append
        } else {
            EditorOperation::Replace
        };
        emit(service_tx, ServiceEvent::EditorWrite { content, operation });
    }

    emit(
        service_tx,
        ServiceEvent::AcpBridge {
            event: AcpBridgeEvent::TurnResult(AcpTurnResultEvent {
                session_id: session.clone(),
                stop_reason: stop_reason_str.to_string(),
                result: text,
            }),
        },
    );
    emit(
        service_tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: format!("ACP runtime: TurnResult emitted (session_id={session})"),
        },
    );
    Ok(())
}

async fn apply_requested_model_before_prompt(
    conn: &ClientSideConnection,
    session_id: &SessionId,
    runtime_state: &Arc<AcpRuntimeState>,
    requested_model: Option<&str>,
    service_tx: &Option<mpsc::Sender<ServiceEvent>>,
) -> Result<(), String> {
    let Some(requested) = requested_model.map(str::trim).filter(|m| !m.is_empty()) else {
        return Ok(());
    };

    let established = runtime_state.established_model.borrow().clone();
    if established.as_deref() == Some(requested) {
        return Ok(());
    }

    let known_options = runtime_state.config_options.borrow().clone();
    let (option_id, value_allowed) = resolve_model_option_for_request(&known_options, requested);
    if !value_allowed {
        emit(
            service_tx,
            ServiceEvent::Log {
                level: LogLevel::Warn,
                message: format!(
                    "ACP runtime: requested model '{requested}' is not in ACP config options; keeping current model"
                ),
            },
        );
        return Ok(());
    }

    emit(
        service_tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: format!(
                "ACP runtime: applying model change mid-session (option_id={option_id}, value={requested})"
            ),
        },
    );

    let set_resp = conn
        .set_session_config_option(SetSessionConfigOptionRequest::new(
            session_id.clone(),
            option_id.clone(),
            requested.to_string(),
        ))
        .await
        .map_err(|err| format!("set_session_config_option failed: {err}"))?;

    let updated = super::mapping::map_config_options(&set_resp.config_options);
    if !updated.is_empty() {
        *runtime_state.config_options.borrow_mut() = updated.clone();
        emit(
            service_tx,
            ServiceEvent::AcpBridge {
                event: AcpBridgeEvent::ConfigOptionsUpdate {
                    session_id: session_id.0.to_string(),
                    config_options: updated,
                },
            },
        );
    }

    *runtime_state.established_model.borrow_mut() = Some(requested.to_string());
    Ok(())
}

fn resolve_model_option_for_request(
    options: &[crate::crates::services::types::AcpConfigOption],
    requested_model: &str,
) -> (String, bool) {
    let model_option = options
        .iter()
        .find(|opt| opt.category.as_deref() == Some("model"));
    if let Some(opt) = model_option {
        let allowed = opt.options.iter().any(|o| o.value == requested_model);
        return (opt.id.clone(), allowed);
    }
    // Fallback for adapters that do not provide config options but still accept
    // the conventional `model` config ID.
    ("model".to_string(), true)
}

async fn apply_requested_mode_before_prompt(
    conn: &ClientSideConnection,
    session_id: &SessionId,
    runtime_state: &Arc<AcpRuntimeState>,
    requested_mode: Option<&str>,
    service_tx: &Option<mpsc::Sender<ServiceEvent>>,
) -> Result<(), String> {
    let Some(requested) = requested_mode.map(str::trim).filter(|m| !m.is_empty()) else {
        return Ok(());
    };

    let known_options = runtime_state.config_options.borrow().clone();
    let (option_id, value_allowed) = resolve_mode_option_for_request(&known_options, requested);
    if !value_allowed {
        emit(
            service_tx,
            ServiceEvent::Log {
                level: LogLevel::Warn,
                message: format!(
                    "ACP runtime: requested session_mode '{requested}' is not in ACP mode options; keeping current value"
                ),
            },
        );
        return Ok(());
    }

    let set_resp = conn
        .set_session_config_option(SetSessionConfigOptionRequest::new(
            session_id.clone(),
            option_id.clone(),
            requested.to_string(),
        ))
        .await
        .map_err(|err| format!("set_session_config_option(session_mode) failed: {err}"))?;

    let updated = super::mapping::map_config_options(&set_resp.config_options);
    if !updated.is_empty() {
        *runtime_state.config_options.borrow_mut() = updated.clone();
        emit(
            service_tx,
            ServiceEvent::AcpBridge {
                event: AcpBridgeEvent::ConfigOptionsUpdate {
                    session_id: session_id.0.to_string(),
                    config_options: updated,
                },
            },
        );
    }

    Ok(())
}

fn resolve_mode_option_for_request(
    options: &[crate::crates::services::types::AcpConfigOption],
    requested_mode: &str,
) -> (String, bool) {
    let mode_option = options
        .iter()
        .find(|opt| opt.category.as_deref() == Some("mode"));
    if let Some(opt) = mode_option {
        let allowed = opt.options.iter().any(|o| o.value == requested_mode);
        return (opt.id.clone(), allowed);
    }
    // Conservative fallback: no known mode option means do not guess/apply.
    ("".to_string(), false)
}

// ── Editor block parsing ───────────────────────────────────────────────────

/// Parse `<axon:editor>` XML blocks from agent response text.
///
/// Returns a list of `(content, operation)` pairs for each block found.
/// `operation` is either `"replace"` (default) or `"append"`.
///
/// # Format
///
/// ```xml
/// <axon:editor op="replace">
/// # Hello World
/// Content here
/// </axon:editor>
/// ```
pub(super) fn parse_editor_blocks(text: &str) -> Vec<(String, String)> {
    const OPEN: &str = "<axon:editor";
    const CLOSE: &str = "</axon:editor>";

    let mut blocks = Vec::new();
    let mut remaining = text;

    while let Some(tag_start) = remaining.find(OPEN) {
        remaining = &remaining[tag_start + OPEN.len()..];
        let Some(tag_end) = remaining.find('>') else {
            break;
        };
        let tag_attrs = &remaining[..tag_end];
        remaining = &remaining[tag_end + 1..];

        let operation = if tag_attrs.contains(r#"op="append""#) {
            "append".to_string()
        } else {
            "replace".to_string()
        };

        let Some(content_end) = remaining.find(CLOSE) else {
            break;
        };
        let content = remaining[..content_end].trim().to_string();
        remaining = &remaining[content_end + CLOSE.len()..];

        if !content.is_empty() {
            blocks.push((content, operation));
        }
    }

    blocks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_editor_blocks_replace() {
        let text = r#"Here is some text.
<axon:editor op="replace">
# Hello

World
</axon:editor>
Done."#;
        let blocks = parse_editor_blocks(text);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].0, "# Hello\n\nWorld");
        assert_eq!(blocks[0].1, "replace");
    }

    #[test]
    fn parse_editor_blocks_append() {
        let text = r#"<axon:editor op="append">## Section
Content</axon:editor>"#;
        let blocks = parse_editor_blocks(text);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].1, "append");
    }

    #[test]
    fn parse_editor_blocks_multiple() {
        let text = r#"<axon:editor op="replace">First</axon:editor>
<axon:editor op="append">Second</axon:editor>"#;
        let blocks = parse_editor_blocks(text);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].0, "First");
        assert_eq!(blocks[0].1, "replace");
        assert_eq!(blocks[1].0, "Second");
        assert_eq!(blocks[1].1, "append");
    }

    #[test]
    fn parse_editor_blocks_default_op_is_replace() {
        let text = r#"<axon:editor>content</axon:editor>"#;
        let blocks = parse_editor_blocks(text);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].1, "replace");
    }

    #[test]
    fn parse_editor_blocks_empty_content_skipped() {
        let text = r#"<axon:editor op="replace">   </axon:editor>"#;
        let blocks = parse_editor_blocks(text);
        assert!(blocks.is_empty());
    }

    #[test]
    fn parse_editor_blocks_no_blocks() {
        let blocks = parse_editor_blocks("just some text with no editor blocks");
        assert!(blocks.is_empty());
    }

    #[test]
    fn resolve_model_option_uses_model_category() {
        let options = vec![crate::crates::services::types::AcpConfigOption {
            id: "model_select".to_string(),
            name: "Model".to_string(),
            description: None,
            category: Some("model".to_string()),
            current_value: "sonnet".to_string(),
            options: vec![
                crate::crates::services::types::AcpConfigSelectValue {
                    value: "sonnet".to_string(),
                    name: "Sonnet".to_string(),
                    description: None,
                },
                crate::crates::services::types::AcpConfigSelectValue {
                    value: "opus".to_string(),
                    name: "Opus".to_string(),
                    description: None,
                },
            ],
        }];

        let (id, allowed) = resolve_model_option_for_request(&options, "opus");
        assert_eq!(id, "model_select");
        assert!(allowed);
    }

    #[test]
    fn resolve_model_option_rejects_unknown_value_when_options_known() {
        let options = vec![crate::crates::services::types::AcpConfigOption {
            id: "model".to_string(),
            name: "Model".to_string(),
            description: None,
            category: Some("model".to_string()),
            current_value: "sonnet".to_string(),
            options: vec![crate::crates::services::types::AcpConfigSelectValue {
                value: "sonnet".to_string(),
                name: "Sonnet".to_string(),
                description: None,
            }],
        }];

        let (_id, allowed) = resolve_model_option_for_request(&options, "not-valid");
        assert!(!allowed);
    }

    #[test]
    fn resolve_model_option_falls_back_to_default_model_id() {
        let options: Vec<crate::crates::services::types::AcpConfigOption> = Vec::new();
        let (id, allowed) = resolve_model_option_for_request(&options, "anything");
        assert_eq!(id, "model");
        assert!(allowed);
    }

    #[test]
    fn resolve_mode_option_uses_mode_category() {
        let options = vec![crate::crates::services::types::AcpConfigOption {
            id: "approval_mode".to_string(),
            name: "Approval Mode".to_string(),
            description: None,
            category: Some("mode".to_string()),
            current_value: "default".to_string(),
            options: vec![crate::crates::services::types::AcpConfigSelectValue {
                value: "default".to_string(),
                name: "Default".to_string(),
                description: None,
            }],
        }];

        let (id, allowed) = resolve_mode_option_for_request(&options, "default");
        assert_eq!(id, "approval_mode");
        assert!(allowed);
    }

    #[test]
    fn resolve_mode_option_returns_not_allowed_when_missing() {
        let options: Vec<crate::crates::services::types::AcpConfigOption> = Vec::new();
        let (id, allowed) = resolve_mode_option_for_request(&options, "default");
        assert_eq!(id, "");
        assert!(!allowed);
    }
}
