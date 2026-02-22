use crate::crates::core::config::Config;
use sqlx::{postgres::PgPoolOptions, Row};
use std::time::Duration;

pub(super) async fn pg_pool_for_stats(cfg: &Config) -> Option<sqlx::PgPool> {
    if cfg.pg_url.is_empty() {
        return None;
    }
    tokio::time::timeout(
        Duration::from_secs(3),
        PgPoolOptions::new().max_connections(2).connect(&cfg.pg_url),
    )
    .await
    .ok()
    .and_then(Result::ok)
}

async fn table_exists(pool: &sqlx::PgPool, table: &str) -> Result<bool, sqlx::Error> {
    let exists: bool = sqlx::query_scalar("SELECT to_regclass($1) IS NOT NULL")
        .bind(table)
        .fetch_one(pool)
        .await?;
    Ok(exists)
}

async fn count_table_rows(pool: &sqlx::PgPool, table: &str) -> Result<i64, sqlx::Error> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    sqlx::query_scalar::<_, i64>(&sql).fetch_one(pool).await
}

async fn command_count(pool: &sqlx::PgPool, command: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM axon_command_runs WHERE command = $1")
        .bind(command)
        .fetch_one(pool)
        .await
}

#[derive(Default)]
pub(super) struct PostgresMetrics {
    pub(super) crawl_count: Option<i64>,
    pub(super) batch_count: Option<i64>,
    pub(super) extract_count: Option<i64>,
    pub(super) average_pages_per_second: Option<f64>,
    pub(super) average_crawl_duration_seconds: Option<f64>,
    pub(super) average_embedding_duration_seconds: Option<f64>,
    pub(super) average_overall_crawl_duration_seconds: Option<f64>,
    pub(super) longest_crawl: Option<serde_json::Value>,
    pub(super) most_chunks: Option<serde_json::Value>,
    pub(super) total_chunks: Option<i64>,
    pub(super) total_docs: Option<i64>,
    pub(super) base_urls_count: Option<i64>,
    pub(super) scrape_count: Option<i64>,
    pub(super) query_count: Option<i64>,
    pub(super) ask_count: Option<i64>,
    pub(super) retrieve_count: Option<i64>,
    pub(super) map_count: Option<i64>,
    pub(super) search_count: Option<i64>,
    pub(super) embed_count: Option<i64>,
    pub(super) evaluate_count: Option<i64>,
    pub(super) suggest_count: Option<i64>,
}

pub(super) async fn collect_postgres_metrics(cfg: &Config) -> PostgresMetrics {
    let mut metrics = PostgresMetrics::default();
    let Some(pool) = pg_pool_for_stats(cfg).await else {
        return metrics;
    };
    if table_exists(&pool, "axon_crawl_jobs")
        .await
        .unwrap_or(false)
    {
        collect_crawl_metrics(&pool, &mut metrics).await;
    }
    if table_exists(&pool, "axon_batch_jobs")
        .await
        .unwrap_or(false)
    {
        collect_batch_metrics(&pool, &mut metrics).await;
    }
    if table_exists(&pool, "axon_extract_jobs")
        .await
        .unwrap_or(false)
    {
        collect_extract_metrics(&pool, &mut metrics).await;
    }
    if table_exists(&pool, "axon_embed_jobs")
        .await
        .unwrap_or(false)
    {
        collect_embed_metrics(&pool, &mut metrics).await;
    }
    if table_exists(&pool, "axon_command_runs")
        .await
        .unwrap_or(false)
    {
        collect_command_metrics(&pool, &mut metrics).await;
    }
    metrics
}

