//! SSH key challenge-response authentication layer.
//!
//! ## Flow
//!
//! 1. Client sends `GET /auth/ssh-challenge` (public endpoint).
//!    Server returns `{ "nonce": "<64-hex-chars>", "expires_secs": 30 }`.
//!
//! 2. Client signs the nonce with their SSH private key:
//!    ```text
//!    echo -n "<nonce>" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n axon-auth -
//!    ```
//!
//! 3. Client sends the upgrade request with headers:
//!    - `X-SSH-Nonce: <hex-nonce>`
//!    - `X-SSH-Pubkey: <single-line public key, e.g. "ssh-ed25519 AAAA...">`
//!    - `X-SSH-Signature: <base64-encoded armored .sig output>`
//!
//! 4. Server verifies via `ssh-keygen -Y verify`, consuming the nonce (single-use).
//!
//! ## Security notes
//!
//! - Nonces are single-use (consumed on first valid use) to prevent replay attacks.
//! - Nonces expire after 30 seconds to limit the window for interception.
//! - The authorized keys file must be on the local filesystem — no remote fetching.
//! - `ssh-keygen -Y verify` is spawned as a subprocess; the pubkey and signature are
//!   written to tempfiles (never passed via shell args) to prevent injection.

use axum::http::HeaderMap;
use dashmap::DashMap;
use std::io::Write as _;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::tailscale_auth::SshKeyIdentity;

// ── Header names ──────────────────────────────────────────────────────────────

const HEADER_SSH_NONCE: &str = "x-ssh-nonce";
const HEADER_SSH_PUBKEY: &str = "x-ssh-pubkey";
const HEADER_SSH_SIGNATURE: &str = "x-ssh-signature";

/// Default nonce TTL — 30 seconds.
const NONCE_TTL_SECS: u64 = 30;

// ── Error type ────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum SshAuthError {
    /// Required SSH header (`X-SSH-Nonce`, `X-SSH-Pubkey`, or `X-SSH-Signature`) was absent.
    HeaderMissing(&'static str),
    /// The nonce was not found in the store — never issued or already consumed.
    NonceNotFound,
    /// The nonce was issued but has passed its 30-second TTL.
    NonceExpired,
    /// The public key string is malformed (must be `<type> <base64> [comment]`).
    InvalidPubkey,
    /// The signature is not valid base64.
    InvalidSignatureEncoding,
    /// `authorized_keys` path does not exist or is not readable.
    AuthorizedKeysNotFound,
    /// `ssh-keygen -Y verify` exited non-zero or could not be spawned.
    SshKeygenFailed(String),
}

impl std::fmt::Display for SshAuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::HeaderMissing(h) => write!(f, "missing SSH header: {h}"),
            Self::NonceNotFound => write!(f, "ssh nonce not found (never issued or already used)"),
            Self::NonceExpired => write!(f, "ssh nonce expired (>30 s)"),
            Self::InvalidPubkey => write!(f, "invalid SSH public key format"),
            Self::InvalidSignatureEncoding => write!(f, "signature is not valid base64"),
            Self::AuthorizedKeysNotFound => write!(f, "authorized_keys file not found"),
            Self::SshKeygenFailed(msg) => write!(f, "ssh-keygen verification failed: {msg}"),
        }
    }
}

// ── Nonce store ───────────────────────────────────────────────────────────────

/// Thread-safe store for issued nonces.
///
/// Each nonce maps to the `Instant` it was issued; entries are consumed on first
/// use and evicted by the background task when they exceed `NONCE_TTL_SECS`.
pub struct SshChallengeStore {
    nonces: DashMap<String, Instant>,
    ttl: Duration,
}

impl SshChallengeStore {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            nonces: DashMap::new(),
            ttl: Duration::from_secs(NONCE_TTL_SECS),
        })
    }

    /// Issue a new 64-character hex nonce (32 random bytes) and store it.
    pub fn generate_nonce(&self) -> String {
        // rand::random::<[u8; 32]>() uses the thread-local CSPRNG (rand 0.9+).
        let bytes: [u8; 32] = rand::random();
        let nonce = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        self.nonces.insert(nonce.clone(), Instant::now());
        nonce
    }

    /// Atomically validate and consume a nonce.
    ///
    /// Returns `true` iff the nonce existed and was not expired.
    /// The nonce is removed on the first call (single-use invariant).
    pub fn validate_and_consume(&self, nonce: &str) -> Result<(), SshAuthError> {
        let Some((_, issued_at)) = self.nonces.remove(nonce) else {
            return Err(SshAuthError::NonceNotFound);
        };
        if issued_at.elapsed() > self.ttl {
            return Err(SshAuthError::NonceExpired);
        }
        Ok(())
    }

    /// Evict all expired nonces. Called periodically by a background task.
    pub fn evict_expired(&self) {
        let ttl = self.ttl;
        self.nonces
            .retain(|_, issued_at| issued_at.elapsed() <= ttl);
    }
}

