use super::task_id::task_id_for;
use crate::jobs::backend::JobKind;
use crate::jobs::status::JobStatus;
use crate::services::types::ServiceJob;
use rmcp::model::{GetTaskPayloadResult, Task, TaskStatus};
use serde_json::json;

pub(super) const TASK_POLL_INTERVAL_MS: u64 = 5_000;

pub(super) fn task_from_job(kind: JobKind, job: &ServiceJob) -> Task {
    let mut task = Task::new(
        task_id_for(kind, job.id),
        task_status(job.status_enum()),
        job.created_at.to_rfc3339(),
        job.updated_at.to_rfc3339(),
    )
    .with_poll_interval(TASK_POLL_INTERVAL_MS);

    if let Some(message) = status_message(job.status_enum()) {
        task = task.with_status_message(message);
    }
    task
}

pub(super) fn task_result_payload(kind: JobKind, job: &ServiceJob) -> GetTaskPayloadResult {
    GetTaskPayloadResult::new(json!({
        "task_id": task_id_for(kind, job.id),
        "job_id": job.id,
        "kind": super::task_id::kind_name(kind),
        "status": job.status,
        "completed": job.status_enum() == JobStatus::Completed,
        "terminal": matches!(
            job.status_enum(),
            JobStatus::Completed | JobStatus::Failed | JobStatus::Canceled
        ),
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }))
}

fn task_status(status: JobStatus) -> TaskStatus {
    match status {
        JobStatus::Pending | JobStatus::Running => TaskStatus::Working,
        JobStatus::Completed => TaskStatus::Completed,
        JobStatus::Failed => TaskStatus::Failed,
        JobStatus::Canceled => TaskStatus::Cancelled,
    }
}

fn status_message(status: JobStatus) -> Option<&'static str> {
    match status {
        JobStatus::Pending => Some("queued"),
        JobStatus::Running => Some("running"),
        JobStatus::Completed => Some("completed"),
        JobStatus::Failed => Some("failed"),
        JobStatus::Canceled => Some("cancelled"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    fn job(status: &str) -> ServiceJob {
        let now = Utc::now();
        ServiceJob {
            id: Uuid::new_v4(),
            status: status.to_string(),
            created_at: now,
            updated_at: now,
            started_at: None,
            finished_at: None,
            error_text: Some("raw error must not be exposed".to_string()),
            url: Some("https://example.com/private".to_string()),
            source_type: Some("github".to_string()),
            target: Some("secret-target".to_string()),
            urls_json: Some(json!(["https://example.com/private"])),
            result_json: Some(json!({"raw": "result"})),
            config_json: Some(json!({"token": "secret"})),
            attempt_count: 1,
            active_attempt_id: Some("attempt-1".to_string()),
            last_reclaimed_at: None,
            last_reclaimed_reason: None,
        }
    }

    #[test]
    fn maps_axon_job_statuses_to_rmcp_task_statuses() {
        let cases = [
            ("pending", TaskStatus::Working),
            ("running", TaskStatus::Working),
            ("completed", TaskStatus::Completed),
            ("failed", TaskStatus::Failed),
            ("canceled", TaskStatus::Cancelled),
        ];
        for (axon, expected) in cases {
            assert_eq!(task_from_job(JobKind::Crawl, &job(axon)).status, expected);
        }
    }

    #[test]
    fn task_result_payload_is_minimal_and_sanitized() {
        let payload = task_result_payload(JobKind::Ingest, &job("completed"));
        let value = serde_json::to_value(payload).unwrap();
        assert_eq!(value["kind"], "ingest");
        assert_eq!(value["completed"], true);
        assert!(value.get("result_json").is_none());
        assert!(value.get("config_json").is_none());
        assert!(value.get("error_text").is_none());
        assert!(value.get("target").is_none());
        assert!(value.get("url").is_none());
    }
}
