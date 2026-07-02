use axon_api::source::*;
use sqlx::Row;

use super::SqliteUnifiedJobStore;
use crate::boundary::Result;
use crate::limits::clamp_page_limit;
use crate::state_machine::validate_transition;
use crate::unified_codec::*;

impl SqliteUnifiedJobStore {
    pub(crate) async fn cancel_job(
        &self,
        job_id: JobId,
        request: JobCancelRequest,
    ) -> Result<JobCancelResult> {
        let mut tx = self.pool.begin().await.map_err(sql_error)?;
        let row = sqlx::query("SELECT status FROM jobs WHERE job_id = ?")
            .bind(job_id.0.to_string())
            .fetch_optional(&mut *tx)
            .await
            .map_err(sql_error)?
            .ok_or_else(|| missing_job(job_id))?;
        let current = parse_enum::<LifecycleStatus>(row.get::<String, _>("status"))?;
        validate_transition(job_id, current, LifecycleStatus::Canceling)?;
        let now = now_timestamp();
        sqlx::query("UPDATE jobs SET status = ?, phase = ?, updated_at = ? WHERE job_id = ?")
            .bind(enum_name(LifecycleStatus::Canceling)?)
            .bind(enum_name(PipelinePhase::Canceled)?)
            .bind(now.0.as_str())
            .bind(job_id.0.to_string())
            .execute(&mut *tx)
            .await
            .map_err(sql_error)?;
        tx.commit().await.map_err(sql_error)?;
        Ok(JobCancelResult {
            job_id,
            status: LifecycleStatus::Canceling,
            canceled_at: None,
            reason: request.reason,
        })
    }

    pub(crate) async fn retry_job(
        &self,
        job_id: JobId,
        _request: JobRetryRequest,
    ) -> Result<JobRetryResult> {
        let original = self
            .get_job(job_id)
            .await?
            .ok_or_else(|| missing_job(job_id))?;
        let attempt = original.attempt + 1;
        let retry_job = self
            .create_job(JobCreateRequest {
                job_kind: original.kind,
                job_intent: JobIntent::Retry,
                source_id: original.source_id,
                watch_id: original.watch_id,
                parent_job_id: Some(job_id),
                root_job_id: Some(original.root_job_id.unwrap_or(job_id)),
                priority: original.priority,
                idempotency_key: None,
                stage_plan: Vec::new(),
                request: None,
                metadata: MetadataMap::new(),
            })
            .await?;
        Ok(JobRetryResult {
            original_job_id: job_id,
            retry_job,
            attempt,
        })
    }

    pub(crate) async fn recover_jobs(
        &self,
        request: JobRecoveryRequest,
    ) -> Result<JobRecoveryResult> {
        let kind_filter = request.kind.map(enum_name).transpose()?;
        let cutoff = request.older_than_seconds.map(|seconds| {
            Timestamp::from(chrono::Utc::now() - chrono::Duration::seconds(seconds as i64))
        });
        let mut sql = "SELECT job_id FROM jobs WHERE status IN ('running', 'waiting')".to_string();
        append_recovery_filter(&mut sql, kind_filter.as_deref(), cutoff.as_ref());
        let mut query = sqlx::query(&sql);
        if let Some(cutoff) = cutoff.as_ref() {
            query = query.bind(cutoff.0.as_str());
        }
        let rows = query.fetch_all(&self.pool).await.map_err(sql_error)?;
        let scanned = rows.len() as u64;
        if !request.dry_run && scanned > 0 {
            self.fail_recoverable_jobs(kind_filter.as_deref(), cutoff.as_ref())
                .await?;
        }
        Ok(JobRecoveryResult {
            jobs_scanned: scanned,
            jobs_requeued: 0,
            jobs_failed: if request.dry_run { 0 } else { scanned },
            warnings: Vec::new(),
        })
    }

