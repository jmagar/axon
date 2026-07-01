use async_trait::async_trait;
use axon_api::source::*;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::boundary::{JobStore, Result};
use crate::state_machine::validate_transition;
use crate::unified_codec::*;

#[derive(Debug, Clone)]
pub struct SqliteUnifiedJobStore {
    pool: SqlitePool,
}

impl SqliteUnifiedJobStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl JobStore for SqliteUnifiedJobStore {
    async fn create(&self, request: JobCreateRequest) -> Result<JobDescriptor> {
        if let Some(idempotency_key) = request.idempotency_key.as_deref() {
            if let Some(summary) = find_by_idempotency_key(&self.pool, idempotency_key).await? {
                return Ok(descriptor(&summary));
            }
        }

        let job_id = JobId::new(Uuid::new_v4());
        let now = now_timestamp();
        let warnings = Vec::<SourceWarning>::new();
        let metadata = request.metadata.clone();
        let request_json = request.request.clone();
        let mut tx = self.pool.begin().await.map_err(sql_error)?;

        sqlx::query(
            "INSERT INTO jobs (
                job_id, kind, intent, status, phase, priority, source_id, watch_id,
                parent_job_id, root_job_id, attempt, warnings_json, request_json,
                metadata_json, idempotency_key, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
        )
        .bind(job_id.0.to_string())
        .bind(enum_name(request.job_kind)?)
        .bind(enum_name(request.job_intent)?)
        .bind(enum_name(LifecycleStatus::Queued)?)
        .bind(enum_name(PipelinePhase::Queued)?)
        .bind(enum_name(request.priority)?)
        .bind(request.source_id.as_ref().map(|id| id.0.as_str()))
        .bind(request.watch_id.as_ref().map(|id| id.0.as_str()))
        .bind(request.parent_job_id.map(|id| id.0.to_string()))
        .bind(request.root_job_id.map(|id| id.0.to_string()))
        .bind(to_json(&warnings)?)
        .bind(optional_to_json(&request_json)?)
        .bind(to_json(&metadata)?)
        .bind(request.idempotency_key.as_deref())
        .bind(now.0.as_str())
        .bind(now.0.as_str())
        .execute(&mut *tx)
        .await
        .map_err(sql_error)?;

        for stage in request.stage_plan {
            sqlx::query(
                "INSERT INTO job_stages (
                    stage_id, job_id, phase, status, required, provider_requirements_json
                ) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(job_id.0.to_string())
            .bind(enum_name(stage.phase)?)
            .bind(enum_name(LifecycleStatus::Queued)?)
            .bind(if stage.required { 1_i64 } else { 0_i64 })
            .bind(to_json(&stage.provider_requirements)?)
            .execute(&mut *tx)
            .await
            .map_err(sql_error)?;
        }

        tx.commit().await.map_err(sql_error)?;
        Ok(new_job_descriptor(job_id, request.job_kind, now))
    }

    async fn get(&self, job_id: JobId) -> Result<Option<JobSummary>> {
        let row = sqlx::query("SELECT * FROM jobs WHERE job_id = ?")
            .bind(job_id.0.to_string())
            .fetch_optional(&self.pool)
            .await
            .map_err(sql_error)?;
        row.map(row_to_summary).transpose()
    }

