//! ACP (Agent Communication Protocol) types — session setup, bridge events,
//! update kinds, permission requests, and config options.

// ── Session setup / adapter ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcpAdapterCommand {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcpPromptTurnRequest {
    pub session_id: Option<String>,
    pub prompt: Vec<String>,
    /// Model config option value to set after session setup (if agent supports it).
    pub model: Option<String>,
    /// MCP servers to pass through to the ACP agent session.
    pub mcp_servers: Vec<AcpMcpServerConfig>,
}

/// MCP server configuration passed through to ACP NewSessionRequest.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "transport", rename_all = "snake_case")]
pub enum AcpMcpServerConfig {
    Stdio {
        name: String,
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: Vec<(String, String)>,
    },
    Http {
        name: String,
        url: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcpSessionProbeRequest {
    pub session_id: Option<String>,
    /// Optional model config option value to apply during probe.
    pub model: Option<String>,
}

// ── Config options ───────────────────────────────────────────────────────────

/// A single selectable value within an ACP config option.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpConfigSelectValue {
    pub value: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// An ACP session config option (model selector, mode selector, etc.).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpConfigOption {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub current_value: String,
    pub options: Vec<AcpConfigSelectValue>,
}

// ── Session update kind ──────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum AcpSessionUpdateKind {
    #[serde(rename = "user_delta")]
    UserDelta,
    #[serde(rename = "assistant_delta")]
    AssistantDelta,
    #[serde(rename = "thinking_content")]
    ThinkingDelta,
    #[serde(rename = "tool_use")]
    ToolCallStarted,
    #[serde(rename = "tool_use_update")]
    ToolCallUpdated,
    /// Intercepted by `AcpBridgeEvent::PlanUpdate` custom serialization — never
    /// reaches the `AcpSessionUpdateKind` serde path directly.
    #[serde(rename = "plan")]
    Plan,
    /// Intercepted by `AcpBridgeEvent::CommandsUpdate` custom serialization.
    #[serde(rename = "available_commands_update")]
    AvailableCommandsUpdate,
    /// Intercepted by `AcpBridgeEvent::ModeUpdate` custom serialization.
    #[serde(rename = "current_mode_update")]
    CurrentModeUpdate,
    /// Intercepted by `AcpBridgeEvent::ConfigOptionsUpdate` custom serialization.
    #[serde(rename = "config_option_update")]
    ConfigOptionUpdate,
    /// Catch-all for unrecognized ACP protocol events. Serialized as `"unknown"`
    /// so it is distinguishable on the wire (previously collided with `"status"`).
    #[serde(rename = "unknown")]
    Unknown,
}

impl std::fmt::Display for AcpSessionUpdateKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UserDelta => write!(f, "user_delta"),
            Self::AssistantDelta => write!(f, "assistant_delta"),
            Self::ThinkingDelta => write!(f, "thinking_content"),
            Self::ToolCallStarted => write!(f, "tool_use"),
            Self::ToolCallUpdated => write!(f, "tool_use_update"),
            // These four are intercepted by AcpBridgeEvent's custom Serialize
            // impl and routed to dedicated wire types (plan_update, commands_update,
            // mode_update, config_options_update). The Display value here is only
            // used if the event falls through to the SessionUpdate serialization
            // path — which means the AcpBridgeEvent dispatch didn't match it.
            // In that case, "status" is the correct legacy wire type.
            Self::Plan => write!(f, "status"),
            Self::AvailableCommandsUpdate => write!(f, "status"),
            Self::CurrentModeUpdate => write!(f, "status"),
            Self::ConfigOptionUpdate => write!(f, "status"),
            Self::Unknown => write!(f, "unknown"),
        }
    }
}

// ── Session update event ─────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct AcpSessionUpdateEvent {
    pub session_id: String,
    pub kind: AcpSessionUpdateKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_status: Option<String>,
    /// Text content produced by the tool call (extracted from ToolCallContent::Content).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_content: Option<String>,
    /// Raw JSON input to the tool call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<serde_json::Value>,
}

// ── Permission request ───────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct AcpPermissionRequestEvent {
    pub session_id: String,
    pub tool_call_id: String,
    /// Serialized as `"options"` on the wire to match existing frontend expectations.
    #[serde(rename = "options")]
    pub option_ids: Vec<String>,
}

// ── Turn result ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct AcpTurnResultEvent {
    pub session_id: String,
    pub stop_reason: String,
    pub result: String,
}

// ── Plan / mode / commands updates ───────────────────────────────────────────

/// ACP plan forwarded from the agent's Plan session update.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPlanEntry {
    pub content: String,
    pub priority: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpPlanUpdate {
    pub session_id: String,
    pub entries: Vec<AcpPlanEntry>,
}

/// Current mode changed notification from the ACP agent.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpModeUpdate {
    pub session_id: String,
    pub current_mode_id: String,
}

/// Available slash-commands changed notification from the ACP agent.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpAvailableCommand {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpCommandsUpdate {
    pub session_id: String,
    pub commands: Vec<AcpAvailableCommand>,
}

