use crate::axon_cli::crates::core::config::{CommandKind, Config};
use crate::axon_cli::crates::core::http::normalize_url;

pub fn parse_urls(cfg: &Config) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(csv) = &cfg.urls_csv {
        out.extend(
            csv.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(normalize_url),
        );
    }
    out.extend(
        cfg.positional
            .iter()
            .flat_map(|s| s.split(','))
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(normalize_url),
    );
    out
}

pub fn start_url_from_cfg(cfg: &Config) -> String {
    if matches!(
        cfg.command,
        CommandKind::Crawl | CommandKind::Batch | CommandKind::Extract | CommandKind::Embed
    ) && matches!(
        cfg.positional.first().map(|s| s.as_str()),
        Some("status" | "cancel" | "errors" | "list" | "cleanup" | "clear" | "worker" | "doctor")
    ) {
        return cfg.start_url.clone();
    }

    if matches!(
        cfg.command,
        CommandKind::Scrape
            | CommandKind::Map
            | CommandKind::Crawl
            | CommandKind::Batch
            | CommandKind::Extract
            | CommandKind::Embed
    ) {
        let selected = cfg
            .positional
            .first()
            .cloned()
            .unwrap_or_else(|| cfg.start_url.clone());
        return normalize_url(&selected);
    }

    cfg.start_url.clone()
}
