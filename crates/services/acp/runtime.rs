//! ACP runtime: `run_prompt_turn` and `run_session_probe` orchestration.
//!
//! Contains the core logic for establishing an ACP session (spawn adapter,
//! initialize, session setup) and running prompt turns or probes.
//!
//! Session-level sub-functions (spawn, connect, setup) live in `session.rs`.

use crate::crates::services::events::{LogLevel, ServiceEvent, emit};
use crate::crates::services::types::{
    AcpAdapterCommand, AcpBridgeEvent, AcpPromptTurnRequest, AcpSessionProbeRequest,
    AcpTurnResultEvent,
};
use agent_client_protocol::{
    Agent, ClientSideConnection, ContentBlock, InitializeRequest, PromptRequest, SessionId,
    StopReason,
};
use std::sync::Arc;
use tokio::sync::mpsc;

use super::adapters::{
    append_codex_model_override, append_gemini_model_override, is_codex_adapter, is_gemini_adapter,
};
use super::bridge::{AcpRuntimeState, stop_reason_to_str};
use super::session::{
    apply_config_and_model, initialize_connection, setup_session, spawn_adapter_with_io,
};
use super::{AcpSessionSetupRequest, PermissionResponderMap};

// ── AdapterGuard (FIX A-8/PERF-3) ──────────────────────────────────────────

/// RAII guard that kills the adapter subprocess on drop, covering all error
/// paths without explicit kill calls.
pub(super) struct AdapterGuard(pub(super) Option<tokio::process::Child>);

impl AdapterGuard {
    pub(super) fn new(child: tokio::process::Child) -> Self {
        Self(Some(child))
    }

    /// Take ownership of the child process (disarms the guard).
    pub(super) fn take(&mut self) -> Option<tokio::process::Child> {
        self.0.take()
    }
}

impl Drop for AdapterGuard {
    fn drop(&mut self) {
        if let Some(ref mut child) = self.0 {
            let _ = child.start_kill();
        }
    }
}

// ── EstablishedSession ───────────────────────────────────────────────────────

/// Result of establishing an ACP session: connection + session ID + exit watcher.
pub struct EstablishedSession {
    pub(super) conn: ClientSideConnection,
    pub(super) session_id: SessionId,
    pub(super) exit_rx: tokio::sync::oneshot::Receiver<String>,
    pub(super) runtime_state: Arc<AcpRuntimeState>,
}

// ── establish_acp_session ────────────────────────────────────────────────────

/// Orchestrate: spawn adapter → initialize → session setup → config/model apply.
///
/// FIX H-1: Single entry point for both prompt-turn and probe flows.
/// Sub-functions are in `session.rs` to respect the 500-line file limit.
async fn establish_acp_session(
    adapter: AcpAdapterCommand,
    initialize: InitializeRequest,
    session_setup: AcpSessionSetupRequest,
    model: Option<&str>,
    tx: &Option<mpsc::Sender<ServiceEvent>>,
    permission_responders: &PermissionResponderMap,
) -> Result<EstablishedSession, String> {
    let adapter = append_codex_model_override(adapter, model)
        .map_err(|err| format!("invalid model override: {err}"))?;
    let adapter = append_gemini_model_override(adapter, model)
        .map_err(|err| format!("invalid model override: {err}"))?;
    let codex_adapter = is_codex_adapter(&adapter);
    let gemini_adapter = is_gemini_adapter(&adapter);

    emit(
        tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: "ACP runtime: spawning adapter process".to_string(),
        },
    );

    let spawned = spawn_adapter_with_io(adapter, tx)?;
    let (conn, runtime_state, exit_rx) =
        initialize_connection(spawned, initialize, tx, permission_responders).await?;
    let (session_id, initial_config_options) = setup_session(&conn, session_setup, tx).await?;
    apply_config_and_model(
        &conn,
        &session_id,
        initial_config_options,
        model,
        codex_adapter,
        gemini_adapter,
        tx,
    )
    .await?;

    Ok(EstablishedSession {
        conn,
        session_id,
        exit_rx,
        runtime_state,
    })
}

