use axon_api::source::{ApiError, ErrorStage, JobId, LifecycleStatus};

pub(crate) fn validate_transition(
    job_id: JobId,
    from: LifecycleStatus,
    to: LifecycleStatus,
) -> Result<(), ApiError> {
    if from == to {
        return Ok(());
    }

    let allowed = matches!(
        (from, to),
        (LifecycleStatus::Queued, LifecycleStatus::Pending)
            | (LifecycleStatus::Queued, LifecycleStatus::Running)
            | (LifecycleStatus::Queued, LifecycleStatus::Skipped)
            | (LifecycleStatus::Pending, LifecycleStatus::Running)
            | (LifecycleStatus::Pending, LifecycleStatus::Expired)
            | (LifecycleStatus::Running, LifecycleStatus::Waiting)
            | (LifecycleStatus::Running, LifecycleStatus::Canceling)
            | (LifecycleStatus::Running, LifecycleStatus::Completed)
            | (LifecycleStatus::Running, LifecycleStatus::CompletedDegraded)
            | (LifecycleStatus::Running, LifecycleStatus::Failed)
            | (LifecycleStatus::Waiting, LifecycleStatus::Running)
            | (LifecycleStatus::Waiting, LifecycleStatus::Canceling)
            | (LifecycleStatus::Waiting, LifecycleStatus::Failed)
            | (LifecycleStatus::Canceling, LifecycleStatus::Canceled)
    );

    if allowed {
        return Ok(());
    }

    Err(ApiError::new(
        "job.invalid_transition",
        ErrorStage::Publishing,
        format!(
            "cannot transition job {} from {:?} to {:?}",
            job_id.0, from, to
        ),
    ))
}
