use super::SessionWatchOptions;
use super::queue::{PendingFiles, PendingState};
use super::validate::{SessionWatchRoots, ValidatedSessionPath, validate_session_file_path};
use crate::core::config::Config;
use crate::ingest::sessions::checkpoint::{
    SessionFileMetadata, checkpoint_metadata_matches, record_error, record_success,
    stream_content_hash,
};
use crate::services::context::ServiceContext;
use anyhow::{Result, anyhow};
use futures::StreamExt;
use futures::stream::FuturesUnordered;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
pub(crate) struct WatchOutputMode {
    pub(crate) json: bool,
    pub(crate) verbose_paths: bool,
}

impl WatchOutputMode {
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn quiet() -> Self {
        Self {
            json: false,
            verbose_paths: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ProcessOutcome {
    Ingested { chunks_or_job: String },
    SkippedUnchanged,
    NoContent,
    RetryableFailure(String),
}

pub(crate) fn validate_event_path(
    roots: &SessionWatchRoots,
    path: &Path,
) -> Option<ValidatedSessionPath> {
    validate_session_file_path(roots, path)
        .map_err(|err| tracing::debug!(error = %err, "ignored unsupported session watch path"))
        .ok()
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn process_session_file_for_watch(
    cfg: &Config,
    pool: &sqlx::SqlitePool,
    validated: &ValidatedSessionPath,
    output: WatchOutputMode,
) -> Result<ProcessOutcome> {
    let meta = SessionFileMetadata::from_validated_path(validated)?;
    if checkpoint_metadata_matches(pool, &meta).await? {
        emit_watch_json(output, "skipped_unchanged", validated, None);
        return Ok(ProcessOutcome::SkippedUnchanged);
    }

    match crate::ingest::sessions::collect_session_file_doc(cfg, validated).await {
        Ok(Some(session_doc)) => {
            let content_hash = stream_content_hash(&validated.canonical).await.ok();
            let _doc = crate::ingest::sessions::prepared_session_doc_from_session_doc(session_doc)
                .map_err(anyhow::Error::msg)?;
            record_success(pool, &meta, content_hash.as_deref()).await?;
            emit_watch_json(output, "prepared", validated, None);
            Ok(ProcessOutcome::Ingested {
                chunks_or_job: "prepared-session-doc".to_string(),
            })
        }
        Ok(None) => {
            record_success(pool, &meta, None).await?;
            emit_watch_json(output, "no_content", validated, None);
            Ok(ProcessOutcome::NoContent)
        }
        Err(error) => {
            let (code, redacted) = classify_and_redact_watch_error(&error.to_string());
            record_error(pool, &meta, &code, &redacted).await?;
            emit_watch_json(output, "error", validated, Some(&code));
            Ok(ProcessOutcome::RetryableFailure(code))
        }
    }
}

pub(crate) async fn process_session_batch_for_watch(
    cfg: &Config,
    service_context: &ServiceContext,
    pool: &sqlx::SqlitePool,
    paths: Vec<ValidatedSessionPath>,
    options: &SessionWatchOptions,
) -> Result<Vec<ProcessOutcome>> {
    let output = WatchOutputMode {
        json: options.json,
        verbose_paths: options.verbose_paths,
    };
    let mut outcomes = vec![None; paths.len()];
    let mut candidates = Vec::new();
    let mut prepared_meta = Vec::new();

    for (index, validated) in paths.into_iter().enumerate() {
        let meta = SessionFileMetadata::from_validated_path(&validated)?;
        if checkpoint_metadata_matches(pool, &meta).await? {
            emit_watch_json(output, "skipped_unchanged", &validated, None);
            outcomes[index] = Some(ProcessOutcome::SkippedUnchanged);
            continue;
        }
        candidates.push((index, validated, meta));
    }

    for parsed in prepare_session_docs_for_watch(cfg, candidates, options).await {
        let (index, validated, meta, parsed) = parsed;
        match parsed {
            Ok(Some(session_doc)) => {
                let doc =
                    crate::ingest::sessions::prepared_session_doc_from_session_doc(session_doc)
                        .map_err(anyhow::Error::msg)?;
                let content_hash = stream_content_hash(&validated.canonical).await.ok();
                prepared_meta.push((index, validated, meta, doc, content_hash));
            }
            Ok(None) => {
                record_success(pool, &meta, None).await?;
                emit_watch_json(output, "no_content", &validated, None);
                outcomes[index] = Some(ProcessOutcome::NoContent);
            }
            Err(error) => {
                let (code, redacted) = classify_and_redact_watch_error(&error.to_string());
                record_error(pool, &meta, &code, &redacted).await?;
                emit_watch_json(output, "error", &validated, Some(&code));
                outcomes[index] = Some(ProcessOutcome::RetryableFailure(code));
            }
        }
    }

    let collection = (cfg.collection != "axon").then(|| cfg.collection.clone());
    let batch_size = options.max_batch_docs.max(1);
    for meta_chunk in prepared_meta.chunks(batch_size) {
        let request = crate::ingest::sessions::IngestSessionsPreparedRequest {
            docs: meta_chunk
                .iter()
                .map(|(_, _, _, doc, _)| doc.clone())
                .collect(),
            project: cfg.sessions_project.clone(),
            collection: collection.clone(),
        };
        match ingest_prepared_request_for_watch(cfg, service_context, request, options).await {
            Ok(label) => {
                for (index, validated, meta, _, content_hash) in meta_chunk {
                    record_success(pool, meta, content_hash.as_deref()).await?;
                    emit_watch_json(output, "ingested", validated, Some(&label));
                    outcomes[*index] = Some(ProcessOutcome::Ingested {
                        chunks_or_job: label.clone(),
                    });
                }
            }
            Err(error) => {
                let (code, redacted) = classify_and_redact_watch_error(&error.to_string());
                for (index, validated, meta, _, _) in meta_chunk {
                    record_error(pool, meta, &code, &redacted).await?;
                    emit_watch_json(output, "error", validated, Some(&code));
                    outcomes[*index] = Some(ProcessOutcome::RetryableFailure(code.clone()));
                }
            }
        }
    }

    Ok(outcomes.into_iter().flatten().collect())
}

type ParseCandidate = (usize, ValidatedSessionPath, SessionFileMetadata);
type ParseResult = (
    usize,
    ValidatedSessionPath,
    SessionFileMetadata,
    Result<Option<crate::ingest::sessions::SessionDoc>, Box<dyn std::error::Error>>,
);

async fn prepare_session_docs_for_watch(
    cfg: &Config,
    candidates: Vec<ParseCandidate>,
    options: &SessionWatchOptions,
) -> Vec<ParseResult> {
    let permits = effective_processing_concurrency(options);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(permits));
    let mut tasks = FuturesUnordered::new();

    for (index, validated, meta) in candidates {
        let cfg = cfg.clone();
        let semaphore = Arc::clone(&semaphore);
        tasks.push(async move {
            let _permit = semaphore
                .acquire_owned()
                .await
                .expect("session watch parse semaphore closed");
            let parsed = crate::ingest::sessions::collect_session_file_doc(&cfg, &validated).await;
            (index, validated, meta, parsed)
        });
    }

    let mut parsed = Vec::new();
    while let Some(result) = tasks.next().await {
        parsed.push(result);
    }
    parsed.sort_by_key(|(index, _, _, _)| *index);
    parsed
}

pub(crate) fn effective_processing_concurrency(options: &SessionWatchOptions) -> usize {
    options.max_processing_concurrency.max(1)
}

async fn ingest_prepared_request_for_watch(
    cfg: &Config,
    _service_context: &ServiceContext,
    request: crate::ingest::sessions::IngestSessionsPreparedRequest,
    options: &SessionWatchOptions,
) -> Result<String> {
    if options.upload_to_server {
        return upload_prepared_sessions_to_server(request).await;
    }

    let outcome =
        crate::services::ingest::ingest_sessions_prepared_with_progress(cfg, request, None, None)
            .await
            .map_err(|err| anyhow!(err.to_string()))?;
    let chunks = outcome
        .payload
        .get("chunks")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    Ok(format!("prepared-session-chunks={chunks}"))
}

async fn upload_prepared_sessions_to_server(
    request: crate::ingest::sessions::IngestSessionsPreparedRequest,
) -> Result<String> {
    let base = std::env::var("AXON_SERVER_URL")
        .map_err(|_| anyhow!("AXON_SERVER_URL is required when --upload-to-server is set"))?;
    let token = std::env::var("AXON_MCP_HTTP_TOKEN")
        .map_err(|_| anyhow!("AXON_MCP_HTTP_TOKEN is required when --upload-to-server is set"))?;
    upload_prepared_sessions_to_server_with_auth(&base, &token, request).await
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn upload_prepared_sessions_to_server_with_auth(
    base: &str,
    token: &str,
    request: crate::ingest::sessions::IngestSessionsPreparedRequest,
) -> Result<String> {
    let url = reqwest::Url::parse(base)
        .map_err(|error| anyhow!("invalid AXON_SERVER_URL: {error}"))?
        .join("/v1/ingest/sessions/prepared")?;
    if url.scheme() != "https" && !url.host_str().is_some_and(is_loopback_host) {
        return Err(anyhow!(
            "--upload-to-server requires HTTPS unless AXON_SERVER_URL is loopback"
        ));
    }
    let body = serde_json::to_vec(&request)?;
    const MAX_UPLOAD_BODY_BYTES: usize = 25 * 1024 * 1024;
    if body.len() > MAX_UPLOAD_BODY_BYTES {
        return Err(anyhow!("prepared session upload body exceeds size limit"));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let response = client
        .post(url)
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!(
            "remote prepared session upload failed: status={} body={}",
            status.as_u16(),
            redact_error_detail(&text)
        ));
    }
    Ok(parse_remote_job_label(&text).unwrap_or_else(|| "remote-prepared-session-job".to_string()))
}

pub(crate) async fn process_pending(
    cfg: &Config,
    service_context: &ServiceContext,
    pool: &sqlx::SqlitePool,
    roots: &SessionWatchRoots,
    options: &SessionWatchOptions,
    pending: &mut PendingFiles,
) {
    let now = Instant::now();
    let mut stable = Vec::new();
    let mut stable_paths = Vec::new();

    for path in pending.debounced_paths(now, options.debounce) {
        match pending.stable(&path, now, options.settle) {
            Ok(PendingState::Stable) => {
                if let Some(validated) = validate_event_path(roots, &path) {
                    stable.push(validated);
                    stable_paths.push(path);
                } else {
                    pending.remove(&path);
                }
            }
            Ok(PendingState::NotReady) => {}
            Ok(PendingState::Terminal) => pending.remove(&path),
            Err(error) => {
                let detail = redact_error_detail(&error.to_string());
                tracing::warn!(detail = %detail, "session watch stability check failed");
                if !pending.requeue(path.clone(), Instant::now(), options.max_retries) {
                    pending.remove(&path);
                }
            }
        }
    }

    if stable.is_empty() {
        return;
    }

    match process_session_batch_for_watch(cfg, service_context, pool, stable, options).await {
        Ok(outcomes) => {
            for (path, outcome) in stable_paths.into_iter().zip(outcomes) {
                match outcome {
                    ProcessOutcome::RetryableFailure(detail) => {
                        if !pending.requeue(path.clone(), Instant::now(), options.max_retries) {
                            tracing::warn!(
                                detail = %redact_error_detail(&detail),
                                "session watch retry cap reached"
                            );
                            pending.remove(&path);
                        }
                    }
                    _ => pending.remove(&path),
                }
            }
        }
        Err(error) => {
            let detail = redact_error_detail(&error.to_string());
            for path in stable_paths {
                if !pending.requeue(path.clone(), Instant::now(), options.max_retries) {
                    tracing::warn!(
                        detail = %detail,
                        "session watch batch processing failed at retry cap"
                    );
                    pending.remove(&path);
                }
            }
        }
    }
}

fn parse_remote_job_label(text: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| {
            value
                .pointer("/result/job_id")
                .or_else(|| value.pointer("/job_id"))
                .and_then(|job_id| job_id.as_str())
                .map(str::to_string)
        })
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn classify_and_redact_watch_error(error: &str) -> (String, String) {
    let detail = redact_error_detail(error);
    let lower = detail.to_ascii_lowercase();
    let code = if lower.contains("timeout") {
        "timeout"
    } else if lower.contains("http") || lower.contains("status=") {
        "upload_failed"
    } else if lower.contains("parse") || lower.contains("json") {
        "parse_failed"
    } else {
        "watch_failed"
    };
    (code.to_string(), detail)
}

pub(crate) fn redact_error_detail(raw: &str) -> String {
    let mut redacted = raw
        .split_whitespace()
        .map(|part| {
            let lower = part.to_ascii_lowercase();
            if lower.starts_with("bearer")
                || lower.starts_with("sk-")
                || lower.starts_with("ghp_")
                || lower.contains("token")
                || lower.contains("api_key")
            {
                "[REDACTED]"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    const MAX_ERROR_DETAIL_CHARS: usize = 300;
    if redacted.len() > MAX_ERROR_DETAIL_CHARS {
        redacted.truncate(MAX_ERROR_DETAIL_CHARS);
        redacted.push_str("...");
    }
    redacted
}

fn emit_watch_json(
    output: WatchOutputMode,
    stage: &str,
    path: &ValidatedSessionPath,
    detail: Option<&str>,
) {
    if output.json {
        let path_value = if output.verbose_paths {
            path.canonical.display().to_string()
        } else {
            path.redacted_display.clone()
        };
        println!(
            "{}",
            serde_json::json!({
                "stage": stage,
                "provider": path.provider,
                "path_hash": path.path_hash,
                "basename": path.basename,
                "path": path_value,
                "detail": detail,
            })
        );
    }
}
