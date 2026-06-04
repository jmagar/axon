use super::AxonMcpServer;
use super::task_id::{kind_name, task_id_for};
use crate::jobs::backend::JobKind;
use crate::jobs::status::JobStatus;
use rmcp::model::{ProgressNotificationParam, ProgressToken};
use rmcp::{Peer, RoleServer};
use serde_json::Value;
use uuid::Uuid;

pub(super) const NOTIFIER_READ_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq)]
pub(super) struct MappedProgress {
    pub progress: f64,
    pub total: Option<f64>,
    pub message: &'static str,
}

impl MappedProgress {
    pub fn into_notification(self, progress_token: ProgressToken) -> ProgressNotificationParam {
        let mut param = ProgressNotificationParam::new(progress_token, self.progress)
            .with_message(self.message);
        if let Some(total) = self.total {
            param = param.with_total(total);
        }
        param
    }
}

pub(super) async fn start_progress_notifier(
    server: &AxonMcpServer,
    kind: JobKind,
    job_id: Uuid,
    progress_token: Option<ProgressToken>,
    peer: Peer<RoleServer>,
) {
    let Some(progress_token) = progress_token else {
        tracing::debug!(
            task_id = %task_id_for(kind, job_id),
            kind = kind_name(kind),
            has_progress_token = false,
            "mcp.task.progress.start"
        );
        return;
    };
    let task_id = task_id_for(kind, job_id);
    let notifier_key = format!("{task_id}:{progress_token:?}");
    let mut notifiers = server.progress_notifiers.lock().await;
    if notifiers
        .get(&notifier_key)
        .is_some_and(|handle| !handle.is_finished())
    {
        return;
    }
    if notifiers
        .get(&notifier_key)
        .is_some_and(tokio::task::JoinHandle::is_finished)
    {
        notifiers.remove(&notifier_key);
    }

    let ctx = match server.base_service_context().await {
        Ok(ctx) => ctx,
        Err(e) => {
            tracing::error!(
                task_id = %task_id,
                kind = kind_name(kind),
                error = %e,
                "mcp.task.progress.stop"
            );
            return;
        }
    };
    let jobs = ctx.jobs.clone();
    let handle = tokio::spawn(async move {
        tracing::info!(
            task_id = %task_id,
            kind = kind_name(kind),
            has_progress_token = true,
            "mcp.task.progress.start"
        );
        let mut last_fingerprint = String::new();
        loop {
            tokio::time::sleep(NOTIFIER_READ_INTERVAL).await;
            let job = match jobs.job_status(kind, job_id).await {
                Ok(Some(job)) => job,
                Ok(None) => {
                    tracing::debug!(
                        task_id = %task_id,
                        kind = kind_name(kind),
                        reason = "not_found",
                        "mcp.task.progress.stop"
                    );
                    return;
                }
                Err(e) => {
                    tracing::error!(
                        task_id = %task_id,
                        kind = kind_name(kind),
                        error = %e,
                        "mcp.task.progress.stop"
                    );
                    return;
                }
            };
            let status = job.status_enum();
            let mapped = map_job_progress(kind, status, job.result_json.as_ref());
            let fingerprint = progress_fingerprint(status, job.updated_at, &mapped);
            if fingerprint != last_fingerprint {
                last_fingerprint = fingerprint;
                let has_total = mapped.total.is_some();
                let notification = mapped.into_notification(progress_token.clone());
                tracing::debug!(
                    task_id = %task_id,
                    kind = kind_name(kind),
                    progress = notification.progress,
                    has_total,
                    status = %status.as_str(),
                    "mcp.task.progress.emit"
                );
                if peer.notify_progress(notification).await.is_err() {
                    tracing::debug!(
                        task_id = %task_id,
                        kind = kind_name(kind),
                        reason = "send_failed",
                        "mcp.task.progress.stop"
                    );
                    return;
                }
            }
            if !status.is_active() {
                tracing::debug!(
                    task_id = %task_id,
                    kind = kind_name(kind),
                    reason = "terminal",
                    "mcp.task.progress.stop"
                );
                return;
            }
        }
    });
    notifiers.insert(notifier_key, handle);
}

pub(super) fn map_job_progress(
    kind: JobKind,
    status: JobStatus,
    result_json: Option<&Value>,
) -> MappedProgress {
    match status {
        JobStatus::Pending => MappedProgress {
            progress: 0.0,
            total: None,
            message: "queued",
        },
        JobStatus::Completed => terminal("completed"),
        JobStatus::Failed => terminal("failed"),
        JobStatus::Canceled => terminal("cancelled"),
        JobStatus::Running => map_running_progress(kind, result_json),
    }
}

