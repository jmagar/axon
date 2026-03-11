// Complete ACP agent implementation skeleton (Rust)
// Use as a starting point for new agents.
//
// Cargo.toml dependencies:
//   agent-client-protocol = "0"
//   tokio = { version = "1", features = ["full"] }
//   tokio-util = { version = "0.7", features = ["compat"] }   # REQUIRED: compat bridge
//   futures = "0.3"                                            # REQUIRED: AsyncRead/AsyncWrite traits
//   async-trait = "0.1"
//   anyhow = "1"
//   uuid = { version = "1", features = ["v4"] }
//   dashmap = "5"

// CRITICAL: deny stdout/stderr printing — any stray println! corrupts the binary protocol stream
#![deny(clippy::print_stdout, clippy::print_stderr)]

use agent_client_protocol::{
    Agent, AgentCapabilities, AgentSideConnection, AuthMethod, AuthMethodAgent,
    AuthenticateRequest, AuthenticateResponse, CancelNotification, CloseSessionRequest,
    Implementation, InitializeRequest, InitializeResponse, McpCapabilities, NewSessionRequest,
    NewSessionResponse, PromptCapabilities, PromptRequest, PromptResponse, ProtocolVersion,
    SessionNotifier, SessionUpdate, StopReason, ToolCall, ToolCallContent, ToolCallLocation,
    ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind, Content, ContentBlock,
};
use async_trait::async_trait;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::watch;

struct MyAgent {
    // DashMap is preferred over std::sync::Mutex<HashMap> in async contexts
    // to avoid potential deadlocks under Tokio's executor.
    sessions: Arc<DashMap<String, SessionState>>,
}

struct SessionState {
    cwd: std::path::PathBuf,
    // watch channel for graceful cancellation — signal from on_cancel(), race in prompt loop
    cancel_tx: watch::Sender<bool>,
    cancel_rx: watch::Receiver<bool>,
}

#[async_trait]
impl Agent for MyAgent {
    // All response types are #[non_exhaustive] — MUST use builder methods, not struct literals.
    async fn initialize(&self, _req: InitializeRequest) -> anyhow::Result<InitializeResponse> {
        Ok(InitializeResponse::new(ProtocolVersion::LATEST)
            .agent_capabilities(
                AgentCapabilities::new()
                    .prompt_capabilities(
                        PromptCapabilities::new()
                            .embedded_context(true),
                    )
                    .mcp_capabilities(McpCapabilities::new().http(true))
                    .load_session(true),
            )
            .agent_info(Implementation::new("my-agent", "0.1.0"))
            .auth_methods(vec![
                AuthMethod::Agent(AuthMethodAgent::new("api_key", "API Key")),
            ]))
    }

    async fn authenticate(&self, req: AuthenticateRequest) -> anyhow::Result<AuthenticateResponse> {
        // Validate req.method_id — the AuthMethodId identifies which auth method was chosen.
        // Return Err on failure so the SDK sends JSON-RPC error code -32000.
        let _ = req.method_id; // replace with real validation
        Ok(AuthenticateResponse::new())
    }

    async fn new_session(&self, req: NewSessionRequest) -> anyhow::Result<NewSessionResponse> {
        let session_id = uuid::Uuid::new_v4().to_string();
        let (cancel_tx, cancel_rx) = watch::channel(false);
        // req.cwd is PathBuf (not Option<PathBuf>) — always present
        self.sessions.insert(
            session_id.clone(),
            SessionState {
                cwd: req.cwd,
                cancel_tx,
                cancel_rx,
            },
        );
        Ok(NewSessionResponse::new(session_id))
    }

    async fn prompt(
        &self,
        req: PromptRequest,
        notifier: SessionNotifier,
    ) -> anyhow::Result<PromptResponse> {
        let mut cancel = self
            .sessions
            .get(&req.session_id)
            .map(|s| s.cancel_rx.clone())
            .ok_or_else(|| anyhow::anyhow!("session not found"))?;

        // 1. Send ToolCall notification before each tool execution.
        //    ToolCall uses a builder pattern — no Default impl, no struct literal with `..`.
        notifier.send(SessionUpdate::ToolCall(
            ToolCall::new("tc-1", "Reading file")
                .kind(ToolKind::Read)
                .status(ToolCallStatus::InProgress)
                .locations(vec![ToolCallLocation::new("src/main.rs")]),
        )).await?;

        // 2. Execute tool (e.g. call fs/readTextFile on the client via notifier.client()).
        // let content = notifier.client().read_text_file(...).await?;

        // 3. Send ToolCallUpdate with result.
        //    ToolCallUpdateFields builder — fields are #[serde(flatten)] in JSON but nested in Rust.
        notifier.send(SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
            "tc-1",
            ToolCallUpdateFields::new()
                .status(ToolCallStatus::Completed)
                .content(vec![ToolCallContent::Content(Content::new(
                    ContentBlock::Text { text: "fn main() { ... }".into() },
                ))]),
        ))).await?;

        // 4. Stream response text chunks — race against cancellation.
        // biased: prioritizes cancel branch over LLM chunks (prevents starvation)
        loop {
            tokio::select! {
                biased;
                _ = cancel.changed() => {
                    if *cancel.borrow() {
                        return Ok(PromptResponse::new(StopReason::Cancelled));
                    }
                }
                // Replace with: chunk = llm_stream.next() => { ... }
                _ = async { } => {
                    notifier.send(SessionUpdate::AgentMessageChunk("Done reading the file.".into())).await?;
                    break;
                }
            }
        }

        Ok(PromptResponse::new(StopReason::EndTurn))
    }

    // session/cancel arrives as a notification — signal the watch channel
    async fn on_cancel(&self, notification: CancelNotification) {
        if let Some(state) = self.sessions.get(&notification.session_id) {
            let _ = state.cancel_tx.send(true);
        }
    }

    async fn close_session(&self, req: CloseSessionRequest) -> anyhow::Result<()> {
        self.sessions.remove(&req.session_id);
        Ok(())
    }
}

// CRITICAL: AgentSideConnection::new() expects futures::AsyncRead/AsyncWrite — NOT tokio::io types.
// Must use .compat() / .compat_write() from tokio-util. Without LocalSet, runtime panics on !Send.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

    let agent = Arc::new(MyAgent { sessions: Arc::new(DashMap::new()) });

    // LocalSet is required — AgentSideConnection uses !Send types internally
    tokio::task::LocalSet::new().run_until(async move {
        let stdin = tokio::io::stdin().compat();
        let stdout = tokio::io::stdout().compat_write();
        // Arguments: (agent, writer/stdout, reader/stdin, task_spawner)
        let (_client, io_task) = AgentSideConnection::new(agent, stdout, stdin, |fut| {
            tokio::task::spawn_local(fut)
        });
        io_task.await
    }).await
}
