use crate::crates::core::config::Config;
use crate::crates::core::logging::{log_done, log_info, log_warn};
use crate::crates::vector::ops::embed_text_with_extra_payload;
use octocrab::Octocrab;
use std::error::Error;

mod files;
mod issues;
pub(super) mod meta;
mod wiki;

// ── Pure helper functions (re-exported for tests and cli command) ──────────────

/// Returns true if a file path should be indexed when --include-source is set.
/// Excludes lock files, generated files, binaries, and non-code files.
pub fn is_indexable_source_path(path: &str) -> bool {
    // Reject build artifact directories
    if path.starts_with("target/")
        || path.contains("/target/")
        || path.starts_with("node_modules/")
        || path.contains("/node_modules/")
        || path.starts_with("dist/")
        || path.contains("/dist/")
        || path.contains("__pycache__")
    {
        return false;
    }

    // Reject lock files by name suffix
    if path.ends_with(".lock") || path.ends_with("-lock.json") || path.ends_with(".lock.json") {
        return false;
    }

    // Accept known source extensions (MVP scope — covers most common languages;
    // expand as needed for additional language support)
    let accepted = [
        ".rs", ".py", ".go", ".ts", ".js", ".tsx", ".jsx", ".toml", ".c", ".cpp", ".h", ".hpp",
        ".java", ".kt", ".rb", ".php", ".sh", ".yaml", ".yml", ".json", ".md", ".swift", ".cs",
    ];
    accepted.iter().any(|ext| path.ends_with(ext))
}

/// Returns true if a file path should always be indexed (markdown/docs), regardless of --include-source.
pub fn is_indexable_doc_path(path: &str) -> bool {
    let accepted = [".md", ".mdx", ".rst", ".txt"];
    accepted.iter().any(|ext| path.ends_with(ext))
}

/// Parse an "owner/repo" string into (owner, repo) parts.
/// Accepts both "owner/repo" and "https://github.com/owner/repo" forms.
pub fn parse_github_repo(input: &str) -> Option<(String, String)> {
    let normalized = if let Some(rest) = input.strip_prefix("https://github.com/") {
        rest.trim_end_matches('/')
    } else {
        input
    };

    let mut parts = normalized.splitn(2, '/');
    let owner = parts.next().filter(|s| !s.is_empty())?;
    let repo = parts.next().filter(|s| !s.is_empty() && !s.contains('/'))?;

    // Strip .git suffix commonly found in clone URLs
    let repo = repo.strip_suffix(".git").unwrap_or(repo);

    if repo.is_empty() {
        return None;
    }

    Some((owner.to_string(), repo.to_string()))
}

// ── Octocrab helpers ───────────────────────────────────────────────────────────

/// Build an Octocrab instance — authenticated if a token is set, else default (unauthenticated).
fn build_octocrab(cfg: &Config) -> Result<Octocrab, Box<dyn Error>> {
    let builder = Octocrab::builder();
    let octo = if let Some(token) = cfg.github_token.as_deref() {
        builder.personal_token(token.to_string()).build()?
    } else {
        builder.build()?
    };
    Ok(octo)
}

/// Embed repo-level metadata (description, language, topics, license) as a single document.
async fn embed_repo_metadata(
    cfg: &Config,
    repo: &octocrab::models::Repository,
) -> Result<usize, Box<dyn Error>> {
    let owner_name = repo.full_name.as_deref().unwrap_or("");
    let mut parts: Vec<String> = Vec::new();

    if let Some(desc) = &repo.description
        && !desc.is_empty()
    {
        parts.push(format!("Description: {desc}"));
    }
    if let Some(lang) = &repo.language
        && let Some(s) = lang.as_str()
    {
        parts.push(format!("Language: {s}"));
    }
    if let Some(topics) = &repo.topics
        && !topics.is_empty()
    {
        parts.push(format!("Topics: {}", topics.join(", ")));
    }
    if let Some(license) = &repo.license {
        parts.push(format!("License: {}", license.name));
    }
    if let Some(stars) = repo.stargazers_count {
        parts.push(format!("Stars: {stars}"));
    }

    if parts.is_empty() {
        return Ok(0);
    }

    let content = format!("# {owner_name}\n\n{}", parts.join("\n"));
    let url = format!("https://github.com/{owner_name}");
    let extra = meta::build_github_repo_extra_payload(repo);
    embed_text_with_extra_payload(cfg, &content, &url, "github", Some(owner_name), &extra).await
}

