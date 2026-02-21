use super::*;

pub(super) async fn cancel_batch_job(cfg: &Config, id: Uuid) -> Result<bool, Box<dyn Error>> {
    let pool = make_pool(cfg).await?;
    ensure_schema(&pool).await?;
    let rows = sqlx::query("UPDATE axon_batch_jobs SET status='canceled',updated_at=NOW(),finished_at=NOW() WHERE id=$1 AND status IN ('pending','running')")
        .bind(id)
        .execute(&pool)
        .await?
        .rows_affected();

    let redis_client = redis::Client::open(cfg.redis_url.clone())?;
    let mut conn = redis_client.get_multiplexed_async_connection().await?;
    let key = format!("axon:batch:cancel:{id}");
    let _: () = conn.set_ex(key, "1", 86400).await?;
    Ok(rows > 0)
}

pub(super) async fn cleanup_batch_jobs(cfg: &Config) -> Result<u64, Box<dyn Error>> {
    let pool = make_pool(cfg).await?;
    ensure_schema(&pool).await?;
    Ok(
        sqlx::query("DELETE FROM axon_batch_jobs WHERE status IN ('failed','canceled')")
            .execute(&pool)
            .await?
            .rows_affected(),
    )
}

pub(super) async fn clear_batch_jobs(cfg: &Config) -> Result<u64, Box<dyn Error>> {
    let pool = make_pool(cfg).await?;
    ensure_schema(&pool).await?;
    let rows = sqlx::query("DELETE FROM axon_batch_jobs")
        .execute(&pool)
        .await?
        .rows_affected();
    if let Ok(ch) = open_amqp_channel(cfg, &cfg.batch_queue).await {
        let _ = ch
            .queue_purge(
                &cfg.batch_queue,
                lapin::options::QueuePurgeOptions::default(),
            )
            .await;
    }
    Ok(rows)
}

pub(super) async fn recover_stale_batch_jobs(cfg: &Config) -> Result<u64, Box<dyn Error>> {
    let pool = make_pool(cfg).await?;
    ensure_schema(&pool).await?;
    let stats = reclaim_stale_running_jobs(
        &pool,
        TABLE,
        "batch",
        cfg.watchdog_stale_timeout_secs,
        cfg.watchdog_confirm_secs,
        "manual",
    )
    .await?;
    Ok(stats.reclaimed_jobs)
}

pub(super) async fn batch_doctor(cfg: &Config) -> Result<serde_json::Value, Box<dyn Error>> {
    let pg_ok = make_pool(cfg).await.is_ok();
    let amqp_ok = open_amqp_channel(cfg, &cfg.batch_queue).await.is_ok();
    let redis_ok = redis_healthy(&cfg.redis_url).await;
    Ok(serde_json::json!({
        "postgres_ok": pg_ok,
        "amqp_ok": amqp_ok,
        "redis_ok": redis_ok,
        "all_ok": pg_ok && amqp_ok && redis_ok
    }))
}
