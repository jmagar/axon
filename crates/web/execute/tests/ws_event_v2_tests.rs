use super::handle_command;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};

#[tokio::test]
async fn command_start_emits_v2_schema_with_ctx() {
    let (tx, mut rx) = mpsc::channel::<String>(16);
    let crawl_job_id = Arc::new(Mutex::new(None));

    handle_command("doctor", "health-check", &json!({}), tx, crawl_job_id).await;

    let first_message = rx
        .recv()
        .await
        .expect("expected first websocket message from handle_command");
    let parsed: Value =
        serde_json::from_str(&first_message).expect("first websocket message must be valid json");

    assert_eq!(
        parsed.get("type").and_then(Value::as_str),
        Some("command.start"),
        "v2 requires dot-delimited event type"
    );

    let ctx = parsed
        .get("data")
        .and_then(|data| data.get("ctx"))
        .expect("v2 requires data.ctx object");

    assert!(
        ctx.get("exec_id")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty()),
        "v2 requires non-empty data.ctx.exec_id"
    );
    assert_eq!(
        ctx.get("mode").and_then(Value::as_str),
        Some("doctor"),
        "v2 requires data.ctx.mode"
    );
    assert_eq!(
        ctx.get("input").and_then(Value::as_str),
        Some("health-check"),
        "v2 requires data.ctx.input"
    );
}
