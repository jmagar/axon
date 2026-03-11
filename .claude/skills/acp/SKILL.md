---
name: acp
version: "1.0.0"
description: >-
  This skill should be used when implementing an ACP (Agent Client Protocol) agent or client in
  Rust using the agent-client-protocol crate, handling session/prompt or session/update wire
  messages, wiring up tool calls with SessionNotifier, implementing the
  initialize/authenticate/session lifecycle handlers, or debugging JSON-RPC 2.0 stdio transport
  issues. Also applies when working with the codex-acp reference implementation or authoring
  bidirectional stdio agents for Zed or VS Code.
---

# Agent Client Protocol (ACP) — Rust

ACP is a JSON-RPC 2.0 protocol for bidirectional communication between AI coding agents and editor clients (Zed, VS Code, etc.). Agents run as subprocesses — clients write to stdin, read from stdout. stderr is for logs only, never protocol data.

**Spec + SDKs:** `agent-client-protocol` crate on crates.io (SDK — provides `Agent`, `Client`, `AgentSideConnection`, `ClientSideConnection`, `SessionNotifier`)
**Production reference:** `~/workspace/codex-acp/` (Rust agent for OpenAI/Codex)
**Schema types only:** `~/workspace/agent-client-protocol/` — this is `agent-client-protocol-schema`, the schema crate (`InitializeRequest`, `AuthMethod`, etc.). It does **not** contain `Agent`/`Client` traits. Reach for it to understand struct fields and verify API shapes. The SDK crate re-exports all schema types plus adds the runtime layer.

---

## Cargo.toml

```toml
[dependencies]
agent-client-protocol = "0"               # types + transport (AgentSideConnection, Agent trait)
tokio = { version = "1", features = ["full"] }
tokio-util = { version = "0.7", features = ["compat"] }  # required: .compat() / .compat_write() bridge
futures = "0.3"                           # AsyncRead/AsyncWrite traits expected by AgentSideConnection
async-trait = "0.1"
anyhow = "1"
uuid = { version = "1", features = ["v4"] }
dashmap = "5"   # preferred over std::sync::Mutex<HashMap> in async contexts
```

---

## Session Lifecycle (condensed)

```
initialize  →  authenticate  →  session/new  →  session/prompt (streaming)  →  session/close
```

All streaming happens via `session/update` notifications (no id, no response) sent during prompt execution. The final `PromptResponse` matches the original `session/prompt` request id.

See `references/wire-format.md` for full JSON examples of every message.

---

## Implementing an Agent

Implement the `Agent` trait and run it on stdio:

```rust
#[async_trait]
impl Agent for MyAgent {
    async fn initialize(&self, _req: InitializeRequest) -> anyhow::Result<InitializeResponse>;
    async fn authenticate(&self, req: AuthenticateRequest) -> anyhow::Result<AuthenticateResponse>;
    async fn new_session(&self, req: NewSessionRequest) -> anyhow::Result<NewSessionResponse>;
    async fn prompt(&self, req: PromptRequest, notifier: SessionNotifier) -> anyhow::Result<PromptResponse>;
    async fn close_session(&self, req: CloseSessionRequest) -> anyhow::Result<()>;
}

// Entry point — MUST run inside LocalSet (AgentSideConnection uses !Send types)
// MUST use .compat() / .compat_write() — AgentSideConnection expects futures::AsyncRead/AsyncWrite,
// NOT tokio::io traits. These are different trait families.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
    let agent = Arc::new(MyAgent { sessions: Arc::new(DashMap::new()) });
    tokio::task::LocalSet::new().run_until(async move {
        let stdin = tokio::io::stdin().compat();
        let stdout = tokio::io::stdout().compat_write();
        let (client, io_task) = AgentSideConnection::new(agent, stdout, stdin, |fut| {
            tokio::task::spawn_local(fut)
        });
        io_task.await
    }).await
}
```

> **GOTCHA — will not compile without compat:** `tokio::io::stdin()` does NOT implement `futures::AsyncRead`. Always use `.compat()` (read) and `.compat_write()` (write) from `tokio_util::compat`. Without `LocalSet`, the runtime panics on `!Send` types.

For a complete working skeleton see **`examples/agent-impl.rs`**.

Key points:
- Advertise only capabilities the agent actually supports in `InitializeResponse`
- Return `Err(anyhow::anyhow!("msg"))` on auth failure — the SDK maps it to error code `-32000`
- Use `tokio::io::stdin/stdout()` with `.compat()` — never `std::io` in an async context (blocks the executor)
- Use `DashMap` for session state, not `std::sync::Mutex<HashMap>` (deadlock risk under Tokio)
- Add `#![deny(clippy::print_stdout, clippy::print_stderr)]` to the crate root — one stray `println!` corrupts the binary protocol stream

---

## Implementing a Client

Implement the `Client` trait to handle agent requests for file I/O and permissions:

```rust
#[async_trait]
impl Client for MyClient {
    // All response types are #[non_exhaustive] — use builders, not struct literals.
    async fn read_text_file(&self, req: ReadTextFileRequest) -> anyhow::Result<ReadTextFileResponse>;
    async fn write_text_file(&self, req: WriteTextFileRequest) -> anyhow::Result<WriteTextFileResponse>;
    // Returns RequestPermissionResponse (wraps outcome), NOT RequestPermissionOutcome directly.
    // Outcome variants: Cancelled | Selected(SelectedPermissionOutcome::new(option_id))
    async fn request_permission(&self, req: RequestPermissionRequest) -> anyhow::Result<RequestPermissionResponse>;
}

// Spawn agent subprocess and connect
// NOTE: ChildStdout/ChildStdin also need .compat() / .compat_write() — same as agent side
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
ClientSideConnection::new(agent_stdout.compat(), agent_stdin.compat_write(), MyClient).run().await?;
```

