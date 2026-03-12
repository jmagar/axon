//! HTTP client construction and shared singleton.

#[cfg(not(test))]
use std::sync::LazyLock;
use std::time::Duration;

use super::error::HttpError;
use super::normalize::normalize_url;
use super::ssrf::validate_url;

#[cfg(not(test))]
pub(crate) static HTTP_CLIENT: LazyLock<Result<reqwest::Client, String>> =
    LazyLock::new(|| build_client(30).map_err(|e| e.to_string()));

#[cfg(not(test))]
pub fn http_client() -> anyhow::Result<&'static reqwest::Client> {
    HTTP_CLIENT
        .as_ref()
        .map_err(|err| anyhow::Error::msg(format!("failed to initialize HTTP client: {err}")))
}

#[cfg(test)]
pub fn http_client() -> anyhow::Result<&'static reqwest::Client> {
    // In tests, each #[tokio::test] runs on its own runtime. A process-wide
    // reqwest::Client can hold a handle to a dropped runtime and intermittently
    // fail with "dispatch task is gone". Use a fresh client per call.
    let client = build_client(30)
        .map_err(|err| anyhow::Error::msg(format!("failed to initialize HTTP client: {err}")))?;
    Ok(Box::leak(Box::new(client)))
}

pub fn build_client(timeout_secs: u64) -> Result<reqwest::Client, HttpError> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url_string = attempt.url().as_str().to_owned();
            match validate_url(&url_string) {
                Ok(()) => attempt.follow(),
                Err(_) => attempt.error(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!("SSRF: redirect to blocked URL {url_string}"),
                )),
            }
        }))
        .build()?)
}

pub async fn fetch_html(client: &reqwest::Client, url: &str) -> Result<String, anyhow::Error> {
    let normalized = normalize_url(url);
    validate_url(&normalized)?;
    let body = client
        .get(&normalized)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(body)
}
