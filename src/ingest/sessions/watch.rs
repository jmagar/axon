use crate::core::config::Config;
use crate::services::context::ServiceContext;
use anyhow::Result;
use std::path::PathBuf;
use std::time::Duration;

pub mod validate;

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

pub async fn run_session_watch(
    _cfg: &Config,
    _service_context: &ServiceContext,
    _options: SessionWatchOptions,
) -> Result<()> {
    anyhow::bail!("sessions watch is wired but the watcher implementation is not complete")
}
