//! Token-based authentication for the web surfaces.
//!
//! Historical note: this module previously handled Tailscale and SSH auth too.
//! The current development model is intentionally simpler: one shared API token
//! (`AXON_WEB_API_TOKEN`) gates `/ws`, `/output/*`, and `/download/*`.

use axum::http::HeaderMap;

/// The result of checking auth on an incoming request.
#[derive(Debug, PartialEq, Eq)]
pub enum AuthOutcome {
    /// Authenticated via API token.
    Token,
    /// Not authenticated.
    Denied(DenyReason),
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum DenyReason {
    /// No token was provided.
    NoCredentials,
    /// A token was provided but it did not match `AXON_WEB_API_TOKEN`.
    InvalidToken,
    /// No auth method is configured and this is a release build.
    NoAuthConfigured,
}

/// Constant-time byte comparison to prevent timing attacks on API token checks.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }

    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

/// Determine whether a request is authorized to access the axon web surfaces.
pub fn check_auth(
    _headers: &HeaderMap,
    query_token: Option<&str>,
    api_token: Option<&str>,
) -> AuthOutcome {
    if let Some(expected) = api_token {
        let provided = query_token.unwrap_or("").trim();
        if provided.is_empty() {
            return AuthOutcome::Denied(DenyReason::NoCredentials);
        }
        if constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
            return AuthOutcome::Token;
        }
        return AuthOutcome::Denied(DenyReason::InvalidToken);
    }

    #[cfg(any(debug_assertions, test))]
    {
        AuthOutcome::Token
    }
    #[cfg(not(any(debug_assertions, test)))]
    {
        AuthOutcome::Denied(DenyReason::NoAuthConfigured)
    }
}

/// Format a human-readable log message for an auth outcome.
pub fn auth_log_message(outcome: &AuthOutcome, addr: std::net::SocketAddr) -> String {
    match outcome {
        AuthOutcome::Token => format!("ws auth: api token from {}", addr.ip()),
        AuthOutcome::Denied(reason) => match reason {
            DenyReason::NoCredentials => {
                format!("ws denied: no credentials from {}", addr.ip())
            }
            DenyReason::InvalidToken => {
                format!("ws denied: invalid token from {}", addr.ip())
            }
            DenyReason::NoAuthConfigured => {
                format!(
                    "ws denied: no auth configured (set AXON_WEB_API_TOKEN) from {}",
                    addr.ip()
                )
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn constant_time_eq_equal_strings() {
        assert!(constant_time_eq(b"secret-token", b"secret-token"));
    }

    #[test]
    fn constant_time_eq_different_strings() {
        assert!(!constant_time_eq(b"secret-token", b"wrong-token-x"));
    }

    #[test]
    fn token_auth_succeeds_for_matching_token() {
        let outcome = check_auth(
            &HeaderMap::new(),
            Some("correct-token"),
            Some("correct-token"),
        );
        assert!(matches!(outcome, AuthOutcome::Token));
    }

    #[test]
    fn token_auth_rejects_wrong_token() {
        let outcome = check_auth(
            &HeaderMap::new(),
            Some("wrong-token"),
            Some("correct-token"),
        );
        assert!(matches!(
            outcome,
            AuthOutcome::Denied(DenyReason::InvalidToken)
        ));
    }

    #[test]
    fn token_auth_rejects_missing_token() {
        let outcome = check_auth(&HeaderMap::new(), None, Some("correct-token"));
        assert!(matches!(
            outcome,
            AuthOutcome::Denied(DenyReason::NoCredentials)
        ));
    }
}
