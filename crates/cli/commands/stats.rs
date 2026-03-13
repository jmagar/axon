use crate::crates::core::config::Config;
use crate::crates::core::logging::log_info;
use crate::crates::services::system;
use crate::crates::vector::ops::stats::display::print_stats_human;
use std::error::Error;

pub async fn run_stats(cfg: &Config) -> Result<(), Box<dyn Error>> {
    log_info("command=stats");
    let result = system::stats(cfg).await?;
    if cfg.json_output {
        println!("{}", serde_json::to_string_pretty(&result.payload)?);
    } else {
        print_stats_human(&result.payload);
    }
    Ok(())
}
