use crate::crates::core::config::Config;
use crate::crates::core::logging::{log_info, log_warn};
use crate::crates::core::ui::{accent, muted, primary};
use crate::crates::services::system;
use crate::crates::services::types::Pagination;
use crate::crates::vector::ops::qdrant::{env_usize_clamped, payload_domain, payload_url};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::env;
use std::error::Error;

use crate::crates::vector::ops::qdrant::qdrant_scroll_pages;

pub async fn run_domains(cfg: &Config) -> Result<(), Box<dyn Error>> {
    log_info("command=domains");
    if !domains_detailed_mode() && try_fast_domains(cfg).await? {
        return Ok(());
    }

    let mut by_domain: HashMap<String, (usize, HashSet<String>)> = HashMap::new();
    qdrant_scroll_pages(cfg, |points| {
        for p in points {
            let Some(payload) = p.get("payload") else {
                continue;
            };
            let domain = payload_domain(payload);
            let url = payload_url(payload);
            let entry = by_domain.entry(domain).or_insert((0, HashSet::new()));
            entry.0 += 1;
            if !url.is_empty() {
                entry.1.insert(url);
            }
        }
    })
    .await?;
    render_detailed_domains(cfg, by_domain)
}

fn domains_detailed_mode() -> bool {
    env::var("AXON_DOMAINS_DETAILED")
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false)
}

async fn try_fast_domains(cfg: &Config) -> Result<bool, Box<dyn Error>> {
    let facet_limit = env_usize_clamped("AXON_DOMAINS_FACET_LIMIT", 100_000, 1, 1_000_000);
    let pagination = Pagination {
        limit: facet_limit,
        offset: 0,
    };
    match system::domains(cfg, pagination).await {
        Ok(result) => {
            let pairs: Vec<(String, usize)> = result
                .domains
                .into_iter()
                .map(|f| (f.domain, f.vectors))
                .collect();
            render_fast_domain_results(cfg, pairs)?;
            Ok(true)
        }
        Err(err) => {
            log_warn(&format!(
                "sources_facet_fallback qdrant={} error={err}",
                cfg.qdrant_url
            ));
            Ok(false)
        }
    }
}

fn render_fast_domain_results(
    cfg: &Config,
    domains: Vec<(String, usize)>,
) -> Result<(), Box<dyn Error>> {
    if cfg.json_output {
        let mut out: BTreeMap<String, usize> = BTreeMap::new();
        for (domain, vectors) in domains {
            out.insert(domain, vectors);
        }
        println!("{}", serde_json::to_string_pretty(&out)?);
        return Ok(());
    }
    println!("{}", primary("Domains"));
    for (domain, vectors) in domains {
        println!(
            "  {} {}",
            accent(&domain),
            muted(&format!("vectors={vectors}"))
        );
    }
    println!(
        "{}",
        muted("Tip: set AXON_DOMAINS_DETAILED=1 for exact per-domain unique URL counts (slower).")
    );
    Ok(())
}

fn render_detailed_domains(
    cfg: &Config,
    by_domain: HashMap<String, (usize, HashSet<String>)>,
) -> Result<(), Box<dyn Error>> {
    if cfg.json_output {
        let mut out: BTreeMap<String, (usize, usize)> = BTreeMap::new();
        for (domain, (vectors, urls)) in by_domain {
            out.insert(domain, (vectors, urls.len()));
        }
        println!("{}", serde_json::to_string_pretty(&out)?);
    } else {
        println!("{}", primary("Domains"));
        let mut rows: Vec<_> = by_domain.into_iter().collect();
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        for (domain, (vectors, urls)) in rows {
            println!(
                "  {} {}",
                accent(&domain),
                muted(&format!("urls={} vectors={}", urls.len(), vectors))
            );
        }
    }
    Ok(())
}
