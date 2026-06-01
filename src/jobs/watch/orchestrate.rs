//! Drive a `watch` tick: detect per-URL changes, summarize + record artifacts,
//! cluster changed URLs, and dispatch one crawl per cluster (in-flight-guarded).

use crate::core::config::Config;
use crate::jobs::store::open_config_pool;
use crate::jobs::watch::WatchDef;
use crate::jobs::watch::change_detect::detect_url_change;
use crate::jobs::watch::cluster::group_by_common_prefix;
use crate::jobs::watch::dispatch::{crawl_job_active, enqueue_change_crawl};
use crate::jobs::watch::filter::compile_patterns;
use crate::jobs::watch::report::{summarize_diff, write_change_artifact};
use crate::jobs::watch::url_state::{UrlState, get_url_state, upsert_url_state};
use sqlx::SqlitePool;
use uuid::Uuid;

/// Look up the current `running` run row for this watch. `run_watch_now_with_pool`
/// creates the run row, then calls `run_watch_task` → here; the newest running
/// run for the watch is the one we are executing. This pragmatic bridge keeps the
/// existing `run_watch_task` signature unchanged.
async fn current_run_id(pool: &SqlitePool, watch_id: Uuid) -> Option<Uuid> {
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM axon_watch_runs WHERE watch_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(watch_id.to_string())
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .and_then(|s| Uuid::parse_str(&s).ok())
}

/// Cluster changed URLs and dispatch one crawl per cluster, skipping clusters
/// whose prior crawl is still in flight. Records the new crawl id on members.
/// Returns `(clusters_out, dispatched, cluster_errors)`.
#[allow(clippy::type_complexity)]
async fn dispatch_clusters(
    pool: &SqlitePool,
    cfg: &Config,
    watch_id: Uuid,
    changed: &[String],
    max_depth: usize,
) -> (Vec<serde_json::Value>, Vec<String>, Vec<serde_json::Value>) {
    let mut clusters_out: Vec<serde_json::Value> = Vec::new();
    let mut dispatched: Vec<String> = Vec::new();
    let mut errors: Vec<serde_json::Value> = Vec::new();
    for cluster in group_by_common_prefix(changed) {
        let mut in_flight = false;
        for member in &cluster.members {
            if let Ok(Some(state)) = get_url_state(pool, watch_id, member).await
                && let Some(job_id) = state.last_crawl_job_id
                && crawl_job_active(pool, job_id).await
            {
                in_flight = true;
                break;
            }
        }
        if in_flight {
            clusters_out.push(serde_json::json!({
                "seed": cluster.seed, "members": cluster.members, "skipped": "crawl in flight"
            }));
            continue;
        }
        // Map the (non-Send) boxed enqueue error to a String at the await
        // boundary so the non-Send type never spans the upsert awaits below —
        // this future must stay Send for the scheduler's tokio::spawn.
        let enqueued = enqueue_change_crawl(pool, cfg, &cluster.seed, max_depth)
            .await
            .map_err(|e| e.to_string());
        match enqueued {
            Ok(job_id) => {
                for member in &cluster.members {
                    let mut s = get_url_state(pool, watch_id, member)
                        .await
                        .ok()
                        .flatten()
                        .unwrap_or_else(UrlState::default);
                    s.last_crawl_job_id = Some(job_id);
                    let _ = upsert_url_state(pool, watch_id, member, &s).await;
                }
                dispatched.push(job_id.to_string());
                clusters_out.push(serde_json::json!({
                    "seed": cluster.seed, "members": cluster.members, "crawl_job_id": job_id.to_string()
                }));
            }
            Err(msg) => errors.push(serde_json::json!({ "seed": cluster.seed, "error": msg })),
        }
    }
    (clusters_out, dispatched, errors)
}

pub(crate) async fn run_url_watch(
    cfg: &Config,
    watch: &WatchDef,
) -> Result<serde_json::Value, String> {
    let p = &watch.task_payload;
    let urls: Vec<String> = p
        .get("urls")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    if urls.is_empty() {
        return Err("watch task requires task_payload.urls".to_string());
    }
    let max_depth = p
        .get("max_depth")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(2);
    let threshold = p
        .get("change_threshold_words")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let do_summary = p.get("summarize").and_then(|v| v.as_bool()).unwrap_or(true);
    let ignore_src: Vec<String> = p
        .get("ignore_patterns")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let ignore = compile_patterns(&ignore_src).map_err(|e| format!("watch: {e}"))?;

    let pool = open_config_pool(cfg)
        .await
        .map_err(|e| format!("watch: open pool: {e}"))?;
    let run_id = current_run_id(&pool, watch.id).await;

    let mut changed: Vec<String> = Vec::new();
    let mut unchanged = 0usize;
    let mut errors: Vec<serde_json::Value> = Vec::new();
    let mut summaries: Vec<serde_json::Value> = Vec::new();

    for url in &urls {
        let outcome = detect_url_change(cfg, &pool, watch.id, url, &ignore, threshold).await;
        if let Some(err) = &outcome.error {
            errors.push(serde_json::json!({ "url": url, "error": err }));
        }
        if outcome.meaningful {
            changed.push(url.clone());
            if let (Some(diff), Some(run_id)) = (&outcome.diff, run_id) {
                let summary = if do_summary {
                    summarize_diff(cfg, url, diff).await
                } else {
                    None
                };
                if let Some(s) = &summary {
                    summaries.push(serde_json::json!({ "url": url, "summary": s }));
                }
                let _ = write_change_artifact(&pool, run_id, url, diff, summary).await;
            }
        } else if outcome.error.is_none() {
            unchanged += 1;
        }
    }

    let (clusters_out, dispatched, cluster_errors) =
        dispatch_clusters(&pool, cfg, watch.id, &changed, max_depth).await;
    errors.extend(cluster_errors);

    Ok(serde_json::json!({
        "mode": "url-change-watch",
        "checked": urls.len(),
        "changed": changed.len(),
        "unchanged": unchanged,
        "clusters": clusters_out,
        "dispatched": dispatched,
        "summaries": summaries,
        "errors": errors,
    }))
}
