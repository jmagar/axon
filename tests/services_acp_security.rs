//! Security regression tests for the ACP service layer.
//!
//! These tests cover fixes made in the 2026-03-08 review:
//!   - AcpSessionUpdateKind::Unknown serializes as "unknown" (not "status")
//!   - AcpSessionUpdateKind serde variants are collision-free
//!   - validate_adapter_command rejects empty/whitespace programs
//!   - validate_adapter_command accepts bare adapter names
//!   - spawn_adapter env allowlist: proxy vars are NOT passed through
//!   - spawn_adapter env allowlist: Gemini auth vars ARE passed through
#![allow(unsafe_code)]

use axon::crates::services::acp::{AcpClientScaffold, validate_adapter_command};
use axon::crates::services::types::{
    AcpAdapterCommand, AcpBridgeEvent, AcpSessionUpdateEvent, AcpSessionUpdateKind,
};
use std::sync::Mutex;

// ── AcpSessionUpdateKind serde correctness ──────────────────────────────────

#[test]
fn unknown_session_update_serializes_as_unknown_not_status() {
    let kind = AcpSessionUpdateKind::Unknown;
    let serialized = serde_json::to_string(&kind).unwrap();
    assert!(
        serialized.contains("unknown"),
        "AcpSessionUpdateKind::Unknown should serialize as 'unknown', got: {serialized}"
    );
    assert!(
        !serialized.contains("status"),
        "AcpSessionUpdateKind::Unknown must NOT serialize as 'status', got: {serialized}"
    );
}

#[test]
fn session_update_kind_serde_no_collision() {
    // Every variant must serialize to a distinct string so the frontend can
    // reliably dispatch on the wire type.
    let variants = vec![
        AcpSessionUpdateKind::UserDelta,
        AcpSessionUpdateKind::AssistantDelta,
        AcpSessionUpdateKind::ThinkingDelta,
        AcpSessionUpdateKind::ToolCallStarted,
        AcpSessionUpdateKind::ToolCallUpdated,
        AcpSessionUpdateKind::Plan,
        AcpSessionUpdateKind::AvailableCommandsUpdate,
        AcpSessionUpdateKind::CurrentModeUpdate,
        AcpSessionUpdateKind::ConfigOptionUpdate,
        AcpSessionUpdateKind::Unknown,
    ];
    let serialized: Vec<String> = variants
        .iter()
        .map(|v| serde_json::to_string(v).unwrap())
        .collect();

    for i in 0..serialized.len() {
        for j in (i + 1)..serialized.len() {
            assert_ne!(
                serialized[i], serialized[j],
                "variants[{i}] ({:?}) and variants[{j}] ({:?}) both serialize as '{}'",
                variants[i], variants[j], serialized[i]
            );
        }
    }
}

#[test]
fn unknown_session_update_display_is_unknown() {
    // Display is used by the custom AcpBridgeEvent::Serialize for the wire type.
    assert_eq!(
        AcpSessionUpdateKind::Unknown.to_string(),
        "unknown",
        "Display for Unknown must produce 'unknown'"
    );
}

// ── AcpBridgeEvent wire shape for Unknown variant ───────────────────────────

#[test]
fn acp_bridge_event_unknown_session_update_wire_type() {
    let event = AcpBridgeEvent::SessionUpdate(AcpSessionUpdateEvent {
        session_id: "sess-unknown-test".to_string(),
        kind: AcpSessionUpdateKind::Unknown,
        text_delta: None,
        tool_call_id: None,
        tool_name: None,
        tool_status: None,
        tool_content: None,
        tool_input: None,
    });

    let json = serde_json::to_value(&event).unwrap();

    // The custom Serialize impl derives `type` from `kind.to_string()`.
    // After the fix, Unknown produces "unknown" on the wire.
    assert_eq!(
        json["type"], "unknown",
        "AcpBridgeEvent wire type for Unknown variant must be 'unknown', got: {}",
        json["type"]
    );
    assert_eq!(json["session_id"], "sess-unknown-test");
}

// ── validate_adapter_command ────────────────────────────────────────────────

#[test]
fn validate_adapter_rejects_empty_program() {
    let adapter = AcpAdapterCommand {
        program: String::new(),
        args: vec![],
        cwd: None,
    };
    let err = validate_adapter_command(&adapter).expect_err("empty program should fail");
    assert!(
        err.to_string().contains("cannot be empty"),
        "error should mention empty: {err}"
    );
}

