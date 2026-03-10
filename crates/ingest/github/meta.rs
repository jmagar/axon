use octocrab::models;
use serde_json::{Value, json};

fn issue_state_str(state: &models::IssueState) -> &'static str {
    match state {
        models::IssueState::Open => "open",
        models::IssueState::Closed => "closed",
        _ => "unknown",
    }
}

/// Build Qdrant extra payload fields for a GitHub repository chunk.
///
/// Fields: `gh_owner`, `gh_stars`, `gh_forks`, `gh_open_issues`, `gh_language`,
/// `gh_topics`, `gh_created_at`, `gh_pushed_at`, `gh_is_fork`, `gh_is_archived`.
pub fn build_github_repo_extra_payload(repo: &models::Repository) -> Value {
    let owner = repo
        .full_name
        .as_deref()
        .and_then(|s| s.split('/').next())
        .unwrap_or("");
    let language = repo.language.as_ref().and_then(|v| v.as_str());
    let topics: &[String] = repo.topics.as_deref().unwrap_or(&[]);
    json!({
        "gh_owner": owner,
        "gh_stars": repo.stargazers_count.unwrap_or(0),
        "gh_forks": repo.forks_count.unwrap_or(0),
        "gh_open_issues": repo.open_issues_count.unwrap_or(0),
        "gh_language": language,
        "gh_topics": topics,
        "gh_created_at": repo.created_at.map(|dt| dt.to_rfc3339()),
        "gh_pushed_at": repo.pushed_at.map(|dt| dt.to_rfc3339()),
        "gh_is_fork": repo.fork.unwrap_or(false),
        "gh_is_archived": repo.archived.unwrap_or(false),
    })
}

/// Build Qdrant extra payload fields for a GitHub issue chunk.
///
/// Fields: `gh_issue_number`, `gh_state`, `gh_author`, `gh_created_at`,
/// `gh_updated_at`, `gh_comment_count`, `gh_labels`, `gh_is_pr`.
///
/// Note: `Issue::user` is `Author` (not `Option`); `Issue::updated_at` is non-optional.
pub fn build_github_issue_extra_payload(issue: &models::issues::Issue) -> Value {
    let labels: Vec<&str> = issue.labels.iter().map(|l| l.name.as_str()).collect();
    json!({
        "gh_issue_number": issue.number,
        "gh_state": issue_state_str(&issue.state),
        "gh_author": issue.user.login.as_str(),
        "gh_created_at": issue.created_at.to_rfc3339(),
        "gh_updated_at": issue.updated_at.to_rfc3339(),
        "gh_comment_count": issue.comments,
        "gh_labels": labels,
        "gh_is_pr": false,
    })
}

/// Build Qdrant extra payload fields for a GitHub pull request chunk.
///
/// Fields: `gh_issue_number`, `gh_state`, `gh_author`, `gh_created_at`,
/// `gh_updated_at`, `gh_comment_count`, `gh_labels`, `gh_is_pr`, `gh_merged_at`, `gh_is_draft`.
pub fn build_github_pr_extra_payload(pr: &models::pulls::PullRequest) -> Value {
    let author = pr.user.as_ref().map(|u| u.login.as_str()).unwrap_or("");
    let labels: Vec<&str> = pr
        .labels
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(|l| l.name.as_str())
        .collect();
    let state = pr
        .state
        .as_ref()
        .map(|s| issue_state_str(s))
        .unwrap_or("unknown");
    json!({
        "gh_issue_number": pr.number,
        "gh_state": state,
        "gh_author": author,
        "gh_created_at": pr.created_at.map(|dt| dt.to_rfc3339()),
        "gh_updated_at": pr.updated_at.map(|dt| dt.to_rfc3339()),
        "gh_comment_count": pr.comments.unwrap_or(0),
        "gh_labels": labels,
        "gh_is_pr": true,
        "gh_merged_at": pr.merged_at.map(|dt| dt.to_rfc3339()),
        "gh_is_draft": pr.draft.unwrap_or(false),
    })
}
