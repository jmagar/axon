use crate::axon_cli::crates::core::config::Config;
use std::error::Error;

/// Discriminates between a subreddit name and a specific thread URL.
#[derive(Debug, PartialEq, Eq)]
pub enum RedditTarget {
    /// r/subreddit — fetch hot posts
    Subreddit(String),
    /// Specific thread URL — fetch that thread + comments
    Thread(String),
}

/// Classify a user-provided target string as a subreddit name or thread URL.
pub fn classify_target(target: &str) -> RedditTarget {
    if target.contains("/comments/") {
        return RedditTarget::Thread(target.to_string());
    }

    // Handle full subreddit URLs like https://www.reddit.com/r/rust/
    if let Some(rest) = target
        .strip_prefix("https://www.reddit.com/r/")
        .or_else(|| target.strip_prefix("http://www.reddit.com/r/"))
        .or_else(|| target.strip_prefix("https://reddit.com/r/"))
        .or_else(|| target.strip_prefix("http://reddit.com/r/"))
        .or_else(|| target.strip_prefix("https://old.reddit.com/r/"))
        .or_else(|| target.strip_prefix("http://old.reddit.com/r/"))
    {
        let name = rest.trim_end_matches('/');
        if !name.is_empty() {
            return RedditTarget::Subreddit(name.to_string());
        }
    }

    let clean = target
        .strip_prefix("/r/")
        .or_else(|| target.strip_prefix("r/"))
        .unwrap_or(target);
    RedditTarget::Subreddit(clean.to_string())
}

/// Obtain an OAuth2 bearer token from Reddit using client credentials.
pub async fn get_access_token(
    _client_id: &str,
    _client_secret: &str,
) -> Result<String, Box<dyn Error>> {
    todo!("implement OAuth2 token exchange")
}

/// Ingest Reddit content:
/// - For a subreddit: fetches hot posts + their top-level comments
/// - For a thread URL: fetches that thread + full comment tree
/// - Embeds all content into Qdrant via embed_text_with_metadata
pub async fn ingest_reddit(_cfg: &Config, _target: &str) -> Result<usize, Box<dyn Error>> {
    todo!("implement Reddit ingestion")
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- classify_target ---

    #[test]
    fn classify_bare_subreddit_name() {
        assert_eq!(
            classify_target("rust"),
            RedditTarget::Subreddit("rust".to_string())
        );
    }

    #[test]
    fn classify_subreddit_name_with_r_prefix() {
        assert_eq!(
            classify_target("r/rust"),
            RedditTarget::Subreddit("rust".to_string())
        );
    }

    #[test]
    fn classify_subreddit_name_with_leading_slash() {
        assert_eq!(
            classify_target("/r/rust"),
            RedditTarget::Subreddit("rust".to_string())
        );
    }

    #[test]
    fn classify_thread_url() {
        let url = "https://www.reddit.com/r/rust/comments/abc123/some_title/";
        assert_eq!(classify_target(url), RedditTarget::Thread(url.to_string()));
    }

    #[test]
    fn classify_old_reddit_thread_url() {
        let url = "https://old.reddit.com/r/rust/comments/abc123/some_title/";
        assert_eq!(classify_target(url), RedditTarget::Thread(url.to_string()));
    }

    #[test]
    fn classify_subreddit_name_with_underscores() {
        assert_eq!(
            classify_target("rust_gamedev"),
            RedditTarget::Subreddit("rust_gamedev".to_string())
        );
    }

    #[test]
    fn classify_subreddit_name_with_numbers() {
        assert_eq!(
            classify_target("web_dev"),
            RedditTarget::Subreddit("web_dev".to_string())
        );
    }

    #[test]
    fn classify_full_subreddit_url() {
        assert_eq!(
            classify_target("https://www.reddit.com/r/rust/"),
            RedditTarget::Subreddit("rust".to_string())
        );
    }

    #[test]
    fn classify_full_subreddit_url_no_trailing_slash() {
        assert_eq!(
            classify_target("https://www.reddit.com/r/rust"),
            RedditTarget::Subreddit("rust".to_string())
        );
    }

    #[test]
    fn classify_full_subreddit_url_no_www() {
        assert_eq!(
            classify_target("https://reddit.com/r/programming/"),
            RedditTarget::Subreddit("programming".to_string())
        );
    }

    #[test]
    fn classify_old_reddit_subreddit_url() {
        assert_eq!(
            classify_target("https://old.reddit.com/r/rust/"),
            RedditTarget::Subreddit("rust".to_string())
        );
    }
}
