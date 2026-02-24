use serde_json::json;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

/// Known command modes — only these are allowed to prevent injection.
const ALLOWED_MODES: &[&str] = &[
    "scrape",
    "crawl",
    "map",
    "extract",
    "search",
    "research",
    "embed",
    "debug",
    "doctor",
    "query",
    "retrieve",
    "ask",
    "evaluate",
    "suggest",
    "sources",
    "domains",
    "stats",
    "status",
    "dedupe",
    "github",
    "reddit",
    "youtube",
    "sessions",
    "screenshot",
];

/// Known flag names — only these are passed through to the subprocess.
const ALLOWED_FLAGS: &[(&str, &str)] = &[
    ("max_pages", "--max-pages"),
    ("max_depth", "--max-depth"),
    ("limit", "--limit"),
    ("collection", "--collection"),
    ("format", "--format"),
    ("render_mode", "--render-mode"),
    ("include_subdomains", "--include-subdomains"),
    ("discover_sitemaps", "--discover-sitemaps"),
    ("embed", "--embed"),
    ("diagnostics", "--diagnostics"),
];

/// Strip ANSI escape sequences from a string.
fn strip_ansi(s: &str) -> String {
    console::strip_ansi_codes(s).into_owned()
}

/// Execute a CLI command as a subprocess with `--json --wait true`, streaming
/// both stdout and stderr lines back over the WS channel in real time.
pub(super) async fn handle_command(
    mode: &str,
    input: &str,
    flags: &serde_json::Value,
    tx: mpsc::Sender<String>,
) {
    if !ALLOWED_MODES.contains(&mode) {
        let _ = tx
            .send(json!({"type": "error", "message": format!("unknown mode: {mode}")}).to_string())
            .await;
        return;
    }

    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            let _ = tx
                .send(
                    json!({"type": "error", "message": format!("cannot find self: {e}")})
                        .to_string(),
                )
                .await;
            return;
        }
    };

    let mut args: Vec<String> = vec![mode.to_string()];

    // Input goes as a positional argument (URL, query text, etc.)
    let trimmed = input.trim();
    if !trimmed.is_empty() {
        args.push(trimmed.to_string());
    }

    // Always force JSON output + synchronous execution from the UI
    args.push("--json".to_string());
    args.push("--wait".to_string());
    args.push("true".to_string());

    // Whitelist-based flag mapping
    if let Some(obj) = flags.as_object() {
        for (json_key, cli_flag) in ALLOWED_FLAGS {
            if let Some(val) = obj.get(*json_key) {
                match val {
                    serde_json::Value::Bool(true) => {
                        args.push(cli_flag.to_string());
                    }
                    serde_json::Value::Bool(false) => {
                        args.push(cli_flag.to_string());
                        args.push("false".to_string());
                    }
                    serde_json::Value::Number(n) => {
                        args.push(cli_flag.to_string());
                        args.push(n.to_string());
                    }
                    serde_json::Value::String(s) if !s.is_empty() => {
                        args.push(cli_flag.to_string());
                        args.push(s.clone());
                    }
                    _ => {}
                }
            }
        }
    }

    let start = Instant::now();

    let child = Command::new(&exe)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            let _ = tx
                .send(json!({"type": "error", "message": format!("spawn failed: {e}")}).to_string())
                .await;
            return;
        }
    };

    // Stream both stdout and stderr concurrently.
    // stdout = "output" (JSON data lines), stderr = "log" (progress, spinners, tracing)
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_tx = tx.clone();
    let stderr_tx = tx.clone();

    let stdout_task = tokio::spawn(async move {
        let Some(stdout) = stdout else { return };
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let clean = strip_ansi(&line);
            if clean.trim().is_empty() {
                continue;
            }
            if stdout_tx
                .send(json!({"type": "output", "line": clean}).to_string())
                .await
                .is_err()
            {
                break;
            }
        }
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
            // Deduplicate rapid spinner updates (same text repeated)
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

    // Wait for both streams to finish
    let _ = tokio::join!(stdout_task, stderr_task);

    let status = child.wait().await;
    let elapsed = start.elapsed().as_millis() as u64;

    match status {
        Ok(exit) => {
            let code = exit.code().unwrap_or(-1);
            if code == 0 {
                let _ = tx
                    .send(
                        json!({"type": "done", "exit_code": code, "elapsed_ms": elapsed})
                            .to_string(),
                    )
                    .await;
            } else {
                let _ = tx
                    .send(
                        json!({"type": "error", "message": format!("exit code {code}"), "elapsed_ms": elapsed})
                            .to_string(),
                    )
                    .await;
            }
        }
        Err(e) => {
            let _ = tx
                .send(json!({"type": "error", "message": format!("wait failed: {e}")}).to_string())
                .await;
        }
    }
}

/// Cancel a running crawl job by spawning `axon crawl cancel <id> --json`.
pub(super) async fn handle_cancel(job_id: &str, tx: mpsc::Sender<String>) {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            let _ = tx
                .send(
                    json!({"type": "error", "message": format!("cannot find self: {e}")})
                        .to_string(),
                )
                .await;
            return;
        }
    };

    let output = Command::new(&exe)
        .args(["crawl", "cancel", job_id, "--json"])
        .output()
        .await;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                let clean = strip_ansi(line);
                if clean.trim().is_empty() {
                    continue;
                }
                let _ = tx
                    .send(json!({"type": "output", "line": clean}).to_string())
                    .await;
            }
            let _ = tx
                .send(
                    json!({"type": "done", "exit_code": out.status.code().unwrap_or(-1)})
                        .to_string(),
                )
                .await;
        }
        Err(e) => {
            let _ = tx
                .send(
                    json!({"type": "error", "message": format!("cancel failed: {e}")}).to_string(),
                )
                .await;
        }
    }
}
