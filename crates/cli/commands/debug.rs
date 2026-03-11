use crate::crates::core::config::Config;
use crate::crates::core::ui::{muted, primary};
use crate::crates::services::debug as debug_service;
use serde_json::Value;
use std::error::Error;

fn bool_field(value: &Value, path: &[&str]) -> bool {
    let mut current = value;
    for key in path {
        current = current.get(*key).unwrap_or(&Value::Null);
    }
    current.as_bool().unwrap_or(false)
}

fn string_field<'a>(value: &'a Value, path: &[&str]) -> &'a str {
    let mut current = value;
    for key in path {
        current = current.get(*key).unwrap_or(&Value::Null);
    }
    current.as_str().unwrap_or("")
}

pub async fn run_debug(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let user_context = if cfg.positional.is_empty() {
        String::new()
    } else {
        cfg.positional.join(" ")
    };
    let result = debug_service::debug_report(cfg, &user_context).await?;

    if cfg.json_output {
        println!("{}", serde_json::to_string_pretty(&result.payload)?);
        return Ok(());
    }

    let doctor_report = &result.payload["doctor_report"];
    let analysis = result.payload["llm_debug"]["analysis"]
        .as_str()
        .unwrap_or("(no debug response)");

    println!("{}", primary("Debug Snapshot"));
    println!(
        "  {} {}",
        muted("overall:"),
        if bool_field(doctor_report, &["all_ok"]) {
            "healthy"
        } else {
            "degraded"
        }
    );
    println!(
        "  {} {}",
        muted("tei:"),
        string_field(doctor_report, &["services", "tei", "model"])
    );
    println!(
        "  {} {}",
        muted("openai model:"),
        string_field(doctor_report, &["services", "openai", "model"])
    );
    println!();
    println!("{}", primary("LLM Debug"));
    println!("{analysis}");

    Ok(())
}