// ── Bridge event (top-level enum) ────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AcpBridgeEvent {
    SessionUpdate(AcpSessionUpdateEvent),
    PermissionRequest(AcpPermissionRequestEvent),
    TurnResult(AcpTurnResultEvent),
    ConfigOptionsUpdate(Vec<AcpConfigOption>),
    PlanUpdate(AcpPlanUpdate),
    ModeUpdate(AcpModeUpdate),
    CommandsUpdate(AcpCommandsUpdate),
    SessionFallback {
        old_session_id: String,
        new_session_id: String,
    },
}

impl serde::Serialize for AcpBridgeEvent {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        match self {
            Self::SessionUpdate(update) => {
                // SEC-6: Log unknown ACP session update events so they don't silently vanish.
                if update.kind == AcpSessionUpdateKind::Unknown {
                    log::warn!(
                        "received unknown ACP session update kind, forwarding as 'unknown': {:?}",
                        update
                    );
                }
                // The wire type is derived from `kind` (e.g. "assistant_delta", "thinking_content").
                let event_type = update.kind.to_string();
                // "thinking_content" uses `content` as the text key; everything else uses `delta`.
                let text_key = if event_type == "thinking_content" {
                    "content"
                } else {
                    "delta"
                };
                let text_val = update.text_delta.clone().unwrap_or_default();

                let mut map = serializer.serialize_map(None)?;
                map.serialize_entry("type", &event_type)?;
                map.serialize_entry("session_id", &update.session_id)?;
                map.serialize_entry("tool_call_id", &update.tool_call_id)?;
                map.serialize_entry(text_key, &text_val)?;
                if let Some(ref name) = update.tool_name {
                    map.serialize_entry("tool_name", name)?;
                }
                if let Some(ref status) = update.tool_status {
                    map.serialize_entry("tool_status", status)?;
                }
                if let Some(ref content) = update.tool_content {
                    map.serialize_entry("tool_content", content)?;
                }
                if let Some(ref input) = update.tool_input {
                    map.serialize_entry("tool_input", input)?;
                }
                map.end()
            }
            Self::PermissionRequest(req) => {
                let mut map = serializer.serialize_map(None)?;
                map.serialize_entry("type", "permission_request")?;
                map.serialize_entry("session_id", &req.session_id)?;
                map.serialize_entry("tool_call_id", &req.tool_call_id)?;
                map.serialize_entry("options", &req.option_ids)?;
                map.end()
            }
            Self::TurnResult(result) => {
                let mut map = serializer.serialize_map(None)?;
                map.serialize_entry("type", "result")?;
                map.serialize_entry("session_id", &result.session_id)?;
                map.serialize_entry("stop_reason", &result.stop_reason)?;
                map.serialize_entry("result", &result.result)?;
                map.end()
            }
            Self::ConfigOptionsUpdate(options) => {
                let mut map = serializer.serialize_map(None)?;
                map.serialize_entry("type", "config_options_update")?;
                map.serialize_entry("configOptions", options)?;
                map.end()
            }
            Self::PlanUpdate(plan) => {
                let mut map = serializer.serialize_map(None)?;
                map.serialize_entry("type", "plan_update")?;
                map.serialize_entry("session_id", &plan.session_id)?;
                map.serialize_entry("entries", &plan.entries)?;
                map.end()
            }
            Self::ModeUpdate(mode) => {
                let mut map = serializer.serialize_map(None)?;
                map.serialize_entry("type", "mode_update")?;
                map.serialize_entry("session_id", &mode.session_id)?;
                map.serialize_entry("currentModeId", &mode.current_mode_id)?;
                map.end()
            }
            Self::CommandsUpdate(cmds) => {
                let mut map = serializer.serialize_map(None)?;
                map.serialize_entry("type", "commands_update")?;
                map.serialize_entry("session_id", &cmds.session_id)?;
                map.serialize_entry("commands", &cmds.commands)?;
                map.end()
            }
            Self::SessionFallback {
                old_session_id,
                new_session_id,
            } => {
                let mut map = serializer.serialize_map(None)?;
                map.serialize_entry("type", "session_fallback")?;
                map.serialize_entry("old_session_id", old_session_id)?;
                map.serialize_entry("new_session_id", new_session_id)?;
                map.end()
            }
        }
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    // ── AcpBridgeEvent::SessionUpdate (assistant_delta) ───────────────────────

