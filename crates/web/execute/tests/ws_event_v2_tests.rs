use super::events::{
    ArtifactEntry, CommandContext, JobProgressPayload, JobStatusPayload, WsEventV2,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn sample_ctx() -> CommandContext {
    CommandContext {
        exec_id: "exec-123".to_string(),
        mode: "crawl".to_string(),
        input: "https://example.com".to_string(),
    }
}

#[test]
fn command_start_serializes_v2_schema_with_ctx() {
    let event = WsEventV2::CommandStart { ctx: sample_ctx() };
    let serialized = serde_json::to_value(event).expect("event should serialize");

    assert_eq!(
        serialized.get("type").and_then(Value::as_str),
        Some("command.start")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("ctx"))
            .and_then(|ctx| ctx.get("exec_id"))
            .and_then(Value::as_str),
        Some("exec-123")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("ctx"))
            .and_then(|ctx| ctx.get("mode"))
            .and_then(Value::as_str),
        Some("crawl")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("ctx"))
            .and_then(|ctx| ctx.get("input"))
            .and_then(Value::as_str),
        Some("https://example.com")
    );
}

#[test]
fn job_status_serializes_v2_schema_with_optional_fields() {
    let mut metrics = BTreeMap::new();
    metrics.insert("pages_crawled".to_string(), json!(2));
    metrics.insert("thin_pages".to_string(), json!(0));

    let event = WsEventV2::JobStatus {
        ctx: sample_ctx(),
        payload: JobStatusPayload {
            status: "running".to_string(),
            error: Some("none".to_string()),
            metrics: Some(metrics),
        },
    };
    let serialized = serde_json::to_value(event).expect("event should serialize");

    assert_eq!(
        serialized.get("type").and_then(Value::as_str),
        Some("job.status")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("payload"))
            .and_then(|payload| payload.get("status"))
            .and_then(Value::as_str),
        Some("running")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("payload"))
            .and_then(|payload| payload.get("error"))
            .and_then(Value::as_str),
        Some("none")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("payload"))
            .and_then(|payload| payload.get("metrics"))
            .and_then(|metrics| metrics.get("pages_crawled"))
            .and_then(Value::as_i64),
        Some(2)
    );
}

#[test]
fn job_progress_serializes_v2_schema_with_counters() {
    let event = WsEventV2::JobProgress {
        ctx: sample_ctx(),
        payload: JobProgressPayload {
            phase: "fetching".to_string(),
            percent: Some(25.0),
            processed: Some(50),
            total: Some(200),
        },
    };
    let serialized = serde_json::to_value(event).expect("event should serialize");

    assert_eq!(
        serialized.get("type").and_then(Value::as_str),
        Some("job.progress")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("payload"))
            .and_then(|payload| payload.get("phase"))
            .and_then(Value::as_str),
        Some("fetching")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("payload"))
            .and_then(|payload| payload.get("percent"))
            .and_then(Value::as_f64),
        Some(25.0)
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("payload"))
            .and_then(|payload| payload.get("processed"))
            .and_then(Value::as_u64),
        Some(50)
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("payload"))
            .and_then(|payload| payload.get("total"))
            .and_then(Value::as_u64),
        Some(200)
    );
}

#[test]
fn artifact_list_serializes_v2_schema_with_artifacts_array() {
    let event = WsEventV2::ArtifactList {
        ctx: sample_ctx(),
        artifacts: vec![ArtifactEntry {
            kind: Some("screenshot".to_string()),
            path: Some("output/report.png".to_string()),
            download_url: Some("/download/job-1/file/output/report.png".to_string()),
            mime: Some("image/png".to_string()),
            size_bytes: Some(1024),
        }],
    };
    let serialized = serde_json::to_value(event).expect("event should serialize");

    assert_eq!(
        serialized.get("type").and_then(Value::as_str),
        Some("artifact.list")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("artifacts"))
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(1)
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("artifacts"))
            .and_then(Value::as_array)
            .and_then(|artifacts| artifacts.first())
            .and_then(|artifact| artifact.get("kind"))
            .and_then(Value::as_str),
        Some("screenshot")
    );
    assert_eq!(
        serialized
            .get("data")
            .and_then(|data| data.get("artifacts"))
            .and_then(Value::as_array)
            .and_then(|artifacts| artifacts.first())
            .and_then(|artifact| artifact.get("size_bytes"))
            .and_then(Value::as_u64),
        Some(1024)
    );
}
