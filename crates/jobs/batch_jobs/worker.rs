use super::*;
use crate::axon_cli::crates::jobs::common::open_amqp_connection_and_channel;

async fn process_batch_job(cfg: &Config, pool: &PgPool, id: Uuid) -> Result<(), Box<dyn Error>> {
    let row = sqlx::query_as::<_, (serde_json::Value, serde_json::Value)>(
        "SELECT urls_json, config_json FROM axon_batch_jobs WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some((urls_json, cfg_json)) = row else {
        return Ok(());
    };

    let redis_client = redis::Client::open(cfg.redis_url.clone())?;
    let mut redis_conn = redis_client.get_multiplexed_async_connection().await?;
    let cancel_key = format!("axon:batch:cancel:{id}");
    let cancel_before: Option<String> = redis_conn.get(&cancel_key).await.ok();
    if cancel_before.is_some() {
        sqlx::query("UPDATE axon_batch_jobs SET status='canceled',updated_at=NOW(),finished_at=NOW() WHERE id=$1")
            .bind(id)
            .execute(pool)
            .await?;
        return Ok(());
    }

    let job_cfg: BatchJobConfig = serde_json::from_value(cfg_json)?;
    let urls: Vec<String> = serde_json::from_value(urls_json)?;
    let out_dir = PathBuf::from(job_cfg.output_dir)
        .join("batch-jobs")
        .join(id.to_string());
    if out_dir.exists() {
        let _ = tokio::fs::remove_dir_all(&out_dir).await;
    }
    tokio::fs::create_dir_all(&out_dir).await?;

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

    let queue_injection = apply_queue_injection(
        cfg,
        &candidates,
        job_cfg.extraction_prompt.as_deref(),
        "batch-post-fetch",
        true,
    )
    .await?;

    if job_cfg.embed {
        let mut embed_cfg = cfg.clone();
        embed_cfg.collection = job_cfg.collection;
        if let Err(e) = embed_path_native(&embed_cfg, &out_dir.to_string_lossy()).await {
            log_warn(&format!("batch job {id}: embed failed (non-fatal): {e:#}"));
        }
    }

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

pub async fn run_batch_worker(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let pool = make_pool(cfg).await?;
    ensure_schema(&pool).await?;
    match reclaim_stale_running_jobs(
        &pool,
        TABLE,
        "batch",
        cfg.watchdog_stale_timeout_secs,
        cfg.watchdog_confirm_secs,
        "startup",
    )
    .await
    {
        Ok(stats) => {
            if stats.stale_candidates > 0 || stats.reclaimed_jobs > 0 {
                log_info(&format!(
                    "watchdog batch startup sweep candidates={} marked={} reclaimed={}",
                    stats.stale_candidates, stats.marked_candidates, stats.reclaimed_jobs
                ));
            }
        }
        Err(err) => log_warn(&format!("watchdog batch startup sweep failed: {err}")),
    }

    let run_amqp_lane = |lane: usize| {
        let pool = pool.clone();
        async move {
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
                let msg = match tokio::time::timeout(
                    Duration::from_secs(STALE_SWEEP_INTERVAL_SECS),
                    consumer.next(),
                )
                .await
                {
                    Ok(Some(msg)) => msg,
                    Ok(None) => break,
                    Err(_) => {
                        if let Ok(stats) = reclaim_stale_running_jobs(
                            &pool,
                            TABLE,
                            "batch",
                            cfg.watchdog_stale_timeout_secs,
                            cfg.watchdog_confirm_secs,
                            "amqp",
                        )
                        .await
                        {
                            if stats.stale_candidates > 0 || stats.reclaimed_jobs > 0 {
                                log_info(&format!(
                                "watchdog batch sweep lane={} candidates={} marked={} reclaimed={}",
                                lane,
                                stats.stale_candidates,
                                stats.marked_candidates,
                                stats.reclaimed_jobs
                            ));
                            }
                        }
                        continue;
                    }
                };
                let delivery = match msg {
                    Ok(d) => d,
                    Err(_) => continue,
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
                        if let Err(err) = process_batch_job(cfg, &pool, job_id).await {
                            let error_text = err.to_string();
                            mark_job_failed(&pool, TABLE, job_id, &error_text).await;
                            log_warn(&format!("worker failed batch job {job_id}: {error_text}"));
                        }
                    }
                }
            }
            Result::<(), Box<dyn Error>>::Ok(())
        }
    };

    let run_polling_lane = |lane: usize| {
        let pool = pool.clone();
        async move {
            log_info(&format!(
                "batch worker polling lane={} active queue={}",
                lane, cfg.batch_queue
            ));
            let mut last_sweep = Instant::now();
            loop {
                if last_sweep.elapsed() >= Duration::from_secs(STALE_SWEEP_INTERVAL_SECS) {
                    if let Ok(stats) = reclaim_stale_running_jobs(
                        &pool,
                        TABLE,
                        "batch",
                        cfg.watchdog_stale_timeout_secs,
                        cfg.watchdog_confirm_secs,
                        "polling",
                    )
                    .await
                    {
                        if stats.stale_candidates > 0 || stats.reclaimed_jobs > 0 {
                            log_info(&format!(
                                "watchdog batch sweep lane={} candidates={} marked={} reclaimed={}",
                                lane,
                                stats.stale_candidates,
                                stats.marked_candidates,
                                stats.reclaimed_jobs
                            ));
                        }
                    }
                    last_sweep = Instant::now();
                }
                if let Some(id) = claim_next_pending(&pool, TABLE).await? {
                    if let Err(err) = process_batch_job(cfg, &pool, id).await {
                        let error_text = err.to_string();
                        mark_job_failed(&pool, TABLE, id, &error_text).await;
                        log_warn(&format!("worker failed batch job {id}: {error_text}"));
                    }
                } else {
                    tokio::time::sleep(Duration::from_millis(800)).await;
                }
            }
            #[allow(unreachable_code)]
            Result::<(), Box<dyn Error>>::Ok(())
        }
    };

    if open_amqp_channel(cfg, &cfg.batch_queue).await.is_ok() {
        tokio::try_join!(run_amqp_lane(1), run_amqp_lane(2))?;
        return Ok(());
    }

    log_warn("amqp unavailable; running batch worker in postgres polling mode");
    tokio::try_join!(run_polling_lane(1), run_polling_lane(2))?;
    Ok(())
}
