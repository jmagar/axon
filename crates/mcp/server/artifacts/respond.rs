use super::super::common::internal_error;
use super::path::build_artifact_path;
use super::shape::{clip_inline_json, json_shape_preview, line_count, sha256_hex};
use crate::crates::mcp::schema::{AxonToolResponse, ResponseMode};
use rmcp::ErrorData;
use uuid::Uuid;

pub async fn write_json_artifact(
    stem: &str,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, ErrorData> {
    let text = serde_json::to_string_pretty(payload).map_err(|e| internal_error(e.to_string()))?;
    let path = build_artifact_path(stem, "json").await?;

    // Write to a sibling temp file first, then rename atomically.
    // This ensures that if the write fails, the original file (if any) is preserved.
    let tmp_path = path.with_extension(format!("json.{}.tmp", Uuid::new_v4().simple()));
    tokio::fs::write(&tmp_path, text.as_bytes())
        .await
        .map_err(|e| internal_error(format!("failed to write artifact temp file: {e}")))?;
    tokio::fs::rename(&tmp_path, &path).await.map_err(|e| {
        // Best-effort cleanup of the temp file on rename failure.
        let tmp = tmp_path.clone();
        tokio::spawn(async move {
            let _ = tokio::fs::remove_file(tmp).await;
        });
        internal_error(format!("failed to finalize artifact file: {e}"))
    })?;

    Ok(serde_json::json!({
        "path": path,
        "bytes": text.len(),
        "line_count": line_count(&text),
        "sha256": sha256_hex(text.as_bytes()),
    }))
}

pub async fn respond_with_mode(
    action: &str,
    subaction: &str,
    mode: ResponseMode,
    artifact_stem: &str,
    payload: serde_json::Value,
) -> Result<AxonToolResponse, ErrorData> {
    // Auto-inline: if payload serializes small, skip the artifact disk write entirely.
    // Claude can read it directly without a follow-up artifacts.read call.
    // Threshold configurable via AXON_INLINE_BYTES_THRESHOLD (default: 8192).
    // Set to 0 to disable auto-inline and force path mode for all payloads.
    let payload_bytes = serde_json::to_string(&payload)
        .map(|s| s.len())
        .unwrap_or(usize::MAX);
    let threshold = std::env::var("AXON_INLINE_BYTES_THRESHOLD")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(8_192);
    if threshold > 0 && payload_bytes <= threshold {
        return Ok(AxonToolResponse::ok(
            action,
            subaction,
            serde_json::json!({
                "response_mode": "auto-inline",
                "data": payload,
            }),
        ));
    }

    // Payload is large — write artifact to disk and respond according to the requested mode.
    let artifact = write_json_artifact(artifact_stem, &payload).await?;

    let shape = json_shape_preview(&payload);
    match mode {
        ResponseMode::Path => Ok(AxonToolResponse::ok(
            action,
            subaction,
            serde_json::json!({
                "response_mode": "path",
                "shape": shape,
                "artifact": artifact,
            }),
        )),
        ResponseMode::Inline => {
            let (inline, truncated) = clip_inline_json(&payload, 12_000);
            Ok(AxonToolResponse::ok(
                action,
                subaction,
                serde_json::json!({
                    "response_mode": "inline",
                    "inline": inline,
                    "truncated": truncated,
                    "artifact": artifact,
                }),
            ))
        }
        ResponseMode::Both => {
            let (inline, truncated) = clip_inline_json(&payload, 12_000);
            Ok(AxonToolResponse::ok(
                action,
                subaction,
                serde_json::json!({
                    "response_mode": "both",
                    "inline": inline,
                    "truncated": truncated,
                    "shape": shape,
                    "artifact": artifact,
                }),
            ))
        }
    }
}
