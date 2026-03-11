# Production Patterns from codex-acp

These patterns are extracted from the codex-acp reference implementation. Apply them in any Rust ACP agent.

> **Source:** `~/workspace/codex-acp/` — patterns below are extracted and self-contained, but the full source is available for deeper reference.

---

## Session State with DashMap

Use `DashMap` instead of `std::sync::Mutex<HashMap>` for session state in async contexts. `std::sync::Mutex` can deadlock under Tokio's executor if held across `.await` points.

```rust
use dashmap::DashMap;
use std::sync::Arc;

struct MyAgent {
    sessions: Arc<DashMap<String, Arc<tokio::sync::Mutex<SessionState>>>>,
}
```

---

## Filesystem Sandboxing

Scope all file reads/writes to the session `cwd`. Reject paths that escape via `../`.

```rust
fn resolve_path(&self, path: &Path, cwd: &Path) -> anyhow::Result<PathBuf> {
    // Resolve relative to session cwd, not process cwd
    let full = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };

    // Use std::path::absolute() (Rust 1.82+) — resolves ../ without requiring the path to exist.
    // Do NOT use canonicalize() here — it returns Err on non-existent paths,
    // which breaks write operations to new files before they're created.
    let abs = std::path::absolute(&full)
        .unwrap_or(full);

    // Reject anything that escapes the session root
    let abs_cwd = std::path::absolute(cwd).unwrap_or(cwd.to_path_buf());
    if !abs.starts_with(&abs_cwd) {
        anyhow::bail!("path escapes session root: {}", path.display());
    }
    Ok(abs)
}
```

---

## Session Listing with Pagination

```rust
// 25 per page; cursor = last session ID from previous page
// Truncate display titles to 120 grapheme clusters
use unicode_segmentation::UnicodeSegmentation;

fn truncate_title(raw: &str) -> String {
    raw.graphemes(true).take(120).collect()
}

async fn list_sessions(&self, cursor: Option<&str>, limit: usize) -> Vec<SessionSummary> {
    let all = self.sessions.iter()
        .map(|e| e.key().clone())
        .collect::<Vec<_>>();

    let start = match cursor {
        None => 0,
        Some(id) => all.iter().position(|s| s == id).map(|i| i + 1).unwrap_or(0),
    };

    all[start..].iter().take(limit).cloned().collect()
}
```

---

## MCP Server Name Normalization

MCP server names must not contain whitespace. Replace spaces with underscores when forwarding from client config.

```rust
fn normalize_mcp_name(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join("_")
}
```

---

## Graceful Cancellation

Check a cancellation signal inside the prompt loop. Use `tokio::select!` to race the LLM response against the cancel signal.

```rust
use tokio::sync::watch;

// In SessionState
cancel_tx: watch::Sender<bool>,
cancel_rx: watch::Receiver<bool>,

// In prompt handler
async fn prompt(&self, req: PromptRequest, notifier: SessionNotifier) -> anyhow::Result<PromptResponse> {
    let mut cancel = self.get_cancel_rx(&req.session_id);

    loop {
        tokio::select! {
            // biased: prioritizes cancel branch over llm chunks.
            // Without biased, rapid chunk spam can starve the cancel signal.
            biased;
            _ = cancel.changed() => {
                if *cancel.borrow() {
                    return Ok(PromptResponse { stop_reason: "cancelled".into(), usage: None });
                }
            }
            chunk = llm_stream.next() => {
                match chunk {
                    Some(text) => notifier.send(SessionUpdate::AgentMessageChunk(text)).await?,
                    None => break,
                }
            }
        }
    }

    Ok(PromptResponse { stop_reason: "end_turn".into(), usage: None })
}

// In the session/cancel handler (called from Agent trait)
fn handle_cancel(&self, session_id: &str) {
    if let Some(state) = self.sessions.get(session_id) {
        let _ = state.blocking_lock().cancel_tx.send(true);
    }
}
```

---

## Auth via Environment Variables

Set credentials as env vars after `authenticate` — downstream LLM clients pick them up automatically.

```rust
async fn authenticate(&self, req: AuthenticateRequest) -> anyhow::Result<AuthenticateResponse> {
    match req.method_id.as_str() {
        "openai_api_key" => {
            let key = req.credentials.get("apiKey")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing apiKey"))?;
            std::env::set_var("OPENAI_API_KEY", key);
            Ok(AuthenticateResponse { authenticated: true })
        }
        _ => Err(anyhow::anyhow!("unknown auth method: {}", req.method_id)),
    }
}
```
