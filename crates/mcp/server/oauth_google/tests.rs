#![cfg(test)]

use super::helpers::{is_allowed_redirect_uri, normalize_loopback_redirect_uri};
use super::types::RedirectPolicy;

#[test]
fn normalize_loopback_redirect_uri_prefers_localhost_http() {
    let uri = normalize_loopback_redirect_uri("https://127.0.0.1:34543/callback")
        .expect("loopback uri should normalize");
    assert_eq!(uri, "http://localhost:34543/callback");
}
#[test]
fn normalize_loopback_redirect_uri_accepts_ipv6_loopback() {
    let uri = normalize_loopback_redirect_uri("https://[::1]:34543/callback")
        .expect("ipv6 loopback uri should normalize");
    assert_eq!(uri, "http://localhost:34543/callback");
}

#[test]
fn redirect_policy_loopback_only_rejects_non_loopback() {
    assert!(is_allowed_redirect_uri(
        "http://localhost:5555/callback",
        RedirectPolicy::LoopbackOnly
    ));
    assert!(!is_allowed_redirect_uri(
        "https://axon.tootie.tv/callback",
        RedirectPolicy::LoopbackOnly
    ));
}
#[test]
fn redirect_policy_loopback_only_allows_ipv6_loopback() {
    assert!(is_allowed_redirect_uri(
        "http://[::1]:5555/callback",
        RedirectPolicy::LoopbackOnly
    ));
}

#[test]
fn redirect_policy_loopback_or_https_allows_hosted_https_and_loopback_http() {
    assert!(is_allowed_redirect_uri(
        "https://claude.ai/mcp/callback",
        RedirectPolicy::LoopbackOrHttps
    ));
    assert!(is_allowed_redirect_uri(
        "http://localhost:5555/callback",
        RedirectPolicy::LoopbackOrHttps
    ));
    assert!(!is_allowed_redirect_uri(
        "http://example.com/callback",
        RedirectPolicy::LoopbackOrHttps
    ));
}

#[test]
fn redirect_policy_any_allows_non_loopback() {
    assert!(is_allowed_redirect_uri(
        "https://axon.tootie.tv/callback",
        RedirectPolicy::Any
    ));
}

/// Verifies that Docker-internal Redis hostnames are rewritten to localhost
/// before being passed to the Redis client, so `axon mcp` (running as a local
/// process outside Docker) can actually reach the Redis container.
///
/// Without this normalization, `redis::Client::open("redis://axon-redis:6379")`
/// succeeds (it is lazy), but every subsequent connection attempt silently fails
/// because `axon-redis` does not resolve outside the Docker network — causing
/// all OAuth state to fall back to in-memory and be lost on restart.
///
/// This test calls `normalize_local_service_url` directly with a simulated
/// non-Docker environment by using a known Docker-internal hostname. The
/// function itself checks for `/.dockerenv`; when running inside Docker the
/// rewrite is a no-op, so we validate only the host rewrite — not the exact
/// mapped port — to remain portable across CI environments.
#[test]
fn oauth_redis_url_docker_hostname_is_normalized_to_localhost() {
    use crate::crates::core::config::parse::normalize_local_service_url;
    use spider::url::Url;

    let raw = "redis://:secret@axon-redis:6379".to_string();
    let normalized = normalize_local_service_url(raw);
    let parsed = Url::parse(&normalized).expect("normalized url must be valid");

    if std::path::Path::new("/.dockerenv").exists() {
        // Inside Docker: axon-redis resolves natively; normalization is a no-op.
        // Verify the host is still axon-redis (unchanged) so the test provides
        // signal even in Docker-based CI.
        assert_eq!(
            parsed.host_str(),
            Some("axon-redis"),
            "inside Docker, axon-redis hostname must be preserved unchanged"
        );
    } else {
        // Outside Docker: host must be rewritten to 127.0.0.1.
        assert_eq!(
            parsed.host_str(),
            Some("127.0.0.1"),
            "axon-redis should be rewritten to 127.0.0.1 outside Docker"
        );
        // Verify the port was rewritten to the host-mapped port.
        // Read from env var to allow override in non-standard environments;
        // fall back to the default mapped port from docker-compose.yaml.
        let expected_port: u16 = std::env::var("AXON_REDIS_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(53379);
        assert_eq!(
            parsed.port(),
            Some(expected_port),
            "axon-redis:6379 should be rewritten to the host-mapped port {expected_port}"
        );
    }

    assert_eq!(
        parsed.password(),
        Some("secret"),
        "credentials must be preserved after rewrite"
    );
}
