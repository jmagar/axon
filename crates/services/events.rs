use crate::crates::services::types::AcpBridgeEvent;
use serde::Serialize;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

impl std::fmt::Display for LogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Info => write!(f, "info"),
            Self::Warn => write!(f, "warn"),
            Self::Error => write!(f, "error"),
        }
    }
}

impl From<&str> for LogLevel {
    fn from(s: &str) -> Self {
        match s {
            "warn" | "warning" => Self::Warn,
            "error" => Self::Error,
            _ => Self::Info,
        }
    }
}

impl From<String> for LogLevel {
    fn from(s: String) -> Self {
        Self::from(s.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceEvent {
    Log { level: LogLevel, message: String },
    AcpBridge { event: AcpBridgeEvent },
}

pub fn emit(tx: &Option<mpsc::Sender<ServiceEvent>>, event: ServiceEvent) {
    if let Some(sender) = tx
        && sender.try_send(event).is_err()
    {
        eprintln!("[acp] event channel full — dropping event");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── LogLevel::from(&str) ──────────────────────────────────────────────────

    #[test]
    fn log_level_from_str_warn_variants() {
        assert_eq!(LogLevel::from("warn"), LogLevel::Warn);
        assert_eq!(LogLevel::from("warning"), LogLevel::Warn);
    }

    #[test]
    fn log_level_from_str_error() {
        assert_eq!(LogLevel::from("error"), LogLevel::Error);
    }

    #[test]
    fn log_level_from_str_info() {
        assert_eq!(LogLevel::from("info"), LogLevel::Info);
    }

    /// Anything not explicitly matched ("debug", "trace", uppercase) falls
    /// through to the `_` arm which returns `Info` — the default variant.
    #[test]
    fn log_level_from_str_unknown_defaults_to_info() {
        assert_eq!(LogLevel::from("debug"), LogLevel::Info);
        assert_eq!(LogLevel::from("trace"), LogLevel::Info);
        // Case-sensitive: "WARN" does not match the "warn" arm.
        assert_eq!(LogLevel::from("WARN"), LogLevel::Info);
    }

    #[test]
    fn log_level_from_str_empty_defaults() {
        assert_eq!(LogLevel::from(""), LogLevel::Info);
    }

    // ── Display round-trips ───────────────────────────────────────────────────

    #[test]
    fn log_level_display_round_trips() {
        assert_eq!(format!("{}", LogLevel::Info), "info");
        assert_eq!(format!("{}", LogLevel::Warn), "warn");
        assert_eq!(format!("{}", LogLevel::Error), "error");
    }

    // ── emit() ────────────────────────────────────────────────────────────────

    fn make_log_event(msg: &str) -> ServiceEvent {
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: msg.to_string(),
        }
    }

    #[test]
    fn emit_delivers_event_when_channel_has_room() {
        let (tx, mut rx) = mpsc::channel::<ServiceEvent>(4);
        let sender_opt = Some(tx);
        emit(&sender_opt, make_log_event("hello"));
        // try_recv() is synchronous — no async runtime required.
        let received = rx.try_recv().expect("event should have been delivered");
        assert_eq!(received, make_log_event("hello"));
    }

    #[test]
    fn emit_with_none_sender_does_not_panic() {
        // Passing None must not panic; the event is silently discarded.
        emit(&None, make_log_event("ignored"));
    }

    #[test]
    fn emit_full_channel_does_not_panic() {
        // Capacity of 1: fill the slot first, then verify a second emit is
        // dropped silently rather than panicking.
        let (tx, _rx) = mpsc::channel::<ServiceEvent>(1);
        let sender_opt = Some(tx);
        emit(&sender_opt, make_log_event("first"));
        // Channel is now full; second emit should not panic.
        emit(&sender_opt, make_log_event("dropped"));
    }
}
