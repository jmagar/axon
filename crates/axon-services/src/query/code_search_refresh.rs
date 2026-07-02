use std::error::Error;
use std::path::{Path, PathBuf};

use axon_api::source::JobId;
use axon_code_index::ensure::{EnsureFreshOptions, ensure_fresh_with_progress};
use axon_code_index::{CodeIndexIdentity, FreshnessWarning, ReindexProgressSink};

use crate::context::ServiceContext;
use crate::local_source::{
    LocalSourceIndexInput, LocalSourceSelectionPolicy, index_local_source_with_job,
};
use crate::types::{CodeSearchCaller, CodeSearchFreshness};

use super::{
    code_index_pool, code_search_committed_generation, code_search_freshness, code_search_identity,
    resolve_code_search_root,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeSearchRefreshBackend {
    LegacyCodeIndex,
    TargetLocalSource,
}
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CodeSearchRefreshResult {
    pub project_root: PathBuf,
    pub project_key: String,
    pub generation: Option<i64>,
    pub freshness: CodeSearchFreshness,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CodeSearchProjectResult {
    pub project_root: PathBuf,
    pub project_key: String,
}

#[must_use = "resolve_code_search_project returns a Result that should be handled"]
pub async fn resolve_code_search_project(
    ctx: &ServiceContext,
    cwd: Option<&Path>,
    caller: CodeSearchCaller,
) -> Result<CodeSearchProjectResult, Box<dyn Error + Send + Sync>> {
    let root = resolve_code_search_root(cwd, caller).await?;
    let identity = code_search_identity(ctx.cfg(), root).await;
    Ok(CodeSearchProjectResult {
        project_root: identity.project_root,
        project_key: identity.project_key,
    })
}

#[must_use = "refresh_code_search_index returns a Result that should be handled"]
pub async fn refresh_code_search_index(
    ctx: &ServiceContext,
    cwd: Option<&Path>,
    caller: CodeSearchCaller,
) -> Result<CodeSearchRefreshResult, Box<dyn Error + Send + Sync>> {
    refresh_code_search_index_with_progress(ctx, cwd, caller, None).await
}

#[must_use = "refresh_code_search_index_with_progress returns a Result that should be handled"]
pub async fn refresh_code_search_index_with_progress(
    ctx: &ServiceContext,
    cwd: Option<&Path>,
    caller: CodeSearchCaller,
    progress: Option<&dyn ReindexProgressSink>,
) -> Result<CodeSearchRefreshResult, Box<dyn Error + Send + Sync>> {
    refresh_code_search_index_with_backend(
        ctx,
        cwd,
        caller,
        CodeSearchRefreshBackend::LegacyCodeIndex,
        progress,
    )
    .await
}

#[must_use = "refresh_code_search_index_with_backend returns a Result that should be handled"]
pub async fn refresh_code_search_index_with_backend(
    ctx: &ServiceContext,
    cwd: Option<&Path>,
    caller: CodeSearchCaller,
    backend: CodeSearchRefreshBackend,
    progress: Option<&dyn ReindexProgressSink>,
) -> Result<CodeSearchRefreshResult, Box<dyn Error + Send + Sync>> {
    match backend {
        CodeSearchRefreshBackend::LegacyCodeIndex => {
            refresh_legacy_code_search_index_with_progress(ctx, cwd, caller, progress).await
        }
        CodeSearchRefreshBackend::TargetLocalSource => {
            refresh_target_local_code_search_index_with_progress(ctx, cwd, caller).await
        }
    }
}

async fn refresh_legacy_code_search_index_with_progress(
    ctx: &ServiceContext,
    cwd: Option<&Path>,
    caller: CodeSearchCaller,
    progress: Option<&dyn ReindexProgressSink>,
) -> Result<CodeSearchRefreshResult, Box<dyn Error + Send + Sync>> {
    let root = resolve_code_search_root(cwd, caller).await?;
    let identity = code_search_identity(ctx.cfg(), root).await;
    let freshness =
        resolve_code_search_freshness_with_progress(ctx, &identity, true, progress).await;
    let generation = code_search_committed_generation(ctx, &identity).await?;
    Ok(CodeSearchRefreshResult {
        project_root: identity.project_root.clone(),
        project_key: identity.project_key.clone(),
        generation,
        freshness,
    })
}

async fn refresh_target_local_code_search_index_with_progress(
    ctx: &ServiceContext,
    cwd: Option<&Path>,
    caller: CodeSearchCaller,
) -> Result<CodeSearchRefreshResult, Box<dyn Error + Send + Sync>> {
    let root = resolve_code_search_root(cwd, caller).await?;
    let identity = code_search_identity(ctx.cfg(), root).await;
    let Some(target) = ctx.target_local_source_runtime() else {
        return Ok(CodeSearchRefreshResult {
            project_root: identity.project_root,
            project_key: identity.project_key,
            generation: None,
            freshness: code_search_freshness(
                "stale",
                Some(FreshnessWarning::Failed {
                    error: "target local source code-search refresh dependencies are not available"
                        .to_string(),
                }),
                0,
                0,
            ),
        });
    };
    let project_root = identity.project_root.clone();
    let project_key = identity.project_key.clone();
    let input = LocalSourceIndexInput {
        root: identity.project_root.clone(),
        collection: ctx.cfg().collection.clone(),
        owner_id: format!("code-search:{}", identity.project_key),
        job_id: JobId::new(uuid::Uuid::new_v4()),
        embedding_provider_id: target.embedding_provider_id.clone(),
        embedding_model: target.embedding_model.clone(),
        embedding_dimensions: target.embedding_dimensions,
        selection_policy: LocalSourceSelectionPolicy::CodeSearch,
    };
    match index_local_source_with_job(
        input,
        target.jobs.as_ref(),
        target.ledger.as_ref(),
        target.embedding_provider.as_ref(),
        target.vector_store.as_ref(),
    )
    .await
    {
        Ok(output) => {
            let result = CodeSearchRefreshResult {
                project_root: project_root.clone(),
                project_key: project_key.clone(),
                generation: None,
                freshness: code_search_freshness(
                    "stale",
                    Some(FreshnessWarning::Failed {
                        error: format!(
                            "target local source refresh indexed {} document(s), but target code-search retrieval is not wired yet; legacy index remains the queryable source",
                            output.documents_prepared
                        ),
                    }),
                    usize::try_from(output.documents_prepared).unwrap_or(usize::MAX),
                    0,
                ),
            };
            tracing::warn!(
                project_key,
                indexed_files = result.freshness.indexed_files,
                warning = ?result.freshness.warning,
                "target local source refresh completed but remains non-queryable"
            );
            Ok(result)
        }
        Err(err) => {
            let result = CodeSearchRefreshResult {
                project_root: project_root.clone(),
                project_key: project_key.clone(),
                generation: None,
                freshness: code_search_freshness(
                    "stale",
                    Some(FreshnessWarning::Failed {
                        error: err.to_string(),
                    }),
                    0,
                    0,
                ),
            };
            tracing::warn!(
            project_key,
                warning = ?result.freshness.warning,
            "target local source refresh degraded"
            );
            Ok(result)
        }
    }
}

pub(super) async fn resolve_code_search_freshness_with_progress(
    ctx: &ServiceContext,
    identity: &CodeIndexIdentity,
    ensure: bool,
    progress: Option<&dyn ReindexProgressSink>,
) -> CodeSearchFreshness {
    if !ensure {
        return code_search_freshness("skipped", None, 0, 0);
    }

    let pool = match code_index_pool(ctx) {
        Ok(pool) => pool,
        Err(err) => {
            return code_search_freshness(
                "stale",
                Some(FreshnessWarning::Failed {
                    error: err.to_string(),
                }),
                0,
                0,
            );
        }
    };

    match ensure_fresh_with_progress(
        ctx.cfg(),
        pool,
        identity,
        EnsureFreshOptions::default(),
        progress,
    )
    .await
    {
        Ok(outcome) => code_search_freshness(
            "fresh",
            outcome.warning,
            outcome.indexed_files,
            outcome.removed_files,
        ),
        Err(err) => code_search_freshness(
            "stale",
            Some(FreshnessWarning::Failed {
                error: err.to_string(),
            }),
            0,
            0,
        ),
    }
}
