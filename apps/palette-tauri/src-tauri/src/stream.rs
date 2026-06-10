use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::{merged_settings, normalize_server_url};

/// Maximum allowed size (in bytes) for a single SSE line.
///
/// A rogue or misconfigured server could send an unbounded stream of bytes
/// without a newline, growing the in-memory `pending` buffer without limit.
/// This cap returns an error rather than allowing OOM growth.
const MAX_SSE_LINE_BYTES: usize = 1024 * 1024; // 1 MiB

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PaletteStreamRequest {
    #[serde(default, rename = "baseUrl")]
    _base_url: Option<String>,
    #[serde(default, rename = "token")]
    _token: Option<String>,
    request_id: String,
    path: String,
    body: serde_json::Value,
}

#[derive(Debug, Serialize, Clone)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum PaletteStreamEvent {
    Started {
        request_id: String,
        path: String,
    },
    Delta {
        request_id: String,
        text: String,
    },
    Done {
        request_id: String,
        answer: Option<String>,
    },
    Error {
        request_id: String,
        message: String,
    },
}

#[tauri::command]
pub(crate) async fn axon_http_stream_request(
    app: AppHandle,
    window: tauri::Window,
    request: PaletteStreamRequest,
) -> Result<(), String> {
    if !matches!(request.path.as_str(), "/v1/ask/stream" | "/v1/chat/stream") {
        return Err("stream request path is not an allowed Axon API route".to_string());
    }
    let settings = merged_settings(&app)?;
    let base_url = validate_saved_server_url(&settings.server_url)?;
    let url = format!("{}{}", base_url.trim_end_matches('/'), request.path);
    window
        .emit(
            "palette://stream",
            PaletteStreamEvent::Started {
                request_id: request.request_id.clone(),
                path: request.path.clone(),
            },
        )
        .map_err(|err| err.to_string())?;

    // Use connect_timeout rather than a total-stream timeout so long RAG
    // responses are not cut off at an arbitrary wall-clock limit.
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .user_agent(concat!("Axon Palette/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|err| err.to_string())?;
    let mut builder = client
        .post(url)
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .json(&request.body);
    if let Some(token) = settings
        .token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        builder = builder.bearer_auth(token).header("x-api-key", token);
    }

    let response = builder.send().await.map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("stream request failed with HTTP {status}: {text}"));
    }

    let mut pending = Vec::new();
    let mut terminal = false;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|err| err.to_string())?;
        for line in drain_sse_lines(&mut pending, &chunk)? {
            terminal |= handle_palette_sse_line(&window, &request.request_id, &line)?;
        }
    }
    if !pending.is_empty() {
        let line = decode_sse_line(std::mem::take(&mut pending))?;
        if !line.trim().is_empty() {
            terminal |= handle_palette_sse_line(&window, &request.request_id, &line)?;
        }
    }
    if !terminal {
        let message = "stream ended before done".to_string();
        let _ = window.emit(
            "palette://stream",
            PaletteStreamEvent::Error {
                request_id: request.request_id,
                message: message.clone(),
            },
        );
        return Err(message);
    }
    Ok(())
}

fn validate_saved_server_url(server_url: &str) -> Result<String, String> {
    let server_url = normalize_server_url(server_url);
    let parsed =
        reqwest::Url::parse(&server_url).map_err(|_| "saved Axon server URL is invalid")?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("saved Axon server URL must use http or https".to_string());
    }
    if parsed.host_str().is_none()
        || !matches!(parsed.path(), "" | "/")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("saved Axon server URL must be an origin URL".to_string());
    }
    Ok(server_url.trim_end_matches('/').to_string())
}

fn drain_sse_lines(pending: &mut Vec<u8>, chunk: &[u8]) -> Result<Vec<String>, String> {
    pending.extend_from_slice(chunk);
    if pending.len() > MAX_SSE_LINE_BYTES && !pending.contains(&b'\n') {
        return Err(format!(
            "SSE line exceeded {MAX_SSE_LINE_BYTES} bytes without a newline — \
             refusing to buffer further"
        ));
    }
    let mut lines = Vec::new();
    while let Some(pos) = pending.iter().position(|byte| *byte == b'\n') {
        if pos > MAX_SSE_LINE_BYTES {
            return Err(format!(
                "SSE line of {pos} bytes exceeds the {MAX_SSE_LINE_BYTES}-byte limit"
            ));
        }
        let raw: Vec<u8> = pending.drain(..=pos).collect();
        lines.push(decode_sse_line(raw)?);
    }
    Ok(lines)
}

fn decode_sse_line(mut raw: Vec<u8>) -> Result<String, String> {
    if raw.last() == Some(&b'\n') {
        raw.pop();
    }
    if raw.last() == Some(&b'\r') {
        raw.pop();
    }
    String::from_utf8(raw).map_err(|err| format!("invalid UTF-8 in SSE stream: {err}"))
}

fn parse_sse_data_line(line: &str) -> Option<String> {
    line.strip_prefix("data:")
        .map(|value| value.trim().to_string())
}

fn handle_palette_sse_line(
    window: &tauri::Window,
    request_id: &str,
    line: &str,
) -> Result<bool, String> {
    let Some(data) = parse_sse_data_line(line) else {
        return Ok(false);
    };
    let value: serde_json::Value = serde_json::from_str(&data).map_err(|err| err.to_string())?;
    match value.get("type").and_then(|kind| kind.as_str()) {
        Some("delta") => {
            let text = value
                .get("text")
                .and_then(|text| text.as_str())
                .unwrap_or_default();
            window
                .emit(
                    "palette://stream",
                    PaletteStreamEvent::Delta {
                        request_id: request_id.to_string(),
                        text: text.to_string(),
                    },
                )
                .map_err(|err| err.to_string())?;
            Ok(false)
        }
        Some("done") => {
            let answer = value
                .get("answer")
                .and_then(|answer| answer.as_str())
                .map(str::to_string);
            window
                .emit(
                    "palette://stream",
                    PaletteStreamEvent::Done {
                        request_id: request_id.to_string(),
                        answer,
                    },
                )
                .map_err(|err| err.to_string())?;
            Ok(true)
        }
        Some("error") => {
            let message = value
                .get("message")
                .and_then(|message| message.as_str())
                .unwrap_or("stream error")
                .to_string();
            window
                .emit(
                    "palette://stream",
                    PaletteStreamEvent::Error {
                        request_id: request_id.to_string(),
                        message,
                    },
                )
                .map_err(|err| err.to_string())?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

#[cfg(test)]
#[path = "stream_tests.rs"]
mod stream_tests;
