//! ACP bridge client: implements the `agent_client_protocol::Client` trait,
//! forwarding session notifications and permission requests through the
//! service event channel.

use crate::crates::services::events::{LogLevel, ServiceEvent, emit};
use crate::crates::services::types::AcpConfigOption;
use crate::crates::services::types::AcpSessionUpdateKind;
use agent_client_protocol::{
    Client, PermissionOptionKind, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionNotification, SessionUpdate,
    StopReason,
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
    pub(super) current_session_id: std::cell::RefCell<Option<String>>,
    pub(super) assistant_text: std::cell::RefCell<String>,
    /// Current turn's service event sender — updated per-turn by `run_turn_on_conn`
    /// so bridge callbacks (session_notification, request_permission) always route
    /// to the active turn's channel, not the stale first-turn channel.
    pub(super) service_tx: std::cell::RefCell<Option<mpsc::Sender<ServiceEvent>>>,
    /// Monotonically-increasing turn counter.  Incremented at the start of each
    /// turn by `run_turn_on_conn`.  `session_notification` compares the active
    /// turn ID against this value and drops deltas that arrive after the turn has
    /// ended (e.g. late results from a previous timed-out turn).
    pub(super) current_turn_id: std::cell::Cell<u64>,
    /// The model string applied when the ACP session was established.
    /// Updated by `run_turn_on_conn` when a model switch succeeds.
    pub(super) established_model: std::cell::RefCell<Option<String>>,
    /// Latest config options known for this session (from setup and runtime updates).
    /// Used by the persistent runtime to resolve config option IDs for mid-session
    /// config changes (for example model changes).
    pub(super) config_options: std::cell::RefCell<Vec<AcpConfigOption>>,
    /// Disabled MCP tool command names for the active session/runtime.
    pub(super) blocked_mcp_tools: std::cell::RefCell<std::collections::HashSet<String>>,
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
///
/// Returns `Cancelled` immediately with a warning if `session_id` is blank —
/// a blank key would prevent the WS router from ever routing the response.
pub(super) async fn handle_interactive_permission(
    args: &RequestPermissionRequest,
    tx: &Option<mpsc::Sender<ServiceEvent>>,
    permission_responders: &PermissionResponderMap,
    session_id: &str,
    tool_call_id: &str,
) -> RequestPermissionOutcome {
    // Reject blank session_id early — the composite (session_id, tool_call_id) key
    // would never match a route_permission_response call, so the request would hang
    // until timeout.  Fail fast with a clear error instead.
    if session_id.trim().is_empty() {
        emit(
            tx,
            ServiceEvent::Log {
                level: LogLevel::Warn,
                message: format!(
                    "ACP permission: blank session_id for tool_call={tool_call_id}, \
                     cannot route response — cancelling"
                ),
            },
        );
        return RequestPermissionOutcome::Cancelled;
    }

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
        // Disconnect path: the oneshot sender was dropped without being sent.
        // This can happen if the DashMap entry was removed by an external cleanup
        // path that discarded the sender rather than calling send().  As a safety
        // net, explicitly remove the map entry here so no stale entry can linger.
        Ok(Err(_)) => {
            permission_responders.remove(&(session_id.to_string(), tool_call_id.to_string()));
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
/// `AcpRuntimeState` uses `RefCell` internally (not thread-safe).  Cloning
/// `AcpBridgeClient` shares the same state across spawned tasks safely
/// because the ACP runtime runs on a `current_thread` tokio runtime inside
/// a `LocalSet`, guaranteeing single-threaded access.  The `?Send` bound on
/// the `Client` trait impl enforces this at compile time.
#[derive(Clone)]
pub struct AcpBridgeClient {
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
        // Use the current turn's service_tx. Clone to release borrow before awaits.
        let service_tx = self.runtime_state.service_tx.borrow().clone();
        emit(&service_tx, map_permission_request_event(&args));

        let tool_call_id = args.tool_call.tool_call_id.0.to_string();
        let tool_name = args
            .tool_call
            .fields
            .title
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_lowercase();

        if !tool_name.is_empty()
            && self
                .runtime_state
                .blocked_mcp_tools
                .borrow()
                .contains(&tool_name)
        {
            emit(
                &service_tx,
                ServiceEvent::Log {
                    level: LogLevel::Info,
                    message: format!(
                        "ACP permission auto-cancelled for blocked MCP tool: {tool_name}"
                    ),
                },
            );
            return Ok(RequestPermissionResponse::new(
                RequestPermissionOutcome::Cancelled,
            ));
        }

        if self.auto_approve {
            return Ok(RequestPermissionResponse::new(auto_approve_outcome(
                &args,
                &service_tx,
                &tool_call_id,
            )));
        }

        // Interactive mode: delegate to helper which manages oneshot registration,
        // timeout, and map cleanup.
        let session_id = args.session_id.0.as_ref();
        let outcome = handle_interactive_permission(
            &args,
            &service_tx,
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

            // Capture the turn ID at the start of this notification to detect
            // late results from a previous timed-out turn.  `run_turn_on_conn`
            // increments `current_turn_id` before each prompt; if the value changed
            // between when this notification was enqueued and now, we drop the delta.
            let active_turn_id = state.current_turn_id.get();

            if let Some(text_delta) = extract_text_delta(&args.update)
                && matches!(
                    map_session_update_kind(&args.update),
                    AcpSessionUpdateKind::AssistantDelta
                )
            {
                // Reject deltas that arrived after the current turn ended.  This
                // guards against late results from a previous timed-out turn being
                // attributed to the new active turn.
                if active_turn_id != state.current_turn_id.get() {
                    log::warn!(
                        "[acp_bridge] dropping late text delta: turn_id mismatch \
                         (expected {active_turn_id}, current {})",
                        state.current_turn_id.get()
                    );
                    return Ok(());
                }
                // Cap at 1 MiB to prevent unbounded accumulation from long sessions.
                const MAX_ASSISTANT_TEXT_BYTES: usize = 1024 * 1024;
                let mut text = state.assistant_text.borrow_mut();
                if text.len() < MAX_ASSISTANT_TEXT_BYTES {
                    text.push_str(&text_delta);
                }
            }
            *state.current_session_id.borrow_mut() = Some(args.session_id.0.to_string());

            if let SessionUpdate::ConfigOptionUpdate(update) = &args.update {
                let mapped = super::mapping::map_config_options(&update.config_options);
                *state.config_options.borrow_mut() = mapped;
            }
        }

        // Use the current turn's service_tx (updated per-turn by run_turn_on_conn).
        // Clone immediately to release the borrow before the emit call.
        let service_tx = self.runtime_state.service_tx.borrow().clone();
        emit(&service_tx, map_session_notification_event(&args));
        Ok(())
    }
}