For a complete working skeleton see **`examples/client-impl.rs`**.

---

## Tool Calls (streaming)

Send `ToolCall` before executing a tool, then `ToolCallUpdate` with the result. The client renders these in the UI.

```rust
// Before tool execution — builder pattern, no Default impl
notifier.send(SessionUpdate::ToolCall(
    ToolCall::new("tc-1", "Read src/main.rs")
        .kind(ToolKind::Read)
        .status(ToolCallStatus::InProgress)
        .locations(vec![ToolCallLocation::new("src/main.rs")]),
)).await?;

// After tool execution — ToolCallUpdateFields builder, #[serde(flatten)] in wire format
notifier.send(SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
    "tc-1",
    ToolCallUpdateFields::new()
        .status(ToolCallStatus::Completed)
        .content(vec![ToolCallContent::Content(Content::new(
            ContentBlock::Text { text: result },
        ))]),
))).await?;
```

> **GOTCHA — no struct literals:** `ToolCall` and `ToolCallUpdate` have no `Default` impl. Use the builder pattern shown above — `ToolCall::new(id, title).kind(...).status(...)`. `ToolCallStatus::Started` does **not** exist; use `InProgress`. The enum is `ToolKind` (not `ToolCallKind`).

For all 10 `ToolKind` variants, JSON wire format, streaming deduplication, and `_meta` extensibility see **`references/tool-calls.md`**.

---

## Reference Files

These reference files contain detail beyond the core guide above:

- **`references/wire-format.md`** — Full JSON-RPC examples for every message type (initialize handshake, authenticate, session/new, session/prompt with streaming, terminal API, session/list, fs/readTextFile, request/permission). Reach for this when debugging wire format mismatches or building a client from scratch.
- **`references/message-reference.md`** — Complete table of all 24 ACP methods (direction, type, purpose), all 11 `SessionUpdate` variants (10 stable + 1 unstable), session modes, and error codes. Reach for this when you need to look up a specific method or understand what messages are available.
- **`references/tool-calls.md`** — Tool call kinds table, full JSON wire examples for `tool_call` and `tool_call_update` notifications, streaming deduplication pattern, `_meta` extensibility, terminal tool lifecycle, and the Rust sending pattern. Reach for this when wiring up tool call streaming.
- **`references/codex-patterns.md`** — Production patterns extracted from codex-acp: `DashMap` session state, `LocalSet` + compat wiring, `OnceLock` global client, filesystem sandboxing, session listing with pagination, MCP name normalization, graceful cancellation with `biased tokio::select!`, and auth via env vars. Reach for this when implementing production-grade agent features.
- **`references/unstable-features.md`** — All 9 unstable feature flags with Cargo.toml activation syntax, types, and stability tracking. Reach for this when enabling optional ACP features (session/fork, usage tracking, etc.) or checking if a feature has been stabilized.

---

## Examples

- **`examples/agent-impl.rs`** — Complete `Agent` trait implementation skeleton with `DashMap` session state, tool call notifications, and correct `tokio::io` usage.
- **`examples/client-impl.rs`** — Complete `Client` trait implementation skeleton with subprocess spawning, file I/O handlers, and permission handling.

---

## Quick Checklists

### New Rust ACP Agent

- [ ] `#![deny(clippy::print_stdout, clippy::print_stderr)]` in crate root — one stray `println!` corrupts the binary protocol stream
- [ ] Run `AgentSideConnection` inside `tokio::task::LocalSet` — required for `!Send` types
- [ ] Use `.compat()` / `.compat_write()` from `tokio-util` — tokio IO types do NOT implement `futures::AsyncRead/Write`
- [ ] `initialize` — advertise only capabilities the agent actually supports
- [ ] `authenticate` — validate credentials; return `Err` with clear message on failure
- [ ] `new_session` — generate UUID, store state in `DashMap` (not `std::sync::Mutex<HashMap>`)
- [ ] `prompt` — send `ToolCall` before each tool, `ToolCallUpdate` after, stream text chunks
- [ ] Handle `session/cancel` — store a `watch::Sender<bool>` in session state, signal it from `Agent::on_cancel()`; race with `tokio::select! { biased; }` in prompt loop (see `references/codex-patterns.md`)
- [ ] `close_session` — remove session from `DashMap`, drop any spawned resources
- [ ] Call `request/permission` on client before destructive file writes
- [ ] Keep stderr for logs only — never write protocol data to stderr
- [ ] Sandbox file paths to session `cwd` — reject `../` escapes

### New Rust ACP Client

- [ ] Spawn agent binary with `tokio::process::Command`, pipe stdio
- [ ] Send `initialize` first — parse capabilities before using any features
- [ ] Implement `read_text_file` and `write_text_file` handlers
- [ ] Implement `request_permission` — show user dialog, return `Approved`/`Denied`/`Cancelled`
- [ ] Handle all `SessionUpdate` variants (chunk, tool_call, tool_call_update, thought)
- [ ] Send `session/cancel` notification on user interrupt
- [ ] Render tool calls using `kind` to pick appropriate UI (diff, file path, terminal)
- [ ] Gracefully degrade for capabilities the agent doesn't advertise
