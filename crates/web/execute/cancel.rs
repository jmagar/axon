use super::events::{self, JobCancelResponsePayload, WsEventV2, serialize_v2_event};
use super::exe::resolve_exe;
use super::ws_send::{send_done_dual, send_error_dual};
use std::string::ToString;
use tokio::process::Command;
use tokio::sync::mpsc;
use uuid::Uuid;

pub(super) fn cancel_ok_from_output(
    parsed: Option<&serde_json::Value>,
    status_success: bool,
) -> bool {
    parsed
        .and_then(|v| v.get("ok"))
        .and_then(|v| v.as_bool())
        .or_else(|| {
            parsed
                .and_then(|v| v.get("canceled"))
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(status_success)
}

pub(super) fn is_valid_cancel_job_id(job_id: &str) -> bool {
    Uuid::parse_str(job_id).is_ok()
}

pub(super) async fn handle_cancel(mode: &str, job_id: &str, tx: mpsc::Sender<String>) {
    let cancel_mode = if mode.is_empty() { "crawl" } else { mode };
    let ws_ctx = events::CommandContext {
        exec_id: format!("exec-{}", Uuid::new_v4()),
        mode: cancel_mode.to_string(),
        input: job_id.to_string(),
    };
    if !is_valid_cancel_job_id(job_id) {
        if let Some(v2) = serialize_v2_event(WsEventV2::JobCancelResponse {
            ctx: ws_ctx.clone(),
            payload: JobCancelResponsePayload {
                ok: false,
                mode: Some(cancel_mode.to_string()),
                job_id: Some(job_id.to_string()),
                message: Some("invalid job_id format".to_string()),
            },
        }) {
            let _ = tx.send(v2).await;
        }
        send_error_dual(
            &tx,
            &ws_ctx,
            "cancel failed: invalid job_id format".to_string(),
            None,
        )
        .await;
        return;
    }
    let exe = match resolve_exe() {
        Ok(p) => p,
        Err(e) => {
            send_error_dual(&tx, &ws_ctx, format!("cannot find axon binary: {e}"), None).await;
            return;
        }
    };

    let output = Command::new(&exe)
        .args([cancel_mode, "cancel", job_id, "--json"])
        .output()
        .await;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let parsed = serde_json::from_str::<serde_json::Value>(stdout.trim()).ok();
            let ok = cancel_ok_from_output(parsed.as_ref(), out.status.success());
            let message = parsed
                .as_ref()
                .and_then(|v| v.get("message"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .or_else(|| {
                    let trimmed = stderr.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                });

            if let Some(v2) = serialize_v2_event(WsEventV2::JobCancelResponse {
                ctx: ws_ctx.clone(),
                payload: JobCancelResponsePayload {
                    ok,
                    mode: Some(cancel_mode.to_string()),
                    job_id: Some(job_id.to_string()),
                    message,
                },
            }) {
                let _ = tx.send(v2).await;
            }

            if !ok {
                send_error_dual(
                    &tx,
                    &ws_ctx,
                    format!(
                        "cancel failed{}",
                        out.status
                            .code()
                            .map(|code| format!(": exit code {code}"))
                            .unwrap_or_default()
                    ),
                    None,
                )
                .await;
            } else {
                send_done_dual(&tx, &ws_ctx, 0, None).await;
            }
        }
        Err(e) => {
            send_error_dual(&tx, &ws_ctx, format!("cancel failed: {e}"), None).await;
        }
    }
}
