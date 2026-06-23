//! `From<*Job>` conversions into the transport-neutral `axon_api::ServiceJob`.
//!
//! These live here (not in `axon-api`) because the source job types are local
//! to `axon-jobs`; the orphan rule permits `impl From<LocalJob> for ServiceJob`
//! here, and this keeps `axon-api` free of any dependency on the job structs.

use axon_api::service_job::ServiceJob;

impl From<crate::jobs::crawl::CrawlJob> for ServiceJob {
    fn from(job: crate::jobs::crawl::CrawlJob) -> Self {
        Self {
            id: job.id,
            status: job.status,
            created_at: job.created_at,
            updated_at: job.updated_at,
            started_at: job.started_at,
            finished_at: job.finished_at,
            error_text: job.error_text,
            url: Some(job.url),
            source_type: None,
            target: None,
            urls_json: None,
            progress_json: None,
            result_json: job.result_json,
            config_json: None,
            attempt_count: 0,
            active_attempt_id: None,
            last_reclaimed_at: None,
            last_reclaimed_reason: None,
        }
    }
}

impl From<crate::jobs::embed::EmbedJob> for ServiceJob {
    fn from(job: crate::jobs::embed::EmbedJob) -> Self {
        Self {
            id: job.id,
            status: job.status,
            created_at: job.created_at,
            updated_at: job.updated_at,
            started_at: job.started_at,
            finished_at: job.finished_at,
            error_text: job.error_text,
            url: None,
            source_type: None,
            target: Some(job.input_text),
            urls_json: None,
            progress_json: None,
            result_json: job.result_json,
            config_json: Some(job.config_json),
            attempt_count: 0,
            active_attempt_id: None,
            last_reclaimed_at: None,
            last_reclaimed_reason: None,
        }
    }
}

impl From<crate::jobs::extract::ExtractJob> for ServiceJob {
    fn from(job: crate::jobs::extract::ExtractJob) -> Self {
        Self {
            id: job.id,
            status: job.status,
            created_at: job.created_at,
            updated_at: job.updated_at,
            started_at: job.started_at,
            finished_at: job.finished_at,
            error_text: job.error_text,
            url: None,
            source_type: None,
            target: None,
            urls_json: Some(job.urls_json),
            progress_json: None,
            result_json: job.result_json,
            config_json: None,
            attempt_count: 0,
            active_attempt_id: None,
            last_reclaimed_at: None,
            last_reclaimed_reason: None,
        }
    }
}

impl From<crate::jobs::ingest::IngestJob> for ServiceJob {
    fn from(job: crate::jobs::ingest::IngestJob) -> Self {
        Self {
            id: job.id,
            status: job.status,
            created_at: job.created_at,
            updated_at: job.updated_at,
            started_at: job.started_at,
            finished_at: job.finished_at,
            error_text: job.error_text,
            url: None,
            source_type: Some(job.source_type),
            target: Some(job.target),
            urls_json: None,
            progress_json: None,
            result_json: job.result_json,
            config_json: Some(job.config_json),
            attempt_count: 0,
            active_attempt_id: None,
            last_reclaimed_at: None,
            last_reclaimed_reason: None,
        }
    }
}
