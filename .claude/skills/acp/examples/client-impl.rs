// Complete ACP client implementation skeleton (Rust)
// Use as a starting point for new clients / editors.
//
// Cargo.toml dependencies:
//   agent-client-protocol = "0"
//   tokio = { version = "1", features = ["full", "process"] }
//   tokio-util = { version = "0.7", features = ["compat"] }   # REQUIRED: compat bridge
//   futures = "0.3"                                            # REQUIRED: AsyncRead/AsyncWrite traits
//   async-trait = "0.1"
//   anyhow = "1"

// CRITICAL: deny stdout/stderr printing — stray output corrupts the protocol stream
#![deny(clippy::print_stdout, clippy::print_stderr)]

use agent_client_protocol::{
    Client, ClientSideConnection,
    ReadTextFileRequest, ReadTextFileResponse,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    WriteTextFileRequest, WriteTextFileResponse,
};
use async_trait::async_trait;

struct MyClient;

#[async_trait]
impl Client for MyClient {
    // Agent calls this to read a file — client resolves the path and returns content.
    // All response types are #[non_exhaustive] — use builder methods, not struct literals.
    async fn read_text_file(
        &self,
        req: ReadTextFileRequest,
    ) -> anyhow::Result<ReadTextFileResponse> {
        let content = tokio::fs::read_to_string(&req.path).await?;
        Ok(ReadTextFileResponse::new(content))
    }

    // Agent calls this to write a file — client applies the write after permission check.
    async fn write_text_file(
        &self,
        req: WriteTextFileRequest,
    ) -> anyhow::Result<WriteTextFileResponse> {
        tokio::fs::write(&req.path, &req.content).await?;
        Ok(WriteTextFileResponse::new())
    }

    // Agent calls this before any destructive operation.
    // Returns RequestPermissionResponse wrapping an outcome — NOT the outcome directly.
    // Outcome variants: Cancelled (user/session cancelled) or Selected(SelectedPermissionOutcome).
    // To auto-approve, select one of the option IDs from req.options:
    //   RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(req.options[0].id))
    // Return Cancelled if the session has been cancelled mid-prompt.
    async fn request_permission(
        &self,
        _req: RequestPermissionRequest,
    ) -> anyhow::Result<RequestPermissionResponse> {
        // Replace with real UI dialog logic that selects from _req.options.
        // Using Cancelled here as a safe default that forces agents to handle denial.
        Ok(RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled))
    }
}

/// Spawn the agent binary as a subprocess and run the ACP connection.
async fn connect_to_agent(agent_bin: &str) -> anyhow::Result<()> {
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

    let mut child = tokio::process::Command::new(agent_bin)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        // stderr is the agent's log channel — inherit or redirect as needed.
        .stderr(std::process::Stdio::inherit())
        .spawn()?;

    let agent_stdout = child.stdout.take().expect("stdout piped");
    let agent_stdin = child.stdin.take().expect("stdin piped");

    // ClientSideConnection expects futures::AsyncRead/AsyncWrite — NOT tokio::io types.
    // Must use .compat() (read) / .compat_write() (write) from tokio-util.
    let agent_reader = agent_stdout.compat();
    let agent_writer = agent_stdin.compat_write();

    // ClientSideConnection: read from agent stdout, write to agent stdin.
    let connection = ClientSideConnection::new(agent_reader, agent_writer, MyClient);
    connection.run().await?;
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    connect_to_agent("./my-agent").await
}
