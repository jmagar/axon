use super::super::types::PerformanceProfile;
use std::env;

/// Returns (crawl_concurrency, sitemap_concurrency, backfill_concurrency,
///          request_timeout_ms, fetch_retries, retry_backoff_ms)
pub(super) fn performance_defaults(
    profile: PerformanceProfile,
) -> (usize, usize, usize, u64, usize, u64) {
    let logical_cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(8);

    match profile {
        PerformanceProfile::HighStable => (
            (logical_cpus.saturating_mul(8)).clamp(64, 192),
            (logical_cpus.saturating_mul(12)).clamp(64, 256),
            (logical_cpus.saturating_mul(6)).clamp(32, 128),
            20_000,
            2,
            250,
        ),
        PerformanceProfile::Extreme => (
            (logical_cpus.saturating_mul(16)).clamp(128, 384),
            (logical_cpus.saturating_mul(20)).clamp(128, 512),
            (logical_cpus.saturating_mul(10)).clamp(64, 256),
            15_000,
            1,
            100,
        ),
        PerformanceProfile::Balanced => (
            (logical_cpus.saturating_mul(4)).clamp(32, 96),
            (logical_cpus.saturating_mul(6)).clamp(32, 128),
            (logical_cpus.saturating_mul(3)).clamp(16, 64),
            30_000,
            2,
            300,
        ),
        PerformanceProfile::Max => (
            (logical_cpus.saturating_mul(24)).clamp(256, 1024),
            (logical_cpus.saturating_mul(32)).clamp(256, 1536),
            (logical_cpus.saturating_mul(20)).clamp(128, 1024),
            12_000,
            1,
            50,
        ),
    }
}

pub(super) fn env_usize_clamped(key: &str, default: usize, min: usize, max: usize) -> usize {
    env::var(key)
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(default)
        .clamp(min, max)
}

pub(super) fn env_f64_clamped(key: &str, default: f64, min: f64, max: f64) -> f64 {
    env::var(key)
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(default)
        .clamp(min, max)
}
