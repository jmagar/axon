use super::events::{CommandContext, WsEventV2};
use crate::crates::services::events::EditorOperation;
use crate::crates::services::types::{
    AcpBridgeEvent, AcpPermissionRequestEvent, AcpSessionUpdateEvent, AcpSessionUpdateKind,
    AcpTurnResultEvent,
};
use serde_json::Value;

fn sample_ctx() -> CommandContext {
    CommandContext {
        exec_id: "exec-123".to_string(),
        mode: "crawl".to_string(),
        input: "https://example.com".to_string(),
    }
}

#[test]
fn acp_session_update_maps_to_stream_friendly_output_json_payload() {
    let payload = super::events::acp_bridge_event_payload(&AcpBridgeEvent::SessionUpdate(
        AcpSessionUpdateEvent {
            session_id: "session-123".to_string(),
            kind: AcpSessionUpdateKind::AssistantDelta,
            text_delta: Some("hello".to_string()),
            tool_call_id: None,
            tool_name: None,
            tool_status: None,
            tool_content: None,
            tool_input: None,
        },
    ));

    let event = WsEventV2::CommandOutputJson {
        ctx: sample_ctx(),
        data: payload,
    };
    let serialized = serde_json::to_value(event).expect("event should serialize");

    assert_eq!(
        serialized.get("type").and_then(Value::as_str),
        Some("command.output.json")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("data"))
            .and_then(|data| data.get("type"))
            .and_then(Value::as_str),
        Some("assistant_delta")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("data"))
            .and_then(|data| data.get("delta"))
            .and_then(Value::as_str),
        Some("hello")
    );
}

#[test]
fn acp_permission_request_maps_to_stream_friendly_output_json_payload() {
    let payload = super::events::acp_bridge_event_payload(&AcpBridgeEvent::PermissionRequest(
        AcpPermissionRequestEvent {
            session_id: "session-123".to_string(),
            tool_call_id: "tool-9".to_string(),
            option_ids: vec!["allow_once".to_string(), "deny".to_string()],
        },
    ));

    let event = WsEventV2::CommandOutputJson {
        ctx: sample_ctx(),
        data: payload,
    };
    let serialized = serde_json::to_value(event).expect("event should serialize");

    assert_eq!(
        serialized.get("type").and_then(Value::as_str),
        Some("command.output.json")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("data"))
            .and_then(|data| data.get("type"))
            .and_then(Value::as_str),
        Some("permission_request")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("data"))
            .and_then(|data| data.get("tool_call_id"))
            .and_then(Value::as_str),
        Some("tool-9")
    );
}

#[test]
fn acp_turn_result_maps_to_stream_friendly_output_json_payload() {
    let payload =
        super::events::acp_bridge_event_payload(&AcpBridgeEvent::TurnResult(AcpTurnResultEvent {
            session_id: "session-xyz".to_string(),
            stop_reason: "end_turn".to_string(),
            result: "{\"text\":\"hello\",\"operations\":[]}".to_string(),
        }));

    let event = WsEventV2::CommandOutputJson {
        ctx: sample_ctx(),
        data: payload,
    };
    let serialized = serde_json::to_value(event).expect("event should serialize");

    assert_eq!(
        serialized.get("type").and_then(Value::as_str),
        Some("command.output.json")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("data"))
            .and_then(|data| data.get("type"))
            .and_then(Value::as_str),
        Some("result")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("data"))
            .and_then(|data| data.get("session_id"))
            .and_then(Value::as_str),
        Some("session-xyz")
    );
}

// ── Security regression: Unknown variant wire type in WS event pipeline ─────

#[test]
fn acp_unknown_session_update_serializes_as_unknown_wire_type_in_ws_event() {
    let payload = super::events::acp_bridge_event_payload(&AcpBridgeEvent::SessionUpdate(
        AcpSessionUpdateEvent {
            session_id: "session-unknown-ws".to_string(),
            kind: AcpSessionUpdateKind::Unknown,
            text_delta: None,
            tool_call_id: None,
            tool_name: None,
            tool_status: None,
            tool_content: None,
            tool_input: None,
        },
    ));

    let event = WsEventV2::CommandOutputJson {
        ctx: sample_ctx(),
        data: payload,
    };
    let serialized = serde_json::to_value(event).expect("event should serialize");

    assert_eq!(
        serialized.get("type").and_then(Value::as_str),
        Some("command.output.json")
    );
    // The inner ACP payload type must be "unknown" (not "status").
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("data"))
            .and_then(|data| data.get("type"))
            .and_then(Value::as_str),
        Some("unknown"),
        "Unknown ACP session update must produce 'unknown' wire type, not 'status'"
    );
}

#[test]
fn acp_bridge_event_payload_does_not_silently_fail() {
    // Verify the serialization helper produces valid JSON for all event types,
    // not the error placeholder. This covers the fix for L-2 (silent failure).
    let events: Vec<AcpBridgeEvent> = vec![
        AcpBridgeEvent::SessionUpdate(AcpSessionUpdateEvent {
            session_id: "s".to_string(),
            kind: AcpSessionUpdateKind::AssistantDelta,
            text_delta: Some("hi".to_string()),
            tool_call_id: None,
            tool_name: None,
            tool_status: None,
            tool_content: None,
            tool_input: None,
        }),
        AcpBridgeEvent::SessionUpdate(AcpSessionUpdateEvent {
            session_id: "s".to_string(),
            kind: AcpSessionUpdateKind::Unknown,
            text_delta: None,
            tool_call_id: None,
            tool_name: None,
            tool_status: None,
            tool_content: None,
            tool_input: None,
        }),
        AcpBridgeEvent::TurnResult(AcpTurnResultEvent {
            session_id: "s".to_string(),
            stop_reason: "end_turn".to_string(),
            result: "done".to_string(),
        }),
        AcpBridgeEvent::PermissionRequest(AcpPermissionRequestEvent {
            session_id: "s".to_string(),
            tool_call_id: "t".to_string(),
            option_ids: vec!["allow".to_string()],
        }),
    ];

    for event in &events {
        let payload = super::events::acp_bridge_event_payload(event);
        assert!(
            payload.get("error").is_none(),
            "acp_bridge_event_payload should not produce error placeholder for {event:?}, \
             got: {payload}"
        );
        assert!(
            payload.get("type").is_some(),
            "acp_bridge_event_payload must produce a 'type' field for {event:?}"
        );
    }
}

