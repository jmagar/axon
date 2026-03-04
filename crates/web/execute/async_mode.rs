use super::context::ExecCommandContext;
use super::exe::strip_ansi;
use super::polling::poll_async_job;
use super::ws_send::send_error_dual;
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{Mutex, mpsc};

pub(super) async fn handle_async_command(
    mut child: tokio::process::Child,
    context: ExecCommandContext,
    tx: &mpsc::Sender<String>,
    crawl_job_id: Arc<Mutex<Option<String>>>,
    start: Instant,
) {
    let ws_ctx = context.to_ws_ctx();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stderr_tx = tx.clone();

    let stdout_capture = tokio::spawn(async move {
        let stdout = stdout?;
        let mut lines = BufReader::new(stdout).lines();
        let mut job_id: Option<String> = None;
        while let Ok(Some(line)) = lines.next_line().await {
            let clean = line.trim().to_string();
            if clean.is_empty() {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&clean)
                && let Some(id) = parsed.get("job_id").and_then(|v| v.as_str())
            {
                job_id = Some(id.to_string());
            }
        }
        job_id
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

    let _ = tokio::join!(stderr_task);
    let _ = child.wait().await;
    let job_id = stdout_capture.await.ok().flatten();

    if let Some(id) = job_id {
        *crawl_job_id.lock().await = Some(id.clone());

        let _ = tx
            .send(
                json!({"type": "log", "line": format!("[web] {} job enqueued: {id}", context.mode)})
                    .to_string(),
            )
            .await;

        let mode_str = context.mode.clone();
        let input_str = context.input.trim().to_string();
        poll_async_job(&id, &mode_str, &input_str, &ws_ctx, tx, start).await;
        *crawl_job_id.lock().await = None;
    } else {
        let elapsed = start.elapsed().as_millis() as u64;
        send_error_dual(
            tx,
            &ws_ctx,
            format!("failed to capture {} job ID from subprocess", context.mode),
            Some(elapsed),
        )
        .await;
    }
}
