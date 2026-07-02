use axon_api::source::*;

pub(super) fn apply_visibility_filter(items: &mut Vec<JobEvent>, visibility: Option<Visibility>) {
    match visibility {
        Some(visibility) => items.retain(|event| event.visibility == visibility),
        None => items.retain(|event| {
            matches!(
                event.visibility,
                Visibility::Public | Visibility::Redacted | Visibility::Derived
            )
        }),
    }
}

pub(super) fn event_details(event: &SourceProgressEvent) -> MetadataMap {
    let mut details = MetadataMap::new();
    details.insert(
        "source_progress_event".to_string(),
        serde_json::to_value(event).unwrap_or(serde_json::Value::Null),
    );
    if let Some(dedupe_key) = &event.dedupe_key {
        details.insert("dedupe_key".to_string(), serde_json::json!(dedupe_key));
    }
    details
}

pub(super) fn new_job_descriptor(
    job_id: JobId,
    kind: JobKind,
    timestamp: Timestamp,
) -> JobDescriptor {
    JobDescriptor {
        job_id,
        kind,
        status: LifecycleStatus::Queued,
        poll: PollDescriptor {
            status_url: format!("/v1/jobs/{job_id}", job_id = job_id.0),
            events_url: Some(format!("/v1/jobs/{job_id}/events", job_id = job_id.0)),
            suggested_interval_ms: 1000,
        },
        created_at: timestamp.clone(),
        updated_at: timestamp,
    }
}

pub(super) fn descriptor(summary: &JobSummary) -> JobDescriptor {
    JobDescriptor {
        job_id: summary.job_id,
        kind: summary.kind,
        status: summary.status,
        poll: PollDescriptor {
            status_url: format!("/v1/jobs/{job_id}", job_id = summary.job_id.0),
            events_url: Some(format!(
                "/v1/jobs/{job_id}/events",
                job_id = summary.job_id.0
            )),
            suggested_interval_ms: 1000,
        },
        created_at: summary.created_at.clone(),
        updated_at: summary.updated_at.clone(),
    }
}

pub(super) fn empty_counts() -> StageCounts {
    StageCounts {
        items_total: None,
        items_done: 0,
        documents_total: None,
        documents_done: 0,
        chunks_total: None,
        chunks_done: 0,
        bytes_total: None,
        bytes_done: 0,
    }
}

pub(super) fn is_stale(job: &JobSummary, now: &Timestamp, older_than_seconds: Option<u64>) -> bool {
    let Some(seconds) = older_than_seconds else {
        return true;
    };
    let reference = job
        .heartbeat
        .as_ref()
        .map(|heartbeat| &heartbeat.heartbeat_at)
        .unwrap_or(&job.updated_at);
    timestamp_age_seconds(now, reference).is_some_and(|age| age >= seconds)
}

pub(super) fn capability(name: &str) -> CapabilityBase {
    CapabilityBase {
        name: name.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        owner_crate: "axon-jobs".to_string(),
        health: HealthStatus::Healthy,
        features: vec!["fake".to_string()],
        limits: MetadataMap::new(),
    }
}

pub(super) fn is_terminal_status(status: LifecycleStatus) -> bool {
    matches!(
        status,
        LifecycleStatus::Completed
            | LifecycleStatus::CompletedDegraded
            | LifecycleStatus::Failed
            | LifecycleStatus::Canceled
            | LifecycleStatus::Expired
            | LifecycleStatus::Skipped
    )
}

fn timestamp_age_seconds(now: &Timestamp, then: &Timestamp) -> Option<u64> {
    let now = chrono::DateTime::parse_from_rfc3339(&now.0).ok()?;
    let then = chrono::DateTime::parse_from_rfc3339(&then.0).ok()?;
    (now - then).num_seconds().try_into().ok()
}