// ── Gap 1: editor_update WS shape ────────────────────────────────────────────

/// Regression test for `ServiceEvent::EditorWrite` → `editor_update` WS message.
///
/// `pulse_chat.rs` emits the `editor_update` JSON directly via
/// `serialize_raw_output_event` (not through `acp_bridge_event_payload`).
/// This test verifies the exact JSON shape that the frontend receives.
#[test]
fn acp_editor_write_produces_editor_update_ws_message() {
    // Build the exact same JSON structure that pulse_chat.rs produces for
    // ServiceEvent::EditorWrite (see pulse_chat.rs:65-69).
    let data = serde_json::json!({
        "type": "editor_update",
        "content": "# Hello",
        "operation": EditorOperation::Replace,
    });

    let event = WsEventV2::CommandOutputJson {
        ctx: sample_ctx(),
        data,
    };
    let serialized = serde_json::to_value(event).expect("event should serialize");

    assert_eq!(
        serialized.get("type").and_then(Value::as_str),
        Some("command.output.json"),
        "outer envelope type must be 'command.output.json'"
    );

    let inner = serialized.get("data").and_then(|d| d.get("data"));

    assert_eq!(
        inner.and_then(|d| d.get("type")).and_then(Value::as_str),
        Some("editor_update"),
        "inner data.type must be 'editor_update'"
    );
    assert_eq!(
        inner.and_then(|d| d.get("content")).and_then(Value::as_str),
        Some("# Hello"),
        "inner data.content must match"
    );
    assert_eq!(
        inner
            .and_then(|d| d.get("operation"))
            .and_then(Value::as_str),
        Some("replace"),
        "inner data.operation must serialize as 'replace' for EditorOperation::Replace"
    );
}

/// Verify `EditorOperation::Append` serializes as `"append"` in the WS envelope.
#[test]
fn acp_editor_write_append_operation_serializes_correctly() {
    let data = serde_json::json!({
        "type": "editor_update",
        "content": "## Appendix",
        "operation": EditorOperation::Append,
    });
    let event = WsEventV2::CommandOutputJson {
        ctx: sample_ctx(),
        data,
    };
    let serialized = serde_json::to_value(event).expect("event should serialize");
    let inner = serialized.get("data").and_then(|d| d.get("data"));
    assert_eq!(
        inner
            .and_then(|d| d.get("operation"))
            .and_then(Value::as_str),
        Some("append"),
        "EditorOperation::Append must serialize as 'append'"
    );
}

// ── Gap 4: session_fallback WS pipeline ──────────────────────────────────────

/// Regression test for `AcpBridgeEvent::SessionFallback` through the WS pipeline.
///
/// The wire shape is tested in `services_acp_bridge_event_serialize.rs`; this test
/// adds the full WS envelope wrapping path that was previously uncovered.
#[test]
fn acp_session_fallback_in_ws_pipeline() {
    let payload = super::events::acp_bridge_event_payload(&AcpBridgeEvent::SessionFallback {
        old_session_id: "old-session-id".to_string(),
        new_session_id: "new-session-id".to_string(),
    });

    let event = WsEventV2::CommandOutputJson {
        ctx: sample_ctx(),
        data: payload,
    };
    let serialized = serde_json::to_value(event).expect("event should serialize");

    assert_eq!(
        serialized.get("type").and_then(Value::as_str),
        Some("command.output.json"),
        "outer envelope type must be 'command.output.json'"
    );

    let inner = serialized.get("data").and_then(|d| d.get("data"));

    assert_eq!(
        inner.and_then(|d| d.get("type")).and_then(Value::as_str),
        Some("session_fallback"),
        "inner data.type must be 'session_fallback'"
    );
    assert_eq!(
        inner
            .and_then(|d| d.get("old_session_id"))
            .and_then(Value::as_str),
        Some("old-session-id"),
        "old_session_id must round-trip through WS envelope"
    );
    assert_eq!(
        inner
            .and_then(|d| d.get("new_session_id"))
            .and_then(Value::as_str),
        Some("new-session-id"),
        "new_session_id must round-trip through WS envelope"
    );
}

// ── Step 7: insta snapshot for EditorWrite WS output ─────────────────────────

/// Snapshot test for the exact JSON the frontend receives for an `editor_update`.
///
/// Any change to the wire format requires running `cargo insta review` and
/// consciously approving the diff — prevents silent protocol drift.
#[test]
fn editor_write_dispatch_snapshot() {
    let json_val = serde_json::json!({
        "type": "editor_update",
        "content": "# Hello",
        "operation": EditorOperation::Replace,
    });
    insta::assert_json_snapshot!(json_val, @r##"
    {
      "content": "# Hello",
      "operation": "replace",
      "type": "editor_update"
    }
    "##);
}