// ── Main entry point ───────────────────────────────────────────────────────────

/// Ingest a GitHub repository: files, metadata, issues, PRs, and wiki.
///
/// - File tree + raw content: raw reqwest (existing, reliable)
/// - Repo metadata, issues, PRs: octocrab (typed, paginated)
/// - Wiki: `git clone --depth=1` subprocess
///
/// Each sub-task is run concurrently via `tokio::join!`. Individual failures
/// are logged and counted as zero rather than aborting the whole run.
pub async fn ingest_github(
    cfg: &Config,
    repo: &str,
    include_source: bool,
) -> Result<usize, Box<dyn Error>> {
    log_info(&format!("command=ingest source=github repo={repo}"));
    let (owner, name) =
        parse_github_repo(repo).ok_or_else(|| format!("invalid GitHub repo: {repo}"))?;

    let octo = build_octocrab(cfg)?;

    // Single metadata fetch — provides default_branch for files AND repo struct for embedding
    let repo_info = octo.repos(&owner, &name).get().await?;
    let default_branch = repo_info
        .default_branch
        .as_deref()
        .unwrap_or("main")
        .to_string();

    let (files_result, metadata_result, issues_result, prs_result, wiki_result) = tokio::join!(
        files::embed_files(
            cfg,
            &owner,
            &name,
            &default_branch,
            include_source,
            cfg.github_token.as_deref()
        ),
        embed_repo_metadata(cfg, &repo_info),
        issues::ingest_issues(cfg, &octo, &owner, &name),
        issues::ingest_pull_requests(cfg, &octo, &owner, &name),
        wiki::ingest_wiki(cfg, &owner, &name, cfg.github_token.as_deref()),
    );

    let mut total = 0usize;
    let mut issues_count = 0usize;
    let mut prs_count = 0usize;
    for (label, result) in [
        ("files", files_result),
        ("metadata", metadata_result),
        ("issues", issues_result),
        ("prs", prs_result),
        ("wiki", wiki_result),
    ] {
        match result {
            Ok(n) => {
                if label == "issues" {
                    issues_count = n;
                } else if label == "prs" {
                    prs_count = n;
                }
                total += n;
            }
            Err(e) => log_warn(&format!(
                "command=ingest_github {label}_failed repo={repo} err={e}"
            )),
        }
    }

    log_info(&format!(
        "github issues_fetched={issues_count} prs_fetched={prs_count}"
    ));
    log_done(&format!(
        "command=ingest source=github repo={repo} chunk_count={total}"
    ));
    Ok(total)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // --- is_indexable_source_path ---

    #[test]
    fn source_path_accepts_rust_files() {
        assert!(is_indexable_source_path("src/main.rs"));
        assert!(is_indexable_source_path("lib/foo.rs"));
    }

    #[test]
    fn source_path_accepts_python_files() {
        assert!(is_indexable_source_path("src/app.py"));
    }

    #[test]
    fn source_path_accepts_typescript_and_js() {
        assert!(is_indexable_source_path("src/index.ts"));
        assert!(is_indexable_source_path("utils/helper.js"));
    }

    #[test]
    fn source_path_accepts_go_files() {
        assert!(is_indexable_source_path("main.go"));
    }

    #[test]
    fn source_path_rejects_lock_files() {
        assert!(!is_indexable_source_path("Cargo.lock"));
        assert!(!is_indexable_source_path("package-lock.json"));
        assert!(!is_indexable_source_path("yarn.lock"));
        assert!(!is_indexable_source_path("Gemfile.lock"));
    }

    #[test]
    fn source_path_rejects_binary_and_image_files() {
        assert!(!is_indexable_source_path("assets/logo.png"));
        assert!(!is_indexable_source_path("icon.svg"));
        assert!(!is_indexable_source_path("font.woff2"));
    }

    #[test]
    fn source_path_rejects_build_artifacts() {
        assert!(!is_indexable_source_path("target/release/axon"));
        assert!(!is_indexable_source_path("dist/bundle.js.map"));
        assert!(!is_indexable_source_path("node_modules/lodash/index.js"));
    }

    // --- is_indexable_doc_path ---

    #[test]
    fn doc_path_accepts_markdown() {
        assert!(is_indexable_doc_path("README.md"));
        assert!(is_indexable_doc_path("docs/guide.md"));
        assert!(is_indexable_doc_path("CONTRIBUTING.md"));
    }

    #[test]
    fn doc_path_rejects_source_code() {
        assert!(!is_indexable_doc_path("src/main.rs"));
    }

    #[test]
    fn doc_path_rejects_lock_files() {
        assert!(!is_indexable_doc_path("Cargo.lock"));
    }

    // --- parse_github_repo ---

    #[test]
    fn parse_repo_from_owner_slash_repo() {
        let result = parse_github_repo("rust-lang/rust");
        assert_eq!(result, Some(("rust-lang".to_string(), "rust".to_string())));
    }

    #[test]
    fn parse_repo_from_github_url() {
        let result = parse_github_repo("https://github.com/rust-lang/rust");
        assert_eq!(result, Some(("rust-lang".to_string(), "rust".to_string())));
    }

    #[test]
    fn parse_repo_from_github_url_with_trailing_slash() {
        let result = parse_github_repo("https://github.com/rust-lang/rust/");
        assert_eq!(result, Some(("rust-lang".to_string(), "rust".to_string())));
    }

    #[test]
    fn parse_repo_rejects_invalid_input() {
        assert_eq!(parse_github_repo("not-a-repo"), None);
        assert_eq!(parse_github_repo(""), None);
    }

    #[test]
    fn parse_repo_rejects_single_component() {
        assert_eq!(parse_github_repo("rust-lang"), None);
    }

    #[test]
    fn parse_repo_strips_git_suffix() {
        let result = parse_github_repo("https://github.com/rust-lang/rust.git");
        assert_eq!(result, Some(("rust-lang".to_string(), "rust".to_string())));
    }

    #[test]
    fn parse_repo_strips_git_suffix_bare() {
        let result = parse_github_repo("rust-lang/rust.git");
        assert_eq!(result, Some(("rust-lang".to_string(), "rust".to_string())));
    }

    #[test]
    fn parse_repo_rejects_empty_after_git_strip() {
        // ".git" is the entire repo component — stripping it yields an empty repo
        assert_eq!(parse_github_repo("owner/.git"), None);
        assert_eq!(parse_github_repo("https://github.com/owner/.git"), None);
    }

    // --- expanded extensions ---

    #[test]
    fn source_path_accepts_c_cpp_files() {
        assert!(is_indexable_source_path("src/main.c"));
        assert!(is_indexable_source_path("src/main.cpp"));
        assert!(is_indexable_source_path("include/header.h"));
        assert!(is_indexable_source_path("include/header.hpp"));
    }

    #[test]
    fn source_path_accepts_java_kotlin_files() {
        assert!(is_indexable_source_path("src/App.java"));
        assert!(is_indexable_source_path("src/App.kt"));
    }

    #[test]
    fn source_path_accepts_ruby_php_shell() {
        assert!(is_indexable_source_path("lib/helper.rb"));
        assert!(is_indexable_source_path("src/index.php"));
        assert!(is_indexable_source_path("scripts/deploy.sh"));
    }

    #[test]
    fn source_path_accepts_yaml_json_md() {
        assert!(is_indexable_source_path("config/settings.yaml"));
        assert!(is_indexable_source_path("config/settings.yml"));
        assert!(is_indexable_source_path("package.json"));
        assert!(is_indexable_source_path("README.md"));
    }
}
