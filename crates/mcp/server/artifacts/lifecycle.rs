use super::super::common::{internal_error, invalid_params};
use super::path::ensure_artifact_root;
use regex::Regex;
use rmcp::ErrorData;
use std::sync::Arc;
use std::time::SystemTime;
use tokio::task::JoinSet;

pub async fn list_artifact_files(
    limit: usize,
    offset: usize,
) -> Result<serde_json::Value, ErrorData> {
    let root = ensure_artifact_root().await?;
    let now = SystemTime::now();
    let mut entries = tokio::fs::read_dir(&root)
        .await
        .map_err(|e| internal_error(format!("failed to read artifact dir: {e}")))?;
    let mut files: Vec<serde_json::Value> = Vec::new();
    let mut total_bytes = 0u64;
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| internal_error(e.to_string()))?
    {
        let meta = entry
            .metadata()
            .await
            .map_err(|e| internal_error(e.to_string()))?;
        if meta.is_dir() {
            continue;
        }
        let bytes = meta.len();
        total_bytes += bytes;
        let modified_secs_ago = meta
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        files.push(serde_json::json!({
            "name": entry.file_name().to_string_lossy(),
            "bytes": bytes,
            "modified_secs_ago": modified_secs_ago,
            "path": entry.path(),
        }));
    }
    files.sort_by_key(|f| f["modified_secs_ago"].as_u64().unwrap_or(u64::MAX));
    let total_count = files.len();
    let page: Vec<_> = files.into_iter().skip(offset).take(limit).collect();
    Ok(serde_json::json!({
        "artifact_dir": root,
        "total_count": total_count,
        "count": page.len(),
        "offset": offset,
        "limit": limit,
        "total_bytes": total_bytes,
        "files": page,
    }))
}

pub async fn delete_artifact_file(path: &std::path::Path) -> Result<u64, ErrorData> {
    let meta = tokio::fs::metadata(path)
        .await
        .map_err(|e| internal_error(format!("failed to stat artifact: {e}")))?;
    let bytes = meta.len();
    tokio::fs::remove_file(path)
        .await
        .map_err(|e| internal_error(format!("failed to delete artifact: {e}")))?;
    Ok(bytes)
}

pub async fn clean_artifact_files(
    max_age_hours: u64,
    dry_run: bool,
) -> Result<serde_json::Value, ErrorData> {
    let root = ensure_artifact_root().await?;
    let now = SystemTime::now();
    let cutoff_secs = max_age_hours * 3600;
    let mut entries = tokio::fs::read_dir(&root)
        .await
        .map_err(|e| internal_error(format!("failed to read artifact dir: {e}")))?;
    let mut scanned = 0usize;
    let mut candidates: Vec<serde_json::Value> = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| internal_error(e.to_string()))?
    {
        let meta = entry
            .metadata()
            .await
            .map_err(|e| internal_error(e.to_string()))?;
        // Never recurse into subdirs (screenshots/ etc.)
        if meta.is_dir() {
            continue;
        }
        scanned += 1;
        let age_secs = meta
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if age_secs >= cutoff_secs {
            let age_hours = (age_secs as f64 / 3600.0 * 10.0).round() / 10.0;
            candidates.push(serde_json::json!({
                "name": entry.file_name().to_string_lossy(),
                "path": entry.path(),
                "age_hours": age_hours,
                "bytes": meta.len(),
            }));
        }
    }
    let would_free: u64 = candidates.iter().filter_map(|c| c["bytes"].as_u64()).sum();
    if dry_run {
        return Ok(serde_json::json!({
            "dry_run": true,
            "max_age_hours": max_age_hours,
            "scanned": scanned,
            "would_delete": candidates.len(),
            "would_free_bytes": would_free,
            "files": candidates,
        }));
    }
    let mut deleted = 0u64;
    let mut freed = 0u64;
    let mut errors: Vec<serde_json::Value> = Vec::new();
    for candidate in &candidates {
        let path_str = candidate["path"].as_str().unwrap_or("");
        match tokio::fs::remove_file(path_str).await {
            Ok(_) => {
                deleted += 1;
                freed += candidate["bytes"].as_u64().unwrap_or(0);
            }
            Err(e) => errors.push(serde_json::json!({ "path": path_str, "error": e.to_string() })),
        }
    }
    Ok(serde_json::json!({
        "dry_run": false,
        "max_age_hours": max_age_hours,
        "scanned": scanned,
        "deleted": deleted,
        "freed_bytes": freed,
        "errors": errors,
        "files": candidates,
    }))
}

pub async fn search_artifact_files(
    pattern: &str,
    limit: usize,
) -> Result<serde_json::Value, ErrorData> {
    let re = Arc::new(
        Regex::new(pattern).map_err(|e| invalid_params(format!("invalid regex pattern: {e}")))?,
    );
    let root = ensure_artifact_root().await?;
    let mut entries = tokio::fs::read_dir(&root)
        .await
        .map_err(|e| internal_error(format!("failed to read artifact dir: {e}")))?;

    // Collect all file paths first, then fan-out reads concurrently.
    let mut paths: Vec<(String, std::path::PathBuf)> = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| internal_error(e.to_string()))?
    {
        let meta = entry
            .metadata()
            .await
            .map_err(|e| internal_error(e.to_string()))?;
        if meta.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        paths.push((name, entry.path()));
    }
    let files_scanned = paths.len();

    let sem = Arc::new(tokio::sync::Semaphore::new(8));
    let mut set: JoinSet<Vec<serde_json::Value>> = JoinSet::new();
    for (name, path) in paths {
        let re = Arc::clone(&re);
        let sem = Arc::clone(&sem);
        set.spawn(async move {
            let _permit = match sem.acquire_owned().await {
                Ok(p) => p,
                Err(_) => return Vec::new(),
            };
            let text = match tokio::fs::read_to_string(&path).await {
                Ok(t) => t,
                Err(_) => return Vec::new(),
            };
            text.lines()
                .enumerate()
                .filter(|(_, line)| re.is_match(line))
                .map(|(idx, line)| {
                    serde_json::json!({
                        "file": name,
                        "line": idx + 1,
                        "text": line,
                    })
                })
                .collect()
        });
    }

    let mut matches: Vec<serde_json::Value> = Vec::new();
    while let Some(result) = set.join_next().await {
        if let Ok(file_matches) = result {
            for m in file_matches {
                matches.push(m);
                if matches.len() >= limit {
                    set.abort_all();
                    break;
                }
            }
        }
    }

    Ok(serde_json::json!({
        "pattern": pattern,
        "files_scanned": files_scanned,
        "matches": matches,
        "limit": limit,
    }))
}