    async fn update_status(&self, status: JobStatusUpdate) -> Result<()> {
        let mut tx = self.pool.begin().await.map_err(sql_error)?;
        let row = sqlx::query("SELECT status, started_at FROM jobs WHERE job_id = ?")
            .bind(status.job_id.0.to_string())
            .fetch_optional(&mut *tx)
            .await
            .map_err(sql_error)?
            .ok_or_else(|| missing_job(status.job_id))?;
        let current = parse_enum::<LifecycleStatus>(row.get::<String, _>("status"))?;
        validate_transition(status.job_id, current, status.status)?;
        let now = now_timestamp();
        let started_at = if row.get::<Option<String>, _>("started_at").is_none()
            && status.status == LifecycleStatus::Running
        {
            Some(now.0.clone())
        } else {
            None
        };
        let finished_at = if is_terminal(status.status) {
            Some(now.0.clone())
        } else {
            None
        };

        sqlx::query(
            "UPDATE jobs SET
                status = ?, phase = ?, counts_json = ?, current_json = ?,
                last_error_json = ?, updated_at = ?,
                started_at = COALESCE(started_at, ?),
                finished_at = COALESCE(?, finished_at)
             WHERE job_id = ?",
        )
        .bind(enum_name(status.status)?)
        .bind(enum_name(status.phase)?)
        .bind(optional_to_json(&status.counts)?)
        .bind(optional_to_json(&status.current)?)
        .bind(optional_to_json(&status.error)?)
        .bind(now.0.as_str())
        .bind(started_at.as_deref())
        .bind(finished_at.as_deref())
        .bind(status.job_id.0.to_string())
        .execute(&mut *tx)
        .await
        .map_err(sql_error)?;

        tx.commit().await.map_err(sql_error)?;
        Ok(())
    }

    async fn append_event(&self, event: SourceProgressEvent) -> Result<()> {
        let mut tx = self.pool.begin().await.map_err(sql_error)?;
        ensure_job(&mut tx, event.job_id).await?;
        let max_sequence = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT MAX(sequence) FROM job_events WHERE job_id = ?",
        )
        .bind(event.job_id.0.to_string())
        .fetch_one(&mut *tx)
        .await
        .map_err(sql_error)?
        .unwrap_or(0) as u64;
        let expected = max_sequence + 1;
        if event.sequence != expected {
            return Err(ApiError::new(
                "job_event.sequence_invalid",
                ErrorStage::Publishing,
                format!(
                    "expected event sequence {} for job {}, got {}",
                    expected, event.job_id.0, event.sequence
                ),
            ));
        }

        sqlx::query(
            "INSERT INTO job_events (
                event_id, job_id, sequence, attempt, stage_id, phase, status, severity,
                visibility, message, timestamp, details_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(event.event_id)
        .bind(event.job_id.0.to_string())
        .bind(event.sequence as i64)
        .bind(event.attempt as i64)
        .bind(event.stage_id.map(|id| id.0.to_string()))
        .bind(enum_name(event.phase)?)
        .bind(enum_name(event.status)?)
        .bind(enum_name(event.severity)?)
        .bind(enum_name(event.visibility)?)
        .bind(event.message)
        .bind(event.timestamp.0)
        .bind(to_json(&MetadataMap::new())?)
        .execute(&mut *tx)
        .await
        .map_err(sql_error)?;

        tx.commit().await.map_err(sql_error)?;
        Ok(())
    }

