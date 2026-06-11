use super::SessionWatchOptions;
use super::queue::{PendingFiles, PendingState};
use super::targets::provider_allowed;
use super::validate::{SessionWatchRoots, ValidatedSessionPath, validate_session_file_path};
use crate::core::config::Config;
use crate::ingest::sessions::checkpoint::{
    SessionFileMetadata, checkpoint_metadata_matches, record_error, record_no_content,
    record_remote_accepted, record_success, stream_content_hash,
};
use crate::services::context::ServiceContext;
use anyhow::{Result, anyhow};
use futures::StreamExt;
use futures::stream::FuturesUnordered;
use sha2::Digest;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
pub(crate) struct WatchOutputMode {
    pub(crate) json: bool,
    pub(crate) verbose_paths: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ProcessOutcome {
    Ingested { chunks_or_job: String },
    RemoteAccepted { job: String },
    SkippedUnchanged,
    SkippedFiltered,
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
                if cfg.sessions_project.is_some() {
                    emit_watch_json(output, "skipped_filtered", &validated, None);
                    outcomes[index] = Some(ProcessOutcome::SkippedFiltered);
                } else {
                    record_no_content(pool, &meta).await?;
                    emit_watch_json(output, "no_content", &validated, None);
                    outcomes[index] = Some(ProcessOutcome::NoContent);
                }
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
            Ok(WatchIngestResult::Completed(label)) => {
                for (index, validated, meta, _, content_hash) in meta_chunk {
                    record_success(pool, meta, content_hash.as_deref()).await?;
                    emit_watch_json(output, "ingested", validated, Some(&label));
                    outcomes[*index] = Some(ProcessOutcome::Ingested {
                        chunks_or_job: label.clone(),
                    });
                }
            }
            Ok(WatchIngestResult::RemoteAccepted(label)) => {
                for (index, validated, meta, _, content_hash) in meta_chunk {
                    record_remote_accepted(pool, meta, content_hash.as_deref(), &label).await?;
                    emit_watch_json(output, "accepted_remote", validated, Some(&label));
                    outcomes[*index] = Some(ProcessOutcome::RemoteAccepted { job: label.clone() });
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
            let _permit = match semaphore.acquire_owned().await {
                Ok(permit) => permit,
                Err(error) => return (index, validated, meta, Err(error.into())),
            };
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

enum WatchIngestResult {
    Completed(String),
    RemoteAccepted(String),
}

async fn ingest_prepared_request_for_watch(
    cfg: &Config,
    _service_context: &ServiceContext,
    request: crate::ingest::sessions::IngestSessionsPreparedRequest,
    options: &SessionWatchOptions,
) -> Result<WatchIngestResult> {
    if options.upload_to_server {
        return upload_prepared_sessions_to_server(request, options)
            .await
            .map(WatchIngestResult::RemoteAccepted);
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
    Ok(WatchIngestResult::Completed(format!(
        "prepared-session-chunks={chunks}"
    )))
}

async fn upload_prepared_sessions_to_server(
    request: crate::ingest::sessions::IngestSessionsPreparedRequest,
    options: &SessionWatchOptions,
) -> Result<String> {
    let base = options
        .upload_server_url
        .clone()
        .map(Ok)
        .unwrap_or_else(|| std::env::var("AXON_SERVER_URL"))
        .map_err(|_| anyhow!("AXON_SERVER_URL is required when --upload-to-server is set"))?;
    let token = options
        .upload_token
        .clone()
        .map(Ok)
        .unwrap_or_else(|| std::env::var("AXON_MCP_HTTP_TOKEN"))
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
    let body = serde_json::to_vec(&redact_remote_prepared_request(request))?;
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
    let text = response
        .text()
        .await
        .map_err(|error| anyhow!("remote prepared session upload response read failed: {error}"))?;
    if !status.is_success() {
        return Err(anyhow!(
            "remote prepared session upload failed: status={} body={}",
            status.as_u16(),
            redact_error_detail(&text)
        ));
    }
    if status != reqwest::StatusCode::ACCEPTED {
        return Err(anyhow!(
            "remote prepared session upload did not return 202 Accepted: status={} body={}",
            status.as_u16(),
            redact_error_detail(&text)
        ));
    }
    parse_remote_job_label(&text)
        .ok_or_else(|| anyhow!("remote prepared session upload response missing job_id"))
}

pub(crate) fn redact_remote_prepared_request(
    request: crate::ingest::sessions::IngestSessionsPreparedRequest,
) -> crate::ingest::sessions::IngestSessionsPreparedRequest {
    crate::ingest::sessions::IngestSessionsPreparedRequest {
        docs: request
            .docs
            .into_iter()
            .map(redact_remote_prepared_doc)
            .collect(),
        project: request.project,
        collection: request.collection,
    }
}

fn redact_remote_prepared_doc(
    mut doc: crate::ingest::sessions::PreparedSessionDoc,
) -> crate::ingest::sessions::PreparedSessionDoc {
    let mut hasher = sha2::Sha256::new();
    Digest::update(&mut hasher, doc.url.as_bytes());
    Digest::update(&mut hasher, doc.session_file.as_bytes());
    let digest = hex::encode(Digest::finalize(hasher));
    let basename = Path::new(&doc.session_file)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("session")
        .to_string();
    doc.url = format!(
        "file:///redacted/{}/{}/{}",
        doc.session_platform,
        &digest[..16],
        basename
    );
    doc.session_file = basename;
    doc.extra = redact_remote_extra(doc.extra);
    doc
}

fn redact_remote_extra(extra: serde_json::Value) -> serde_json::Value {
    let Some(mut object) = extra.as_object().cloned() else {
        return serde_json::Value::Object(serde_json::Map::new());
    };
    for key in [
        "cwd",
        "path",
        "project_path",
        "session_file",
        "source_path",
        "transcript_path",
        "workspace",
        "workspace_path",
    ] {
        object.remove(key);
    }
    serde_json::Value::Object(object)
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
                if let Some(validated) = validate_event_path(roots, &path)
                    && provider_allowed(cfg, validated.provider)
                {
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
    let mut redacted = redact_local_paths(raw)
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

fn redact_local_paths(raw: &str) -> String {
    let mut redacted = raw.to_string();
    if let Some(home) = std::env::var_os("HOME").and_then(|value| value.into_string().ok())
        && home.len() > 1
    {
        redacted = redacted.replace(&home, "[REDACTED-HOME]");
    }
    for root in [
        crate::ingest::sessions::expand_home("~/.claude/projects"),
        crate::ingest::sessions::expand_home("~/.codex/sessions"),
        crate::ingest::sessions::expand_home("~/.gemini/history"),
        crate::ingest::sessions::expand_home("~/.gemini/tmp"),
    ] {
        let root = root.display().to_string();
        if root.len() > 1 {
            redacted = redacted.replace(&root, "[REDACTED-SESSION-ROOT]");
        }
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
