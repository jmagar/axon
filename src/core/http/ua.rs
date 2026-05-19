//! User-Agent resolution for all HTTP calls.
//!
//! Resolution order (first non-empty wins):
//!   1. `AXON_USER_AGENT` env var
//!   2. `AXON_CHROME_USER_AGENT` env var (legacy; kept for back-compat)
//!   3. [`DEFAULT_UA`] — a real browser UA so APIs that block bots let us through
//!
//! Use [`axon_ua()`] everywhere instead of hardcoding strings or reading env
//! vars per call. The result is resolved once at startup and cached.

use std::sync::LazyLock;

/// Fallback UA — Firefox on Linux. APIs that require a non-empty UA (e.g.
/// crates.io returns 403 on empty UA) all accept this without complaint.
pub const DEFAULT_UA: &str = concat!(
    "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0 axon/",
    env!("CARGO_PKG_VERSION"),
);

static RESOLVED_UA: LazyLock<String> = LazyLock::new(|| {
    std::env::var("AXON_USER_AGENT")
        .or_else(|_| std::env::var("AXON_CHROME_USER_AGENT"))
        .unwrap_or_else(|_| DEFAULT_UA.to_string())
});

/// Returns the resolved User-Agent string for all HTTP requests.
///
/// Resolved once at first call and cached for the process lifetime.
/// Override via `AXON_USER_AGENT` env var (or legacy `AXON_CHROME_USER_AGENT`).
pub fn axon_ua() -> &'static str {
    RESOLVED_UA.as_str()
}
