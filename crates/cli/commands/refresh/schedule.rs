mod add;
mod run_due;
mod worker;

use crate::crates::core::config::Config;
use crate::crates::core::ui::{accent, muted, status_text, symbol_for_status};
use crate::crates::jobs::watch::list_watch_defs;
use crate::crates::services::refresh as refresh_service;
use std::error::Error;

pub use run_due::handle_refresh_schedule_run_due;
#[cfg(test)]
pub use worker::refresh_schedule_tick_secs_default;

pub(super) const REFRESH_TIER_HIGH_SECONDS: i64 = 1800;
pub(super) const REFRESH_TIER_MEDIUM_SECONDS: i64 = 21600;
pub(super) const REFRESH_TIER_LOW_SECONDS: i64 = 86400;

pub fn tier_to_seconds(tier: &str) -> Option<i64> {
    match tier.trim().to_ascii_lowercase().as_str() {
        "high" => Some(REFRESH_TIER_HIGH_SECONDS),
        "medium" => Some(REFRESH_TIER_MEDIUM_SECONDS),
        "low" => Some(REFRESH_TIER_LOW_SECONDS),
        _ => None,
    }
}

pub async fn handle_refresh_schedule(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let action = cfg
        .positional
        .get(1)
        .map(|s| s.as_str())
        .ok_or("refresh schedule requires a subcommand")?;
    match action {
        "add" => add::handle_refresh_schedule_add(cfg).await?,
        "list" => handle_refresh_schedule_list(cfg).await?,
        "enable" => handle_refresh_schedule_enable(cfg).await?,
        "disable" => handle_refresh_schedule_disable(cfg).await?,
        "delete" => handle_refresh_schedule_delete(cfg).await?,
        "run-due" => handle_refresh_schedule_run_due(cfg).await?,
        "worker" => worker::handle_refresh_schedule_worker(cfg).await?,
        _ => return Err(format!("unknown refresh schedule subcommand: {action}").into()),
    }
    Ok(())
}

pub(super) fn schedule_name_arg(
    cfg: &Config,
    action: &str,
    index: usize,
) -> Result<String, Box<dyn Error>> {
    cfg.positional
        .get(index)
        .cloned()
        .ok_or_else(|| format!("refresh schedule {action} requires <name>").into())
}

async fn handle_refresh_schedule_list(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let (watch_defs, legacy_schedules) = tokio::try_join!(
        list_watch_defs(cfg, 500),
        refresh_service::refresh_schedule_list(cfg, 200)
    )?;
    let mut seen = std::collections::HashSet::new();
    let mut schedules: Vec<serde_json::Value> = watch_defs
        .into_iter()
        .filter(|w| w.task_type == "refresh")
        .map(|w| {
            seen.insert(w.name.clone());
            serde_json::json!({
                "name": w.name,
                "enabled": w.enabled,
                "every_seconds": w.every_seconds,
            })
        })
        .collect();
    for s in legacy_schedules {
        if !seen.contains(&s.name) {
            schedules.push(serde_json::json!({
                "name": s.name,
                "enabled": s.enabled,
                "every_seconds": s.every_seconds,
            }));
        }
    }
    if cfg.json_output {
        println!("{}", serde_json::to_string_pretty(&schedules)?);
        return Ok(());
    }

    println!("{}", crate::crates::core::ui::primary("Refresh Schedules"));
    if schedules.is_empty() {
        println!("  {}", muted("No refresh schedules found."));
        return Ok(());
    }

    for schedule in schedules {
        let enabled = schedule
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let name = schedule
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("<unknown>");
        let status = if enabled {
            status_text("running")
        } else {
            status_text("paused")
        };
        println!(
            "  {} {} {}",
            symbol_for_status("pending"),
            accent(name),
            status
        );
    }
    Ok(())
}

async fn handle_refresh_schedule_enable(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let name = schedule_name_arg(cfg, "enable", 2)?;
    let updated = refresh_service::refresh_schedule_enable(cfg, &name).await?;
    if cfg.json_output {
        println!(
            "{}",
            serde_json::json!({"name": name, "enabled": true, "updated": updated})
        );
    } else if updated {
        println!(
            "{} enabled refresh schedule {}",
            symbol_for_status("completed"),
            accent(&name)
        );
    } else {
        println!(
            "{} refresh schedule not found: {}",
            symbol_for_status("error"),
            accent(&name)
        );
    }
    Ok(())
}

async fn handle_refresh_schedule_disable(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let name = schedule_name_arg(cfg, "disable", 2)?;
    let updated = refresh_service::refresh_schedule_disable(cfg, &name).await?;
    if cfg.json_output {
        println!(
            "{}",
            serde_json::json!({"name": name, "enabled": false, "updated": updated})
        );
    } else if updated {
        println!(
            "{} disabled refresh schedule {}",
            symbol_for_status("completed"),
            accent(&name)
        );
    } else {
        println!(
            "{} refresh schedule not found: {}",
            symbol_for_status("error"),
            accent(&name)
        );
    }
    Ok(())
}

async fn handle_refresh_schedule_delete(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let name = schedule_name_arg(cfg, "delete", 2)?;
    let deleted = refresh_service::refresh_schedule_delete(cfg, &name).await?;
    if cfg.json_output {
        println!("{}", serde_json::json!({"name": name, "deleted": deleted}));
    } else if deleted {
        println!(
            "{} deleted refresh schedule {}",
            symbol_for_status("completed"),
            accent(&name)
        );
    } else {
        println!(
            "{} refresh schedule not found: {}",
            symbol_for_status("error"),
            accent(&name)
        );
    }
    Ok(())
}
