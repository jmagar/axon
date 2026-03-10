//! Tailscale Serve identity header authentication.
//!
//! When axon runs behind `tailscale serve`, Tailscale acts as the network-layer
//! identity provider. It:
//!
//! 1. **Strips** any incoming `Tailscale-*` headers from requests (prevents spoofing).
//! 2. **Injects** its own verified headers for every authenticated tailnet user.
//! 3. Only injects these headers for Serve traffic — not Funnel (public) traffic.
//!
//! This means: if `Tailscale-User-Login` is present on a request, Tailscale itself
//! verified the user is authenticated to the tailnet before forwarding the request.
//!
//! ## Security invariant
//!
//! **The backend MUST listen on `127.0.0.1` only.** If it were reachable on a
//! network interface directly, any caller could forge `Tailscale-User-Login`.
//! Localhost-only binding means only the local Tailscale Serve daemon can inject
//! these headers — and it only does so after verifying tailnet identity.
//!
//! ## External shares
//!
//! Tailscale docs note that headers ARE populated for external users who accepted a
//! device share. Set `AXON_TAILSCALE_ALLOWED_USERS` to restrict to specific emails
//! if you need to guarantee "only my tailnet" and have shared the device externally.
//!
//! ## Environment variables
//!
//! | Variable | Default | Description |
//! |----------|---------|-------------|
//! | `AXON_TAILSCALE_STRICT` | `false` | When `true`, reject requests without TS headers entirely. No token fallback. |
//! | `AXON_TAILSCALE_ALLOWED_USERS` | (empty) | Comma-separated email allowlist. Empty = any authenticated tailnet user. |

use axum::http::HeaderMap;
use std::collections::HashSet;

// ── SSH key identity ──────────────────────────────────────────────────────────

/// Identity established via SSH key challenge-response authentication.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct SshKeyIdentity {
    /// SSH key fingerprint — `"SHA256:XXXXX"` as reported by `ssh-keygen -Y verify`.
    pub fingerprint: String,
}

// ── Header names ──────────────────────────────────────────────────────────────

/// Tailscale injects and strips these exact header names (case-insensitive in HTTP/2,
/// but axum normalizes to lowercase). Tailscale docs: https://tailscale.com/kb/1312/serve-headers
const HEADER_USER_LOGIN: &str = "tailscale-user-login";
const HEADER_USER_NAME: &str = "tailscale-user-name";
const HEADER_USER_PROFILE_PIC: &str = "tailscale-user-profile-pic";

// ── Auth result ───────────────────────────────────────────────────────────────

/// The result of checking auth on an incoming request.
#[derive(Debug, PartialEq, Eq)]
pub enum AuthOutcome {
    /// Authenticated via Tailscale identity header — user is a tailnet member.
    Tailscale(TailscaleIdentity),
    /// Authenticated via API token fallback (`AXON_WEB_API_TOKEN`).
    Token,
    /// Authenticated via dual-auth mode — both Tailscale identity AND API token passed.
    DualAuth(TailscaleIdentity),
    /// Authenticated via SSH key challenge-response.
    SshKey(SshKeyIdentity),
    /// Not authenticated.
    Denied(DenyReason),
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum DenyReason {
    /// No credentials of any kind were provided.
    NoCredentials,
    /// An API token was provided but it did not match `AXON_WEB_API_TOKEN`.
    InvalidToken,
    /// A valid Tailscale identity was present but the user is not in the allowlist.
    UserNotAllowed(String),
    /// `AXON_TAILSCALE_STRICT=true` and no Tailscale headers were present.
    StrictModeRequiresTailscale,
    /// No auth method is configured and this is a release build.
    NoAuthConfigured,
    /// Dual-auth mode (`AXON_REQUIRE_DUAL_AUTH=true`) and Tailscale header was absent or user not allowed.
    DualAuthRequiresTailscale,
    /// Dual-auth mode and API token was missing or incorrect.
    DualAuthRequiresToken,
}

/// Identity extracted from Tailscale Serve headers.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct TailscaleIdentity {
    /// Requester's login name — e.g. `alice@example.com`.
    /// Always populated for tailnet users (excluding tagged devices).
    pub login: String,
    /// Requester's display name — e.g. `Alice Architect`. May be empty.
    pub name: String,
    /// Profile picture URL. May be empty.
    pub profile_pic: String,
}

