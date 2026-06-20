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
}

pub(crate) async fn ensure_fresh() -> anyhow::Result<EnsureFreshOutcome> {
    Ok(EnsureFreshOutcome {
        indexed_files: 0,
        removed_files: 0,
        warning: None,
    })
}
