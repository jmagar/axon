use crate::core::config::Config;
use crate::ingest::sessions::watch::validate::{SessionWatchRoots, validate_event_path_missing_ok};
use crate::services::context::ServiceContext;
use anyhow::Result;
use std::collections::BTreeMap;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use std::time::Instant;

pub mod validate;

pub(crate) const WATCH_EVENT_BUFFER: usize = 1024;
pub(crate) const MAX_WATCH_DIRS: usize = 8192;
pub(crate) const MAX_PENDING_FILES: usize = 4096;

#[derive(Debug, Clone)]
pub struct SessionWatchOptions {
    pub path: Option<PathBuf>,
    pub debounce: Duration,
    pub settle: Duration,
    pub max_retries: u8,
    pub max_batch_docs: usize,
    pub max_processing_concurrency: usize,
    pub rescan_cooldown: Duration,
    pub initial_scan: bool,
    pub upload_to_server: bool,
    pub verbose_paths: bool,
    pub json: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionsRuntimeAction {
    Watch,
}

#[derive(Debug, Clone)]
pub(crate) enum WatchTarget {
    Directory(PathBuf),
    File { path: PathBuf, parent: PathBuf },
}

impl WatchTarget {
    fn root(&self) -> &Path {
        match self {
            Self::Directory(path) => path,
            Self::File { parent, .. } => parent,
        }
    }

    fn allowed_file(&self) -> Option<&Path> {
        match self {
            Self::Directory(_) => None,
            Self::File { path, .. } => Some(path),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PendingFile {
    last_seen: Instant,
    retries: u8,
    last_len: Option<u64>,
    last_mtime: Option<std::time::SystemTime>,
    stable_since: Option<Instant>,
}

#[derive(Debug, Default)]
pub(crate) struct PendingFiles {
    pub(crate) files: BTreeMap<PathBuf, PendingFile>,
    pub(crate) coalesced_events: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PendingState {
    NotReady,
    Stable,
    Terminal,
}

impl PendingFiles {
    pub(crate) fn push(&mut self, path: PathBuf, now: Instant) -> bool {
        if let Some(entry) = self.files.get_mut(&path) {
            entry.last_seen = now;
            self.coalesced_events += 1;
            return true;
        }
        if self.files.len() >= MAX_PENDING_FILES {
            return false;
        }
        self.files.insert(
            path,
            PendingFile {
                last_seen: now,
                retries: 0,
                last_len: None,
                last_mtime: None,
                stable_since: None,
            },
        );
        true
    }

    pub(crate) fn requeue(&mut self, path: PathBuf, now: Instant, max_retries: u8) -> bool {
        let entry = self.files.entry(path).or_insert(PendingFile {
            last_seen: now,
            retries: 0,
            last_len: None,
            last_mtime: None,
            stable_since: None,
        });
        if entry.retries >= max_retries {
            return false;
        }
        entry.retries += 1;
        entry.last_seen = now;
        entry.stable_since = None;
        true
    }

    pub(crate) fn debounced_paths(&self, now: Instant, debounce: Duration) -> Vec<PathBuf> {
        self.files
            .iter()
            .filter(|(_, entry)| now.duration_since(entry.last_seen) >= debounce)
            .map(|(path, _)| path.clone())
            .collect()
    }

    pub(crate) fn remove(&mut self, path: &Path) {
        self.files.remove(path);
    }

    pub(crate) fn clear(&mut self) {
        self.files.clear();
    }

    pub(crate) fn stable(
        &mut self,
        path: &Path,
        now: Instant,
        settle: Duration,
    ) -> Result<PendingState> {
        let Some(entry) = self.files.get_mut(path) else {
            return Ok(PendingState::Terminal);
        };
        let metadata = match std::fs::symlink_metadata(path) {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => return Ok(PendingState::Terminal),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(PendingState::Terminal);
            }
            Err(error) => return Err(error.into()),
        };
        if metadata.file_type().is_symlink() {
            return Ok(PendingState::Terminal);
        }
        let len = metadata.len();
        let mtime = metadata.modified().ok();
        if entry.last_len == Some(len) && entry.last_mtime == mtime {
            let stable_since = *entry.stable_since.get_or_insert(now);
            return Ok(if now.duration_since(stable_since) >= settle {
                PendingState::Stable
            } else {
                PendingState::NotReady
            });
        }
        entry.last_len = Some(len);
        entry.last_mtime = mtime;
        entry.stable_since = Some(now);
        Ok(PendingState::NotReady)
    }
}

fn canonical_path_allowed(canonical: &Path, targets: &[WatchTarget]) -> bool {
    targets.iter().any(|target| match target {
        WatchTarget::Directory(root) => canonical.starts_with(root),
        WatchTarget::File { path, .. } => canonical == path,
    })
}

fn event_path_allowed_missing_ok(path: &Path, targets: &[WatchTarget]) -> bool {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    canonical_path_allowed(&canonical, targets)
}

pub(crate) fn handle_remove_path(
    path: &Path,
    roots: &SessionWatchRoots,
    targets: &[WatchTarget],
    pending: &mut PendingFiles,
    _overflow_rescan: &AtomicBool,
    prune_missing: &AtomicBool,
) {
    if validate_event_path_missing_ok(roots, path).is_some()
        && event_path_allowed_missing_ok(path, targets)
    {
        pending.remove(path);
        prune_missing.store(true, Ordering::Relaxed);
    }
}

pub async fn run_session_watch(
    _cfg: &Config,
    _service_context: &ServiceContext,
    _options: SessionWatchOptions,
) -> Result<()> {
    anyhow::bail!("sessions watch is wired but the watcher implementation is not complete")
}

#[cfg(test)]
#[path = "watch_tests.rs"]
mod tests;
