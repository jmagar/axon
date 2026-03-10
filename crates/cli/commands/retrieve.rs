use crate::crates::core::config::Config;
use crate::crates::core::logging::log_info;
use crate::crates::core::ui::{muted, primary};
use crate::crates::services::query as query_svc;
use crate::crates::services::types::RetrieveOptions;
use std::error::Error;

pub async fn run_retrieve(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let target = cfg.positional.first().ok_or("retrieve requires URL")?;
    log_info(&format!("command=retrieve url={target}"));

    let opts = RetrieveOptions { max_points: None };
    let result = query_svc::retrieve(cfg, target, opts).await?;

    let chunk_count = result
        .chunks
        .first()
        .and_then(|c| c.get("chunk_count"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;
    let content = result
        .chunks
        .first()
        .and_then(|c| c.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if chunk_count == 0 {
        println!("No content found for URL: {}", target);
        return Ok(());
    }

    if cfg.json_output {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "url": target,
                "chunks": chunk_count,
                "content": content.trim()
            }))?
        );
    } else {
        println!("{}", primary(&format!("Retrieve Result for {target}")));
        println!("{} {}\n", muted("Chunks:"), chunk_count);
        println!("{}", content.trim());
    }

    Ok(())
}
