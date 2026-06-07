use std::error::Error as StdError;
use std::sync::{Arc, LazyLock};

use dashmap::DashMap;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

#[cfg(test)]
const DEFAULT_LLM_COMPLETION_CONCURRENCY: usize = 4;

static COMPLETION_SEMAPHORES: LazyLock<DashMap<(String, usize), Arc<Semaphore>>> =
    LazyLock::new(DashMap::new);

#[cfg(test)]
fn parse_completion_concurrency_limit(raw: Option<&str>) -> usize {
    raw.and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .map(|value| value.min(Semaphore::MAX_PERMITS))
        .unwrap_or(DEFAULT_LLM_COMPLETION_CONCURRENCY)
}

pub async fn acquire_completion_permit(
    limit: usize,
) -> Result<OwnedSemaphorePermit, Box<dyn StdError + Send + Sync>> {
    acquire_completion_permit_for_key("default", limit).await
}

pub async fn acquire_completion_permit_for_key(
    key: impl Into<String>,
    limit: usize,
) -> Result<OwnedSemaphorePermit, Box<dyn StdError + Send + Sync>> {
    let normalized_limit = limit.clamp(1, Semaphore::MAX_PERMITS);
    COMPLETION_SEMAPHORES
        .entry((key.into(), normalized_limit))
        .or_insert_with(|| Arc::new(Semaphore::new(normalized_limit)))
        .clone()
        .acquire_owned()
        .await
        .map_err(|err| format!("LLM completion semaphore closed: {err}").into())
}

#[cfg(test)]
#[path = "concurrency_tests.rs"]
mod tests;