    #[test]
    fn acpbridgeevent_assistant_delta_wire_shape() {
        let event = AcpBridgeEvent::SessionUpdate(AcpSessionUpdateEvent {
            session_id: "s1".to_string(),
            kind: AcpSessionUpdateKind::AssistantDelta,
            text_delta: Some("hello".to_string()),
            tool_call_id: None,
            tool_name: None,
            tool_status: None,
            tool_content: None,
            tool_input: None,
        });
        let v: Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["type"], "assistant_delta");
        assert_eq!(v["delta"], "hello");
        // assistant_delta must NOT use the "content" key for its text
        assert!(
            v.get("content").is_none(),
            "assistant_delta must not have a 'content' key"
        );
        assert_eq!(v["session_id"], "s1");
    }

    // ── AcpBridgeEvent::SessionUpdate (thinking_content) ─────────────────────

    #[test]
    fn acpbridgeevent_thinking_content_wire_shape() {
        let event = AcpBridgeEvent::SessionUpdate(AcpSessionUpdateEvent {
            session_id: "s2".to_string(),
            kind: AcpSessionUpdateKind::ThinkingDelta,
            text_delta: Some("thought".to_string()),
            tool_call_id: None,
            tool_name: None,
            tool_status: None,
            tool_content: None,
            tool_input: None,
        });
        let v: Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["type"], "thinking_content");
        // thinking_content uses "content", NOT "delta"
        assert_eq!(v["content"], "thought");
        assert!(
            v.get("delta").is_none(),
            "thinking_content must not have a 'delta' key"
        );
    }

    // ── AcpBridgeEvent::PermissionRequest ─────────────────────────────────────

    #[test]
    fn acpbridgeevent_permission_request_wire_shape() {
        let event = AcpBridgeEvent::PermissionRequest(AcpPermissionRequestEvent {
            session_id: "s3".to_string(),
            tool_call_id: "tc1".to_string(),
            option_ids: vec!["allow".to_string(), "deny".to_string()],
        });
        let v: Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["type"], "permission_request");
        assert!(v["options"].is_array(), "'options' must be an array");
        assert_eq!(v["options"].as_array().unwrap().len(), 2);
    }

    // ── AcpBridgeEvent::TurnResult ────────────────────────────────────────────

    #[test]
    fn acpbridgeevent_turn_result_wire_shape() {
        let event = AcpBridgeEvent::TurnResult(AcpTurnResultEvent {
            session_id: "s4".to_string(),
            stop_reason: "end_turn".to_string(),
            result: "done".to_string(),
        });
        let v: Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["type"], "result");
        assert!(
            v.get("stop_reason").is_some(),
            "'stop_reason' must be present"
        );
        assert_eq!(v["stop_reason"], "end_turn");
    }

    // ── AcpBridgeEvent::ConfigOptionsUpdate ───────────────────────────────────

    #[test]
    fn acpbridgeevent_config_options_update_wire_shape() {
        let opt = AcpConfigOption {
            id: "model".to_string(),
            name: "Model".to_string(),
            description: None,
            category: None,
            current_value: "claude-3-5-sonnet".to_string(),
            options: vec![AcpConfigSelectValue {
                value: "claude-3-5-sonnet".to_string(),
                name: "Claude 3.5 Sonnet".to_string(),
                description: None,
            }],
        };
        let event = AcpBridgeEvent::ConfigOptionsUpdate(vec![opt]);
        let v: Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["type"], "config_options_update");
        // The key must be camelCase "configOptions" per the custom Serialize impl
        assert!(
            v.get("configOptions").is_some(),
            "key must be 'configOptions' (camelCase)"
        );
        assert!(v["configOptions"].is_array());
    }

    // ── AcpBridgeEvent::SessionFallback ───────────────────────────────────────

    #[test]
    fn acpbridgeevent_session_fallback_wire_shape() {
        let event = AcpBridgeEvent::SessionFallback {
            old_session_id: "old-123".to_string(),
            new_session_id: "new-456".to_string(),
        };
        let v: Value = serde_json::to_value(&event).unwrap();
        assert_eq!(v["type"], "session_fallback");
        assert_eq!(v["old_session_id"], "old-123");
        assert_eq!(v["new_session_id"], "new-456");
    }

    // ── AcpSessionUpdateKind Display ─────────────────────────────────────────

    #[test]
    fn acpsessionupdatekind_display_status_variants() {
        // These four variants display as "status" (they are intercepted by the
        // custom AcpBridgeEvent Serialize impl and never reach the wire via the
        // SessionUpdate path in practice).
        let status_variants = [
            AcpSessionUpdateKind::Plan,
            AcpSessionUpdateKind::AvailableCommandsUpdate,
            AcpSessionUpdateKind::CurrentModeUpdate,
            AcpSessionUpdateKind::ConfigOptionUpdate,
        ];
        for kind in &status_variants {
            assert_eq!(
                kind.to_string(),
                "status",
                "{kind:?} Display must produce \"status\""
            );
        }
        // Unknown now displays as "unknown" (H-3/A-4 fix: disambiguated from "status")
        assert_eq!(
            AcpSessionUpdateKind::Unknown.to_string(),
            "unknown",
            "Unknown Display must produce \"unknown\""
        );
        // Sanity-check the non-status variants
        assert_eq!(AcpSessionUpdateKind::UserDelta.to_string(), "user_delta");
        assert_eq!(
            AcpSessionUpdateKind::AssistantDelta.to_string(),
            "assistant_delta"
        );
        assert_eq!(
            AcpSessionUpdateKind::ThinkingDelta.to_string(),
            "thinking_content"
        );
        assert_eq!(
            AcpSessionUpdateKind::ToolCallStarted.to_string(),
            "tool_use"
        );
        assert_eq!(
            AcpSessionUpdateKind::ToolCallUpdated.to_string(),
            "tool_use_update"
        );
    }
}
