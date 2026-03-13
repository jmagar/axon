#![cfg(test)]

use super::helpers::{is_allowed_redirect_uri, normalize_loopback_redirect_uri};
use super::types::RedirectPolicy;
use axum::http::StatusCode;
use std::sync::Mutex;

/// Serializes env-var mutations within this file.
///
/// **Limitation:** this mutex only prevents races between tests *within this file*.
/// Tests in other files that mutate the same env vars can still race these tests.
/// For fully isolated env-var test runs, use `cargo test -- --test-threads=1`.
static ENV_LOCK: Mutex<()> = Mutex::new(());

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
fn normalize_loopback_redirect_uri_accepts_localhost_with_trailing_dot() {
    let uri = normalize_loopback_redirect_uri("https://localhost.:34543/callback")
        .expect("localhost with trailing dot should normalize");
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

#[allow(unsafe_code)]
#[tokio::test]
async fn mcp_api_key_is_loaded_from_env() {
    let _guard = ENV_LOCK.lock().unwrap();
    const API_KEY: &str = "AXON_MCP_API_KEY";
    let prev = std::env::var(API_KEY).ok();

    unsafe {
        std::env::set_var(API_KEY, "  test-mcp-key  ");
    }

    let state = super::types::GoogleOAuthState::from_env("127.0.0.1", 8001);
    assert!(state.api_key_configured());
    assert_eq!(state.inner.mcp_api_key.as_deref(), Some("test-mcp-key"));

    match prev {
        Some(v) => unsafe { std::env::set_var(API_KEY, v) },
        None => unsafe { std::env::remove_var(API_KEY) },
    }
}

#[allow(unsafe_code)]
#[tokio::test]
async fn empty_mcp_api_key_is_treated_as_unconfigured() {
    let _guard = ENV_LOCK.lock().unwrap();
    const API_KEY: &str = "AXON_MCP_API_KEY";
    let prev = std::env::var(API_KEY).ok();

    unsafe {
        std::env::set_var(API_KEY, "   ");
    }

    let state = super::types::GoogleOAuthState::from_env("127.0.0.1", 8001);
    assert!(!state.api_key_configured());
    assert!(state.inner.mcp_api_key.is_none());

    match prev {
        Some(v) => unsafe { std::env::set_var(API_KEY, v) },
        None => unsafe { std::env::remove_var(API_KEY) },
    }
}

/// Verifies that an explicitly-set `GOOGLE_OAUTH_REDIRECT_URI` is preserved
/// exactly — no normalization applied. Google's OAuth requires the redirect URI
/// registered with the client to match character-for-character; normalization
/// of an explicit value would silently break the OAuth flow.
#[allow(unsafe_code)]
#[test]
fn explicitly_configured_redirect_uri_is_preserved_exactly() {
    let _guard = ENV_LOCK.lock().unwrap();
    let vars = [
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "GOOGLE_OAUTH_REDIRECT_URI",
        "GOOGLE_OAUTH_REDIRECT_HOST",
        "GOOGLE_OAUTH_BROKER_ISSUER",
    ];
    let prev = vars
        .iter()
        .map(|k| ((*k).to_string(), std::env::var(k).ok()))
        .collect::<Vec<_>>();

    unsafe {
        std::env::set_var("GOOGLE_OAUTH_CLIENT_ID", "test-client-id");
        std::env::set_var("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret");
        // Deliberately use https:// — this is what a user may register in the
        // Google Cloud Console. The value must survive config loading unchanged.
        std::env::set_var(
            "GOOGLE_OAUTH_REDIRECT_URI",
            "https://localhost:8001/oauth/google/callback",
        );
        std::env::remove_var("GOOGLE_OAUTH_REDIRECT_HOST");
        std::env::remove_var("GOOGLE_OAUTH_BROKER_ISSUER");
    }

    let cfg = super::types::GoogleOAuthConfig::from_env("0.0.0.0", 8001)
        .expect("oauth config should load with test credentials");
    // Explicit URI must be preserved verbatim — NOT rewritten to http://localhost.
    assert_eq!(
        cfg.redirect_uri,
        "https://localhost:8001/oauth/google/callback"
    );

    for (key, value) in prev {
        match value {
            Some(v) => unsafe { std::env::set_var(&key, v) },
            None => unsafe { std::env::remove_var(&key) },
        }
    }
}

/// Verifies that the *auto-generated* redirect URI (built from redirect_host +
/// mcp_port when `GOOGLE_OAUTH_REDIRECT_URI` is not set) is normalized to
/// canonical `http://localhost` form for loopback addresses.
#[allow(unsafe_code)]
#[test]
fn auto_generated_loopback_redirect_uri_is_normalized_to_http_localhost() {
    let _guard = ENV_LOCK.lock().unwrap();
    let vars = [
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "GOOGLE_OAUTH_REDIRECT_URI",
        "GOOGLE_OAUTH_REDIRECT_HOST",
        "GOOGLE_OAUTH_BROKER_ISSUER",
    ];
    let prev = vars
        .iter()
        .map(|k| ((*k).to_string(), std::env::var(k).ok()))
        .collect::<Vec<_>>();

    unsafe {
        std::env::set_var("GOOGLE_OAUTH_CLIENT_ID", "test-client-id");
        std::env::set_var("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret");
        // No GOOGLE_OAUTH_REDIRECT_URI — let config auto-generate from host+port.
        std::env::remove_var("GOOGLE_OAUTH_REDIRECT_URI");
        // Use 127.0.0.1 so the auto-generated URI is a loopback address that
        // the normalizer should rewrite to http://localhost.
        std::env::set_var("GOOGLE_OAUTH_REDIRECT_HOST", "127.0.0.1");
        std::env::remove_var("GOOGLE_OAUTH_BROKER_ISSUER");
    }

    let cfg = super::types::GoogleOAuthConfig::from_env("0.0.0.0", 8001)
        .expect("oauth config should load with test credentials");
    // Auto-generated loopback URIs are normalized to http://localhost.
    assert_eq!(
        cfg.redirect_uri,
        "http://localhost:8001/oauth/google/callback"
    );

    for (key, value) in prev {
        match value {
            Some(v) => unsafe { std::env::set_var(&key, v) },
            None => unsafe { std::env::remove_var(&key) },
        }
    }
}

#[allow(unsafe_code)]
#[tokio::test]
async fn check_rate_limit_enforces_bucket_limit_in_memory_fallback() {
    let _guard = ENV_LOCK.lock().unwrap();
    let vars = ["GOOGLE_OAUTH_REDIS_URL", "AXON_REDIS_URL"];
    let prev = vars
        .iter()
        .map(|k| ((*k).to_string(), std::env::var(k).ok()))
        .collect::<Vec<_>>();

    unsafe {
        std::env::set_var("GOOGLE_OAUTH_REDIS_URL", "redis://127.0.0.1:1");
        std::env::remove_var("AXON_REDIS_URL");
    }

    let state = super::types::GoogleOAuthState::from_env("127.0.0.1", 8001);

    for (key, value) in prev {
        match value {
            Some(v) => unsafe { std::env::set_var(&key, v) },
            None => unsafe { std::env::remove_var(&key) },
        }
    }
    drop(_guard);

    let bucket = format!("rate-limit-test-{}", uuid::Uuid::new_v4());
    assert!(state.check_rate_limit(&bucket, 1, 60).await.is_ok());

    let resp = state
        .check_rate_limit(&bucket, 1, 60)
        .await
        .expect_err("second request in same window should be rate limited");
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
}
