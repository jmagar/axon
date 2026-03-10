use crate::crates::core::config::Config;
use crate::crates::core::logging::{log_info, log_warn};
use crate::crates::vector::ops::embed_code_with_metadata;
use crate::crates::vector::ops::input::classify::{
    classify_file_type, is_test_path, language_name,
};
use futures_util::stream::{self, StreamExt};
use reqwest::Client;
use std::error::Error;

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

/// Build a shared reqwest client for GitHub API calls.
pub(super) fn build_client() -> Result<Client, Box<dyn Error>> {
    Ok(Client::builder()
        .user_agent("axon-ingest/1.0 (https://github.com/jmagar/axon_rust)")
        .https_only(true)
        .timeout(std::time::Duration::from_secs(30))
        .build()?)
}

/// Build a reqwest::RequestBuilder with GitHub auth header applied if a token is available.
pub(super) fn github_request(
    client: &Client,
    url: &str,
    auth_header: Option<&str>,
) -> reqwest::RequestBuilder {
    let req = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(auth) = auth_header {
        req.header("Authorization", auth)
    } else {
        req
    }
}

/// Fetch the repo's recursive file tree and return indexable file paths.
async fn fetch_indexable_files(
    client: &Client,
    common: &GitHubCommonFields,
    include_source: bool,
    auth_header: Option<&str>,
) -> Result<Vec<String>, Box<dyn Error>> {
    let base = "https://api.github.com";
    let tree_resp: serde_json::Value = github_request(
        client,
        &format!(
            "{base}/repos/{}/{}/git/trees/{}?recursive=1",
            common.owner, common.name, common.default_branch
        ),
        auth_header,
    )
    .send()
    .await?
    .error_for_status()?
    .json()
    .await?;

    if tree_resp["truncated"].as_bool().unwrap_or(false) {
        log_warn(&format!(
            "command=ingest_github repo={} tree_truncated=true \
             — large repo, some files skipped",
            common.repo_slug
        ));
    }

    let items = tree_resp["tree"].as_array().cloned().unwrap_or_default();
    Ok(items
        .iter()
        .filter_map(|item| {
            let path = item["path"].as_str()?;
            if item["type"].as_str() != Some("blob") {
                return None;
            }
            let should_index =
                is_indexable_doc_path(path) || (include_source && is_indexable_source_path(path));
            should_index.then(|| path.to_string())
        })
        .collect())
}

/// Extract the file extension from a path (lowercase, no dot).
fn file_extension(path: &str) -> String {
    path.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

/// Context for per-file embed tasks, built once from the outer scope.
#[derive(Clone)]
struct FileEmbedCtx {
    client: Client,
    cfg: Config,
    owner: String,
    name: String,
    default_branch: String,
    repo_description: Option<String>,
    pushed_at: Option<String>,
    is_private: Option<bool>,
    auth: Option<String>,
}

/// Fetch a single file from GitHub and embed it with code-aware chunking + metadata.
async fn fetch_and_embed_file(ctx: &FileEmbedCtx, path: &str) -> Result<usize, String> {
    let raw_url = {
        let mut url = reqwest::Url::parse("https://raw.githubusercontent.com")
            .expect("static base URL is valid");
        url.path_segments_mut()
            .expect("base URL can be a base")
            .push(&ctx.owner)
            .push(&ctx.name)
            .push(&ctx.default_branch)
            .extend(path.split('/'));
        url
    };
    let mut req = ctx.client.get(raw_url);
    if let Some(ref a) = ctx.auth {
        req = req.header("Authorization", a.as_str());
    }
    let text = match req.send().await {
        Ok(r) if r.status().is_success() => match r.text().await {
            Ok(t) => t,
            Err(e) => {
                log_warn(&format!(
                    "command=ingest_github body_read_failed path={path} err={e}"
                ));
                return Ok(0);
            }
        },
        Ok(r) => {
            log_warn(&format!(
                "command=ingest_github fetch_failed path={path} status={}",
                r.status()
            ));
            return Ok(0);
        }
        Err(e) => {
            log_warn(&format!(
                "command=ingest_github fetch_error path={path} err={e}"
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

/// Fetch and embed all indexable files from the repository concurrently.
///
/// Uses `embed_code_with_metadata` for AST-aware chunking when the file
/// extension has tree-sitter grammar support, falling back to prose chunking.
pub async fn embed_files(
    cfg: &Config,
    common: &GitHubCommonFields,
    include_source: bool,
    token: Option<&str>,
) -> Result<usize, Box<dyn Error>> {
    let client = build_client()?;
    let auth: Option<String> = token.map(|t| format!("Bearer {t}"));
    let auth_ref = auth.as_deref();

    let file_items = fetch_indexable_files(&client, common, include_source, auth_ref).await?;

    log_info(&format!(
        "github file_tree size={} indexable={}",
        file_items.len(),
        file_items.len()
    ));
    let ctx = FileEmbedCtx {
        client,
        cfg: cfg.clone(),
        owner: common.owner.clone(),
        name: common.name.clone(),
        default_branch: common.default_branch.clone(),
        repo_description: common.repo_description.clone(),
        pushed_at: common.pushed_at.clone(),
        is_private: common.is_private,
        auth,
    };

    let concurrency = std::cmp::min(cfg.batch_concurrency, 16);
    let results: Vec<Result<usize, String>> = stream::iter(file_items)
        .map(|path| {
            let ctx = ctx.clone();
            async move { fetch_and_embed_file(&ctx, &path).await }
        })
        .buffer_unordered(concurrency)
        .collect()
        .await;

    let total: usize = results.len();
    let failed = results.iter().filter(|r| r.is_err()).count();
    log_info(&format!(
        "github files_fetched total={total} failed={failed}"
    ));
    Ok(results.into_iter().filter_map(|r| r.ok()).sum())
}
