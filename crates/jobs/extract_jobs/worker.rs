use super::*;
use crate::axon_cli::crates::core::content::ExtractRun;
use crate::axon_cli::crates::jobs::common::open_amqp_connection_and_channel;

struct ExtractAggregation {
    runs: Vec<serde_json::Value>,
    all_results: Vec<serde_json::Value>,
    pages_visited: usize,
    pages_with_data: usize,
    deterministic_pages: usize,
    llm_fallback_pages: usize,
    llm_requests: usize,
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
    estimated_cost_usd: f64,
    parser_hits: serde_json::Map<String, serde_json::Value>,
}

impl ExtractAggregation {
    fn new() -> Self {
        Self {
            runs: Vec::new(),
            all_results: Vec::new(),
            pages_visited: 0,
            pages_with_data: 0,
            deterministic_pages: 0,
            llm_fallback_pages: 0,
            llm_requests: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            estimated_cost_usd: 0.0,
            parser_hits: serde_json::Map::new(),
        }
    }
}

async fn load_extract_job_inputs(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<(Vec<String>, ExtractJobConfig)>, Box<dyn Error>> {
    let row = sqlx::query_as::<_, (serde_json::Value, serde_json::Value)>(
        "SELECT urls_json, config_json FROM axon_extract_jobs WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some((urls_json, cfg_json)) = row else {
        return Ok(None);
    };
    let job_cfg: ExtractJobConfig = serde_json::from_value(cfg_json)?;
    let urls: Vec<String> = serde_json::from_value(urls_json)?;
    Ok(Some((urls, job_cfg)))
}

async fn mark_extract_canceled(
    cfg: &Config,
    pool: &PgPool,
    id: Uuid,
) -> Result<bool, Box<dyn Error>> {
    let redis_client = redis::Client::open(cfg.redis_url.clone())?;
    let mut redis_conn = redis_client.get_multiplexed_async_connection().await?;
    let cancel_key = format!("axon:extract:cancel:{id}");
    let cancel_before: Option<String> = redis_conn.get(&cancel_key).await.ok();
    if cancel_before.is_none() {
        return Ok(false);
    }
    sqlx::query("UPDATE axon_extract_jobs SET status='canceled',updated_at=NOW(),finished_at=NOW() WHERE id=$1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(true)
}

fn update_parser_hits(map: &mut serde_json::Map<String, serde_json::Value>, run: &ExtractRun) {
    for (name, count) in run.parser_hits.clone() {
        let current = map.get(&name).and_then(|v| v.as_u64()).unwrap_or(0);
        map.insert(name, serde_json::json!(current + count as u64));
    }
}

fn append_extract_success(agg: &mut ExtractAggregation, run: ExtractRun) {
    agg.pages_visited += run.pages_visited;
    agg.pages_with_data += run.pages_with_data;
    agg.deterministic_pages += run.metrics.deterministic_pages;
    agg.llm_fallback_pages += run.metrics.llm_fallback_pages;
    agg.llm_requests += run.metrics.llm_requests;
    agg.prompt_tokens += run.metrics.prompt_tokens;
    agg.completion_tokens += run.metrics.completion_tokens;
    agg.total_tokens += run.metrics.total_tokens;
    agg.estimated_cost_usd += run.metrics.estimated_cost_usd;
    update_parser_hits(&mut agg.parser_hits, &run);
    agg.all_results.extend(run.results.clone());
    agg.runs.push(serde_json::json!({
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

fn append_extract_error(agg: &mut ExtractAggregation, url: String, err: String) {
    agg.runs.push(serde_json::json!({
        "url": url,
        "error": err,
        "pages_visited": 0,
        "pages_with_data": 0,
        "total_items": 0,
        "results": []
    }));
}

async fn execute_extract_runs(
    cfg: &Config,
    urls: Vec<String>,
    prompt: String,
    max_pages: u32,
) -> ExtractAggregation {
    let engine = Arc::new(DeterministicExtractionEngine::with_default_parsers());
    let mut pending_runs = FuturesUnordered::new();

    for url in urls {
        let engine = Arc::clone(&engine);
        let prompt = prompt.clone();
        let openai_base_url = cfg.openai_base_url.clone();
        let openai_api_key = cfg.openai_api_key.clone();
        let openai_model = cfg.openai_model.clone();
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

    let mut agg = ExtractAggregation::new();
    while let Some((url, run_result)) = pending_runs.next().await {
        match run_result {
            Ok(run) => append_extract_success(&mut agg, run),
            Err(err) => append_extract_error(&mut agg, url, err.to_string()),
        }
    }
    agg
}

fn extract_result_json(
    prompt: String,
    model: String,
    agg: ExtractAggregation,
) -> serde_json::Value {
    serde_json::json!({
        "prompt": prompt,
        "model": model,
        "pages_visited": agg.pages_visited,
        "pages_with_data": agg.pages_with_data,
        "deterministic_pages": agg.deterministic_pages,
        "llm_fallback_pages": agg.llm_fallback_pages,
        "llm_requests": agg.llm_requests,
        "prompt_tokens": agg.prompt_tokens,
        "completion_tokens": agg.completion_tokens,
        "total_tokens": agg.total_tokens,
        "estimated_cost_usd": agg.estimated_cost_usd,
        "parser_hits": agg.parser_hits,
        "total_items": agg.all_results.len(),
        "runs": agg.runs,
        "results": agg.all_results,
    })
}

async fn process_extract_job(cfg: &Config, pool: &PgPool, id: Uuid) -> Result<(), Box<dyn Error>> {
    let run_result = async {
        let Some((urls, job_cfg)) = load_extract_job_inputs(pool, id).await? else {
            return Ok::<Option<serde_json::Value>, Box<dyn Error>>(None);
        };
        if mark_extract_canceled(cfg, pool, id).await? {
            return Ok(None);
        }

        let prompt = job_cfg
            .prompt
            .ok_or("extract prompt is required; pass --query")?;
        let agg = execute_extract_runs(cfg, urls, prompt.clone(), job_cfg.max_pages).await;
        Ok(Some(extract_result_json(
            prompt,
            cfg.openai_model.clone(),
            agg,
        )))
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

async fn sweep_stale_extract_jobs(cfg: &Config, pool: &PgPool, source: &str, lane: usize) {
    if let Ok(stats) = reclaim_stale_running_jobs(
        pool,
        TABLE,
        "extract",
        cfg.watchdog_stale_timeout_secs,
        cfg.watchdog_confirm_secs,
        source,
    )
    .await
    {
        if stats.stale_candidates > 0 || stats.reclaimed_jobs > 0 {
            log_info(&format!(
                "watchdog extract sweep lane={} candidates={} marked={} reclaimed={}",
                lane, stats.stale_candidates, stats.marked_candidates, stats.reclaimed_jobs
            ));
        }
    }
}

async fn process_claimed_extract_job(cfg: &Config, pool: &PgPool, id: Uuid) {
    if let Err(err) = process_extract_job(cfg, pool, id).await {
        let error_text = err.to_string();
        mark_job_failed(pool, TABLE, id, &error_text).await;
        log_warn(&format!("worker failed extract job {id}: {error_text}"));
    }
}

async fn run_extract_amqp_lane(
    cfg: &Config,
    pool: PgPool,
    lane: usize,
) -> Result<(), Box<dyn Error>> {
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
                sweep_stale_extract_jobs(cfg, &pool, "amqp", lane).await;
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
                process_claimed_extract_job(cfg, &pool, job_id).await;
            }
        }
    }
    Ok(())
}

async fn run_extract_polling_lane(
    cfg: &Config,
    pool: PgPool,
    lane: usize,
) -> Result<(), Box<dyn Error>> {
    log_info(&format!(
        "extract worker polling lane={} active queue={}",
        lane, cfg.extract_queue
    ));
    let mut last_sweep = Instant::now();
    loop {
        if last_sweep.elapsed() >= Duration::from_secs(STALE_SWEEP_INTERVAL_SECS) {
            sweep_stale_extract_jobs(cfg, &pool, "polling", lane).await;
            last_sweep = Instant::now();
        }
        if let Some(id) = claim_next_pending(&pool, TABLE).await? {
            process_claimed_extract_job(cfg, &pool, id).await;
        } else {
            tokio::time::sleep(Duration::from_millis(800)).await;
        }
    }
}

pub async fn run_extract_worker(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let pool = make_pool(cfg).await?;
    ensure_schema(&pool).await?;
    sweep_stale_extract_jobs(cfg, &pool, "startup", 0).await;

    if open_amqp_channel(cfg, &cfg.extract_queue).await.is_ok() {
        let (r1, r2) = tokio::join!(
            run_extract_amqp_lane(cfg, pool.clone(), 1),
            run_extract_amqp_lane(cfg, pool.clone(), 2)
        );
        r1?;
        r2?;
        return Ok(());
    }

    log_warn("amqp unavailable; running extract worker in postgres polling mode");
    let (r1, r2) = tokio::join!(
        run_extract_polling_lane(cfg, pool.clone(), 1),
        run_extract_polling_lane(cfg, pool, 2)
    );
    r1?;
    r2?;
    Ok(())
}
