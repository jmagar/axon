//! ACP session helper functions for the runtime layer.
//!
//! Extracted from `runtime.rs` to respect the 500-line monolith limit.
//! Contains: process spawn/IO wiring, connection initialization, session
//! setup dispatch, and config-option/model-config application.

use crate::crates::services::events::{LogLevel, ServiceEvent, emit};
use crate::crates::services::types::AcpAdapterCommand;
use crate::crates::services::types::AcpBridgeEvent;
use agent_client_protocol::{
    Agent, ClientSideConnection, InitializeRequest, NewSessionRequest, SessionConfigKind,
    SessionConfigOptionCategory, SessionId, SetSessionConfigOptionRequest,
};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::compat::TokioAsyncReadCompatExt;
use tokio_util::compat::TokioAsyncWriteCompatExt;

use super::adapters::normalized_requested_model;
use super::bridge::{AcpBridgeClient, AcpRuntimeState, resolve_acp_auto_approve};
use super::config::{read_codex_cached_model_options, read_gemini_cached_model_options};
use super::mapping::{map_config_options, select_options_contains_value};
use super::runtime::AdapterGuard;
use super::{AcpClientScaffold, AcpSessionSetupRequest, PermissionResponderMap};

// ── SpawnedAdapter ───────────────────────────────────────────────────────────

/// Intermediate result of spawning the adapter process and wiring up I/O.
pub(super) struct SpawnedAdapter {
    pub(super) stdin: tokio::process::ChildStdin,
    pub(super) stdout: tokio::process::ChildStdout,
    pub(super) exit_rx: tokio::sync::oneshot::Receiver<String>,
}

// ── spawn_adapter_with_io ────────────────────────────────────────────────────

/// Spawn the adapter subprocess, wire up stderr logging and the exit watcher.
pub(super) fn spawn_adapter_with_io(
    adapter: AcpAdapterCommand,
    tx: &Option<mpsc::Sender<ServiceEvent>>,
) -> Result<SpawnedAdapter, String> {
    let scaffold = AcpClientScaffold::new(adapter);
    let child = scaffold
        .spawn_adapter()
        .map_err(|err| format!("failed to spawn ACP adapter: {err}"))?;
    let mut guard = AdapterGuard::new(child);

    let inner = guard.0.as_mut().ok_or("adapter guard empty")?;
    let child_stdin = inner
        .stdin
        .take()
        .ok_or_else(|| "ACP adapter stdin unavailable".to_string())?;
    let child_stdout = inner
        .stdout
        .take()
        .ok_or_else(|| "ACP adapter stdout unavailable".to_string())?;
    let child_stderr = inner
        .stderr
        .take()
        .ok_or_else(|| "ACP adapter stderr unavailable".to_string())?;

    // Spawn stderr reader.
    let stderr_tx = tx.clone();
    tokio::task::spawn_local(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut reader = BufReader::new(child_stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    emit(
                        &stderr_tx,
                        ServiceEvent::Log {
                            level: LogLevel::Warn,
                            message: format!("ACP adapter stderr: {trimmed}"),
                        },
                    );
                }
            }
        }
    });

    // Disarm guard — hand child to exit watcher.
    let mut child = guard.take().ok_or("adapter guard empty after stdio take")?;
    let (exit_tx, exit_rx) = tokio::sync::oneshot::channel::<String>();
    tokio::task::spawn_local(async move {
        match child.wait().await {
            Ok(status) if !status.success() => {
                let _ = exit_tx.send(format!("ACP adapter exited with {status}"));
            }
            Err(err) => {
                let _ = exit_tx.send(format!("ACP adapter wait failed: {err}"));
            }
            Ok(_) => {
                // Clean exit (code 0): drop the sender so the receiver sees
                // a closed channel rather than an empty message.  This lets
                // `run_prompt_turn` distinguish a clean shutdown (Err variant
                // from a dropped channel) from a crash (Ok(non-empty msg)).
                drop(exit_tx);
            }
        }
    });

    Ok(SpawnedAdapter {
        stdin: child_stdin,
        stdout: child_stdout,
        exit_rx,
    })
}

