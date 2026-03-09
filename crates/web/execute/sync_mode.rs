mod acp_adapter;
mod dispatch;
mod params;
mod pulse_chat;
mod service_calls;
mod subprocess;
mod types;

use std::time::Instant;

use tokio::sync::mpsc;

use crate::crates::services::acp as acp_svc;

use super::context::ExecCommandContext;
use super::events::CommandContext;

use dispatch::dispatch_service;
use params::extract_params;
use service_calls::{send_done_owned, send_error_owned};
use types::ServiceMode;

pub(super) use subprocess::handle_sync_command;
pub(super) use types::{AcpConn, DIRECT_SYNC_MODES, DirectParams};

/// Classify a mode string and extract all request parameters into owned values.
///
/// This is the **only** place in the direct-dispatch path where a `String` is
/// borrowed as `&str` — the call to `ServiceMode::from_str` and the
/// `extract_params` helpers.  By doing all classification here, in a plain
/// (non-async) function, no `&str` or `&ExecCommandContext` borrow ever enters
/// an async state machine, which is the root cause of Rust's HRTB `Send` false
/// positives when spawning with `tokio::task::spawn`.
///
/// Returns `None` when the mode is not a recognised `DIRECT_SYNC_MODES` entry.
pub(super) fn classify_sync_direct(context: &ExecCommandContext) -> Option<DirectParams> {
    // L-7: Accept full context directly — no synthetic rebuild needed.
    ServiceMode::from_str(&context.mode)?;
    extract_params(context, &context.flags)
}

/// Execute a pre-classified direct-dispatch request.
///
/// All parameters are fully owned — no `String → &str` conversion happens
/// inside this `async fn`, so the generated `Future` satisfies `Send + 'static`
/// and can be submitted to `tokio::task::spawn` without triggering Rust's HRTB
/// `Send` false positive.
pub(super) async fn handle_sync_direct(
    params: DirectParams,
    tx: mpsc::Sender<String>,
    ws_ctx: CommandContext,
    permission_responders: acp_svc::PermissionResponderMap,
    acp_connection: AcpConn,
) {
    let start = Instant::now();

    // dispatch_service takes full ownership — no borrows cross any .await.
    let svc_result = dispatch_service(
        params,
        tx.clone(),
        ws_ctx.clone(),
        permission_responders,
        acp_connection,
    )
    .await;
    let elapsed_ms = Some(start.elapsed().as_millis() as u64);

    match svc_result {
        Ok(()) => send_done_owned(tx, ws_ctx, 0, elapsed_ms).await,
        Err(e) => send_error_owned(tx, ws_ctx, e.to_string(), elapsed_ms).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_sync_modes_not_in_async_modes() {
        use crate::crates::web::execute::constants::ASYNC_MODES;
        for mode in DIRECT_SYNC_MODES {
            assert!(
                !ASYNC_MODES.contains(mode),
                "mode '{mode}' must not be in both DIRECT_SYNC_MODES and ASYNC_MODES"
            );
        }
    }

    #[test]
    fn direct_sync_modes_all_in_allowed_modes() {
        use crate::crates::web::execute::constants::ALLOWED_MODES;
        for mode in DIRECT_SYNC_MODES {
            assert!(
                ALLOWED_MODES.contains(mode),
                "mode '{mode}' in DIRECT_SYNC_MODES must also be in ALLOWED_MODES"
            );
        }
    }
}
