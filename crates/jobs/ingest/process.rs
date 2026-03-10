use crate::crates::core::config::Config;
use crate::crates::core::logging::{log_info, log_warn};
use crate::crates::jobs::common::{JobTable, mark_job_failed, spawn_heartbeat_task};
use sqlx::PgPool;
use std::collections::HashSet;
use std::time::Duration;
use uuid::Uuid;

use futures::Future;

use super::ops::mark_completed;
use super::types::{IngestJobConfig, IngestSource};

type IngestFuture = std::pin::Pin<Box<dyn Future<Output = (String, Result<usize, String>)> + Send>>;

const TABLE: JobTable = JobTable::Ingest;
const INGEST_HEARTBEAT_INTERVAL_SECS: u64 = 30;
const PLAYLIST_CONCURRENCY: usize = 5;
const RETRY_429_BASE_SECS: u64 = 10;
const RETRY_429_MAX_ATTEMPTS: u8 = 3;

/// Load prior playlist progress from `result_json` to support resume on restart.
///
/// Returns `(chunks_embedded, completed_urls)`. If no prior progress exists,
/// returns `(0, HashSet::new())`.
async fn load_playlist_progress(pool: &PgPool, job_id: Uuid) -> (usize, HashSet<String>) {
    let row = sqlx::query_scalar::<_, Option<serde_json::Value>>(
        "SELECT result_json FROM axon_ingest_jobs WHERE id=$1",
    )
    .bind(job_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .flatten();

    let Some(v) = row else {
        return (0, HashSet::new());
    };

    let chunks = v
        .get("chunks_embedded")
        .and_then(|c| c.as_u64())
        .unwrap_or(0) as usize;
    let urls = v
        .get("completed_urls")
        .and_then(|u| u.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    (chunks, urls)
}

/// Ingest a single video with up to `RETRY_429_MAX_ATTEMPTS` retries on 429 errors.
///
/// Non-429 errors are returned immediately. Backoff: 10s, 20s, 40s.
async fn ingest_video_with_retry(cfg: &Config, video_url: &str) -> Result<usize, String> {
    use crate::crates::ingest;

    for attempt in 0..=RETRY_429_MAX_ATTEMPTS {
        // Convert Box<dyn Error> to String immediately so the state machine never
        // holds a non-Send type across an await point.
        let result = ingest::youtube::ingest_youtube(cfg, video_url)
            .await
            .map_err(|e| e.to_string());
        match result {
            Ok(n) => return Ok(n),
            Err(msg) => {
                if (msg.contains("429") || msg.contains("Too Many Requests"))
                    && attempt < RETRY_429_MAX_ATTEMPTS
                {
                    let delay = RETRY_429_BASE_SECS * (1 << attempt);
                    log_warn(&format!(
                        "command=ingest_youtube_playlist 429_retry attempt={} delay={delay}s url={video_url}",
                        attempt + 1
                    ));
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                    continue;
                }
                return Err(msg);
            }
        }
    }
    Err("max retries exceeded".to_string())
}

/// Enumerate and ingest all videos in a YouTube playlist or channel.
///
/// Resumes from prior progress stored in `result_json` (supports restart after kill).
/// Processes up to `PLAYLIST_CONCURRENCY` videos concurrently.
/// Persists progress after each video so `axon ingest status` shows live progress.
async fn ingest_youtube_playlist(
    cfg: &Config,
    pool: &PgPool,
    job_id: Uuid,
    url: &str,
) -> Result<usize, Box<dyn std::error::Error>> {
    use crate::crates::ingest;
    use futures_util::stream::{FuturesUnordered, StreamExt};

    // Resume: load prior progress (completed_urls enables skipping on restart)
    let (mut chunks_embedded, mut completed_urls) = load_playlist_progress(pool, job_id).await;

    // Write enumerating placeholder so `axon status` shows activity while yt-dlp lists the channel.
    // Only written on a fresh start — resumed jobs already have result_json with video counts.
    if completed_urls.is_empty() {
        let _ =
            sqlx::query("UPDATE axon_ingest_jobs SET result_json=$1, updated_at=NOW() WHERE id=$2")
                .bind(serde_json::json!({"enumerating": true}))
                .bind(job_id)
                .execute(pool)
                .await;
    }

    // Enumerate all videos via single yt-dlp --flat-playlist call
    let video_urls = ingest::youtube::enumerate_playlist_videos(url).await?;
    if video_urls.is_empty() {
        return Err("yt-dlp found no videos in playlist/channel".into());
    }
    let total = video_urls.len();

    // Filter already-completed videos for resume support
    let pending: Vec<String> = video_urls
        .into_iter()
        .filter(|u| !completed_urls.contains(u))
        .collect();

    log_info(&format!(
        "command=ingest_youtube_playlist total={total} pending={} resumed={} url={url}",
        pending.len(),
        completed_urls.len()
    ));

    if pending.is_empty() {
        return Ok(chunks_embedded);
    }

    // Write initial progress immediately so `axon ingest list/status` shows totals
    // before the first video completes (restores behavior from the sequential implementation).
    let _ = sqlx::query("UPDATE axon_ingest_jobs SET result_json=$1, updated_at=NOW() WHERE id=$2")
        .bind(serde_json::json!({
            "videos_done": completed_urls.len(),
            "videos_total": total,
            "chunks_embedded": chunks_embedded,
            "completed_urls": completed_urls.iter().collect::<Vec<_>>(),
        }))
        .bind(job_id)
        .execute(pool)
        .await;

    // Bounded concurrency via FuturesUnordered (boxed to allow two different push sites)
    let mut inflight: FuturesUnordered<IngestFuture> = FuturesUnordered::new();
    let mut pending_iter = pending.into_iter();

    // Pre-fill up to PLAYLIST_CONCURRENCY
    for video_url in pending_iter.by_ref().take(PLAYLIST_CONCURRENCY) {
        let cfg_clone = cfg.clone();
        inflight.push(Box::pin(async move {
            let result = ingest_video_with_retry(&cfg_clone, &video_url).await;
            (video_url, result)
        }));
    }

    // Drain results, persist progress, and refill
    while let Some((video_url, result)) = inflight.next().await {
        match result {
            Ok(n) => {
                chunks_embedded += n;
                completed_urls.insert(video_url.clone());
                log_info(&format!(
                    "command=ingest_youtube_playlist done={}/{total} chunks={n} total_chunks={chunks_embedded} url={video_url}",
                    completed_urls.len()
                ));
            }
            Err(e) => log_warn(&format!(
                "command=ingest_youtube_playlist skip video_url={video_url} err={e}"
            )),
        }

        // Persist progress so resume works on restart and status shows live data
        let progress = serde_json::json!({
            "videos_done": completed_urls.len(),
            "videos_total": total,
            "chunks_embedded": chunks_embedded,
            "completed_urls": completed_urls.iter().collect::<Vec<_>>(),
        });
        let _ =
            sqlx::query("UPDATE axon_ingest_jobs SET result_json=$1, updated_at=NOW() WHERE id=$2")
                .bind(&progress)
                .bind(job_id)
                .execute(pool)
                .await;

        // Queue next pending video to maintain PLAYLIST_CONCURRENCY
        if let Some(video_url) = pending_iter.next() {
            let cfg_clone = cfg.clone();
            inflight.push(Box::pin(async move {
                let result = ingest_video_with_retry(&cfg_clone, &video_url).await;
                (video_url, result)
            }));
        }
    }

    Ok(chunks_embedded)
}

// SEC-M-6: `cfg` is captured by value but never serialized into error_text.
// All error paths pass only `e.to_string()` or static messages to `mark_job_failed`,
// so `openai_api_key` and other secrets in `cfg` cannot leak into the database.
pub(crate) async fn process_ingest_job(cfg: Config, pool: PgPool, id: Uuid) {
    use crate::crates::ingest;

    let cfg_row = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT config_json FROM axon_ingest_jobs WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await;

    let job_cfg: IngestJobConfig = match cfg_row {
        Ok(Some(v)) => match serde_json::from_value(v) {
            Ok(c) => c,
            Err(e) => {
                let _ =
                    mark_job_failed(&pool, TABLE, id, &format!("invalid config_json: {e}")).await;
                return;
            }
        },
        Ok(None) => {
            let _ = mark_job_failed(&pool, TABLE, id, "job not found in DB").await;
            return;
        }
        Err(e) => {
            let _ = mark_job_failed(&pool, TABLE, id, &format!("DB read error: {e}")).await;
            return;
        }
    };

    let (heartbeat_stop_tx, heartbeat_task) =
        spawn_heartbeat_task(pool.clone(), TABLE, id, INGEST_HEARTBEAT_INTERVAL_SECS);

    let result = match &job_cfg.source {
        IngestSource::Github {
            repo,
            include_source,
        } => ingest::github::ingest_github(&cfg, repo, *include_source).await,
        IngestSource::Reddit { target } => ingest::reddit::ingest_reddit(&cfg, target).await,
        IngestSource::Youtube { target } => {
            if ingest::youtube::is_playlist_or_channel_url(target) {
                ingest_youtube_playlist(&cfg, &pool, id, target).await
            } else {
                ingest::youtube::ingest_youtube(&cfg, target).await
            }
        }
        IngestSource::Sessions {
            sessions_claude,
            sessions_codex,
            sessions_gemini,
            sessions_project,
        } => {
            let mut sessions_cfg = cfg.clone();
            sessions_cfg.sessions_claude = *sessions_claude;
            sessions_cfg.sessions_codex = *sessions_codex;
            sessions_cfg.sessions_gemini = *sessions_gemini;
            sessions_cfg.sessions_project = sessions_project.clone();
            ingest::sessions::ingest_sessions(&sessions_cfg).await
        }
    };
    let _ = heartbeat_stop_tx.send(true);
    if let Err(err) = heartbeat_task.await {
        log_warn(&format!(
            "command=ingest_worker heartbeat_task_panicked job_id={id} err={err:?}"
        ));
    }

    match result {
        Ok(chunks) => {
            mark_completed(&pool, id, chunks).await;
        }
        Err(e) => {
            let _ = mark_job_failed(&pool, TABLE, id, &e.to_string()).await;
        }
    }
}