// ── initialize_connection ────────────────────────────────────────────────────

/// Wire up the ACP bridge client, create the `ClientSideConnection`, and send
/// the initialize request.
pub(super) async fn initialize_connection(
    spawned: SpawnedAdapter,
    initialize: InitializeRequest,
    tx: &Option<mpsc::Sender<ServiceEvent>>,
    permission_responders: &PermissionResponderMap,
) -> Result<
    (
        ClientSideConnection,
        Arc<AcpRuntimeState>,
        tokio::sync::oneshot::Receiver<String>,
    ),
    String,
> {
    // FINDING-2: RefCell is intentionally !Send — safe because this code runs
    // exclusively on a current_thread tokio runtime inside a LocalSet.
    #[expect(clippy::arc_with_non_send_sync)]
    let runtime_state = Arc::new(AcpRuntimeState::default());
    let auto_approve = resolve_acp_auto_approve();
    let bridge = AcpBridgeClient {
        runtime_state: runtime_state.clone(),
        auto_approve,
        permission_responders: permission_responders.clone(),
    };

    emit(
        tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: format!(
                "ACP runtime: transport ready, starting initialize (auto_approve={auto_approve})"
            ),
        },
    );

    let compat_stdin = spawned.stdin.compat_write();
    let compat_stdout = spawned.stdout.compat();

    let (conn, io_task) =
        ClientSideConnection::new(bridge, compat_stdin, compat_stdout, move |task| {
            tokio::task::spawn_local(task);
        });

    let io_tx = tx.clone();
    tokio::task::spawn_local(async move {
        match io_task.await {
            Ok(()) => emit(
                &io_tx,
                ServiceEvent::Log {
                    level: LogLevel::Info,
                    message: "ACP runtime: IO task completed".to_string(),
                },
            ),
            Err(err) => emit(
                &io_tx,
                ServiceEvent::Log {
                    level: LogLevel::Warn,
                    message: format!("ACP runtime: IO task failed: {err}"),
                },
            ),
        }
    });

    emit(
        tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: "ACP runtime: sending initialize request".to_string(),
        },
    );
    let resp = conn
        .initialize(initialize)
        .await
        .map_err(|err| err.to_string())?;
    emit(
        tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: format!("ACP initialized with protocol {}", resp.protocol_version),
        },
    );

    Ok((conn, runtime_state, spawned.exit_rx))
}

// ── setup_session ────────────────────────────────────────────────────────────

/// Dispatch the session setup request (new or load-with-fallback).
pub(super) async fn setup_session(
    conn: &ClientSideConnection,
    session_setup: AcpSessionSetupRequest,
    tx: &Option<mpsc::Sender<ServiceEvent>>,
) -> Result<
    (
        SessionId,
        Option<Vec<agent_client_protocol::SessionConfigOption>>,
    ),
    String,
> {
    match session_setup {
        AcpSessionSetupRequest::New(new_session) => {
            emit(
                tx,
                ServiceEvent::Log {
                    level: LogLevel::Info,
                    message: "ACP runtime: creating new session".to_string(),
                },
            );
            let r = conn
                .new_session(new_session)
                .await
                .map_err(|e| e.to_string())?;
            Ok((r.session_id, r.config_options))
        }
        AcpSessionSetupRequest::Load(load_session) => {
            emit(
                tx,
                ServiceEvent::Log {
                    level: LogLevel::Info,
                    message: "ACP runtime: loading existing session".to_string(),
                },
            );
            let requested_id = load_session.session_id.clone();
            let fallback_cwd = load_session.cwd.clone();
            match conn.load_session(load_session).await {
                Ok(r) => Ok((requested_id, r.config_options)),
                Err(err) => {
                    emit(
                        tx,
                        ServiceEvent::Log {
                            level: LogLevel::Warn,
                            message: format!("ACP load_session failed, falling back: {err}"),
                        },
                    );
                    let r = conn
                        .new_session(NewSessionRequest::new(fallback_cwd))
                        .await
                        .map_err(|e| e.to_string())?;
                    emit(
                        tx,
                        ServiceEvent::AcpBridge {
                            event: AcpBridgeEvent::SessionFallback {
                                old_session_id: requested_id.0.to_string(),
                                new_session_id: r.session_id.0.to_string(),
                            },
                        },
                    );
                    Ok((r.session_id, r.config_options))
                }
            }
        }
    }
}