// ── run_prompt_turn ──────────────────────────────────────────────────────────

pub(super) async fn run_prompt_turn(
    adapter: AcpAdapterCommand,
    initialize: InitializeRequest,
    session_setup: AcpSessionSetupRequest,
    req: AcpPromptTurnRequest,
    tx: Option<mpsc::Sender<ServiceEvent>>,
    permission_responders: PermissionResponderMap,
) -> Result<(), String> {
    let EstablishedSession {
        conn,
        session_id,
        exit_rx,
        runtime_state,
    } = establish_acp_session(
        adapter,
        initialize,
        session_setup,
        req.model.as_deref(),
        &tx,
        &permission_responders,
    )
    .await?;

    // OnceLock: set once. If bridge already set it during session setup, this is a no-op.
    runtime_state
        .session_id
        .get_or_init(|| session_id.0.to_string());

    let prompt_blocks: Vec<ContentBlock> = req.prompt.into_iter().map(ContentBlock::from).collect();
    emit(
        &tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: "ACP runtime: sending prompt turn".to_string(),
        },
    );

    // Race the prompt against process exit.
    tokio::select! {
        prompt_result = conn.prompt(PromptRequest::new(session_id.clone(), prompt_blocks)) => {
            let prompt_response = prompt_result.map_err(|err| err.to_string())?;
            let stop_reason = prompt_response.stop_reason;
            let stop_reason_str = stop_reason_to_str(stop_reason);
            let log_level = match stop_reason {
                StopReason::EndTurn => LogLevel::Info,
                StopReason::MaxTokens | StopReason::Refusal | StopReason::Cancelled => LogLevel::Warn,
                _ => LogLevel::Info,
            };
            emit(&tx, ServiceEvent::Log {
                level: log_level,
                message: format!(
                    "ACP runtime: prompt turn completed (stop_reason={stop_reason_str})"
                ),
            });

            // RefCell + OnceLock — no Mutex lock needed on current_thread runtime.
            let session = runtime_state
                .session_id
                .get()
                .cloned()
                .unwrap_or_else(|| session_id.0.to_string());
            let text = runtime_state.assistant_text.borrow().clone();

            emit(&tx, ServiceEvent::AcpBridge {
                event: AcpBridgeEvent::TurnResult(AcpTurnResultEvent {
                    session_id: session,
                    stop_reason: stop_reason_str.to_string(),
                    result: text,
                }),
            });
        }
        // FINDING-14: Sender is dropped on clean exit (code 0), so the receiver
        // sees Err(RecvError) — treat that as a clean shutdown, not a crash.
        // Only return an error when the adapter sent an explicit crash message.
        exit_msg = exit_rx => {
            if let Ok(msg) = exit_msg {
                return Err(format!("ACP adapter crashed mid-session: {msg}"));
            }
            // Err variant: channel was dropped → clean exit, nothing to do.
        }
    }

    // FIX PERF-9: Drain permission responders on exit. DashMap: no lock needed.
    permission_responders.clear();

    Ok(())
}

// ── run_session_probe ────────────────────────────────────────────────────────

pub(super) async fn run_session_probe(
    adapter: AcpAdapterCommand,
    initialize: InitializeRequest,
    session_setup: AcpSessionSetupRequest,
    req: AcpSessionProbeRequest,
    tx: Option<mpsc::Sender<ServiceEvent>>,
    permission_responders: PermissionResponderMap,
) -> Result<(), String> {
    let EstablishedSession { exit_rx, .. } = establish_acp_session(
        adapter,
        initialize,
        session_setup,
        req.model.as_deref(),
        &tx,
        &permission_responders,
    )
    .await?;

    // Probe is fire-and-forget: session is set up, we just confirm it worked.
    drop(exit_rx);

    // FIX PERF-9: Drain permission responders on exit. DashMap: no lock needed.
    permission_responders.clear();

    Ok(())
}
