use crate::crates::core::config::Config;
use crate::crates::core::logging::{log_info, log_warn};
use crate::crates::vector::ops::embed_code_with_metadata;
use crate::crates::vector::ops::input::classify::{
    classify_file_type, is_test_path, language_name,
};
use futures_util::stream::{self, StreamExt};
use std::error::Error;
use std::path::{Path, PathBuf};

use super::meta::{GitHubPayloadParams, build_github_payload};
use super::{GitHubCommonFields, is_indexable_doc_path, is_indexable_source_path};

/// Extensions that have tree-sitter grammar support for AST-aware chunking.
const TREE_SITTER_EXTENSIONS: &[&str] = &["rs", "py", "js", "jsx", "ts", "tsx", "go", "sh", "bash"];

/// Determine the chunking method based on file extension.
fn chunking_method(ext: &str) -> &'static str {
    if TREE_SITTER_EXTENSIONS.contains(&ext) {
        "tree-sitter"
    } else {
        "prose"
    }
}

/// Extract the file extension from a path (lowercase, no dot).
fn file_extension(path: &str) -> String {
    path.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

/// Clone the repo with `git clone --depth=1` into a temp directory.
///
/// Returns the temp directory handle (dropped = cleanup) and the path.
/// Auth uses `http.extraHeader` via git config env vars — token never appears in process args.
/// Run `git clone --depth=1` into a temp directory.
///
/// Tries authenticated clone first (if token provided), then falls back to
/// unauthenticated for public repos. Uses `token` prefix (not `Bearer`) for
/// the Authorization header — works with both classic (`ghp_`) and
/// fine-grained (`github_pat_`) GitHub PATs.
async fn clone_repo(
    common: &GitHubCommonFields,
    branch: &str,
    token: Option<&str>,
) -> Result<tempfile::TempDir, Box<dyn Error>> {
    let tmp = tempfile::tempdir()?;
    let tmp_path = tmp.path().to_string_lossy().to_string();
    let clone_url = format!("https://github.com/{}/{}.git", common.owner, common.name);

    let base_args = [
        "clone",
        "--depth=1",
        "--branch",
        branch,
        "--single-branch",
        "--",
        &clone_url,
        &tmp_path,
    ];

    // Try authenticated first, fall back to unauthenticated for public repos.
    if let Some(t) = token {
        let output = tokio::process::Command::new("git")
            .args(base_args)
            .env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "http.extraHeader")
            .env("GIT_CONFIG_VALUE_0", format!("Authorization: token {t}"))
            .output()
            .await
            .map_err(|e| format!("git not found or failed to start: {e}"))?;

        if output.status.success() {
            return Ok(tmp);
        }

        // Auth failed — retry without token (public repos don't need it).
        log_warn(&format!(
            "command=ingest_github auth_clone_failed repo={}/{} retrying_unauthenticated",
            common.owner, common.name
        ));
        // Clean up the failed partial clone before retrying.
        let _ = tokio::fs::remove_dir_all(tmp.path()).await;
        let _ = tokio::fs::create_dir_all(tmp.path()).await;
    }

    let output = tokio::process::Command::new("git")
        .args(base_args)
        .output()
        .await
        .map_err(|e| format!("git not found or failed to start: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "git clone failed (exit {}): {}",
            output.status,
            stderr.trim()
        )
        .into());
    }

    Ok(tmp)
}

/// Recursively walk a directory and collect file paths relative to `root`.
async fn collect_indexable_files(
    root: &Path,
    include_source: bool,
) -> Result<Vec<String>, Box<dyn Error>> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            // Skip .git and common non-indexable directories
            if name == ".git" || name == "node_modules" || name == "__pycache__" {
                continue;
            }

            if entry.file_type().await?.is_dir() {
                stack.push(path);
            } else if let Ok(rel) = path.strip_prefix(root) {
                let rel_str = rel.to_string_lossy().to_string();
                let should_index = is_indexable_doc_path(&rel_str)
                    || (include_source && is_indexable_source_path(&rel_str));
                if should_index {
                    files.push(rel_str);
                }
            }
        }
    }

    Ok(files)
}

/// Context for per-file embed tasks, built once from the outer scope.
#[derive(Clone)]
struct FileEmbedCtx {
    cfg: Config,
    repo_root: PathBuf,
    owner: String,
    name: String,
    default_branch: String,
    repo_description: Option<String>,
    pushed_at: Option<String>,
    is_private: Option<bool>,
}