#[test]
fn validate_adapter_rejects_whitespace_only_program() {
    let adapter = AcpAdapterCommand {
        program: "   \t  ".to_string(),
        args: vec!["--stdio".to_string()],
        cwd: None,
    };
    let err = validate_adapter_command(&adapter).expect_err("whitespace-only program should fail");
    assert!(
        err.to_string().contains("cannot be empty"),
        "error should mention empty: {err}"
    );
}

#[test]
fn validate_adapter_accepts_bare_adapter_name() {
    // A bare name like "claude" should pass validation even if it doesn't exist
    // on this system — validation only checks for empty/whitespace.
    let adapter = AcpAdapterCommand {
        program: "claude".to_string(),
        args: vec!["--stdio".to_string()],
        cwd: None,
    };
    validate_adapter_command(&adapter).expect("bare adapter name should pass validation");
}

#[test]
fn validate_adapter_accepts_absolute_path() {
    // Absolute paths pass validation regardless of whether the file exists.
    let adapter = AcpAdapterCommand {
        program: "/usr/bin/claude-agent-acp".to_string(),
        args: vec![],
        cwd: None,
    };
    validate_adapter_command(&adapter).expect("absolute path should pass validation");
}

// ── spawn_adapter env isolation ─────────────────────────────────────────────

/// Global lock: env var mutation is not thread-safe; serialize env-touching tests.
static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Proxy vars (HTTP_PROXY, HTTPS_PROXY, etc.) must NOT leak into adapter subprocesses.
/// The adapter connects directly to its own API endpoints; proxy vars would break auth.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn spawn_adapter_does_not_pass_proxy_vars() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    const PROXY_VARS: &[&str] = &[
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "http_proxy",
        "https_proxy",
        "NO_PROXY",
        "no_proxy",
    ];
    const SENTINEL: &str = "http://poison-proxy.test:9999";

    // SAFETY: ENV_LOCK is held; no concurrent env mutation.
    unsafe {
        for v in PROXY_VARS {
            std::env::set_var(v, SENTINEL);
        }
    }

    // Build a probe that prints the concatenated values of all proxy vars.
    let args_inner = PROXY_VARS
        .iter()
        .map(|v| format!("\"${v}\""))
        .collect::<Vec<_>>()
        .join("");
    let cmd = format!("printf '%s' {args_inner}");

    let adapter = AcpAdapterCommand {
        program: "sh".to_string(),
        args: vec!["-c".to_string(), cmd],
        cwd: None,
    };
    let scaffold = AcpClientScaffold::new(adapter);
    let child = scaffold
        .spawn_adapter()
        .expect("spawn_adapter should succeed");
    let output = child
        .wait_with_output()
        .await
        .expect("child should complete");
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // SAFETY: ENV_LOCK is held.
    unsafe {
        for v in PROXY_VARS {
            std::env::remove_var(v);
        }
    }

    assert!(
        stdout.is_empty(),
        "proxy vars must NOT be passed through to adapter subprocess \
         (env_clear allowlist should exclude them), but child saw: {stdout:?}"
    );
}

/// CLAUDECODE must not leak through the env_clear allowlist.
/// This is the same test as in services_acp_spawn_env.rs but validates via
/// the env_clear+allowlist approach rather than env_remove.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn spawn_adapter_does_not_pass_claudecode() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    // SAFETY: ENV_LOCK is held.
    unsafe {
        std::env::set_var("CLAUDECODE", "poison_nested_session");
    }

    let adapter = AcpAdapterCommand {
        program: "sh".to_string(),
        args: vec!["-c".to_string(), "printf '%s' \"$CLAUDECODE\"".to_string()],
        cwd: None,
    };
    let scaffold = AcpClientScaffold::new(adapter);
    let child = scaffold
        .spawn_adapter()
        .expect("spawn_adapter should succeed");
    let output = child
        .wait_with_output()
        .await
        .expect("child should complete");
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // SAFETY: ENV_LOCK is held.
    unsafe {
        std::env::remove_var("CLAUDECODE");
    }

    assert!(
        stdout.is_empty(),
        "CLAUDECODE must not be in env_clear allowlist, but child saw: {stdout:?}"
    );
}

/// PATH must be passed through so the adapter can find its own binary.
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn spawn_adapter_passes_through_path() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    let adapter = AcpAdapterCommand {
        program: "sh".to_string(),
        args: vec!["-c".to_string(), "printf '%s' \"$PATH\"".to_string()],
        cwd: None,
    };
    let scaffold = AcpClientScaffold::new(adapter);
    let child = scaffold
        .spawn_adapter()
        .expect("spawn_adapter should succeed");
    let output = child
        .wait_with_output()
        .await
        .expect("child should complete");
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    assert!(
        !stdout.is_empty(),
        "PATH must be in env_clear allowlist so adapter can find executables"
    );
}
