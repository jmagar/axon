//! ACP (Agent Client Protocol) service layer.
//!
//! Provides `AcpClientScaffold` for spawning and communicating with ACP
//! adapter subprocesses (Claude CLI, Codex, Gemini).
//!
//! # Module layout
//!
//! - `adapters`  — adapter kind detection, model normalization, model override
//! - `bridge`    — `AcpBridgeClient` implementing the ACP SDK `Client` trait
//! - `config`    — config directory discovery and model file readers
//! - `mapping`   — ACP SDK type → service-layer type conversions + validators
//! - `runtime`   — `run_prompt_turn` / `run_session_probe` orchestration
//!
//! Callers outside this crate only need the public surface exported below.

pub mod adapters;
pub(super) mod bridge;
pub(super) mod config;
pub mod mapping;
pub(super) mod persistent_conn;
pub(super) mod runtime;
pub(super) mod session;

use std::sync::Arc;

use agent_client_protocol::{
    InitializeRequest, LoadSessionRequest, NewSessionRequest, ProtocolVersion,
};
use tokio::sync::mpsc;

use crate::crates::services::events::{LogLevel, ServiceEvent, emit};
use crate::crates::services::types::{
    AcpAdapterCommand, AcpPromptTurnRequest, AcpSessionProbeRequest,
};

use mapping::build_session_setup;
use runtime::{run_prompt_turn, run_session_probe};

// ── Public type re-exports ───────────────────────────────────────────────────

pub use bridge::AcpRuntimeState;
pub use mapping::{
    map_config_options, map_permission_request, map_permission_request_event,
    map_session_notification, map_session_notification_event, map_session_update_kind,
    validate_adapter_command, validate_probe_request, validate_prompt_turn_request,
    validate_session_cwd,
};
pub use persistent_conn::{AcpConnectionHandle, TurnRequest};

// ── PermissionResponderMap ───────────────────────────────────────────────────

/// Shared map of pending permission responses keyed by `tool_call_id`.
///
/// FINDING-13: Uses `DashMap` instead of `Arc<Mutex<HashMap<...>>>` to eliminate
/// lock contention when the bridge inserts/removes permission responders from
/// concurrent async tasks. DashMap uses shard-level locking internally.
///
/// When a permission request arrives from the ACP agent, the bridge inserts a
/// oneshot sender here. The WS handler (or auto-approve logic) sends the chosen
/// `option_id` through it.
/// Key is `(session_id, tool_call_id)` to prevent cross-session collisions
/// (SEC-7): two concurrent sessions cannot accidentally receive each other's
/// permission responses even if their `tool_call_id` values happen to collide.
pub type PermissionResponderMap =
    Arc<dashmap::DashMap<(String, String), tokio::sync::oneshot::Sender<String>>>;

// ── AcpSessionSetupRequest ───────────────────────────────────────────────────

/// Discriminates between creating a new ACP session and loading an existing one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AcpSessionSetupRequest {
    New(NewSessionRequest),
    Load(LoadSessionRequest),
}

// ── AcpClientScaffold ───────────────────────────────────────────────────────

/// Minimal ACP client scaffold for the services layer.
///
/// Handles process lifecycle: spawn adapter, initialize ACP protocol, set up
/// session, run prompt turn or session probe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcpClientScaffold {
    adapter: AcpAdapterCommand,
}

const ACP_ADAPTER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

impl AcpClientScaffold {
    #[must_use]
    pub fn new(adapter: AcpAdapterCommand) -> Self {
        Self { adapter }
    }

    #[must_use]
    pub fn adapter(&self) -> &AcpAdapterCommand {
        &self.adapter
    }

    pub fn validate_adapter(&self) -> Result<(), Box<dyn std::error::Error>> {
        validate_adapter_command(&self.adapter)
    }

