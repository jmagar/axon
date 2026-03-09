//! ACP bridge client: implements the `agent_client_protocol::Client` trait,
//! forwarding session notifications and permission requests through the
//! service event channel.

use crate::crates::services::events::{LogLevel, ServiceEvent, emit};
use crate::crates::services::types::AcpSessionUpdateKind;
use agent_client_protocol::{
    Client, PermissionOptionKind, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionNotification, StopReason,
};
use std::sync::Arc;
use tokio::sync::mpsc;

use super::PermissionResponderMap;
use super::mapping::{
    extract_text_delta, map_permission_request_event, map_session_notification_event,
    map_session_update_kind,
};

// ── Runtime state ───────────────────────────────────────────────────────────

/// FINDING-2: Use RefCell for single-threaded hot path — avoids Mutex lock on
/// every streaming token delta. Safe because the ACP runtime runs on a
/// `current_thread` tokio runtime inside `LocalSet` (all tasks on one thread).
#[derive(Debug, Default)]
pub struct AcpRuntimeState {
    pub(super) session_id: std::sync::OnceLock<String>,
    pub(super) assistant_text: std::cell::RefCell<String>,
}

// ── Auto-approve helpers ────────────────────────────────────────────────────

/// Resolve whether ACP permissions should be auto-approved.
///
/// Returns `true` (auto-approve) unless `AXON_ACP_AUTO_APPROVE` is explicitly
/// set to `"false"`. Default is `true` for containerized deployments.
pub(super) fn resolve_acp_auto_approve() -> bool {
    std::env::var("AXON_ACP_AUTO_APPROVE")
        .map(|v| v != "false")
        .unwrap_or(true)
}

/// Select the best auto-approve outcome from the permission request options.
pub(super) fn auto_approve_outcome(
    args: &RequestPermissionRequest,
    tx: &Option<mpsc::Sender<ServiceEvent>>,
    tool_call_id: &str,
) -> RequestPermissionOutcome {
    let outcome = args
        .options
        .iter()
        .find(|opt| matches!(opt.kind, PermissionOptionKind::AllowAlways))
        .or_else(|| {
            args.options
                .iter()
                .find(|opt| matches!(opt.kind, PermissionOptionKind::AllowOnce))
        })
        .map(|opt| {
            RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                opt.option_id.clone(),
            ))
        })
        .unwrap_or(RequestPermissionOutcome::Cancelled);

    if matches!(outcome, RequestPermissionOutcome::Selected(_)) {
        emit(
            tx,
            ServiceEvent::Log {
                level: LogLevel::Info,
                message: format!("ACP permission auto-approved for tool_call={tool_call_id}"),
            },
        );
    }

    outcome
}

// ── FIX L-1: return &'static str instead of String ──────────────────────────

pub(super) fn stop_reason_to_str(reason: StopReason) -> &'static str {
    match reason {
        StopReason::EndTurn => "end_turn",
        StopReason::MaxTokens => "max_tokens",
        StopReason::MaxTurnRequests => "max_turn_requests",
        StopReason::Refusal => "refusal",
        StopReason::Cancelled => "cancelled",
        _ => "unknown",
    }
}

// ── Interactive permission helper ───────────────────────────────────────────