impl Default for SshChallengeStore {
    fn default() -> Self {
        Self {
            nonces: DashMap::new(),
            ttl: Duration::from_secs(NONCE_TTL_SECS),
        }
    }
}

// ── Public auth entry point ───────────────────────────────────────────────────

/// Check SSH auth headers, validate and consume the nonce, verify the signature.
///
/// Called from WS/HTTP handlers when `X-SSH-Nonce` is present in the request.
/// Returns `SshKeyIdentity` on success; `SshAuthError` on any failure.
pub fn check_ssh_headers(
    headers: &HeaderMap,
    store: &SshChallengeStore,
    authorized_keys_path: &Path,
) -> Result<SshKeyIdentity, SshAuthError> {
    let nonce = header_str(headers, HEADER_SSH_NONCE)?;
    let pubkey = header_str(headers, HEADER_SSH_PUBKEY)?;
    let sig_b64 = header_str(headers, HEADER_SSH_SIGNATURE)?;

    // Consume nonce first — before any expensive I/O — to prevent double-use.
    store.validate_and_consume(nonce)?;

    verify_ssh_signature(nonce, pubkey, sig_b64, authorized_keys_path)
}

// ── Signature verification ────────────────────────────────────────────────────

/// Verify an SSH signature against a nonce using `ssh-keygen -Y verify`.
///
/// Writes the public key to a temporary `allowed_signers` file and the
/// signature to a temporary `.sig` file, then spawns `ssh-keygen` to verify.
/// Tempfiles are cleaned up when their handles drop.
pub fn verify_ssh_signature(
    nonce: &str,
    pubkey_pem: &str,
    sig_b64: &str,
    authorized_keys_path: &Path,
) -> Result<SshKeyIdentity, SshAuthError> {
    // Validate public key has at least two fields: <type> <base64> [comment]
    let parts: Vec<&str> = pubkey_pem.split_whitespace().collect();
    if parts.len() < 2 {
        return Err(SshAuthError::InvalidPubkey);
    }
    let identity = parts.get(2).copied().unwrap_or("axon-user");

    // Decode signature from base64 to raw bytes
    let sig_bytes = base64_decode(sig_b64)?;

    // Authorized keys file must exist
    if !authorized_keys_path.exists() {
        return Err(SshAuthError::AuthorizedKeysNotFound);
    }

    // Write allowed_signers tempfile: "<identity> <pubkey_pem>"
    let mut signers_file = tempfile::NamedTempFile::new()
        .map_err(|e| SshAuthError::SshKeygenFailed(format!("tempfile: {e}")))?;
    writeln!(signers_file, "{identity} {pubkey_pem}")
        .map_err(|e| SshAuthError::SshKeygenFailed(format!("write signers: {e}")))?;

    // Write signature tempfile (raw binary)
    let mut sig_file = tempfile::NamedTempFile::new()
        .map_err(|e| SshAuthError::SshKeygenFailed(format!("tempfile: {e}")))?;
    sig_file
        .write_all(&sig_bytes)
        .map_err(|e| SshAuthError::SshKeygenFailed(format!("write sig: {e}")))?;
    sig_file
        .flush()
        .map_err(|e| SshAuthError::SshKeygenFailed(format!("flush sig: {e}")))?;

    // Run: ssh-keygen -Y verify -f <allowed_signers> -I <identity> -n axon-auth -s <sig_file>
    // Nonce is passed via stdin.
    let output = std::process::Command::new("ssh-keygen")
        .arg("-Y")
        .arg("verify")
        .arg("-f")
        .arg(signers_file.path())
        .arg("-I")
        .arg(identity)
        .arg("-n")
        .arg("axon-auth")
        .arg("-s")
        .arg(sig_file.path())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write as _;
            if let Some(stdin) = child.stdin.as_mut() {
                let _ = stdin.write_all(nonce.as_bytes());
            }
            child.wait_with_output()
        })
        .map_err(|e| SshAuthError::SshKeygenFailed(format!("spawn: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(SshAuthError::SshKeygenFailed(stderr.trim().to_string()));
    }

    // Extract fingerprint from stdout: "Good "axon-auth" signature for <identity>"
    // Run ssh-keygen -l -f <pubkey> to get the fingerprint separately.
    let fingerprint = extract_fingerprint(pubkey_pem)
        .unwrap_or_else(|| format!("key:{}", &pubkey_pem[..pubkey_pem.len().min(16)]));

    Ok(SshKeyIdentity { fingerprint })
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn header_str<'a>(headers: &'a HeaderMap, name: &'static str) -> Result<&'a str, SshAuthError> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(SshAuthError::HeaderMissing(name))
}

fn base64_decode(input: &str) -> Result<Vec<u8>, SshAuthError> {
    // Strip PEM armor if present (ssh-keygen -Y sign outputs armored format)
    let stripped = strip_pem_armor(input);
    // Use base64 via standard library approach: decode line-by-line
    base64_std_decode(stripped.trim()).ok_or(SshAuthError::InvalidSignatureEncoding)
}

fn strip_pem_armor(input: &str) -> String {
    // Remove -----BEGIN SSH SIGNATURE----- ... -----END SSH SIGNATURE----- wrapping
    input
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("")
}

/// Minimal base64 decoder (no external dep beyond std).
fn base64_std_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let bytes: Vec<u8> = input.bytes().filter(|&b| b != b'=').collect();
    if bytes.len() % 4 > 2 {
        // Allow up to 2 padding chars stripped; 1-byte remainder is invalid
    }
    let lookup = |c: u8| -> Option<u8> { TABLE.iter().position(|&t| t == c).map(|i| i as u8) };
    let mut i = 0;
    let chunks = bytes.len() / 4;
    let rem = bytes.len() % 4;
    while i < chunks * 4 {
        let a = lookup(bytes[i])?;
        let b = lookup(bytes[i + 1])?;
        let c = lookup(bytes[i + 2])?;
        let d = lookup(bytes[i + 3])?;
        out.push((a << 2) | (b >> 4));
        out.push((b << 4) | (c >> 2));
        out.push((c << 6) | d);
        i += 4;
    }
    match rem {
        2 => {
            let a = lookup(bytes[i])?;
            let b = lookup(bytes[i + 1])?;
            out.push((a << 2) | (b >> 4));
        }
        3 => {
            let a = lookup(bytes[i])?;
            let b = lookup(bytes[i + 1])?;
            let c = lookup(bytes[i + 2])?;
            out.push((a << 2) | (b >> 4));
            out.push((b << 4) | (c >> 2));
        }
        _ => {}
    }
    Some(out)
}

