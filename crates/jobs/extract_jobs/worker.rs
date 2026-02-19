use super::*;
use crate::axon_cli::crates::jobs::common::open_amqp_connection_and_channel;

async fn process_extract_job(cfg: &Config, pool: &PgPool, id: Uuid) -> Result<(), Box<dyn Error>> {
    let run_result = async {
        let row = sqlx::query_as::<_, (serde_json::Value, serde_json::Value)>(
            "SELECT urls_json, config_json FROM axon_extract_jobs WHERE id=$1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
        let Some((urls_json, cfg_json)) = row else {
            return Ok::<Option<serde_json::Value>, Box<dyn Error>>(None);
        };

        let redis_client = redis::Client::open(cfg.redis_url.clone())?;
        let mut redis_conn = redis_client.get_multiplexed_async_connection().await?;
        let cancel_key = format!("axon:extract:cancel:{id}");
        let cancel_before: Option<String> = redis_conn.get(&cancel_key).await.ok();
        if cancel_before.is_some() {
            sqlx::query("UPDATE axon_extract_jobs SET status='canceled',updated_at=NOW(),finished_at=NOW() WHERE id=$1")
                .bind(id)
                .execute(pool)
                .await?;
            return Ok(None);
        }

        let job_cfg: ExtractJobConfig = serde_json::from_value(cfg_json)?;
        let urls: Vec<String> = serde_json::from_value(urls_json)?;
        let prompt = job_cfg
            .prompt
            .ok_or("extract prompt is required; pass --query")?;
        let mut runs = Vec::new();
        let mut all_results = Vec::new();
        let mut pages_visited = 0usize;
        let mut pages_with_data = 0usize;
        let mut deterministic_pages = 0usize;
        let mut llm_fallback_pages = 0usize;
        let mut llm_requests = 0usize;
        let mut prompt_tokens = 0u64;
        let mut completion_tokens = 0u64;
        let mut total_tokens = 0u64;
        let mut estimated_cost_usd = 0.0f64;
        let mut parser_hits = serde_json::Map::new();
        let engine = Arc::new(DeterministicExtractionEngine::with_default_parsers());
        let max_pages = job_cfg.max_pages;
        let openai_base_url = cfg.openai_base_url.clone();
        let openai_api_key = cfg.openai_api_key.clone();
        let openai_model = cfg.openai_model.clone();
        let mut pending_runs = FuturesUnordered::new();

        for url in urls {
            let engine = Arc::clone(&engine);
            let prompt = prompt.clone();
            let openai_base_url = openai_base_url.clone();
            let openai_api_key = openai_api_key.clone();
            let openai_model = openai_model.clone();
            pending_runs.push(async move {
                let run = run_extract_with_engine(
                    &url,
                    &prompt,
                    max_pages,
                    &openai_base_url,
                    &openai_api_key,
                    &openai_model,
                    engine,
                )
                .await;
                (url, run)
            });
        }

        while let Some((url, run_result)) = pending_runs.next().await {
            match run_result {
                Ok(run) => {
                    pages_visited += run.pages_visited;
                    pages_with_data += run.pages_with_data;
                    deterministic_pages += run.metrics.deterministic_pages;
                    llm_fallback_pages += run.metrics.llm_fallback_pages;
                    llm_requests += run.metrics.llm_requests;
                    prompt_tokens += run.metrics.prompt_tokens;
                    completion_tokens += run.metrics.completion_tokens;
                    total_tokens += run.metrics.total_tokens;
                    estimated_cost_usd += run.metrics.estimated_cost_usd;
                    for (name, count) in run.parser_hits.clone() {
                        let current = parser_hits
                            .get(&name)
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        parser_hits.insert(name, serde_json::json!(current + count as u64));
                    }
                    all_results.extend(run.results.clone());
                    runs.push(serde_json::json!({
                        "url": run.start_url,
                        "pages_visited": run.pages_visited,
                        "pages_with_data": run.pages_with_data,
                        "deterministic_pages": run.metrics.deterministic_pages,
                        "llm_fallback_pages": run.metrics.llm_fallback_pages,
                        "llm_requests": run.metrics.llm_requests,
                        "prompt_tokens": run.metrics.prompt_tokens,
                        "completion_tokens": run.metrics.completion_tokens,
                        "total_tokens": run.metrics.total_tokens,
                        "estimated_cost_usd": run.metrics.estimated_cost_usd,
                        "parser_hits": run.parser_hits,
                        "total_items": run.results.len(),
                        "results": run.results
                    }));
                }
                Err(err) => {
                    runs.push(serde_json::json!({
                        "url": url,
                        "error": err.to_string(),
                        "pages_visited": 0,
                        "pages_with_data": 0,
                        "total_items": 0,
                        "results": []
                    }));
                }
            }
        }

        Ok(Some(serde_json::json!({
            "prompt": prompt,
            "model": cfg.openai_model,
            "pages_visited": pages_visited,
            "pages_with_data": pages_with_data,
            "deterministic_pages": deterministic_pages,
            "llm_fallback_pages": llm_fallback_pages,
            "llm_requests": llm_requests,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "estimated_cost_usd": estimated_cost_usd,
            "parser_hits": parser_hits,
            "total_items": all_results.len(),
            "runs": runs,
            "results": all_results
        })))
    }
    .await;

    match run_result {
        Ok(Some(result_json)) => {
            sqlx::query(
                "UPDATE axon_extract_jobs SET status='completed',updated_at=NOW(),finished_at=NOW(),result_json=$2,error_text=NULL WHERE id=$1 AND status='running'",
            )
            .bind(id)
            .bind(result_json)
            .execute(pool)
            .await?;
            log_done(&format!("worker completed extract job {id}"));
        }
        Ok(None) => {}
        Err(err) => {
            let error_text = err.to_string();
            let _ = sqlx::query(
                "UPDATE axon_extract_jobs SET status='failed',updated_at=NOW(),finished_at=NOW(),error_text=$2 WHERE id=$1 AND status='running'",
            )
            .bind(id)
            .bind(error_text.clone())
            .execute(pool)
            .await;
            log_warn(&format!("worker failed extract job {id}: {error_text}"));
        }
    }

    Ok(())
}

pub async fn run_extract_worker(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let pool = make_pool(cfg).await?;
    ensure_schema(&pool).await?;
    match reclaim_stale_running_jobs(
        &pool,
        TABLE,
        "extract",
        cfg.watchdog_stale_timeout_secs,
        cfg.watchdog_confirm_secs,
        "startup",
    )
    .await
    {
        Ok(stats) => {
            if stats.stale_candidates > 0 || stats.reclaimed_jobs > 0 {
                log_info(&format!(
                    "watchdog extract startup sweep candidates={} marked={} reclaimed={}",
                    stats.stale_candidates, stats.marked_candidates, stats.reclaimed_jobs
                ));
            }
        }
        Err(err) => log_warn(&format!("watchdog extract startup sweep failed: {err}")),
    }

    let run_amqp_lane = |lane: usize| {
        let pool = pool.clone();
        async move {
            let (_conn, ch) = open_amqp_connection_and_channel(cfg, &cfg.extract_queue).await?;
            let tag = format!("axon-rust-extract-worker-{lane}");
            let mut consumer = ch
                .basic_consume(
                    &cfg.extract_queue,
                    &tag,
                    BasicConsumeOptions::default(),
                    FieldTable::default(),
                )
                .await?;
            log_info(&format!(
                "extract worker lane={} listening on queue={} concurrency={}",
                lane, cfg.extract_queue, WORKER_CONCURRENCY
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
                            "extract",
                            cfg.watchdog_stale_timeout_secs,
                            cfg.watchdog_confirm_secs,
                            "amqp",
                        )
                        .await
                        {
                            if stats.stale_candidates > 0 || stats.reclaimed_jobs > 0 {
                                log_info(&format!(
                                "watchdog extract sweep lane={} candidates={} marked={} reclaimed={}",
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
                        if let Err(err) = process_extract_job(cfg, &pool, job_id).await {
                            let error_text = err.to_string();
                            mark_job_failed(&pool, TABLE, job_id, &error_text).await;
                            log_warn(&format!("worker failed extract job {job_id}: {error_text}"));
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
                "extract worker polling lane={} active queue={}",
                lane, cfg.extract_queue
            ));
            let mut last_sweep = Instant::now();
            loop {
                if last_sweep.elapsed() >= Duration::from_secs(STALE_SWEEP_INTERVAL_SECS) {
                    if let Ok(stats) = reclaim_stale_running_jobs(
                        &pool,
                        TABLE,
                        "extract",
                        cfg.watchdog_stale_timeout_secs,
                        cfg.watchdog_confirm_secs,
                        "polling",
                    )
                    .await
                    {
                        if stats.stale_candidates > 0 || stats.reclaimed_jobs > 0 {
                            log_info(&format!(
                            "watchdog extract sweep lane={} candidates={} marked={} reclaimed={}",
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
                    if let Err(err) = process_extract_job(cfg, &pool, id).await {
                        let error_text = err.to_string();
                        mark_job_failed(&pool, TABLE, id, &error_text).await;
                        log_warn(&format!("worker failed extract job {id}: {error_text}"));
                    }
                } else {
                    tokio::time::sleep(Duration::from_millis(800)).await;
                }
            }
            #[allow(unreachable_code)]
            Result::<(), Box<dyn Error>>::Ok(())
        }
    };

    if open_amqp_channel(cfg, &cfg.extract_queue).await.is_ok() {
        tokio::try_join!(run_amqp_lane(1), run_amqp_lane(2))?;
        return Ok(());
    }

    log_warn("amqp unavailable; running extract worker in postgres polling mode");
    tokio::try_join!(run_polling_lane(1), run_polling_lane(2))?;
    Ok(())
}