impl TailscaleIdentity {
    /// A minimal identity for testing — only login is set.
    #[cfg(test)]
    pub fn test(login: &str) -> Self {
        Self {
            login: login.to_string(),
            name: String::new(),
            profile_pic: String::new(),
        }
    }
}

// ── Config (read from env) ────────────────────────────────────────────────────

/// Auth configuration loaded from environment variables.
///
/// Constructed once per server start — env vars are not re-read per request.
#[derive(Debug, Clone, Default)]
pub struct TailscaleAuthConfig {
    /// When `true`, reject any request without a valid `Tailscale-User-Login` header.
    /// No token fallback. Set with `AXON_TAILSCALE_STRICT=true`.
    pub strict: bool,
    /// Allowlist of login emails permitted through. Empty = any tailnet user.
    /// Set with `AXON_TAILSCALE_ALLOWED_USERS=alice@example.com,bob@example.com`.
    pub allowed_users: HashSet<String>,
    /// When `true`, BOTH a valid Tailscale identity AND the API token must be present.
    /// Either alone is insufficient — both independent factors are required.
    /// Set with `AXON_REQUIRE_DUAL_AUTH=true` (default: `true`).
    pub require_dual_auth: bool,
}

impl TailscaleAuthConfig {
    /// Load configuration from environment variables.
    pub fn from_env() -> Self {
        let strict = std::env::var("AXON_TAILSCALE_STRICT")
            .map(|v| v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

        let allowed_users = std::env::var("AXON_TAILSCALE_ALLOWED_USERS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_lowercase)
            .collect();

        // Default: true — require both TS identity AND API token.
        // Set AXON_REQUIRE_DUAL_AUTH=false to relax to single-factor (either suffices).
        let require_dual_auth = std::env::var("AXON_REQUIRE_DUAL_AUTH")
            .map(|v| !v.eq_ignore_ascii_case("false"))
            .unwrap_or(true);

        Self {
            strict,
            allowed_users,
            require_dual_auth,
        }
    }

    /// Check whether an allowlist is configured.
    pub fn has_allowlist(&self) -> bool {
        !self.allowed_users.is_empty()
    }

    /// Check whether a login is permitted by the allowlist.
    /// If no allowlist is configured, any login is permitted.
    pub fn is_user_allowed(&self, login: &str) -> bool {
        if !self.has_allowlist() {
            return true; // No allowlist = any tailnet user is allowed
        }
        self.allowed_users.contains(&login.to_lowercase())
    }
}

// ── Header extraction ─────────────────────────────────────────────────────────

/// Extract Tailscale identity from request headers.
///
/// Returns `None` if the `Tailscale-User-Login` header is absent or empty,
/// which indicates the request did NOT come through `tailscale serve`.
///
/// Note: axum normalizes HTTP header names to lowercase, which matches the
/// lowercase header names used here.
pub fn extract_tailscale_identity(headers: &HeaderMap) -> Option<TailscaleIdentity> {
    let login = headers
        .get(HEADER_USER_LOGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;

    let name = headers
        .get(HEADER_USER_NAME)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_string();

    let profile_pic = headers
        .get(HEADER_USER_PROFILE_PIC)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_string();

    Some(TailscaleIdentity {
        login: login.to_string(),
        name,
        profile_pic,
    })
}

// ── Token comparison ──────────────────────────────────────────────────────────

/// Constant-time byte comparison to prevent timing attacks on API token checks.
///
/// Runs in O(n) time regardless of where the first difference is.
/// Returns `true` only when `a == b` in both length and content.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    // Length check is not secret — tokens of different lengths are always not equal.
    // The content comparison must be constant-time.
    if a.len() != b.len() {
        return false;
    }
    // XOR each byte pair and OR the results — any mismatch sets a bit.
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

// ── Primary auth function ─────────────────────────────────────────────────────

/// Determine whether a request is authorized to access the axon WS endpoint.
///
/// Auth priority:
/// 0. Dual-auth mode (`AXON_REQUIRE_DUAL_AUTH=true`, the default) — BOTH Tailscale
///    identity AND API token must be present. Either alone is rejected.
/// 1. Tailscale identity header (`Tailscale-User-Login`) — preferred single-factor path.
///    Tailscale Serve injects this after verifying the user is authenticated
///    to the tailnet. The backend MUST listen on localhost only (invariant).
/// 2. API token (`AXON_WEB_API_TOKEN`) — fallback for non-Tailscale deployments.
///    Rejected when `AXON_TAILSCALE_STRICT=true`.
/// 3. Open (debug builds only) — when no auth is configured.
pub fn check_auth(
    headers: &HeaderMap,
    query_token: Option<&str>,
    api_token: Option<&str>,
    ts_cfg: &TailscaleAuthConfig,
) -> AuthOutcome {
    // ── 0. Dual-auth mode: BOTH Tailscale identity AND API token required ────
    if ts_cfg.require_dual_auth {
        let identity = match extract_tailscale_identity(headers) {
            Some(id) if ts_cfg.is_user_allowed(&id.login) => id,
            Some(id) => {
                return AuthOutcome::Denied(DenyReason::UserNotAllowed(id.login));
            }
            None => return AuthOutcome::Denied(DenyReason::DualAuthRequiresTailscale),
        };
        let token_ok = api_token
            .map(|expected| {
                let provided = query_token.unwrap_or("").trim();
                !provided.is_empty() && constant_time_eq(provided.as_bytes(), expected.as_bytes())
            })
            .unwrap_or(false);
        if !token_ok {
            return AuthOutcome::Denied(DenyReason::DualAuthRequiresToken);
        }
        return AuthOutcome::DualAuth(identity);
    }

    // ── 1. Tailscale identity check ──────────────────────────────────────────
    if let Some(identity) = extract_tailscale_identity(headers) {
        if ts_cfg.is_user_allowed(&identity.login) {
            return AuthOutcome::Tailscale(identity);
        }
        return AuthOutcome::Denied(DenyReason::UserNotAllowed(identity.login));
    }

    // ── 2. Strict mode: Tailscale headers required ───────────────────────────
    if ts_cfg.strict {
        return AuthOutcome::Denied(DenyReason::StrictModeRequiresTailscale);
    }

    // ── 3. API token fallback ────────────────────────────────────────────────
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

    // ── 4. No auth configured ────────────────────────────────────────────────
    // In debug/test builds: allow (dev convenience).
    // In release builds: deny (safe default — misconfiguration protection).
    #[cfg(any(debug_assertions, test))]
    {
        AuthOutcome::Token // Treat as token-authed for dev purposes
    }
    #[cfg(not(any(debug_assertions, test)))]
    {
        AuthOutcome::Denied(DenyReason::NoAuthConfigured)
    }
}

/// Format a human-readable log message for an auth outcome.
pub fn auth_log_message(outcome: &AuthOutcome, addr: std::net::SocketAddr) -> String {
    match outcome {
        AuthOutcome::Tailscale(id) => {
            format!("ws auth: tailscale user '{}' from {}", id.login, addr.ip())
        }
        AuthOutcome::Token => format!("ws auth: api token from {}", addr.ip()),
        AuthOutcome::DualAuth(id) => format!(
            "ws auth: dual-auth OK (TS+token) — user='{}' from {}",
            id.login,
            addr.ip()
        ),
        AuthOutcome::SshKey(id) => format!(
            "ws auth: ssh-key OK — fingerprint='{}' from {}",
            id.fingerprint,
            addr.ip()
        ),
        AuthOutcome::Denied(reason) => match reason {
            DenyReason::NoCredentials => {
                format!("ws denied: no credentials from {}", addr.ip())
            }
            DenyReason::InvalidToken => {
                format!("ws denied: invalid token from {}", addr.ip())
            }
            DenyReason::UserNotAllowed(login) => {
                format!(
                    "ws denied: user '{login}' not in AXON_TAILSCALE_ALLOWED_USERS (from {})",
                    addr.ip()
                )
            }
            DenyReason::StrictModeRequiresTailscale => {
                format!(
                    "ws denied: AXON_TAILSCALE_STRICT=true but no Tailscale headers from {}",
                    addr.ip()
                )
            }
            DenyReason::NoAuthConfigured => {
                format!(
                    "ws denied: no auth configured (set AXON_WEB_API_TOKEN or use tailscale serve) from {}",
                    addr.ip()
                )
            }
            DenyReason::DualAuthRequiresTailscale => {
                format!(
                    "ws denied: AXON_REQUIRE_DUAL_AUTH=true but no valid Tailscale header from {}",
                    addr.ip()
                )
            }
            DenyReason::DualAuthRequiresToken => {
                format!(
                    "ws denied: AXON_REQUIRE_DUAL_AUTH=true but token missing or wrong from {}",
                    addr.ip()
                )
            }
        },
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn headers_with_ts(login: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(HEADER_USER_LOGIN, login.parse().unwrap());
        h.insert(HEADER_USER_NAME, "Alice Architect".parse().unwrap());
        h.insert(
            HEADER_USER_PROFILE_PIC,
            "https://example.com/pic.jpg".parse().unwrap(),
        );
        h
    }

    fn empty_headers() -> HeaderMap {
        HeaderMap::new()
    }

    fn no_strict_no_allowlist() -> TailscaleAuthConfig {
        TailscaleAuthConfig {
            strict: false,
            allowed_users: HashSet::new(),
            require_dual_auth: false,
        }
    }

    fn strict_cfg() -> TailscaleAuthConfig {
        TailscaleAuthConfig {
            strict: true,
            allowed_users: HashSet::new(),
            require_dual_auth: false,
        }
    }

    fn allowlist_cfg(users: &[&str]) -> TailscaleAuthConfig {
        TailscaleAuthConfig {
            strict: false,
            allowed_users: users.iter().map(|s| s.to_lowercase()).collect(),
            require_dual_auth: false,
        }
    }

    fn dual_auth_cfg() -> TailscaleAuthConfig {
        TailscaleAuthConfig {
            strict: false,
            allowed_users: HashSet::new(),
            require_dual_auth: true,
        }
    }

    fn dual_auth_allowlist_cfg(users: &[&str]) -> TailscaleAuthConfig {
        TailscaleAuthConfig {
            strict: false,
            allowed_users: users.iter().map(|s| s.to_lowercase()).collect(),
            require_dual_auth: true,
        }
    }

    // ── extract_tailscale_identity ────────────────────────────────────────────

    #[test]
    fn extract_ts_identity_present_and_populated() {
        let headers = headers_with_ts("alice@example.com");
        let id = extract_tailscale_identity(&headers).expect("should extract identity");
        assert_eq!(id.login, "alice@example.com");
        assert_eq!(id.name, "Alice Architect");
        assert_eq!(id.profile_pic, "https://example.com/pic.jpg");
    }

    #[test]
    fn extract_ts_identity_absent_returns_none() {
        assert!(extract_tailscale_identity(&empty_headers()).is_none());
    }

    #[test]
    fn extract_ts_identity_empty_login_returns_none() {
        // Tailscale strips incoming headers, but test defensive behavior for empty value
        let mut h = HeaderMap::new();
        h.insert(HEADER_USER_LOGIN, "   ".parse().unwrap()); // whitespace only
        assert!(
            extract_tailscale_identity(&h).is_none(),
            "whitespace-only login must not be accepted"
        );
    }

    #[test]
    fn extract_ts_identity_missing_optional_fields() {
        // Only login present — name and profile-pic are optional
        let mut h = HeaderMap::new();
        h.insert(HEADER_USER_LOGIN, "bob@example.com".parse().unwrap());
        let id = extract_tailscale_identity(&h).expect("login alone should work");
        assert_eq!(id.login, "bob@example.com");
        assert_eq!(id.name, ""); // absent → empty
        assert_eq!(id.profile_pic, ""); // absent → empty
    }

    #[test]
    fn extract_ts_identity_trims_whitespace() {
        let mut h = HeaderMap::new();
        h.insert(HEADER_USER_LOGIN, "  alice@example.com  ".parse().unwrap());
        let id = extract_tailscale_identity(&h).expect("trimmed login should work");
        assert_eq!(id.login, "alice@example.com");
    }

    // ── constant_time_eq ──────────────────────────────────────────────────────

    #[test]
    fn constant_time_eq_equal_strings() {
        assert!(constant_time_eq(b"secret-token", b"secret-token"));
    }

    #[test]
    fn constant_time_eq_different_strings() {
        assert!(!constant_time_eq(b"secret-token", b"wrong-token-x"));
    }

    #[test]
    fn constant_time_eq_different_lengths() {
        assert!(!constant_time_eq(b"short", b"longer-string"));
    }

    #[test]
    fn constant_time_eq_empty_strings() {
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn constant_time_eq_empty_vs_nonempty() {
        assert!(!constant_time_eq(b"", b"x"));
        assert!(!constant_time_eq(b"x", b""));
    }

    #[test]
    fn constant_time_eq_single_bit_difference() {
        // Validates that a one-bit difference is detected regardless of position
        assert!(!constant_time_eq(b"aaa", b"aab")); // last byte differs
        assert!(!constant_time_eq(b"aaa", b"baa")); // first byte differs
        assert!(!constant_time_eq(b"aaa", b"aba")); // middle byte differs
    }

    // ── TailscaleAuthConfig ───────────────────────────────────────────────────

    #[test]
    fn allowlist_empty_permits_any_user() {
        let cfg = no_strict_no_allowlist();
        assert!(cfg.is_user_allowed("alice@example.com"));
        assert!(cfg.is_user_allowed("bob@external.org"));
    }

    #[test]
    fn allowlist_populated_restricts_to_listed_users() {
        let cfg = allowlist_cfg(&["alice@example.com", "charlie@example.com"]);
        assert!(cfg.is_user_allowed("alice@example.com"));
        assert!(cfg.is_user_allowed("charlie@example.com"));
        assert!(!cfg.is_user_allowed("mallory@attacker.com"));
        assert!(!cfg.is_user_allowed("bob@example.com"));
    }

    #[test]
    fn allowlist_comparison_is_case_insensitive() {
        // Emails can be mixed-case in TS headers (RFC2047 encoding)
        let cfg = allowlist_cfg(&["Alice@Example.COM"]);
        assert!(cfg.is_user_allowed("alice@example.com")); // lowercase
        assert!(cfg.is_user_allowed("ALICE@EXAMPLE.COM")); // uppercase
        assert!(cfg.is_user_allowed("Alice@Example.COM")); // original case
    }

    #[test]
    fn has_allowlist_reflects_populated_state() {
        assert!(!no_strict_no_allowlist().has_allowlist());
        assert!(allowlist_cfg(&["alice@example.com"]).has_allowlist());
    }

    // ── check_auth: Tailscale path ────────────────────────────────────────────

    #[test]
    fn tailscale_auth_succeeds_for_valid_tailnet_user() {
        let headers = headers_with_ts("alice@example.com");
        let outcome = check_auth(&headers, None, None, &no_strict_no_allowlist());
        assert!(
            matches!(outcome, AuthOutcome::Tailscale(ref id) if id.login == "alice@example.com"),
            "expected Tailscale auth, got: {outcome:?}"
        );
    }

    #[test]
    fn tailscale_auth_preferred_over_token_when_both_present() {
        // Even if a token is configured and provided, TS header takes priority
        let headers = headers_with_ts("alice@example.com");
        let outcome = check_auth(
            &headers,
            Some("mytoken"),
            Some("mytoken"),
            &no_strict_no_allowlist(),
        );
        assert!(
            matches!(outcome, AuthOutcome::Tailscale(_)),
            "Tailscale auth must take priority over token: {outcome:?}"
        );
    }

    #[test]
    fn tailscale_auth_denied_when_user_not_in_allowlist() {
        let headers = headers_with_ts("mallory@attacker.com");
        let cfg = allowlist_cfg(&["alice@example.com"]);
        let outcome = check_auth(&headers, None, None, &cfg);
        assert!(
            matches!(
                outcome,
                AuthOutcome::Denied(DenyReason::UserNotAllowed(ref login)) if login == "mallory@attacker.com"
            ),
            "expected UserNotAllowed, got: {outcome:?}"
        );
    }

    #[test]
    fn tailscale_auth_succeeds_when_user_in_allowlist() {
        let headers = headers_with_ts("alice@example.com");
        let cfg = allowlist_cfg(&["alice@example.com", "bob@example.com"]);
        let outcome = check_auth(&headers, None, None, &cfg);
        assert!(
            matches!(outcome, AuthOutcome::Tailscale(_)),
            "alice is in allowlist, must be allowed: {outcome:?}"
        );
    }

    #[test]
    fn tailscale_auth_allowlist_check_is_case_insensitive() {
        let mut h = HeaderMap::new();
        // Header arrives with mixed case
        h.insert(HEADER_USER_LOGIN, "Alice@Example.COM".parse().unwrap());
        let cfg = allowlist_cfg(&["alice@example.com"]);
        let outcome = check_auth(&h, None, None, &cfg);
        assert!(
            matches!(outcome, AuthOutcome::Tailscale(_)),
            "allowlist check must be case-insensitive: {outcome:?}"
        );
    }

    // ── check_auth: strict mode ───────────────────────────────────────────────

    #[test]
    fn strict_mode_denies_request_without_ts_headers() {
        let outcome = check_auth(
            &empty_headers(),
            Some("mytoken"),
            Some("mytoken"),
            &strict_cfg(),
        );
        assert!(
            matches!(
                outcome,
                AuthOutcome::Denied(DenyReason::StrictModeRequiresTailscale)
            ),
            "strict mode must reject non-TS requests even with valid token: {outcome:?}"
        );
    }

    #[test]
    fn strict_mode_allows_valid_ts_user() {
        let headers = headers_with_ts("alice@example.com");
        let outcome = check_auth(&headers, None, None, &strict_cfg());
        assert!(
            matches!(outcome, AuthOutcome::Tailscale(_)),
            "strict mode must accept valid TS user: {outcome:?}"
        );
    }

    #[test]
    fn strict_mode_denies_even_with_no_api_token_configured() {
        // Strict mode must not fall through to open access
        let outcome = check_auth(&empty_headers(), None, None, &strict_cfg());
        assert!(
            matches!(
                outcome,
                AuthOutcome::Denied(DenyReason::StrictModeRequiresTailscale)
            ),
            "strict mode must reject even with no token configured: {outcome:?}"
        );
    }

    // ── check_auth: token fallback ────────────────────────────────────────────

    #[test]
    fn token_auth_succeeds_with_correct_token() {
        let outcome = check_auth(
            &empty_headers(),
            Some("correct-token"),
            Some("correct-token"),
            &no_strict_no_allowlist(),
        );
        assert!(
            matches!(outcome, AuthOutcome::Token),
            "correct token must succeed: {outcome:?}"
        );
    }

    #[test]
    fn token_auth_fails_with_wrong_token() {
        let outcome = check_auth(
            &empty_headers(),
            Some("wrong-token"),
            Some("correct-token"),
            &no_strict_no_allowlist(),
        );
        assert!(
            matches!(outcome, AuthOutcome::Denied(DenyReason::InvalidToken)),
            "wrong token must be denied: {outcome:?}"
        );
    }

    #[test]
    fn token_auth_fails_with_no_token_provided() {
        let outcome = check_auth(
            &empty_headers(),
            None,
            Some("correct-token"),
            &no_strict_no_allowlist(),
        );
        assert!(
            matches!(outcome, AuthOutcome::Denied(DenyReason::NoCredentials)),
            "no token provided must give NoCredentials: {outcome:?}"
        );
    }

    #[test]
    fn token_auth_fails_with_empty_token() {
        let outcome = check_auth(
            &empty_headers(),
            Some(""),
            Some("correct-token"),
            &no_strict_no_allowlist(),
        );
        assert!(
            matches!(outcome, AuthOutcome::Denied(DenyReason::NoCredentials)),
            "empty token must give NoCredentials: {outcome:?}"
        );
    }

    // ── Spoofing resistance ───────────────────────────────────────────────────

    #[test]
    fn spoofed_ts_header_is_treated_as_valid_ts_auth() {
        // This test DOCUMENTS the invariant: header presence alone is trusted.
        // Protection against spoofing comes from the DEPLOYMENT invariant:
        // the server MUST listen on localhost only. If it does, only the local
        // tailscale serve daemon can reach the server, and it strips incoming
        // headers before injecting its own. This test documents that the code
        // itself does not re-verify headers — it relies on the network invariant.
        //
        // If your server is NOT behind tailscale serve (e.g. exposed directly on
        // a network interface), anyone can forge these headers. Do not do that.
        let mut h = HeaderMap::new();
        h.insert(HEADER_USER_LOGIN, "forged@attacker.com".parse().unwrap());
        let cfg = allowlist_cfg(&["alice@example.com"]);
        let outcome = check_auth(&h, None, None, &cfg);
        // With allowlist configured, the forged user is rejected
        assert!(
            matches!(outcome, AuthOutcome::Denied(DenyReason::UserNotAllowed(_))),
            "forged user rejected by allowlist: {outcome:?}"
        );
    }

    #[test]
    fn spoofed_ts_header_without_allowlist_would_succeed() {
        // IMPORTANT: This test exists to document the threat model clearly.
        // Without an allowlist, any valid-looking Tailscale-User-Login header is
        // trusted. This is SAFE only because tailscale serve strips and re-injects
        // the header, and the server is localhost-only.
        //
        // If you cannot guarantee localhost-only binding, always set
        // AXON_TAILSCALE_ALLOWED_USERS or AXON_TAILSCALE_STRICT=true.
        let mut h = HeaderMap::new();
        h.insert(
            HEADER_USER_LOGIN,
            "legitimate-looking@example.com".parse().unwrap(),
        );
        let outcome = check_auth(&h, None, None, &no_strict_no_allowlist());
        // Without allowlist, any header is accepted — safe ONLY in localhost-only deployment
        assert!(
            matches!(outcome, AuthOutcome::Tailscale(_)),
            "documents: no allowlist = any TS login accepted (safe with localhost binding)"
        );
    }

    // ── auth_log_message ──────────────────────────────────────────────────────

    #[test]
    fn log_message_contains_login_for_ts_auth() {
        let addr: std::net::SocketAddr = "127.0.0.1:12345".parse().unwrap();
        let outcome = AuthOutcome::Tailscale(TailscaleIdentity::test("alice@example.com"));
        let msg = auth_log_message(&outcome, addr);
        assert!(
            msg.contains("alice@example.com"),
            "log must contain login: {msg}"
        );
        assert!(
            msg.contains("tailscale"),
            "log must identify auth method: {msg}"
        );
    }

    #[test]
    fn log_message_identifies_user_not_allowed() {
        let addr: std::net::SocketAddr = "127.0.0.1:12345".parse().unwrap();
        let outcome = AuthOutcome::Denied(DenyReason::UserNotAllowed(
            "mallory@attacker.com".to_string(),
        ));
        let msg = auth_log_message(&outcome, addr);
        assert!(
            msg.contains("mallory@attacker.com"),
            "log must contain the blocked user: {msg}"
        );
        assert!(
            msg.contains("AXON_TAILSCALE_ALLOWED_USERS"),
            "log must reference the env var: {msg}"
        );
    }

    #[test]
    fn log_message_identifies_strict_mode_denial() {
        let addr: std::net::SocketAddr = "127.0.0.1:12345".parse().unwrap();
        let outcome = AuthOutcome::Denied(DenyReason::StrictModeRequiresTailscale);
        let msg = auth_log_message(&outcome, addr);
        assert!(
            msg.contains("AXON_TAILSCALE_STRICT"),
            "log must reference the env var: {msg}"
        );
    }

    // ── check_auth: dual-auth mode ────────────────────────────────────────────

    #[test]
    fn dual_auth_succeeds_when_both_ts_and_token_valid() {
        let headers = headers_with_ts("alice@example.com");
        let outcome = check_auth(
            &headers,
            Some("correct-token"),
            Some("correct-token"),
            &dual_auth_cfg(),
        );
        assert!(
            matches!(outcome, AuthOutcome::DualAuth(ref id) if id.login == "alice@example.com"),
            "dual-auth must succeed when both TS header and token are valid: {outcome:?}"
        );
    }

    #[test]
    fn dual_auth_fails_if_ts_header_absent() {
        let outcome = check_auth(
            &empty_headers(),
            Some("correct-token"),
            Some("correct-token"),
            &dual_auth_cfg(),
        );
        assert!(
            matches!(
                outcome,
                AuthOutcome::Denied(DenyReason::DualAuthRequiresTailscale)
            ),
            "dual-auth must fail without TS header: {outcome:?}"
        );
    }

    #[test]
    fn dual_auth_fails_if_user_not_in_allowlist() {
        let headers = headers_with_ts("mallory@attacker.com");
        let cfg = dual_auth_allowlist_cfg(&["alice@example.com"]);
        let outcome = check_auth(&headers, Some("correct-token"), Some("correct-token"), &cfg);
        assert!(
            matches!(outcome, AuthOutcome::Denied(DenyReason::UserNotAllowed(ref u)) if u == "mallory@attacker.com"),
            "dual-auth must fail when user not in allowlist: {outcome:?}"
        );
    }

    #[test]
    fn dual_auth_fails_if_token_wrong() {
        let headers = headers_with_ts("alice@example.com");
        let outcome = check_auth(
            &headers,
            Some("wrong-token"),
            Some("correct-token"),
            &dual_auth_cfg(),
        );
        assert!(
            matches!(
                outcome,
                AuthOutcome::Denied(DenyReason::DualAuthRequiresToken)
            ),
            "dual-auth must fail with wrong token: {outcome:?}"
        );
    }

    #[test]
    fn dual_auth_fails_if_only_ts_present() {
        // TS header valid but no token configured at all
        let headers = headers_with_ts("alice@example.com");
        let outcome = check_auth(&headers, None, None, &dual_auth_cfg());
        assert!(
            matches!(
                outcome,
                AuthOutcome::Denied(DenyReason::DualAuthRequiresToken)
            ),
            "dual-auth must fail when only TS header is present (no token): {outcome:?}"
        );
    }

    #[test]
    fn dual_auth_fails_if_only_token_present() {
        // Token correct but no TS header
        let outcome = check_auth(
            &empty_headers(),
            Some("correct-token"),
            Some("correct-token"),
            &dual_auth_cfg(),
        );
        assert!(
            matches!(
                outcome,
                AuthOutcome::Denied(DenyReason::DualAuthRequiresTailscale)
            ),
            "dual-auth must fail when only token is present (no TS header): {outcome:?}"
        );
    }
}
