use crate::crates::core::config::Config;
use crate::crates::services::query as query_service;
use std::error::Error;

/// CLI shim for the evaluate command.
pub async fn run_evaluate(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let question = cfg
        .query
        .clone()
        .or_else(|| (!cfg.positional.is_empty()).then(|| cfg.positional.join(" ")))
        .ok_or("evaluate requires a question")?;
    let result = query_service::evaluate(cfg, &question).await?;
    println!("{}", serde_json::to_string_pretty(&result.payload)?);
    Ok(())
}