    /// Spawn the adapter subprocess with a clean environment (env_clear allowlist).
    pub fn spawn_adapter(&self) -> Result<tokio::process::Child, Box<dyn std::error::Error>> {
        self.validate_adapter()?;
        let mut command = tokio::process::Command::new(&self.adapter.program);
        command.args(&self.adapter.args);
        if let Some(cwd) = &self.adapter.cwd {
            command.current_dir(cwd);
        }
        // Clear all inherited env vars, then allowlist only what adapters need.
        // OPENAI_* vars are intentionally excluded — they point at Axon's local LLM
        // proxy, not at OpenAI. Adapters (Claude CLI, Codex) use their own OAuth /
        // stored API keys for authentication.
        // CLAUDECODE is excluded to prevent nested-session detection.
        command.env_clear();
        for key in &[
            "PATH",
            "HOME",
            "USER",
            "SHELL",
            "TERM",
            "LANG",
            "LC_ALL",
            "TZ",
            "TMPDIR",
            "XDG_RUNTIME_DIR",
            // TLS certificate paths for custom CA bundles
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "ANTHROPIC_API_KEY",
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
            "XDG_CACHE_HOME",
            // Gemini CLI auth and config
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
            "GOOGLE_CLOUD_PROJECT",
            "GOOGLE_CLOUD_LOCATION",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "GEMINI_CLI_HOME",
            "GEMINI_FORCE_FILE_STORAGE",
        ] {
            if let Ok(val) = std::env::var(key) {
                command.env(key, val);
            }
        }
        command.stdin(std::process::Stdio::piped());
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());
        // Ensure the child is killed if its handle is dropped without explicit
        // cleanup — covers timeout paths where the outer future is cancelled.
        command.kill_on_drop(true);
        let child = command.spawn()?;
        Ok(child)
    }

    /// Test-only variant of `spawn_adapter` that skips `validate_adapter_command`.
    ///
    /// Used by env-isolation tests that need to spawn a real shell (`sh`) to probe
    /// which env vars are passed through, without being blocked by the shell-name
    /// validator added to production code.
    /// Test-only helper: spawns the adapter without running `validate_adapter_command`.
    /// Used by env-isolation integration tests that need to spawn a real shell (e.g. `sh`)
    /// without being blocked by the shell-name validator.
    #[doc(hidden)]
    pub fn spawn_adapter_skip_validation(
        &self,
    ) -> Result<tokio::process::Child, Box<dyn std::error::Error>> {
        let mut command = tokio::process::Command::new(&self.adapter.program);
        command.args(&self.adapter.args);
        if let Some(cwd) = &self.adapter.cwd {
            command.current_dir(cwd);
        }
        command.env_clear();
        for key in &[
            "PATH",
            "HOME",
            "USER",
            "SHELL",
            "TERM",
            "LANG",
            "LC_ALL",
            "TZ",
            "TMPDIR",
            "XDG_RUNTIME_DIR",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "ANTHROPIC_API_KEY",
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
            "XDG_CACHE_HOME",
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
            "GOOGLE_CLOUD_PROJECT",
            "GOOGLE_CLOUD_LOCATION",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "GEMINI_CLI_HOME",
            "GEMINI_FORCE_FILE_STORAGE",
        ] {
            if let Ok(val) = std::env::var(key) {
                command.env(key, val);
            }
        }
        command.stdin(std::process::Stdio::piped());
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());
        command.kill_on_drop(true);
        let child = command.spawn()?;
        Ok(child)
    }

    pub fn prepare_initialize(&self) -> Result<InitializeRequest, Box<dyn std::error::Error>> {
        self.validate_adapter()?;
        Ok(InitializeRequest::new(ProtocolVersion::LATEST).client_info(
            agent_client_protocol::Implementation::new("axon", env!("CARGO_PKG_VERSION")),
        ))
    }

    pub fn prepare_session_setup(
        &self,
        req: &AcpPromptTurnRequest,
        cwd: impl AsRef<std::path::Path>,
    ) -> Result<AcpSessionSetupRequest, Box<dyn std::error::Error>> {
        self.validate_adapter()?;
        validate_prompt_turn_request(req)?;
        build_session_setup(req.session_id.as_deref(), cwd, &req.mcp_servers)
    }

    pub fn prepare_session_probe_setup(
        &self,
        req: &AcpSessionProbeRequest,
        cwd: impl AsRef<std::path::Path>,
    ) -> Result<AcpSessionSetupRequest, Box<dyn std::error::Error>> {
        self.validate_adapter()?;
        validate_probe_request(req)?;
        build_session_setup(req.session_id.as_deref(), cwd, &[])
    }

    pub async fn start_prompt_turn(
        &self,
        req: &AcpPromptTurnRequest,
        cwd: impl AsRef<std::path::Path>,
        tx: Option<mpsc::Sender<ServiceEvent>>,
        permission_responders: PermissionResponderMap,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let initialize = self.prepare_initialize()?;
        let session_setup = self.prepare_session_setup(req, cwd)?;
        emit(
            &tx,
            ServiceEvent::Log {
                level: LogLevel::Info,
                message: format!(
                    "ACP scaffold accepted prompt turn (session_id={})",
                    req.session_id.as_deref().unwrap_or("<new>")
                ),
            },
        );

        let adapter = self.adapter.clone();
        let req_owned = req.clone();

        // ACP SDK futures are !Send (uses ?Send traits), so we run on a
        // dedicated thread with its own tokio runtime + LocalSet.
        // tokio::process provides non-blocking I/O that returns Pending
        // instead of blocking (fixes the AllowStdIo deadlock root cause).
        let join = tokio::task::spawn_blocking(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|err| format!("failed to create ACP tokio runtime: {err}"))?;
            let local = tokio::task::LocalSet::new();
            local.block_on(&rt, async {
                match tokio::time::timeout(
                    ACP_ADAPTER_TIMEOUT,
                    run_prompt_turn(
                        adapter,
                        initialize,
                        session_setup,
                        req_owned,
                        tx,
                        permission_responders,
                    ),
                )
                .await
                {
                    Ok(result) => result,
                    Err(_) => Err("ACP adapter timed out after 5 minutes".into()),
                }
            })
        })
        .await
        .map_err(|err| format!("failed to join ACP runtime worker: {err}"))?;

        join.map_err(|err| err.to_string())?;
        Ok(())
    }

    pub async fn start_session_probe(
        &self,
        req: &AcpSessionProbeRequest,
        cwd: impl AsRef<std::path::Path>,
        tx: Option<mpsc::Sender<ServiceEvent>>,
        permission_responders: PermissionResponderMap,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let initialize = self.prepare_initialize()?;
        let session_setup = self.prepare_session_probe_setup(req, cwd)?;
        emit(
            &tx,
            ServiceEvent::Log {
                level: LogLevel::Info,
                message: format!(
                    "ACP scaffold accepted session probe (session_id={})",
                    req.session_id.as_deref().unwrap_or("<new>")
                ),
            },
        );

        let adapter = self.adapter.clone();
        let req_owned = req.clone();

        let join = tokio::task::spawn_blocking(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|err| format!("failed to create ACP tokio runtime: {err}"))?;
            let local = tokio::task::LocalSet::new();
            local.block_on(&rt, async {
                match tokio::time::timeout(
                    ACP_ADAPTER_TIMEOUT,
                    run_session_probe(
                        adapter,
                        initialize,
                        session_setup,
                        req_owned,
                        tx,
                        permission_responders,
                    ),
                )
                .await
                {
                    Ok(result) => result,
                    Err(_) => Err("ACP adapter timed out after 5 minutes".into()),
                }
            })
        })
        .await
        .map_err(|err| format!("failed to join ACP runtime worker: {err}"))?;

        join.map_err(|err| err.to_string())?;
        Ok(())
    }
}
