use crate::ingest::sessions::watch::validate::ValidatedSessionPath;
use anyhow::Result;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncReadExt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFileMetadata {
    pub canonical: PathBuf,
    pub path_hash: String,
    pub provider: String,
    pub basename: String,
    pub redacted_display: String,
    pub file_size: u64,
    pub file_mtime_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SessionWatchError {
    pub path_hash: String,
    pub provider: String,
    pub basename: String,
    pub error_code: String,
    pub error_redacted: String,
    pub occurred_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SessionWatchStatus {
    pub checkpoint_count: i64,
    pub error_count: i64,
    pub recent_errors: Vec<SessionWatchError>,
}

impl SessionFileMetadata {
    pub fn from_validated_path(path: &ValidatedSessionPath) -> Result<Self> {
        let metadata = std::fs::metadata(&path.canonical)?;
        let file_size = metadata.len();
        let file_mtime_ms = metadata
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        Ok(Self {
            canonical: path.canonical.clone(),
            path_hash: path.path_hash.clone(),
            provider: path.provider.as_str().to_string(),
            basename: path.basename.clone(),
            redacted_display: path.redacted_display.clone(),
            file_size,
            file_mtime_ms,
        })
    }
}

pub async fn checkpoint_metadata_matches(
    pool: &SqlitePool,
    meta: &SessionFileMetadata,
) -> Result<bool> {
    let row = sqlx::query(
        r#"
        SELECT file_size, file_mtime_ms, last_error_code
        FROM axon_session_watch_checkpoints
        WHERE path_hash = ?
        "#,
    )
    .bind(&meta.path_hash)
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some_and(|row| {
        let file_size: i64 = row.get("file_size");
        let file_mtime_ms: i64 = row.get("file_mtime_ms");
        let last_error_code: Option<String> = row.get("last_error_code");
        file_size == meta.file_size as i64
            && file_mtime_ms == meta.file_mtime_ms
            && last_error_code.is_none()
    }))
}

pub async fn stream_content_hash(path: &Path) -> Result<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub async fn record_success(
    pool: &SqlitePool,
    meta: &SessionFileMetadata,
    content_hash: Option<&str>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO axon_session_watch_checkpoints
            (path_hash, provider, basename, redacted_display, file_size, file_mtime_ms, content_hash, failure_count, next_attempt_at, last_indexed_at, last_error_code, last_error_redacted, updated_at)
        VALUES
            (?, ?, ?, ?, ?, ?, ?, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT(path_hash) DO UPDATE SET
            provider = excluded.provider,
            basename = excluded.basename,
            redacted_display = excluded.redacted_display,
            file_size = excluded.file_size,
            file_mtime_ms = excluded.file_mtime_ms,
            content_hash = excluded.content_hash,
            failure_count = 0,
            next_attempt_at = NULL,
            last_indexed_at = excluded.last_indexed_at,
            last_error_code = NULL,
            last_error_redacted = NULL,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&meta.path_hash)
    .bind(&meta.provider)
    .bind(&meta.basename)
    .bind(&meta.redacted_display)
    .bind(meta.file_size as i64)
    .bind(meta.file_mtime_ms)
    .bind(content_hash)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn record_error(
    pool: &SqlitePool,
    meta: &SessionFileMetadata,
    error_code: &str,
    error_redacted: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO axon_session_watch_errors (path_hash, provider, basename, error_code, error_redacted)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&meta.path_hash)
    .bind(&meta.provider)
    .bind(&meta.basename)
    .bind(error_code)
    .bind(error_redacted)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO axon_session_watch_checkpoints
            (path_hash, provider, basename, redacted_display, file_size, file_mtime_ms, last_error_code, last_error_redacted, failure_count, updated_at)
        VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT(path_hash) DO UPDATE SET
            provider = excluded.provider,
            basename = excluded.basename,
            redacted_display = excluded.redacted_display,
            file_size = excluded.file_size,
            file_mtime_ms = excluded.file_mtime_ms,
            last_error_code = excluded.last_error_code,
            last_error_redacted = excluded.last_error_redacted,
            failure_count = axon_session_watch_checkpoints.failure_count + 1,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&meta.path_hash)
    .bind(&meta.provider)
    .bind(&meta.basename)
    .bind(&meta.redacted_display)
    .bind(meta.file_size as i64)
    .bind(meta.file_mtime_ms)
    .bind(error_code)
    .bind(error_redacted)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_recent_errors(pool: &SqlitePool, limit: i64) -> Result<Vec<SessionWatchError>> {
    let rows = sqlx::query(
        r#"
        SELECT path_hash, provider, basename, error_code, error_redacted, occurred_at
        FROM axon_session_watch_errors
        ORDER BY id DESC
        LIMIT ?
        "#,
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| SessionWatchError {
            path_hash: row.get("path_hash"),
            provider: row.get("provider"),
            basename: row.get("basename"),
            error_code: row.get("error_code"),
            error_redacted: row.get("error_redacted"),
            occurred_at: row.get("occurred_at"),
        })
        .collect())
}

pub async fn watch_status(pool: &SqlitePool, limit: i64) -> Result<SessionWatchStatus> {
    let checkpoint_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM axon_session_watch_checkpoints")
            .fetch_one(pool)
            .await?;
    let error_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM axon_session_watch_errors")
            .fetch_one(pool)
            .await?;
    let recent_errors = list_recent_errors(pool, limit.max(0)).await?;
    Ok(SessionWatchStatus {
        checkpoint_count,
        error_count,
        recent_errors,
    })
}

pub async fn checkpoint_success_exists_for_path_hash(
    pool: &SqlitePool,
    path_hash: &str,
) -> Result<bool> {
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM axon_session_watch_checkpoints
            WHERE path_hash = ?
              AND last_error_code IS NULL
              AND last_indexed_at IS NOT NULL
            LIMIT 1
        )
        "#,
    )
    .bind(path_hash)
    .fetch_one(pool)
    .await?;
    Ok(exists)
}

#[cfg(test)]
#[path = "checkpoint_tests.rs"]
mod tests;
