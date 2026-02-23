use crate::crates::core::config::Config;
use crate::crates::core::logging::log_warn;
use crate::crates::vector::ops::embed_text_with_metadata;
use std::error::Error;

/// Ingest wiki pages from a GitHub repository by cloning the wiki git repo.
///
/// Uses `git clone --depth=1` to clone the wiki. If the wiki doesn't exist,
/// the clone exits non-zero and this function returns `Ok(0)` silently.
///
/// Requires `git` to be installed and on PATH.
pub async fn ingest_wiki(
    cfg: &Config,
    owner: &str,
    name: &str,
    token: Option<&str>,
) -> Result<usize, Box<dyn Error>> {
    // Create a temp directory; cleaned up automatically when `_tmp` is dropped
    let _tmp = tempfile::tempdir()?;
    let tmp_path = _tmp.path().to_string_lossy().to_string();

    // Construct clone URL — embed token for private wikis, plain HTTPS otherwise
    let clone_url = if let Some(t) = token {
        format!("https://{t}@github.com/{owner}/{name}.wiki.git")
    } else {
        format!("https://github.com/{owner}/{name}.wiki.git")
    };

    // "--" separates flags from the URL argument to prevent argument injection
    let output = tokio::process::Command::new("git")
        .args(["clone", "--depth=1", "--", &clone_url, &tmp_path])
        .output()
        .await
        .map_err(|e| format!("git not found or failed to start: {e}"))?;

    if !output.status.success() {
        // Non-zero exit most commonly means the repo has no wiki — treat as empty
        return Ok(0);
    }

    // Walk the cloned directory for text files to embed
    let mut total = 0usize;
    let mut dir = tokio::fs::read_dir(&tmp_path).await?;
    while let Some(entry) = dir.next_entry().await? {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if !matches!(ext.as_str(), "md" | "rst" | "txt") {
            continue;
        }

        let content = match tokio::fs::read_to_string(&path).await {
            Ok(c) => c,
            Err(e) => {
                log_warn(&format!(
                    "command=ingest_github wiki_read_failed path={path:?} err={e}"
                ));
                continue;
            }
        };

        if content.trim().is_empty() {
            continue;
        }

        // Derive a canonical GitHub wiki URL from the file stem
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Home");
        let wiki_url = format!("https://github.com/{owner}/{name}/wiki/{stem}");
        let title = stem.replace(['-', '_'], " ");

        match embed_text_with_metadata(cfg, &content, &wiki_url, "github", Some(&title)).await {
            Ok(n) => total += n,
            Err(e) => log_warn(&format!(
                "command=ingest_github wiki_embed_failed page={stem} err={e}"
            )),
        }
    }

    Ok(total)
}
