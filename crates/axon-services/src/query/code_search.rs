use std::error::Error;
use std::path::{Path, PathBuf};
use std::process::Command;

use axon_code_index::config::validate_path_prefix;
use axon_code_index::store::CodeIndexStore;
use axon_code_index::{
    CodeIndexIdentity, CodeSearchAllowedRoots, FreshnessWarning, ReindexProgressSink,
};
use axon_core::config::Config;
use axon_vector::ops::commands::{CodeSearchVectorRequest, code_search_hits};

use crate::context::ServiceContext;
use crate::query::wrap_service_error;
use crate::types::{CodeSearchCaller, CodeSearchFreshness, CodeSearchOptions, CodeSearchResult};

use self::refresh::resolve_code_search_freshness_with_progress;
pub use self::refresh::{
    CodeSearchProjectResult, CodeSearchRefreshBackend, CodeSearchRefreshResult,
    refresh_code_search_index, refresh_code_search_index_with_backend,
    refresh_code_search_index_with_progress, resolve_code_search_project,
};

#[path = "code_search_refresh.rs"]
mod refresh;

const MAX_CODE_SEARCH_QUERY_LEN_BYTES: usize = 64 * 1024;
const CODE_SEARCH_GIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Search one local git checkout after optionally refreshing its local-code vectors.
#[must_use = "code_search returns a Result that should be handled"]
pub async fn code_search(
    ctx: &ServiceContext,
    text: &str,
    opts: CodeSearchOptions,
) -> Result<CodeSearchResult, Box<dyn Error + Send + Sync>> {
    code_search_with_progress(ctx, text, opts, None).await
}

#[must_use = "code_search_with_progress returns a Result that should be handled"]
pub async fn code_search_with_progress(
    ctx: &ServiceContext,
    text: &str,
    opts: CodeSearchOptions,
    progress: Option<&dyn ReindexProgressSink>,
) -> Result<CodeSearchResult, Box<dyn Error + Send + Sync>> {
    if text.len() > MAX_CODE_SEARCH_QUERY_LEN_BYTES {
        return Err(format!(
            "code_search query exceeds {MAX_CODE_SEARCH_QUERY_LEN_BYTES}-byte cap (got {} bytes)",
            text.len()
        )
        .into());
    }

    let path_prefix = opts
        .path_prefix
        .as_deref()
        .map(validate_path_prefix)
        .transpose()?
        .flatten();
    let root = resolve_code_search_root(opts.cwd.as_deref(), opts.caller).await?;
    let identity = code_search_identity(ctx.cfg(), root).await;
    let freshness =
        resolve_code_search_freshness_with_progress(ctx, &identity, opts.ensure_fresh, progress)
            .await;
    let Some(committed_generation) = code_search_committed_generation(ctx, &identity).await? else {
        return Ok(code_search_missing_index_result(text, freshness));
    };

    let results = code_search_hits(
        ctx.cfg(),
        CodeSearchVectorRequest {
            query: text,
            limit: opts.limit.max(1),
            offset: opts.offset,
            project_key: &identity.project_key,
            generation: committed_generation,
            path_prefix: path_prefix.as_deref(),
        },
    )
    .await
    .map_err(|e| -> Box<dyn Error + Send + Sync> {
        let message = format!(
            "code_search vector query failed for {}: {e}",
            text.chars().take(80).collect::<String>()
        );
        wrap_service_error(message, e.as_ref())
    })?;

    Ok(CodeSearchResult {
        query: text.to_string(),
        content_trust: "untrusted_local_code".to_string(),
        results,
        freshness,
    })
}

/// Extract the SQLite pool backing the code index from the service runtime.
/// Code-index functions take the raw pool (not `ServiceContext`) so they live
/// below the services layer without a dependency cycle.
pub(super) fn code_index_pool(
    ctx: &ServiceContext,
) -> Result<sqlx::SqlitePool, Box<dyn Error + Send + Sync>> {
    ctx.jobs
        .sqlite_pool()
        .map(|pool| pool.as_ref().clone())
        .ok_or_else(|| "code search requires a SQLite service runtime".into())
}

pub(super) async fn code_search_committed_generation(
    ctx: &ServiceContext,
    identity: &CodeIndexIdentity,
) -> Result<Option<i64>, Box<dyn Error + Send + Sync>> {
    let store = CodeIndexStore::open_for_pool(code_index_pool(ctx)?).await?;
    let generation = store.committed_generation(identity).await?.unwrap_or(0);
    Ok((generation > 0).then_some(generation))
}

fn code_search_missing_index_result(
    text: &str,
    freshness: CodeSearchFreshness,
) -> CodeSearchResult {
    CodeSearchResult {
        query: text.to_string(),
        content_trust: "untrusted_local_code".to_string(),
        results: Vec::new(),
        freshness: code_search_missing_index_freshness(freshness),
    }
}

pub(crate) fn code_search_freshness(
    status: &str,
    warning: Option<FreshnessWarning>,
    indexed_files: usize,
    removed_files: usize,
) -> CodeSearchFreshness {
    let status = if warning.is_some() { "stale" } else { status };
    CodeSearchFreshness {
        status: status.to_string(),
        warning: warning.map(|warning| warning.message()),
        indexed_files,
        removed_files,
    }
}