pub(super) fn progress_fingerprint(
    status: JobStatus,
    updated_at: chrono::DateTime<chrono::Utc>,
    mapped: &MappedProgress,
) -> String {
    format!(
        "{}:{}:{}:{:?}:{}",
        status.as_str(),
        updated_at.timestamp_millis(),
        mapped.progress,
        mapped.total,
        mapped.message
    )
}

fn terminal(message: &'static str) -> MappedProgress {
    MappedProgress {
        progress: 1.0,
        total: Some(1.0),
        message,
    }
}

fn map_running_progress(kind: JobKind, result_json: Option<&Value>) -> MappedProgress {
    let Some(value) = result_json.and_then(Value::as_object) else {
        return MappedProgress {
            progress: 0.0,
            total: None,
            message: running_message(kind),
        };
    };

    match kind {
        JobKind::Crawl => count_progress(value, "pages_crawled", "pages_discovered", "crawling")
            .unwrap_or(MappedProgress {
                progress: 0.0,
                total: None,
                message: "crawling",
            }),
        JobKind::Embed => count_progress(value, "docs_embedded", "docs_total", "embedding")
            .unwrap_or(MappedProgress {
                progress: 0.0,
                total: None,
                message: "embedding",
            }),
        JobKind::Extract => MappedProgress {
            progress: 0.0,
            total: None,
            message: "running",
        },
        JobKind::Ingest => {
            let message = allowlisted_phase(value.get("phase").and_then(Value::as_str));
            count_progress(value, "files_done", "files_total", message)
                .or_else(|| count_progress(value, "tasks_done", "tasks_total", message))
                .or_else(|| count_progress(value, "chunks_embedded", "chunks_total", message))
                .unwrap_or(MappedProgress {
                    progress: 0.0,
                    total: None,
                    message,
                })
        }
    }
}

fn count_progress(
    object: &serde_json::Map<String, Value>,
    done_key: &str,
    total_key: &str,
    message: &'static str,
) -> Option<MappedProgress> {
    let progress = number(object.get(done_key)?)?;
    let total = object.get(total_key).and_then(number).filter(|v| *v > 0.0);
    Some(MappedProgress {
        progress,
        total,
        message,
    })
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|v| v.is_finite() && *v >= 0.0)
}

fn running_message(kind: JobKind) -> &'static str {
    match kind {
        JobKind::Crawl => "crawling",
        JobKind::Embed => "embedding",
        JobKind::Extract => "running",
        JobKind::Ingest => "ingesting",
    }
}

fn allowlisted_phase(phase: Option<&str>) -> &'static str {
    match phase {
        Some("cloning") => "ingesting",
        Some("fetching") => "ingesting",
        Some("indexing") => "ingesting",
        Some("embedding") => "embedding",
        Some("finalizing") => "finalizing",
        Some("completed") => "completed",
        _ => "ingesting",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_crawl_progress_without_leaking_paths() {
        let value = json!({
            "output_dir": "/secret/path",
            "output_path": "/secret/path/markdown",
            "pages_crawled": 4,
            "pages_discovered": 10,
            "message": "raw worker message"
        });
        let progress = map_job_progress(JobKind::Crawl, JobStatus::Running, Some(&value));
        assert_eq!(progress.progress, 4.0);
        assert_eq!(progress.total, Some(10.0));
        assert_eq!(progress.message, "crawling");
    }

    #[test]
    fn maps_embed_progress_with_real_total() {
        let value = json!({"docs_embedded": 2, "docs_total": 5, "chunks_embedded": 50});
        let progress = map_job_progress(JobKind::Embed, JobStatus::Running, Some(&value));
        assert_eq!(progress.progress, 2.0);
        assert_eq!(progress.total, Some(5.0));
        assert_eq!(progress.message, "embedding");
    }

    #[test]
    fn maps_ingest_progress_with_allowlisted_message() {
        let value = json!({
            "phase": "cloning",
            "repo": "https://token@example.com/private/repo",
            "files_done": 7,
            "files_total": 9
        });
        let progress = map_job_progress(JobKind::Ingest, JobStatus::Running, Some(&value));
        assert_eq!(progress.progress, 7.0);
        assert_eq!(progress.total, Some(9.0));
        assert_eq!(progress.message, "ingesting");
    }

    #[test]
    fn extract_running_progress_uses_unknown_total() {
        let progress = map_job_progress(JobKind::Extract, JobStatus::Running, None);
        assert_eq!(progress.progress, 0.0);
        assert_eq!(progress.total, None);
        assert_eq!(progress.message, "running");
    }
}