/// Run `ssh-keygen -l -f -` on the public key to extract its fingerprint.
fn extract_fingerprint(pubkey_pem: &str) -> Option<String> {
    let mut key_file = tempfile::NamedTempFile::new().ok()?;
    writeln!(key_file, "{pubkey_pem}").ok()?;
    let output = std::process::Command::new("ssh-keygen")
        .arg("-l")
        .arg("-f")
        .arg(key_file.path())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    // Output: "256 SHA256:XXXXX comment (ED25519)"
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.split_whitespace().nth(1).map(|s| s.to_string())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_store() -> SshChallengeStore {
        SshChallengeStore::default()
    }

    #[test]
    fn generate_nonce_returns_64_hex_chars() {
        let store = make_store();
        let nonce = store.generate_nonce();
        assert_eq!(nonce.len(), 64, "nonce must be 64 hex chars");
        assert!(
            nonce.chars().all(|c| c.is_ascii_hexdigit()),
            "nonce must be all hex digits: {nonce}"
        );
    }

    #[test]
    fn generate_nonce_is_unique() {
        let store = make_store();
        let a = store.generate_nonce();
        let b = store.generate_nonce();
        assert_ne!(a, b, "two consecutive nonces must differ");
    }

    #[test]
    fn validate_and_consume_removes_nonce() {
        let store = make_store();
        let nonce = store.generate_nonce();
        assert!(
            store.validate_and_consume(&nonce).is_ok(),
            "first consume must succeed"
        );
        // Nonce is gone after consumption
        assert_eq!(store.nonces.len(), 0);
    }

    #[test]
    fn validate_and_consume_false_on_missing() {
        let store = make_store();
        let result = store.validate_and_consume(
            "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        );
        assert!(
            matches!(result, Err(SshAuthError::NonceNotFound)),
            "unknown nonce must return NonceNotFound"
        );
    }

    #[test]
    fn validate_and_consume_expired() {
        // Insert a nonce with a past Instant by building a store with zero TTL
        let store = SshChallengeStore {
            nonces: DashMap::new(),
            ttl: Duration::from_secs(0),
        };
        let nonce = store.generate_nonce();
        // Even with 0 TTL, elapsed() may be 0 on a fast machine — sleep to ensure expiry
        std::thread::sleep(Duration::from_millis(1));
        let result = store.validate_and_consume(&nonce);
        assert!(
            matches!(result, Err(SshAuthError::NonceExpired)),
            "expired nonce must return NonceExpired: {result:?}"
        );
    }

    #[test]
    fn nonce_is_single_use() {
        let store = make_store();
        let nonce = store.generate_nonce();
        assert!(
            store.validate_and_consume(&nonce).is_ok(),
            "first use must succeed"
        );
        let result = store.validate_and_consume(&nonce);
        assert!(
            matches!(result, Err(SshAuthError::NonceNotFound)),
            "second use must fail with NonceNotFound: {result:?}"
        );
    }

    #[test]
    fn check_ssh_headers_returns_err_if_headers_absent() {
        let store = make_store();
        let keys_path = std::path::PathBuf::from("/tmp/axon-test-no-such-keys");
        let headers = axum::http::HeaderMap::new();
        let result = check_ssh_headers(&headers, &store, &keys_path);
        assert!(
            matches!(result, Err(SshAuthError::HeaderMissing(_))),
            "absent headers must return HeaderMissing: {result:?}"
        );
    }

    #[test]
    fn evict_expired_removes_stale_nonces() {
        let store = SshChallengeStore {
            nonces: DashMap::new(),
            ttl: Duration::from_secs(0),
        };
        // Insert directly (bypassing generate_nonce which also inserts)
        store.nonces.insert("stale".to_string(), Instant::now());
        std::thread::sleep(Duration::from_millis(1));
        store.evict_expired();
        assert!(store.nonces.is_empty(), "expired nonce must be evicted");
    }

    /// Full end-to-end test using real ssh-keygen.
    /// Requires ssh-keygen to be installed and an ED25519 key to be generated.
    /// Skipped in CI via #[ignore].
    #[test]
    #[ignore]
    fn verify_with_real_ssh_keygen() {
        use std::process::Command;

        // Generate a temporary key pair
        let dir = tempfile::tempdir().unwrap();
        let key_path = dir.path().join("test_key");
        let pub_path = dir.path().join("test_key.pub");
        let auth_path = dir.path().join("authorized_keys");

        Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-N", "", "-f"])
            .arg(&key_path)
            .output()
            .expect("ssh-keygen keygen failed");

        let pubkey = std::fs::read_to_string(&pub_path).unwrap();
        let pubkey = pubkey.trim();

        // Copy pubkey to authorized_keys
        std::fs::write(&auth_path, format!("{pubkey}\n")).unwrap();

        let store = make_store();
        let nonce = store.generate_nonce();

        // Sign nonce
        let sign_out = Command::new("ssh-keygen")
            .args(["-Y", "sign", "-f"])
            .arg(&key_path)
            .args(["-n", "axon-auth", "-"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut c| {
                use std::io::Write as _;
                c.stdin
                    .as_mut()
                    .unwrap()
                    .write_all(nonce.as_bytes())
                    .unwrap();
                c.wait_with_output()
            })
            .unwrap();

        assert!(sign_out.status.success(), "signing failed");
        let sig_raw = sign_out.stdout;
        // Encode as base64
        let sig_b64 = base64_encode(&sig_raw);

        // Build headers
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(HEADER_SSH_NONCE, nonce.parse().unwrap());
        headers.insert(HEADER_SSH_PUBKEY, pubkey.parse().unwrap());
        headers.insert(HEADER_SSH_SIGNATURE, sig_b64.parse().unwrap());

        let result = check_ssh_headers(&headers, &store, &auth_path);
        assert!(
            result.is_ok(),
            "real ssh-keygen verification failed: {result:?}"
        );
    }
}

/// Base64 encoder (test helper only).
#[cfg(test)]
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
        out.push(TABLE[b0 >> 2] as char);
        out.push(TABLE[((b0 & 3) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((b1 & 0xf) << 2) | (b2 >> 6)] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[b2 & 0x3f] as char);
        } else {
            out.push('=');
        }
    }
    out
}
