use crate::crates::core::config::Config;
use crate::crates::vector::ops::run_suggest_native;
use std::error::Error;

/// CLI shim for the suggest command.
///
/// Currently delegates directly to `run_suggest_native` in the vector/ops layer.
/// Phase 2 will extract the business logic into a service function and have this
/// file handle only output formatting.
pub async fn run_suggest(cfg: &Config) -> Result<(), Box<dyn Error>> {
    run_suggest_native(cfg).await
}
