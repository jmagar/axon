use std::path::PathBuf;
use std::time::Duration;

mod process;
mod queue;
mod runner;
mod smoke;
mod targets;
pub mod validate;

pub use runner::run_session_watch;
pub use smoke::{SessionWatchSmokeReport, smoke_watch};

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
    pub upload_server_url: Option<String>,
    pub upload_token: Option<String>,
    pub verbose_paths: bool,
    pub json: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionsRuntimeAction {
    Watch,
    WatchStatus { limit: usize },
    SmokeWatch { timeout_secs: u64 },
}

#[cfg(test)]
pub(crate) use process::{
    ProcessOutcome, WatchOutputMode, effective_processing_concurrency,
    process_session_batch_for_watch, process_session_file_for_watch, redact_error_detail,
    upload_prepared_sessions_to_server_with_auth,
};
#[cfg(test)]
pub(crate) use queue::PendingFiles;
#[cfg(test)]
pub(crate) use targets::{WatchTarget, collect_watch_dirs, handle_remove_path, watch_targets};
#[cfg(test)]
pub(crate) use validate::ValidatedSessionPath;

#[cfg(test)]
#[path = "watch_tests.rs"]
mod tests;
