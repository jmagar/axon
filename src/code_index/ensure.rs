use std::sync::Arc;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use tokio::sync::Mutex;

use crate::code_index::config::{
    CodeIndexIdentity, DEFAULT_FRESHNESS_TTL, DEFAULT_REINDEX_TIMEOUT,
};
use crate::code_index::indexer::{ReindexSummary, reindex_changed_files};
use crate::code_index::manifest::{ManifestOptions, build_manifest};
use crate::code_index::store::CodeIndexStore;
use crate::services::context::ServiceContext;

static FRESH_UNTIL: LazyLock<DashMap<String, Instant>> = LazyLock::new(DashMap::new);
static SINGLE_FLIGHT: LazyLock<DashMap<String, Arc<Mutex<()>>>> = LazyLock::new(DashMap::new);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EnsureFreshOutcome {
    pub indexed_files: usize,
    pub removed_files: usize,
    pub warning: Option<FreshnessWarning>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FreshnessWarning {
    RefreshTimedOut { timeout_ms: u64 },
    RefreshFailed { error: String },
    RefreshAlreadyRunning,
}

#[derive(Debug, Clone)]
pub(crate) struct EnsureFreshOptions {
    pub freshness_ttl: Duration,
    pub reindex_timeout: Duration,
    pub manifest_options: ManifestOptions,
}

impl Default for EnsureFreshOptions {
    fn default() -> Self {
        Self {
            freshness_ttl: DEFAULT_FRESHNESS_TTL,
            reindex_timeout: DEFAULT_REINDEX_TIMEOUT,
            manifest_options: ManifestOptions::default(),
        }
    }
}

pub(crate) async fn ensure_fresh(
    ctx: &ServiceContext,
    identity: &CodeIndexIdentity,
    options: EnsureFreshOptions,
) -> anyhow::Result<EnsureFreshOutcome> {
    if FRESH_UNTIL
        .get(&identity.project_key)
        .is_some_and(|deadline| *deadline > Instant::now())
    {
        return Ok(EnsureFreshOutcome {
            indexed_files: 0,
            removed_files: 0,
            warning: None,
        });
    }

    let lock = SINGLE_FLIGHT
        .entry(identity.project_key.clone())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone();
    let _guard = lock.lock().await;

    if FRESH_UNTIL
        .get(&identity.project_key)
        .is_some_and(|deadline| *deadline > Instant::now())
    {
        return Ok(EnsureFreshOutcome {
            indexed_files: 0,
            removed_files: 0,
            warning: None,
        });
    }

    let store = CodeIndexStore::open_for_context(ctx).await?;
    let owner = format!("{}:{}", std::process::id(), uuid::Uuid::new_v4());
    let lease_ms = options
        .reindex_timeout
        .saturating_add(Duration::from_secs(5))
        .as_millis() as i64;
    if !store.acquire_lease(identity, &owner, lease_ms).await? {
        return Ok(EnsureFreshOutcome {
            indexed_files: 0,
            removed_files: 0,
            warning: Some(FreshnessWarning::RefreshAlreadyRunning),
        });
    }

    let result = refresh_under_lease(ctx, &store, identity, &options).await;
    let release_result = store.release_lease(identity, &owner).await;
    if let Err(err) = release_result {
        tracing::warn!(error = %err, "code-search freshness lease release failed");
    }

    let outcome = match result {
        Ok(summary) => {
            FRESH_UNTIL.insert(
                identity.project_key.clone(),
                Instant::now() + options.freshness_ttl,
            );
            EnsureFreshOutcome {
                indexed_files: summary.indexed_files,
                removed_files: summary.removed_files,
                warning: None,
            }
        }
        Err(RefreshError::TimedOut) => EnsureFreshOutcome {
            indexed_files: 0,
            removed_files: 0,
            warning: Some(FreshnessWarning::RefreshTimedOut {
                timeout_ms: options.reindex_timeout.as_millis() as u64,
            }),
        },
        Err(RefreshError::Failed(error)) => EnsureFreshOutcome {
            indexed_files: 0,
            removed_files: 0,
            warning: Some(FreshnessWarning::RefreshFailed { error }),
        },
    };
    Ok(outcome)
}

enum RefreshError {
    TimedOut,
    Failed(String),
}

async fn refresh_under_lease(
    ctx: &ServiceContext,
    store: &CodeIndexStore,
    identity: &CodeIndexIdentity,
    options: &EnsureFreshOptions,
) -> Result<ReindexSummary, RefreshError> {
    let manifest = build_manifest(store, identity, options.manifest_options)
        .await
        .map_err(|err| RefreshError::Failed(err.to_string()))?;
    let diff = store
        .diff_manifest(identity, &manifest)
        .await
        .map_err(|err| RefreshError::Failed(err.to_string()))?;
    if diff.is_empty() {
        store
            .touch_last_checked(identity)
            .await
            .map_err(|err| RefreshError::Failed(err.to_string()))?;
        return Ok(ReindexSummary::default());
    }

    tokio::time::timeout(
        options.reindex_timeout,
        reindex_changed_files(ctx.cfg(), store, identity, &manifest, &diff),
    )
    .await
    .map_err(|_| RefreshError::TimedOut)?
    .map_err(|err| RefreshError::Failed(err.to_string()))
}

impl FreshnessWarning {
    pub(crate) fn message(&self) -> String {
        match self {
            Self::RefreshTimedOut { timeout_ms } => {
                format!("refresh timed out after {timeout_ms}ms; stale index used")
            }
            Self::RefreshFailed { error } => {
                format!("refresh failed: {error}; stale index used")
            }
            Self::RefreshAlreadyRunning => "refresh already running; stale index used".to_string(),
        }
    }
}
