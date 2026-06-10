mod enqueue;
mod lifecycle;
mod retry;

pub(crate) use retry::is_lock_busy;

/// Stable identifier for the filesystem namespace this process can read.
///
/// Used for embed-job claim affinity (axon_rust-p2oc): a path-like embed input
/// enqueued on the host must not be claimed by the axon container's workers
/// (and vice versa) — neither can see the other's filesystem. Resolution:
/// `AXON_FS_NAMESPACE` env (compose sets a stable value for the container;
/// container hostnames change on every recreate) → kernel hostname → "local".
pub fn fs_namespace() -> String {
    if let Ok(ns) = std::env::var("AXON_FS_NAMESPACE") {
        let ns = ns.trim().to_string();
        if !ns.is_empty() {
            return ns;
        }
    }
    std::fs::read_to_string("/proc/sys/kernel/hostname")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "local".to_string())
}

pub use enqueue::{enqueue_job, enqueue_job_with_sidecar};
pub use lifecycle::{
    ClaimedJob, cancel_row, claim_next_pending, claim_next_pending_for_attempt, mark_completed,
    mark_completed_for_attempt, mark_failed, mark_failed_for_attempt, touch_heartbeat,
    touch_heartbeat_for_attempt, update_result_json, update_result_json_for_attempt,
};

#[cfg(test)]
#[path = "ops_tests.rs"]
mod tests;