    async fn heartbeat(&self, heartbeat: JobHeartbeat) -> Result<()> {
        ensure_job_pool(&self.pool, heartbeat.job_id).await?;
        sqlx::query(
            "UPDATE jobs SET
                phase = ?, status = ?, attempt = ?, counts_json = ?,
                heartbeat_json = ?, updated_at = ?
             WHERE job_id = ?",
        )
        .bind(enum_name(heartbeat.phase)?)
        .bind(enum_name(heartbeat.status)?)
        .bind(heartbeat.attempt as i64)
        .bind(optional_to_json(&heartbeat.counts)?)
        .bind(to_json(&heartbeat)?)
        .bind(heartbeat.heartbeat_at.0.as_str())
        .bind(heartbeat.job_id.0.to_string())
        .execute(&self.pool)
        .await
        .map_err(sql_error)?;

        sqlx::query(
            "INSERT OR REPLACE INTO job_heartbeats (
                job_id, attempt, heartbeat_at, heartbeat_json
            ) VALUES (?, ?, ?, ?)",
        )
        .bind(heartbeat.job_id.0.to_string())
        .bind(heartbeat.attempt as i64)
        .bind(heartbeat.heartbeat_at.0.as_str())
        .bind(to_json(&heartbeat)?)
        .execute(&self.pool)
        .await
        .map_err(sql_error)?;
        Ok(())
    }

    async fn list(&self, request: JobListRequest) -> Result<Page<JobSummary>> {
        if request.cursor.is_some() {
            return Err(ApiError::new(
                "job.cursor_unsupported",
                ErrorStage::Retrieving,
                "sqlite unified job store does not implement cursor pagination yet",
            ));
        }
        let mut sql = "SELECT * FROM jobs WHERE 1 = 1".to_string();
        let mut filters = Vec::<String>::new();
        if let Some(status) = request.status {
            filters.push(format!("status = '{}'", enum_name(status)?));
        }
        if let Some(kind) = request.kind {
            filters.push(format!("kind = '{}'", enum_name(kind)?));
        }
        if let Some(source_id) = request.source_id {
            filters.push(format!("source_id = '{}'", escape_sql(&source_id.0)));
        }
        if let Some(watch_id) = request.watch_id {
            filters.push(format!("watch_id = '{}'", escape_sql(&watch_id.0)));
        }
        for filter in filters {
            sql.push_str(" AND ");
            sql.push_str(&filter);
        }
        sql.push_str(" ORDER BY created_at DESC LIMIT ");
        sql.push_str(&request.limit.unwrap_or(100).to_string());
        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(sql_error)?;
        let items = rows
            .into_iter()
            .map(row_to_summary)
            .collect::<Result<Vec<_>>>()?;
        Ok(Page {
            limit: request.limit.unwrap_or(100),
            total: Some(items.len() as u64),
            next_cursor: None,
            items,
        })
    }

    async fn events(&self, request: JobEventListRequest) -> Result<JobEventPage> {
        if request.cursor.is_some() {
            return Err(ApiError::new(
                "job_event.cursor_unsupported",
                ErrorStage::Retrieving,
                "sqlite unified job store does not implement event cursor pagination yet",
            ));
        }
        let mut sql = "SELECT * FROM job_events WHERE job_id = ?".to_string();
        if let Some(phase) = request.phase {
            sql.push_str(&format!(" AND phase = '{}'", enum_name(phase)?));
        }
        if let Some(severity) = request.severity {
            sql.push_str(&format!(" AND severity = '{}'", enum_name(severity)?));
        }
        if let Some(visibility) = request.visibility {
            sql.push_str(&format!(" AND visibility = '{}'", enum_name(visibility)?));
        }
        if let Some(since_sequence) = request.since_sequence {
            sql.push_str(&format!(" AND sequence > {since_sequence}"));
        }
        sql.push_str(" ORDER BY sequence ASC LIMIT ");
        sql.push_str(&request.limit.unwrap_or(100).to_string());
        let rows = sqlx::query(&sql)
            .bind(request.job_id.0.to_string())
            .fetch_all(&self.pool)
            .await
            .map_err(sql_error)?;
        let events = rows
            .into_iter()
            .map(row_to_event)
            .collect::<Result<Vec<_>>>()?;
        Ok(JobEventPage {
            last_sequence: events.last().map(|event| event.sequence),
            limit: request.limit.unwrap_or(100),
            next_cursor: None,
            events,
        })
    }

    async fn cancel(&self, job_id: JobId, request: JobCancelRequest) -> Result<JobCancelResult> {
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

    async fn retry(&self, job_id: JobId, _request: JobRetryRequest) -> Result<JobRetryResult> {
        let original = self.get(job_id).await?.ok_or_else(|| missing_job(job_id))?;
        let attempt = original.attempt + 1;
        let retry_job = self
            .create(JobCreateRequest {
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

    async fn recover(&self, request: JobRecoveryRequest) -> Result<JobRecoveryResult> {
        let kind_filter = request.kind.map(enum_name).transpose()?;
        let mut sql = "SELECT job_id FROM jobs WHERE status IN ('running', 'waiting')".to_string();
        if let Some(kind) = kind_filter.as_deref() {
            sql.push_str(" AND kind = '");
            sql.push_str(&escape_sql(kind));
            sql.push('\'');
        }
        let rows = sqlx::query(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(sql_error)?;
        let scanned = rows.len() as u64;
        if !request.dry_run && scanned > 0 {
            let now = now_timestamp();
            let mut update_sql =
                "UPDATE jobs SET status = 'failed', phase = 'complete', updated_at = ? \
                 WHERE status IN ('running', 'waiting')"
                    .to_string();
            if let Some(kind) = kind_filter.as_deref() {
                update_sql.push_str(" AND kind = '");
                update_sql.push_str(&escape_sql(kind));
                update_sql.push('\'');
            }
            sqlx::query(&update_sql)
                .bind(now.0.as_str())
                .execute(&self.pool)
                .await
                .map_err(sql_error)?;
        }
        Ok(JobRecoveryResult {
            jobs_scanned: scanned,
            jobs_requeued: 0,
            jobs_failed: if request.dry_run { 0 } else { scanned },
            warnings: Vec::new(),
        })
    }

    async fn cleanup(&self, request: JobCleanupRequest) -> Result<JobCleanupResult> {
        let cutoff = request.older_than_seconds.map(|seconds| {
            Timestamp::from(chrono::Utc::now() - chrono::Duration::seconds(seconds as i64))
        });
        let mut predicate =
            "status IN ('completed', 'completed_degraded', 'failed', 'canceled', 'expired', 'skipped')"
                .to_string();
        if cutoff.is_some() {
            predicate.push_str(" AND updated_at < ?");
        }

        let job_count_sql = format!("SELECT COUNT(*) FROM jobs WHERE {predicate}");
        let event_count_sql = format!(
            "SELECT COUNT(*) FROM job_events WHERE job_id IN (SELECT job_id FROM jobs WHERE {predicate})"
        );
        let heartbeat_count_sql = format!(
            "SELECT COUNT(*) FROM job_heartbeats WHERE job_id IN (SELECT job_id FROM jobs WHERE {predicate})"
        );
        let artifact_count_sql = format!(
            "SELECT COUNT(*) FROM job_artifacts WHERE job_id IN (SELECT job_id FROM jobs WHERE {predicate})"
        );

        let jobs_pruned =
            count_with_optional_cutoff(&self.pool, &job_count_sql, cutoff.as_ref()).await?;
        let events_pruned =
            count_with_optional_cutoff(&self.pool, &event_count_sql, cutoff.as_ref()).await?;
        let heartbeats_pruned =
            count_with_optional_cutoff(&self.pool, &heartbeat_count_sql, cutoff.as_ref()).await?;
        let artifacts_pruned =
            count_with_optional_cutoff(&self.pool, &artifact_count_sql, cutoff.as_ref()).await?;

        if !request.dry_run && jobs_pruned > 0 {
            let delete_sql = format!("DELETE FROM jobs WHERE {predicate}");
            execute_with_optional_cutoff(&self.pool, &delete_sql, cutoff.as_ref()).await?;
        }
        Ok(JobCleanupResult {
            jobs_pruned,
            events_pruned,
            heartbeats_pruned,
            artifacts_pruned,
        })
    }

    async fn artifacts(&self, request: JobArtifactListRequest) -> Result<JobArtifactListResult> {
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
        sql.push_str(" ORDER BY created_at DESC LIMIT ");
        sql.push_str(&request.limit.unwrap_or(100).to_string());
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
            limit: request.limit.unwrap_or(100),
            next_cursor: None,
        })
    }

    async fn reset(&self) -> Result<()> {
        sqlx::query("DELETE FROM jobs")
            .execute(&self.pool)
            .await
            .map_err(sql_error)?;
        Ok(())
    }

    async fn capabilities(&self) -> Result<JobStoreCapability> {
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
}

#[cfg(test)]
#[path = "unified_tests.rs"]
mod tests;