/// Read a single file from the cloned repo and embed it with code-aware chunking + metadata.
async fn read_and_embed_file(ctx: &FileEmbedCtx, path: &str) -> Result<usize, String> {
    let full_path = ctx.repo_root.join(path);
    let text = match tokio::fs::read_to_string(&full_path).await {
        Ok(t) => t,
        Err(e) => {
            log_warn(&format!(
                "command=ingest_github read_failed path={path} err={e}"
            ));
            return Ok(0);
        }
    };
    if text.trim().is_empty() {
        return Ok(0);
    }

    let ext = file_extension(path);
    let extra = build_github_payload(&GitHubPayloadParams {
        repo: ctx.name.clone(),
        owner: ctx.owner.clone(),
        content_kind: "file".into(),
        branch: Some(ctx.default_branch.clone()),
        default_branch: Some(ctx.default_branch.clone()),
        repo_description: ctx.repo_description.clone(),
        pushed_at: ctx.pushed_at.clone(),
        is_private: ctx.is_private,
        file_path: Some(path.to_string()),
        file_language: Some(language_name(&ext).to_string()),
        file_type: Some(classify_file_type(path).to_string()),
        is_test: Some(is_test_path(path)),
        file_size_bytes: Some(text.len()),
        chunking_method: Some(chunking_method(&ext).to_string()),
        ..Default::default()
    });

    let source_url = format!(
        "https://github.com/{}/{}/blob/{}/{}",
        ctx.owner, ctx.name, ctx.default_branch, path
    );
    embed_code_with_metadata(
        &ctx.cfg,
        &text,
        &source_url,
        "github",
        Some(path),
        &ext,
        Some(&extra),
    )
    .await
    .map_err(|e| {
        log_warn(&format!(
            "command=ingest_github embed_failed path={path} err={e}"
        ));
        e.to_string()
    })
}

/// Clone the repo and embed all indexable files concurrently.
///
/// Uses `git clone --depth=1` to get all files in one operation instead of
/// fetching each file individually via the GitHub API. Files are read from
/// disk and embedded with AST-aware chunking (tree-sitter) where supported.
///
/// If `progress_tx` is provided, sends `{"files_done", "files_total", "chunks_embedded"}`
/// after every file completes so the worker can persist live progress to the DB.
pub async fn embed_files(
    cfg: &Config,
    common: &GitHubCommonFields,
    include_source: bool,
    token: Option<&str>,
    progress_tx: Option<&tokio::sync::mpsc::UnboundedSender<serde_json::Value>>,
) -> Result<usize, Box<dyn Error>> {
    // Clone the entire repo in one shot — orders of magnitude faster than per-file API fetches
    let tmp = clone_repo(common, &common.default_branch, token).await?;
    let repo_root = tmp.path().to_path_buf();

    let file_items = collect_indexable_files(&repo_root, include_source).await?;
    let files_total = file_items.len();

    log_info(&format!(
        "github clone complete indexable={files_total} repo={}",
        common.repo_slug
    ));

    let ctx = FileEmbedCtx {
        cfg: cfg.clone(),
        repo_root,
        owner: common.owner.clone(),
        name: common.name.clone(),
        default_branch: common.default_branch.clone(),
        repo_description: common.repo_description.clone(),
        pushed_at: common.pushed_at.clone(),
        is_private: common.is_private,
    };

    let concurrency = std::cmp::min(cfg.batch_concurrency, 16);
    let mut file_stream = stream::iter(file_items)
        .map(|path| {
            let ctx = ctx.clone();
            async move { read_and_embed_file(&ctx, &path).await }
        })
        .buffer_unordered(concurrency);

    let mut chunks_embedded = 0usize;
    let mut files_done = 0usize;
    let mut failed = 0usize;

    while let Some(result) = file_stream.next().await {
        files_done += 1;
        match result {
            Ok(n) => chunks_embedded += n,
            Err(_) => failed += 1,
        }
        if let Some(tx) = progress_tx {
            let _ = tx.send(serde_json::json!({
                "files_done": files_done,
                "files_total": files_total,
                "chunks_embedded": chunks_embedded,
            }));
        }
    }

    // tmp is dropped here → clone directory cleaned up
    log_info(&format!(
        "github files_embedded total={files_total} failed={failed} chunks={chunks_embedded}"
    ));
    Ok(chunks_embedded)
}
