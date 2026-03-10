use crate::crates::core::config::Config;
use crate::crates::vector::ops::run_evaluate_native;
use std::error::Error;

/// CLI shim for the evaluate command.
///
/// Currently delegates directly to `run_evaluate_native` in the vector/ops layer.
/// Phase 2 will extract the business logic into a service function and have this
/// file handle only output formatting.
pub async fn run_evaluate(cfg: &Config) -> Result<(), Box<dyn Error>> {
    run_evaluate_native(cfg).await
}
