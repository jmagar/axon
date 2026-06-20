use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use crate::core::logging::log_warn;

const DEFAULT_ABORT_PERCENT: f64 = 85.0;
const POLL_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy)]
pub(crate) struct MemorySnapshot {
    pub(crate) rss_bytes: u64,
    pub(crate) total_bytes: u64,
}

pub(crate) fn should_abort_for_usage(snapshot: MemorySnapshot, abort_percent: f64) -> bool {
    if snapshot.total_bytes == 0 || abort_percent <= 0.0 {
        return false;
    }
    let used_percent = (snapshot.rss_bytes as f64 / snapshot.total_bytes as f64) * 100.0;
    used_percent >= abort_percent
}

pub(crate) struct CrawlMemoryGuard {
    cancel: CancellationToken,
    abort_reason: Arc<Mutex<Option<String>>>,
}

impl CrawlMemoryGuard {
    pub(crate) fn spawn(crawl_id: Option<&str>, start_url: &str) -> Self {
        let cancel = CancellationToken::new();
        let abort_reason = Arc::new(Mutex::new(None));
        let Some(abort_percent) = abort_percent_from_env() else {
            return Self {
                cancel,
                abort_reason,
            };
        };

        let target = crawl_id.map(|id| format!("{id}{start_url}"));
        let url = start_url.to_string();
        let cancel_task = cancel.clone();
        let reason_task = Arc::clone(&abort_reason);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(POLL_INTERVAL);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tokio::select! {
                    _ = cancel_task.cancelled() => break,
                    _ = ticker.tick() => {
                        let Some(snapshot) = linux_memory_snapshot() else {
                            continue;
                        };
                        if !should_abort_for_usage(snapshot, abort_percent) {
                            continue;
                        }
                        let reason = format!(
                            "crawl memory guard tripped for {url}: rss={} bytes total={} bytes threshold={abort_percent:.1}%",
                            snapshot.rss_bytes, snapshot.total_bytes
                        );
                        log_warn(&reason);
                        if let Ok(mut slot) = reason_task.lock() {
                            *slot = Some(reason);
                        }
                        if let Some(target) = target.as_deref() {
                            spider::utils::shutdown(target).await;
                        }
                        break;
                    }
                }
            }
        });

        Self {
            cancel,
            abort_reason,
        }
    }

    pub(crate) fn stop(&self) {
        self.cancel.cancel();
    }

    pub(crate) fn abort_reason(&self) -> Option<String> {
        self.abort_reason.lock().ok().and_then(|slot| slot.clone())
    }
}

fn abort_percent_from_env() -> Option<f64> {
    let raw = std::env::var("AXON_CRAWL_MEMORY_ABORT_PERCENT").ok();
    let percent = match raw.as_deref() {
        Some(value) => value.parse::<f64>().unwrap_or(DEFAULT_ABORT_PERCENT),
        None => DEFAULT_ABORT_PERCENT,
    };
    (percent > 0.0).then_some(percent.clamp(1.0, 100.0))
}

#[cfg(target_os = "linux")]
fn linux_memory_snapshot() -> Option<MemorySnapshot> {
    let rss_bytes = read_status_rss_bytes()?;
    let total_bytes = read_meminfo_total_bytes()?;
    Some(MemorySnapshot {
        rss_bytes,
        total_bytes,
    })
}

#[cfg(not(target_os = "linux"))]
fn linux_memory_snapshot() -> Option<MemorySnapshot> {
    None
}

#[cfg(target_os = "linux")]
fn read_status_rss_bytes() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status.lines().find_map(|line| {
        let value = line.strip_prefix("VmRSS:")?.trim();
        parse_kib_line(value)
    })
}

#[cfg(target_os = "linux")]
fn read_meminfo_total_bytes() -> Option<u64> {
    let meminfo = std::fs::read_to_string("/proc/meminfo").ok()?;
    meminfo.lines().find_map(|line| {
        let value = line.strip_prefix("MemTotal:")?.trim();
        parse_kib_line(value)
    })
}

#[cfg(target_os = "linux")]
fn parse_kib_line(value: &str) -> Option<u64> {
    let kib = value.split_whitespace().next()?.parse::<u64>().ok()?;
    kib.checked_mul(1024)
}
