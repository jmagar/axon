use crate::crates::cli::commands::ingest_common;
use crate::crates::core::config::Config;
use std::error::Error;

/// Top-level ingest control command alias.
///
/// This command is intentionally scoped to job-control operations (worker,
/// status, cancel, list, cleanup, clear, recover). For source-specific ingest
/// targets, use `github`, `reddit`, or `youtube`.
pub async fn run_ingest(cfg: &Config) -> Result<(), Box<dyn Error>> {
    if ingest_common::maybe_handle_ingest_subcommand(cfg, "ingest").await? {
        return Ok(());
    }
    Err("ingest requires a subcommand (status/cancel/list/cleanup/clear/worker/recover); use github/reddit/youtube for source ingestion targets".into())
}
