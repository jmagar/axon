use std::time::Instant;

use serde_json::json;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;

use super::super::context::ExecCommandContext;
use super::super::exe::strip_ansi;
use super::super::files;
use super::super::ws_send::{send_command_output_line, send_done_dual, send_error_dual};
use super::service_calls::send_json_owned;

/// Subprocess-backed sync handler — used for modes not yet wired to direct dispatch.
///
/// Reads stdout/stderr from the child process and streams events to the WS
/// sender. Screenshot JSON payloads are accumulated and forwarded as
/// artifact entries after the process exits.
pub(crate) async fn handle_sync_command(
    mut child: tokio::process::Child,
    context: &ExecCommandContext,
    tx: &mpsc::Sender<String>,
    start: Instant,
) {
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_tx = tx.clone();
    let stderr_tx = tx.clone();
    let is_screenshot = context.mode == "screenshot";
    let ws_ctx = context.to_ws_ctx();
    let stdout_ctx = ws_ctx.clone();

    let stdout_task = tokio::spawn(async move {
        let Some(stdout) = stdout else {
            return Vec::new();
        };
        let mut lines = BufReader::new(stdout).lines();
        let mut screenshot_jsons: Vec<serde_json::Value> = Vec::new();
        let mut stdout_accum = String::new();
        let mut saw_json_line = false;

        while let Ok(Some(line)) = lines.next_line().await {
            let clean = strip_ansi(&line);
            if clean.trim().is_empty() {
                continue;
            }
            // FINDING-12: only accumulate before we've seen the first JSON line —
            // after that, stdout_accum is only used in the fallback path below which
            // is skipped when saw_json_line is true, so continued accumulation wastes
            // memory for long streaming outputs.
            if !saw_json_line {
                if !stdout_accum.is_empty() {
                    stdout_accum.push('\n');
                }
                stdout_accum.push_str(&clean);
            }
            match serde_json::from_str::<serde_json::Value>(&clean) {
                Ok(parsed) if parsed.is_object() || parsed.is_array() => {
                    saw_json_line = true;
                    if is_screenshot {
                        screenshot_jsons.push(parsed.clone());
                    }
                    send_json_owned(stdout_tx.clone(), stdout_ctx.clone(), parsed).await;
                }
                Ok(_) | Err(_) => {
                    send_command_output_line(&stdout_tx, &stdout_ctx, clean).await;
                }
            }
        }

        if !saw_json_line
            && let Ok(parsed) = serde_json::from_str::<serde_json::Value>(stdout_accum.trim())
        {
            send_json_owned(stdout_tx, stdout_ctx, parsed).await;
        }

        screenshot_jsons
    });

    let stderr_task = tokio::spawn(async move {
        let Some(stderr) = stderr else { return };
        let mut lines = BufReader::new(stderr).lines();
        let mut last_stderr = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            let clean = strip_ansi(&line);
            if clean.trim().is_empty() {
                continue;
            }
            if clean == last_stderr {
                continue;
            }
            last_stderr.clone_from(&clean);
            if stderr_tx
                .send(json!({"type": "log", "line": clean}).to_string())
                .await
                .is_err()
            {
                break;
            }
        }
    });

    let (stdout_result, _) = tokio::join!(stdout_task, stderr_task);
    let screenshot_jsons = stdout_result.unwrap_or_default();
    let status = child.wait().await;
    let elapsed = start.elapsed().as_millis() as u64;

    match status {
        Ok(exit) => {
            let code = exit.code().unwrap_or(-1);
            if code == 0 {
                if context.mode == "screenshot" {
                    files::send_screenshot_files_from_json(&screenshot_jsons, tx, &ws_ctx).await;
                }
                send_done_dual(tx, &ws_ctx, code, Some(elapsed)).await;
            } else {
                send_error_dual(tx, &ws_ctx, format!("exit code {code}"), Some(elapsed)).await;
            }
        }
        Err(e) => {
            send_error_dual(tx, &ws_ctx, format!("wait failed: {e}"), None).await;
        }
    }
}