async fn collect_crawl_metrics(pool: &sqlx::PgPool, metrics: &mut PostgresMetrics) {
    metrics.crawl_count = count_table_rows(pool, "axon_crawl_jobs").await.ok();
    metrics.base_urls_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(DISTINCT url) FROM axon_crawl_jobs")
            .fetch_one(pool)
            .await
            .ok();
    metrics.average_pages_per_second = sqlx::query_scalar::<_, Option<f64>>(
        r#"
        SELECT AVG(
            COALESCE((result_json->>'pages_discovered')::double precision, 0.0)
            / GREATEST(EXTRACT(EPOCH FROM (finished_at - started_at))::double precision, 0.001::double precision)
        )
        FROM axon_crawl_jobs
        WHERE status='completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL
        "#,
    )
    .fetch_one(pool)
    .await
    .ok()
    .flatten();
    metrics.average_crawl_duration_seconds = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT AVG(EXTRACT(EPOCH FROM (finished_at - started_at))::double precision) FROM axon_crawl_jobs WHERE status='completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL",
    )
    .fetch_one(pool)
    .await
    .ok()
    .flatten();
    if let Ok(Some(row)) = sqlx::query(
        r#"
        SELECT id::text AS id, url, EXTRACT(EPOCH FROM (finished_at - started_at))::double precision AS seconds
        FROM axon_crawl_jobs
        WHERE status='completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL
        ORDER BY (finished_at - started_at) DESC
        LIMIT 1
        "#,
    )
    .fetch_optional(pool)
    .await
    {
        let id: String = row.get("id");
        let url: String = row.get("url");
        let seconds: f64 = row.get("seconds");
        metrics.longest_crawl =
            Some(serde_json::json!({"id": id, "url": url, "seconds": seconds}));
    }
    metrics.average_overall_crawl_duration_seconds = sqlx::query_scalar::<_, Option<f64>>(
        r#"
        SELECT AVG(
            EXTRACT(EPOCH FROM (
                COALESCE(e.finished_at, c.finished_at) - c.started_at
            ))::double precision
        )
        FROM axon_crawl_jobs c
        LEFT JOIN LATERAL (
            SELECT finished_at
            FROM axon_embed_jobs e
            WHERE e.status='completed'
              AND e.input_text LIKE ('%' || c.id::text || '/markdown')
            ORDER BY finished_at DESC
            LIMIT 1
        ) e ON TRUE
        WHERE c.status='completed' AND c.started_at IS NOT NULL AND c.finished_at IS NOT NULL
        "#,
    )
    .fetch_one(pool)
    .await
    .ok()
    .flatten();
}

async fn collect_batch_metrics(pool: &sqlx::PgPool, metrics: &mut PostgresMetrics) {
    metrics.batch_count = count_table_rows(pool, "axon_batch_jobs").await.ok();
}

async fn collect_extract_metrics(pool: &sqlx::PgPool, metrics: &mut PostgresMetrics) {
    metrics.extract_count = count_table_rows(pool, "axon_extract_jobs").await.ok();
}

async fn collect_embed_metrics(pool: &sqlx::PgPool, metrics: &mut PostgresMetrics) {
    metrics.average_embedding_duration_seconds = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT AVG(EXTRACT(EPOCH FROM (finished_at - started_at))::double precision) FROM axon_embed_jobs WHERE status='completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL",
    )
    .fetch_one(pool)
    .await
    .ok()
    .flatten();
    metrics.total_chunks = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT SUM(COALESCE((result_json->>'chunks_embedded')::bigint, 0))::bigint FROM axon_embed_jobs WHERE status='completed'",
    )
    .fetch_one(pool)
    .await
    .ok()
    .flatten();
    metrics.total_docs = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT SUM(COALESCE((result_json->>'docs_embedded')::bigint, 0))::bigint FROM axon_embed_jobs WHERE status='completed'",
    )
    .fetch_one(pool)
    .await
    .ok()
    .flatten();
    metrics.embed_count = count_table_rows(pool, "axon_embed_jobs").await.ok();
    if let Ok(Some(row)) = sqlx::query(
        r#"
        SELECT id::text AS id,
               COALESCE((result_json->>'chunks_embedded')::bigint, 0) AS chunks
        FROM axon_embed_jobs
        WHERE status='completed'
        ORDER BY COALESCE((result_json->>'chunks_embedded')::bigint, 0) DESC
        LIMIT 1
        "#,
    )
    .fetch_optional(pool)
    .await
    {
        let id: String = row.get("id");
        let chunks: i64 = row.get("chunks");
        metrics.most_chunks = Some(serde_json::json!({"embed_job_id": id, "chunks": chunks}));
    }
}

async fn collect_command_metrics(pool: &sqlx::PgPool, metrics: &mut PostgresMetrics) {
    metrics.scrape_count = command_count(pool, "scrape").await.ok();
    metrics.query_count = command_count(pool, "query").await.ok();
    metrics.ask_count = command_count(pool, "ask").await.ok();
    metrics.retrieve_count = command_count(pool, "retrieve").await.ok();
    metrics.map_count = command_count(pool, "map").await.ok();
    metrics.search_count = command_count(pool, "search").await.ok();
    metrics.evaluate_count = command_count(pool, "evaluate").await.ok();
    metrics.suggest_count = command_count(pool, "suggest").await.ok();
}
