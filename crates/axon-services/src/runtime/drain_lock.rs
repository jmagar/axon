//! Cross-process worker liveness lock.
//!
//! `axon jobs worker` (including the drainer the CLI auto-spawns after a
//! detached source enqueue) holds this lock for its lifetime so concurrent
//! CLI invocations can tell "a worker process is already draining this data
//! dir" apart from "nobody will pick this job up". The lock is a dedicated
//! zero-table SQLite database held under `BEGIN EXCLUSIVE`: the kernel drops
//! the underlying file lock when the holding process exits (including
//! SIGKILL), so there is no stale-pidfile or TTL-lease failure mode, and the
//! same code path works on Linux, macOS, and Windows.
//!
//! The lock is advisory for *spawn dedup only* — job execution correctness
//! never depends on it. Workers claim jobs transactionally from the unified
//! store, so two racing drainers (or a drainer racing `axon serve`) merely
//! split the queue between them.

use std::error::Error;
use std::path::{Path, PathBuf};
use std::time::Duration;

use sqlx::ConnectOptions;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};

pub type DrainLockResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

/// File name of the lock database inside the axon data dir.
pub const DRAIN_LOCK_FILE: &str = "worker-drain.lock";

/// Resolve the lock path for a data dir.
pub fn drain_lock_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DRAIN_LOCK_FILE)
}

/// Held for the lifetime of a worker process. Dropping (or process exit)
/// releases the exclusive lock.
pub struct WorkerDrainLock {
    // Keeping the connection alive keeps the EXCLUSIVE transaction (and the
    // OS-level file lock backing it) held.
    _conn: SqliteConnection,
}

impl WorkerDrainLock {
    /// Try to become the worker-lock holder for `path`.
    ///
    /// Returns `Ok(None)` when another live process already holds the lock.
    pub async fn try_hold(path: &Path) -> DrainLockResult<Option<Self>> {
        let mut conn = match connect(path).await? {
            Some(conn) => conn,
            None => return Ok(None),
        };
        match sqlx::query("BEGIN EXCLUSIVE").execute(&mut conn).await {
            Ok(_) => Ok(Some(Self { _conn: conn })),
            Err(err) if is_busy(&err) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    /// Probe whether some other process currently holds the lock, without
    /// keeping it. Used by enqueue paths to skip a redundant worker spawn.
    pub async fn is_held(path: &Path) -> DrainLockResult<bool> {
        match Self::try_hold(path).await? {
            Some(guard) => {
                drop(guard);
                Ok(false)
            }
            None => Ok(true),
        }
    }
}

async fn connect(path: &Path) -> DrainLockResult<Option<SqliteConnection>> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .busy_timeout(Duration::from_millis(0))
        .disable_statement_logging();
    match options.connect().await {
        Ok(conn) => Ok(Some(conn)),
        // Another holder can make even connection-time pragmas return BUSY;
        // treat that the same as failing to take the exclusive lock.
        Err(err) if is_busy(&err) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn is_busy(err: &sqlx::Error) -> bool {
    match err {
        sqlx::Error::Database(db) => {
            let message = db.message();
            message.contains("locked") || message.contains("busy")
        }
        _ => false,
    }
}

#[cfg(test)]
#[path = "drain_lock_tests.rs"]
mod tests;
