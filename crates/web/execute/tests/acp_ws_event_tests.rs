use super::events::{CommandContext, WsEventV2};
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
