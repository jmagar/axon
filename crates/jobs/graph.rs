//! Graph extraction job persistence and schema entry points.

use crate::crates::core::config::Config;
use crate::crates::jobs::common::enqueue_job;
use crate::crates::jobs::status::JobStatus;
use sqlx::PgPool;

pub(crate) mod context;
pub(crate) mod extract;
mod schema;
pub(crate) mod similarity;
pub(crate) mod taxonomy;
pub(crate) mod worker;

pub use schema::{ensure_graph_schema, ensure_neo4j_schema};
pub use worker::run_graph_worker;

pub async fn enqueue_graph_job(
    pool: &PgPool,
    cfg: &Config,
    url: &str,
    source_type: &str,
) -> Result<uuid::Uuid, Box<dyn std::error::Error>> {
    ensure_graph_schema(pool).await?;

    let mut tx = pool.begin().await?;
    // Obtain an advisory lock based on the URL to prevent concurrent enqueue races
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
        .bind(format!("graph_job:{}", url))
        .execute(&mut *tx)
        .await?;

    let active = sqlx::query_scalar::<_, uuid::Uuid>(
        r#"
        SELECT id
        FROM axon_graph_jobs
        WHERE url = $1
          AND status IN ($2, $3)
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(url)
    .bind(JobStatus::Pending.as_str())
    .bind(JobStatus::Running.as_str())
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(id) = active {
        tx.commit().await?;
        return Ok(id);
    }

    let id = uuid::Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO axon_graph_jobs (id, url, status, config_json)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(id)
    .bind(url)
    .bind(JobStatus::Pending.as_str())
    .bind(serde_json::json!({ "source_type": source_type }))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    if let Err(err) = enqueue_job(cfg, &cfg.graph_queue, id).await {
        sqlx::query("UPDATE axon_graph_jobs SET status = $1, error_text = $2 WHERE id = $3")
            .bind(JobStatus::Failed.as_str())
            .bind(err.to_string())
            .bind(id)
            .execute(pool)
            .await?;
        return Err(format!("graph enqueue failed for {id}: {err}").into());
    }

    Ok(id)
}

#[cfg(test)]
mod tests {
    #[test]
    fn graph_job_table_name() {
        assert_eq!(
            crate::crates::jobs::common::JobTable::Graph.as_str(),
            "axon_graph_jobs"
        );
    }
}
