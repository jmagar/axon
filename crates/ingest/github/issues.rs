use crate::crates::core::config::Config;
use crate::crates::core::logging::log_warn;
use crate::crates::vector::ops::embed_text_with_metadata;
use octocrab::Octocrab;
use octocrab::{models, params};
use std::error::Error;

/// Ingest all issues (open + closed) from a repository.
///
/// GitHub's Issues API returns both issues AND pull requests — items where
/// `pull_request` is `Some` are filtered out to avoid double-embedding.
pub async fn ingest_issues(
    cfg: &Config,
    octo: &Octocrab,
    owner: &str,
    name: &str,
) -> Result<usize, Box<dyn Error>> {
    let mut total = 0usize;
    let mut page = octo
        .issues(owner, name)
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
            let labels: Vec<&str> = issue.labels.iter().map(|l| l.name.as_str()).collect();
            let label_text = if labels.is_empty() {
                String::new()
            } else {
                format!("\nLabels: {}", labels.join(", "))
            };

            let content = format!(
                "# Issue #{}: {}\n\n{}{}",
                issue.number, issue.title, body, label_text
            );
            let url = format!("https://github.com/{owner}/{name}/issues/{}", issue.number);
            let title = format!("Issue #{}: {}", issue.number, issue.title);

            match embed_text_with_metadata(cfg, &content, &url, "github", Some(&title)).await {
                Ok(n) => total += n,
                Err(e) => log_warn(&format!(
                    "command=ingest_github embed_issue_failed number={} err={e}",
                    issue.number
                )),
            }
        }

        page = match octo.get_page::<models::issues::Issue>(&page.next).await? {
            Some(next) => next,
            None => break,
        };
    }

    Ok(total)
}

/// Ingest all pull requests (open + closed) from a repository.
pub async fn ingest_pull_requests(
    cfg: &Config,
    octo: &Octocrab,
    owner: &str,
    name: &str,
) -> Result<usize, Box<dyn Error>> {
    let mut total = 0usize;
    let mut page = octo
        .pulls(owner, name)
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
            let url = format!("https://github.com/{owner}/{name}/pull/{}", pr.number);
            let embed_title = format!("PR #{}: {}", pr.number, title);

            match embed_text_with_metadata(cfg, &content, &url, "github", Some(&embed_title)).await
            {
                Ok(n) => total += n,
                Err(e) => log_warn(&format!(
                    "command=ingest_github embed_pr_failed number={} err={e}",
                    pr.number
                )),
            }
        }

        page = match octo
            .get_page::<models::pulls::PullRequest>(&page.next)
            .await?
        {
            Some(next) => next,
            None => break,
        };
    }

    Ok(total)
}