pub(crate) fn code_search_missing_index_freshness(
    mut freshness: CodeSearchFreshness,
) -> CodeSearchFreshness {
    if freshness.warning.is_none() {
        freshness.status = "stale".to_string();
        freshness.warning = Some(FreshnessWarning::MissingCommittedIndex.message());
    }
    freshness
}

pub(crate) async fn resolve_code_search_root(
    cwd: Option<&Path>,
    caller: CodeSearchCaller,
) -> Result<PathBuf, Box<dyn Error + Send + Sync>> {
    let cwd = match (caller, cwd) {
        (CodeSearchCaller::Cli, Some(cwd)) => cwd.to_path_buf(),
        (CodeSearchCaller::Cli, None) => std::env::current_dir()?,
        (CodeSearchCaller::Mcp, Some(cwd)) => cwd.to_path_buf(),
        (CodeSearchCaller::Mcp, None) => {
            return Err("code_search MCP requests must provide cwd".into());
        }
    };
    let canonical_cwd =
        std::fs::canonicalize(&cwd).map_err(|_| "code_search cwd could not be resolved")?;
    let git_root = git_toplevel(&canonical_cwd).await?;
    reject_unsafe_code_root(&git_root)?;
    if matches!(caller, CodeSearchCaller::Mcp) {
        let allowed = CodeSearchAllowedRoots::from_env()?;
        if !allowed.contains(&git_root) {
            return Err(code_search_outside_allowed_roots_message().into());
        }
    }
    Ok(git_root)
}

pub(crate) fn code_search_outside_allowed_roots_message() -> &'static str {
    "code_search cwd is outside AXON_CODE_SEARCH_ALLOWED_ROOTS"
}

async fn git_toplevel(cwd: &Path) -> Result<PathBuf, Box<dyn Error + Send + Sync>> {
    let cwd = cwd.to_path_buf();
    let output = tokio::time::timeout(
        CODE_SEARCH_GIT_TIMEOUT,
        tokio::task::spawn_blocking(move || {
            Command::new("git")
                .arg("-C")
                .arg(cwd)
                .args(["rev-parse", "--show-toplevel"])
                .output()
        }),
    )
    .await
    .map_err(|_| "git rev-parse timed out")?
    .map_err(|e| format!("git rev-parse task failed: {e}"))?
    .map_err(|_| "code_search cwd is not inside a git checkout")?;
    if !output.status.success() {
        return Err("code_search cwd is not inside a git checkout".into());
    }
    let root = String::from_utf8(output.stdout)
        .map_err(|e| format!("git rev-parse output was not UTF-8: {e}"))?;
    let root = root.trim();
    if root.is_empty() {
        return Err("git rev-parse returned an empty repository root".into());
    }
    std::fs::canonicalize(root).map_err(Into::into)
}

fn reject_unsafe_code_root(root: &Path) -> Result<(), Box<dyn Error + Send + Sync>> {
    if root == Path::new("/") {
        return Err("code_search refuses to index filesystem root".into());
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from)
        && root == home.as_path()
    {
        return Err("code_search refuses to index HOME directly".into());
    }
    Ok(())
}

pub(super) async fn code_search_identity(cfg: &Config, project_root: PathBuf) -> CodeIndexIdentity {
    let origin = code_search_project_origin(&project_root).await;
    let embedder = if cfg.tei_url.trim().is_empty() {
        "tei".to_string()
    } else {
        cfg.tei_url.clone()
    };
    CodeIndexIdentity::new(project_root, origin, &cfg.collection, &embedder)
}

pub(crate) async fn code_search_project_origin(project_root: &Path) -> String {
    let remote = match git_remote_origin(project_root).await {
        Ok(Some(remote)) => remote,
        Ok(None) => "git:no-origin".to_string(),
        Err(error) => {
            tracing::warn!(
                %error,
                project_root = %project_root.display(),
                "code_search git remote origin lookup failed; using checkout-scoped fallback"
            );
            "git:no-origin".to_string()
        }
    };
    // This seed is private input to the UUID project key. Only the derived key is
    // stored in Qdrant payloads; the absolute root remains SQLite-only.
    format!("{remote}\nworktree:{}", project_root.display())
}

async fn git_remote_origin(project_root: &Path) -> Result<Option<String>, String> {
    let project_root = project_root.to_path_buf();
    let output = tokio::time::timeout(
        CODE_SEARCH_GIT_TIMEOUT,
        tokio::task::spawn_blocking(move || {
            Command::new("git")
                .arg("-C")
                .arg(project_root)
                .args(["config", "--get", "remote.origin.url"])
                .output()
        }),
    )
    .await
    .map_err(|_| "git remote origin lookup timed out".to_string())?
    .map_err(|err| format!("git remote origin lookup task failed: {err}"))?
    .map_err(|err| format!("git remote origin lookup failed to spawn git: {err}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let origin = String::from_utf8(output.stdout)
        .map_err(|err| format!("git remote origin output was not UTF-8: {err}"))?;
    let origin = origin.trim();
    Ok((!origin.is_empty()).then(|| format!("git:{origin}")))
}

#[cfg(test)]
#[path = "code_search_tests.rs"]
mod tests;