/// Wait for the frontend to respond to a permission request.
///
/// Inserts the oneshot sender into `permission_responders`, logs that we are
/// waiting, then races the channel receive against a 60-second timeout.
/// On timeout the map entry is cleaned up before returning `Cancelled`.
pub(super) async fn handle_interactive_permission(
    args: &RequestPermissionRequest,
    tx: &Option<mpsc::Sender<ServiceEvent>>,
    permission_responders: &PermissionResponderMap,
    session_id: &str,
    tool_call_id: &str,
) -> RequestPermissionOutcome {
    let (resp_tx, resp_rx) = tokio::sync::oneshot::channel::<String>();
    // Key is (session_id, tool_call_id) — SEC-7: prevents cross-session routing.
    permission_responders.insert((session_id.to_string(), tool_call_id.to_string()), resp_tx);

    emit(
        tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: format!(
                "ACP permission awaiting frontend response for tool_call={tool_call_id}"
            ),
        },
    );

    // Wait up to 60s for a response from the frontend.
    match tokio::time::timeout(std::time::Duration::from_secs(60), resp_rx).await {
        Ok(Ok(option_id)) => {
            // Validate that the chosen option_id exists in the request.
            let matched = args
                .options
                .iter()
                .find(|opt| *opt.option_id.0 == *option_id);
            match matched {
                Some(opt) => {
                    emit(
                        tx,
                        ServiceEvent::Log {
                            level: LogLevel::Info,
                            message: format!(
                                "ACP permission resolved by frontend for tool_call={tool_call_id}: {option_id}"
                            ),
                        },
                    );
                    RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                        opt.option_id.clone(),
                    ))
                }
                None => {
                    emit(
                        tx,
                        ServiceEvent::Log {
                            level: LogLevel::Warn,
                            message: format!(
                                "ACP permission: frontend sent unknown option_id={option_id} for tool_call={tool_call_id}, cancelling"
                            ),
                        },
                    );
                    RequestPermissionOutcome::Cancelled
                }
            }
        }
        // Disconnect path: the frontend dropped the responder channel.
        Ok(Err(_)) => {
            emit(
                tx,
                ServiceEvent::Log {
                    level: LogLevel::Warn,
                    message: format!(
                        "ACP permission: responder dropped for tool_call={tool_call_id}"
                    ),
                },
            );
            RequestPermissionOutcome::Cancelled
        }
        // Timeout path: no frontend response within 60s.
        Err(_) => {
            log::warn!("ACP permission request timed out after 60s");
            emit(
                tx,
                ServiceEvent::Log {
                    level: LogLevel::Warn,
                    message: format!(
                        "ACP permission: timeout waiting for frontend response for tool_call={tool_call_id}"
                    ),
                },
            );
            // Clean up the map entry. DashMap: no lock needed.
            permission_responders.remove(&(session_id.to_string(), tool_call_id.to_string()));
            RequestPermissionOutcome::Cancelled
        }
    }
}

// ── Bridge client ───────────────────────────────────────────────────────────

/// FINDING-2: `Arc<AcpRuntimeState>` — no Mutex wrapper needed because
/// `AcpRuntimeState` uses `OnceLock` + `RefCell` internally. Cloning
/// `AcpBridgeClient` shares the same state across spawned tasks safely
/// within the single-threaded current_thread + LocalSet runtime.
#[derive(Clone)]
pub struct AcpBridgeClient {
    pub(super) tx: Option<mpsc::Sender<ServiceEvent>>,
    pub(super) runtime_state: Arc<AcpRuntimeState>,
    /// When true, permissions are auto-approved without waiting for frontend.
    pub(super) auto_approve: bool,
    /// Pending permission response channels keyed by tool_call_id.
    pub(super) permission_responders: PermissionResponderMap,
}

#[async_trait::async_trait(?Send)]
impl Client for AcpBridgeClient {
    async fn request_permission(
        &self,
        args: RequestPermissionRequest,
    ) -> agent_client_protocol::Result<RequestPermissionResponse> {
        emit(&self.tx, map_permission_request_event(&args));

        let tool_call_id = args.tool_call.tool_call_id.0.to_string();

        if self.auto_approve {
            return Ok(RequestPermissionResponse::new(auto_approve_outcome(
                &args,
                &self.tx,
                &tool_call_id,
            )));
        }

        // Interactive mode: delegate to helper which manages oneshot registration,
        // timeout, and map cleanup.
        let session_id = self
            .runtime_state
            .session_id
            .get()
            .map(|s| s.as_str())
            .unwrap_or("");
        let outcome = handle_interactive_permission(
            &args,
            &self.tx,
            &self.permission_responders,
            session_id,
            &tool_call_id,
        )
        .await;

        Ok(RequestPermissionResponse::new(outcome))
    }

    async fn session_notification(
        &self,
        args: SessionNotification,
    ) -> agent_client_protocol::Result<()> {
        {
            // FINDING-2: RefCell — no Mutex lock on the hot streaming token path.
            // Safe: current_thread runtime + LocalSet ensures single-threaded access.
            let state = &*self.runtime_state;
            if let Some(text_delta) = extract_text_delta(&args.update)
                && matches!(
                    map_session_update_kind(&args.update),
                    AcpSessionUpdateKind::AssistantDelta
                )
            {
                // Cap at 1 MiB to prevent unbounded accumulation from long sessions.
                const MAX_ASSISTANT_TEXT_BYTES: usize = 1024 * 1024;
                let mut text = state.assistant_text.borrow_mut();
                if text.len() < MAX_ASSISTANT_TEXT_BYTES {
                    text.push_str(&text_delta);
                }
            }
            // OnceLock: set once; no cost after first initialization.
            state
                .session_id
                .get_or_init(|| args.session_id.0.to_string());
        }

        emit(&self.tx, map_session_notification_event(&args));
        Ok(())
    }
}