// ── apply_config_and_model ───────────────────────────────────────────────────

/// Emit config options from the session setup response, then apply the
/// requested model config override if one was specified.
pub(super) async fn apply_config_and_model(
    conn: &ClientSideConnection,
    session_id: &SessionId,
    initial_config_options: Option<Vec<agent_client_protocol::SessionConfigOption>>,
    model: Option<&str>,
    codex_adapter: bool,
    gemini_adapter: bool,
    tx: &Option<mpsc::Sender<ServiceEvent>>,
) -> Result<(), String> {
    let mapped = initial_config_options
        .as_ref()
        .map(|o| map_config_options(o));
    let sid = session_id.0.to_string();
    if let Some(ref opts) = mapped
        && !opts.is_empty()
    {
        emit(
            tx,
            ServiceEvent::AcpBridge {
                event: AcpBridgeEvent::ConfigOptionsUpdate {
                    session_id: sid.clone(),
                    config_options: opts.clone(),
                },
            },
        );
    } else if codex_adapter {
        if let Some(fb) = read_codex_cached_model_options(model).await {
            emit(
                tx,
                ServiceEvent::AcpBridge {
                    event: AcpBridgeEvent::ConfigOptionsUpdate {
                        session_id: sid.clone(),
                        config_options: fb,
                    },
                },
            );
        }
    } else if gemini_adapter && let Some(fb) = read_gemini_cached_model_options(model).await {
        emit(
            tx,
            ServiceEvent::AcpBridge {
                event: AcpBridgeEvent::ConfigOptionsUpdate {
                    session_id: sid.clone(),
                    config_options: fb,
                },
            },
        );
    }

    if let Some(req_model) = normalized_requested_model(model)
        && let Some(ref opts) = initial_config_options
    {
        apply_model_config(conn, session_id, opts, req_model, model, tx).await?;
    }

    Ok(())
}

/// Apply a model config option if the requested model is in the allowed values.
async fn apply_model_config(
    conn: &ClientSideConnection,
    session_id: &SessionId,
    config_options: &[agent_client_protocol::SessionConfigOption],
    requested_model: String,
    model: Option<&str>,
    tx: &Option<mpsc::Sender<ServiceEvent>>,
) -> Result<(), String> {
    let model_config = config_options.iter().find(|opt| {
        opt.category
            .as_ref()
            .is_some_and(|c| matches!(c, SessionConfigOptionCategory::Model))
    });
    let Some(model_config) = model_config else {
        return Ok(());
    };

    let value_allowed = match &model_config.kind {
        SessionConfigKind::Select(select) => {
            select_options_contains_value(&select.options, &requested_model)
        }
        _ => false,
    };

    if value_allowed {
        emit(
            tx,
            ServiceEvent::Log {
                level: LogLevel::Info,
                message: format!("ACP runtime: setting model to {requested_model}"),
            },
        );
        let set_resp = conn
            .set_session_config_option(SetSessionConfigOptionRequest::new(
                session_id.clone(),
                model_config.id.clone(),
                requested_model,
            ))
            .await
            .map_err(|err| format!("failed to set ACP model config: {err}"))?;
        let updated = map_config_options(&set_resp.config_options);
        if !updated.is_empty() {
            emit(
                tx,
                ServiceEvent::AcpBridge {
                    event: AcpBridgeEvent::ConfigOptionsUpdate {
                        session_id: session_id.0.to_string(),
                        config_options: updated,
                    },
                },
            );
        }
    } else {
        emit(
            tx,
            ServiceEvent::Log {
                level: LogLevel::Warn,
                message: format!(
                    "ACP runtime: skipping unsupported model value '{}'",
                    normalized_requested_model(model).unwrap_or_default()
                ),
            },
        );
    }

    Ok(())
}
