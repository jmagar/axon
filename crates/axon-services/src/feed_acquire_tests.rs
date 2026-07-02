use super::*;

#[tokio::test]
async fn fetch_feed_rejects_ssrf_target() {
    // A loopback/private target is rejected before any request is sent.
    let err = fetch_feed_to_file("https://127.0.0.1/feed.rss")
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("refusing to fetch"),
        "expected SSRF rejection, got: {err}"
    );
}

#[tokio::test]
async fn fetch_feed_rejects_ssrf_target_behind_prefix() {
    // The `rss:` prefix is normalized to the real URL, which is then
    // SSRF-validated — a private target is still rejected before any fetch.
    let err = fetch_feed_to_file("rss:https://127.0.0.1/blog")
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("refusing to fetch"),
        "expected SSRF rejection through prefix, got: {err}"
    );
}

#[test]
fn fetch_target_resolves_from_prefix_without_network() {
    // The URL the fetch helper targets is derived purely from the input, so we
    // can assert it without executing a request.
    assert_eq!(
        normalize_feed_target("rss:example.com/feed"),
        "https://example.com/feed"
    );
    assert_eq!(
        normalize_feed_target("https://example.com/feed.atom"),
        "https://example.com/feed.atom"
    );
}
