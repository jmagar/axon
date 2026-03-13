use crate::crates::core::config::Config;
use crate::crates::ingest::embed_pipeline::embed_documents_in_batches;
use crate::crates::vector::ops::{EmbedDocument, embed_text_with_extra_payload};
use octocrab::Octocrab;
use octocrab::{models, params};
use std::error::Error;

use super::GitHubCommonFields;
use super::meta::{GitHubPayloadParams, build_github_payload, issue_state_str};

/// Ingest all issues (open + closed) from a repository.
///
/// GitHub's Issues API returns both issues AND pull requests — items where
/// `pull_request` is `Some` are filtered out to avoid double-embedding.
pub async fn ingest_issues(
    cfg: &Config,
    octo: &Octocrab,
    common: &GitHubCommonFields,
) -> Result<usize, Box<dyn Error>> {
    let mut docs = Vec::new();
    let mut page = octo
        .issues(&common.owner, &common.name)
        .list()
        .state(params::State::All)
        .per_page(100)
        .send()
        .await?;

    loop {
        for issue in &page {
            // Skip pull requests — the Issues API returns both
            if issue.pull_request.is_some() {
                continue;
            }

            let body = issue.body.as_deref().unwrap_or("");
            let labels: Vec<String> = issue.labels.iter().map(|l| l.name.clone()).collect();
            let label_text = if labels.is_empty() {
                String::new()
            } else {
                format!("\nLabels: {}", labels.join(", "))
            };

            let content = format!(
                "# Issue #{}: {}\n\n{}{}",
                issue.number, issue.title, body, label_text
            );
            let url = format!(
                "https://github.com/{}/{}/issues/{}",
                common.owner, common.name, issue.number
            );
            let title = format!("Issue #{}: {}", issue.number, issue.title);
            let extra = build_github_payload(&GitHubPayloadParams {
                repo: common.name.clone(),
                owner: common.owner.clone(),
                content_kind: "issue".into(),
                default_branch: Some(common.default_branch.clone()),
                repo_description: common.repo_description.clone(),
                pushed_at: common.pushed_at.clone(),
                is_private: common.is_private,
                issue_number: Some(issue.number),
                state: Some(issue_state_str(&issue.state).to_string()),
                author: Some(issue.user.login.clone()),
                created_at: Some(issue.created_at.to_rfc3339()),
                updated_at: Some(issue.updated_at.to_rfc3339()),
                comment_count: Some(issue.comments),
                labels: Some(labels),
                is_pr: Some(false),
                ..Default::default()
            });

            docs.push(EmbedDocument {
                content,
                url,
                source_type: "github".to_string(),
                title: Some(title),
                extra: Some(extra),
                file_extension: None,
            });
        }

        page = match octo.get_page::<models::issues::Issue>(&page.next).await? {
            Some(next) => next,
            None => break,
        };
    }

    Ok(embed_github_docs(cfg, &docs, "ingest_github").await)
}

/// Ingest all pull requests (open + closed) from a repository.
pub async fn ingest_pull_requests(
    cfg: &Config,
    octo: &Octocrab,
    common: &GitHubCommonFields,
) -> Result<usize, Box<dyn Error>> {
    let mut docs = Vec::new();
    let mut page = octo
        .pulls(&common.owner, &common.name)
        .list()
        .state(params::State::All)
        .per_page(100)
        .send()
        .await?;

    loop {
        for pr in &page {
            let title = pr.title.as_deref().unwrap_or("(no title)");
            let body = pr.body.as_deref().unwrap_or("");
            let content = format!("# PR #{}: {}\n\n{}", pr.number, title, body);
            let url = format!(
                "https://github.com/{}/{}/pull/{}",
                common.owner, common.name, pr.number
            );
            let embed_title = format!("PR #{}: {}", pr.number, title);
            let author = pr.user.as_ref().map(|u| u.login.clone());
            let labels: Vec<String> = pr
                .labels
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .map(|l| l.name.clone())
                .collect();
            let state = pr.state.as_ref().map(|s| issue_state_str(s).to_string());
            let extra = build_github_payload(&GitHubPayloadParams {
                repo: common.name.clone(),
                owner: common.owner.clone(),
                content_kind: "pull_request".into(),
                default_branch: Some(common.default_branch.clone()),
                repo_description: common.repo_description.clone(),
                pushed_at: common.pushed_at.clone(),
                is_private: common.is_private,
                issue_number: Some(pr.number),
                state,
                author,
                created_at: pr.created_at.map(|dt| dt.to_rfc3339()),
                updated_at: pr.updated_at.map(|dt| dt.to_rfc3339()),
                comment_count: pr.comments.map(|c| c as u32),
                labels: Some(labels),
                is_pr: Some(true),
                merged_at: pr.merged_at.map(|dt| dt.to_rfc3339()),
                is_draft: pr.draft,
                ..Default::default()
            });

            docs.push(EmbedDocument {
                content,
                url,
                source_type: "github".to_string(),
                title: Some(embed_title),
                extra: Some(extra),
                file_extension: None,
            });
        }

        page = match octo
            .get_page::<models::pulls::PullRequest>(&page.next)
            .await?
        {
            Some(next) => next,
            None => break,
        };
    }

    Ok(embed_github_docs(cfg, &docs, "ingest_github").await)
}

async fn embed_github_docs(cfg: &Config, docs: &[EmbedDocument], command: &str) -> usize {
    let result = embed_documents_in_batches(
        cfg,
        docs,
        64,
        command,
        |cfg, doc| {
            Box::pin(async move {
                let extra_owned = doc.extra.clone().unwrap_or_default();
                embed_text_with_extra_payload(
                    cfg,
                    &doc.content,
                    &doc.url,
                    &doc.source_type,
                    doc.title.as_deref(),
                    &extra_owned,
                )
                .await
                .map_err(|err| err.to_string())
            })
        },
        |_| {},
    )
    .await;
    result.chunks_embedded
}
