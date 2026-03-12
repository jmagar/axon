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

mod editor;
mod session_options;
mod turn;

use agent_client_protocol::InitializeRequest;
use tokio::sync::{mpsc, oneshot};

use crate::crates::services::events::ServiceEvent;
use crate::crates::services::types::{AcpAdapterCommand, AcpPromptTurnRequest};

use super::runtime::{EstablishedSession, establish_acp_session};
use super::{AcpSessionSetupRequest, PermissionResponderMap};

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
    let session_cwd = match &session_setup {
        AcpSessionSetupRequest::New(req) => req.cwd.clone(),
        AcpSessionSetupRequest::Load(req) => req.cwd.clone(),
    };

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

    *runtime_state.current_session_id.borrow_mut() = Some(session_id.0.to_string());
    *runtime_state.established_model.borrow_mut() = model.map(str::to_owned);

    turn::run_turn_on_conn(
        &mut conn,
        &session_id,
        &session_cwd,
        &runtime_state,
        first_turn,
    )
    .await;

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Some(AdapterMessage::RunTurn(turn)) => {
                        turn::run_turn_on_conn(&mut conn, &session_id, &session_cwd, &runtime_state, turn).await;
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