    pub(crate) async fn cleanup_jobs(
        &self,
        request: JobCleanupRequest,
    ) -> Result<JobCleanupResult> {
        let cutoff = request.older_than_seconds.map(|seconds| {
            Timestamp::from(chrono::Utc::now() - chrono::Duration::seconds(seconds as i64))
        });
        let mut predicate =
            "status IN ('completed', 'completed_degraded', 'failed', 'canceled', 'expired', 'skipped')"
                .to_string();
        if cutoff.is_some() {
            predicate.push_str(" AND updated_at < ?");
        }

        let jobs_pruned = count_with_optional_cutoff(
            &self.pool,
            &format!("SELECT COUNT(*) FROM jobs WHERE {predicate}"),
            cutoff.as_ref(),
        )
        .await?;
        let events_pruned = count_with_optional_cutoff(
            &self.pool,
            &format!("SELECT COUNT(*) FROM job_events WHERE job_id IN (SELECT job_id FROM jobs WHERE {predicate})"),
            cutoff.as_ref(),
        )
        .await?;
        let heartbeats_pruned = count_with_optional_cutoff(
            &self.pool,
            &format!("SELECT COUNT(*) FROM job_heartbeats WHERE job_id IN (SELECT job_id FROM jobs WHERE {predicate})"),
            cutoff.as_ref(),
        )
        .await?;
        let artifacts_pruned = count_with_optional_cutoff(
            &self.pool,
            &format!("SELECT COUNT(*) FROM job_artifacts WHERE job_id IN (SELECT job_id FROM jobs WHERE {predicate})"),
            cutoff.as_ref(),
        )
        .await?;

        if !request.dry_run && jobs_pruned > 0 {
            execute_with_optional_cutoff(
                &self.pool,
                &format!("DELETE FROM jobs WHERE {predicate}"),
                cutoff.as_ref(),
            )
            .await?;
        }
        Ok(JobCleanupResult {
            jobs_pruned,
            events_pruned,
            heartbeats_pruned,
            artifacts_pruned,
        })
    }

    pub(crate) async fn list_job_artifacts(
        &self,
        request: JobArtifactListRequest,
    ) -> Result<JobArtifactListResult> {
        ensure_job_pool(&self.pool, request.job_id).await?;
        if request.cursor.is_some() {
            return Err(ApiError::new(
                "job_artifact.cursor_unsupported",
                ErrorStage::Retrieving,
                "sqlite unified job store does not implement artifact cursor pagination yet",
            ));
        }
        let mut sql = "SELECT * FROM job_artifacts WHERE job_id = ?".to_string();
        if let Some(kind) = request.kind {
            sql.push_str(&format!(" AND artifact_kind = '{}'", enum_name(kind)?));
        }
        let limit = clamp_page_limit(request.limit);
        sql.push_str(" ORDER BY created_at DESC LIMIT ");
        sql.push_str(&limit.to_string());
        let rows = sqlx::query(&sql)
            .bind(request.job_id.0.to_string())
            .fetch_all(&self.pool)
            .await
            .map_err(sql_error)?;
        let artifacts = rows
            .into_iter()
            .map(row_to_artifact)
            .collect::<Result<Vec<_>>>()?;
        Ok(JobArtifactListResult {
            artifacts,
            limit,
            next_cursor: None,
        })
    }

    pub(crate) async fn reset_jobs(&self) -> Result<()> {
        sqlx::query("DELETE FROM jobs")
            .execute(&self.pool)
            .await
            .map_err(sql_error)?;
        Ok(())
    }

    pub(crate) async fn store_capabilities(&self) -> Result<JobStoreCapability> {
        Ok(CapabilityBase {
            name: "sqlite-unified-job-store".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            owner_crate: "axon-jobs".to_string(),
            health: HealthStatus::Healthy,
            features: vec!["sqlite".to_string(), "unified-jobs".to_string()],
            limits: MetadataMap::new(),
        }
        .into())
    }

    async fn fail_recoverable_jobs(
        &self,
        kind: Option<&str>,
        cutoff: Option<&Timestamp>,
    ) -> Result<()> {
        let now = now_timestamp();
        let mut sql = "UPDATE jobs SET status = 'failed', phase = 'complete', updated_at = ? \
             WHERE status IN ('running', 'waiting')"
            .to_string();
        append_recovery_filter(&mut sql, kind, cutoff);
        let mut update = sqlx::query(&sql).bind(now.0.as_str());
        if let Some(cutoff) = cutoff {
            update = update.bind(cutoff.0.as_str());
        }
        update.execute(&self.pool).await.map_err(sql_error)?;
        Ok(())
    }
}

fn append_recovery_filter(sql: &mut String, kind: Option<&str>, cutoff: Option<&Timestamp>) {
    if let Some(kind) = kind {
        sql.push_str(" AND kind = '");
        sql.push_str(&escape_sql(kind));
        sql.push('\'');
    }
    if cutoff.is_some() {
        sql.push_str(
            " AND COALESCE(json_extract(heartbeat_json, '$.heartbeat_at'), updated_at) < ?",
        );
    }
}
