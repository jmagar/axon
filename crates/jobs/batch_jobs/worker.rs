use super::*;
use crate::axon_cli::crates::jobs::common::open_amqp_connection_and_channel;
use std::path::Path;

async fn load_batch_job_inputs(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<(Vec<String>, BatchJobConfig)>, Box<dyn Error>> {
    let row = sqlx::query_as::<_, (serde_json::Value, serde_json::Value)>(
        "SELECT urls_json, config_json FROM axon_batch_jobs WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some((urls_json, cfg_json)) = row else {
        return Ok(None);
    };
    let job_cfg: BatchJobConfig = serde_json::from_value(cfg_json)?;
    let urls: Vec<String> = serde_json::from_value(urls_json)?;
    Ok(Some((urls, job_cfg)))
}

async fn mark_batch_canceled(
    cfg: &Config,
    pool: &PgPool,
    id: Uuid,
) -> Result<bool, Box<dyn Error>> {
    let redis_client = redis::Client::open(cfg.redis_url.clone())?;
    let mut redis_conn = redis_client.get_multiplexed_async_connection().await?;
    let cancel_key = format!("axon:batch:cancel:{id}");
    let cancel_before: Option<String> = redis_conn.get(&cancel_key).await.ok();
    if cancel_before.is_none() {
        return Ok(false);
    }
    sqlx::query("UPDATE axon_batch_jobs SET status='canceled',updated_at=NOW(),finished_at=NOW() WHERE id=$1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(true)
}

async fn fetch_batch_results(
    urls: &[String],
    out_dir: &Path,
) -> Result<(Vec<serde_json::Value>, Vec<InjectionCandidate>), Box<dyn Error>> {
    let client = build_client(20)?;
    let mut results = Vec::new();
    let mut candidates = Vec::new();
    for (idx, url) in urls.iter().enumerate() {
        let html = match fetch_html(&client, url).await {
            Ok(v) => v,
            Err(err) => {
                results.push(serde_json::json!({"url": url, "error": err.to_string()}));
                continue;
            }
        };
        let md = to_markdown(&html);
        let file = out_dir.join(url_to_filename(url, idx as u32 + 1));
        tokio::fs::write(&file, &md).await?;
        let markdown_chars = md.chars().count();
        candidates.push(InjectionCandidate {
            url: url.to_string(),
            markdown_chars,
        });
        results.push(serde_json::json!({
            "url": url,
            "file_path": file.to_string_lossy(),
            "markdown_chars": markdown_chars
        }));
    }
    Ok((results, candidates))
}

async fn maybe_embed_batch_output(
    cfg: &Config,
    job_cfg: &BatchJobConfig,
    out_dir: &Path,
    id: Uuid,
) {
    if !job_cfg.embed {
        return;
    }
    let mut embed_cfg = cfg.clone();
    embed_cfg.collection = job_cfg.collection.clone();
    if let Err(e) = embed_path_native(&embed_cfg, &out_dir.to_string_lossy()).await {
        log_warn(&format!("batch job {id}: embed failed (non-fatal): {e:#}"));
    }
}

async fn process_batch_job(cfg: &Config, pool: &PgPool, id: Uuid) -> Result<(), Box<dyn Error>> {
    let Some((urls, job_cfg)) = load_batch_job_inputs(pool, id).await? else {
        return Ok(());
    };
    if mark_batch_canceled(cfg, pool, id).await? {
        return Ok(());
    }

    let out_dir = PathBuf::from(job_cfg.output_dir.clone())
        .join("batch-jobs")
        .join(id.to_string());
    if out_dir.exists() {
        let _ = tokio::fs::remove_dir_all(&out_dir).await;
    }
    tokio::fs::create_dir_all(&out_dir).await?;

    let (results, candidates) = fetch_batch_results(&urls, &out_dir).await?;
    let queue_injection = apply_queue_injection(
        cfg,
        &candidates,
        job_cfg.extraction_prompt.as_deref(),
        "batch-post-fetch",
        true,
    )
    .await?;
    maybe_embed_batch_output(cfg, &job_cfg, &out_dir, id).await;

    sqlx::query(
        "UPDATE axon_batch_jobs SET status='completed',updated_at=NOW(),finished_at=NOW(),result_json=$2,error_text=NULL WHERE id=$1 AND status='running'",
    )
    .bind(id)
    .bind(serde_json::json!({
        "results": results,
        "queue_injection": queue_injection,
        "extraction_observability": queue_injection["observability"].clone(),
    }))
    .execute(pool)
    .await?;

    log_done(&format!("worker completed batch job {id}"));
    Ok(())
}

async fn sweep_stale_batch_jobs(cfg: &Config, pool: &PgPool, source: &str, lane: usize) {
    if let Ok(stats) = reclaim_stale_running_jobs(
        pool,
        TABLE,
        "batch",
        cfg.watchdog_stale_timeout_secs,
        cfg.watchdog_confirm_secs,
        source,
    )
    .await
    {
        if stats.stale_candidates > 0 || stats.reclaimed_jobs > 0 {
            log_info(&format!(
                "watchdog batch sweep lane={} candidates={} marked={} reclaimed={}",
                lane, stats.stale_candidates, stats.marked_candidates, stats.reclaimed_jobs
            ));
        }
    }
}

async fn process_claimed_batch_job(cfg: &Config, pool: &PgPool, id: Uuid) {
    if let Err(err) = process_batch_job(cfg, pool, id).await {
        let error_text = err.to_string();
        mark_job_failed(pool, TABLE, id, &error_text).await;
        log_warn(&format!("worker failed batch job {id}: {error_text}"));
    }
}

async fn run_batch_amqp_lane(
    cfg: &Config,
    pool: PgPool,
    lane: usize,
) -> Result<(), Box<dyn Error>> {
    let (_conn, ch) = open_amqp_connection_and_channel(cfg, &cfg.batch_queue).await?;
    let tag = format!("axon-rust-batch-worker-{lane}");
    let mut consumer = ch
        .basic_consume(
            &cfg.batch_queue,
            &tag,
            BasicConsumeOptions::default(),
            FieldTable::default(),
        )
        .await?;

    log_info(&format!(
        "batch worker lane={} listening on queue={} concurrency={}",
        lane, cfg.batch_queue, WORKER_CONCURRENCY
    ));

    loop {
        let timed = tokio::time::timeout(
            Duration::from_secs(STALE_SWEEP_INTERVAL_SECS),
            consumer.next(),
        )
        .await;
        let delivery = match timed {
            Ok(Some(Ok(d))) => d,
            Ok(Some(Err(_))) => continue,
            Ok(None) => break,
            Err(_) => {
                sweep_stale_batch_jobs(cfg, &pool, "amqp", lane).await;
                continue;
            }
        };

        let parsed = std::str::from_utf8(&delivery.data)
            .ok()
            .and_then(|s| Uuid::parse_str(s.trim()).ok());
        delivery.ack(BasicAckOptions::default()).await?;
        if let Some(job_id) = parsed {
            if claim_pending_by_id(&pool, TABLE, job_id)
                .await
                .unwrap_or(false)
            {
                process_claimed_batch_job(cfg, &pool, job_id).await;
            }
        }
    }

    Ok(())
}

async fn run_batch_polling_lane(
    cfg: &Config,
    pool: PgPool,
    lane: usize,
) -> Result<(), Box<dyn Error>> {
    log_info(&format!(
        "batch worker polling lane={} active queue={}",
        lane, cfg.batch_queue
    ));
    let mut last_sweep = Instant::now();
    loop {
        if last_sweep.elapsed() >= Duration::from_secs(STALE_SWEEP_INTERVAL_SECS) {
            sweep_stale_batch_jobs(cfg, &pool, "polling", lane).await;
            last_sweep = Instant::now();
        }
        if let Some(id) = claim_next_pending(&pool, TABLE).await? {
            process_claimed_batch_job(cfg, &pool, id).await;
        } else {
            tokio::time::sleep(Duration::from_millis(800)).await;
        }
    }
}

pub async fn run_batch_worker(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let pool = make_pool(cfg).await?;
    ensure_schema(&pool).await?;
    sweep_stale_batch_jobs(cfg, &pool, "startup", 0).await;

    if open_amqp_channel(cfg, &cfg.batch_queue).await.is_ok() {
        let (r1, r2) = tokio::join!(
            run_batch_amqp_lane(cfg, pool.clone(), 1),
            run_batch_amqp_lane(cfg, pool.clone(), 2)
        );
        r1?;
        r2?;
        return Ok(());
    }

    log_warn("amqp unavailable; running batch worker in postgres polling mode");
    let (r1, r2) = tokio::join!(
        run_batch_polling_lane(cfg, pool.clone(), 1),
        run_batch_polling_lane(cfg, pool, 2)
    );
    r1?;
    r2?;
    Ok(())
}
