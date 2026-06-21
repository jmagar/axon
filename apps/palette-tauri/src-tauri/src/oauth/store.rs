//! Persistence for OAuth credentials, stored beside `settings.json` in the
//! app config dir as `oauth.json` (mode 0o600). Holds a sensitive refresh
//! token — the `Debug` impl is hand-written and redacted; never derive it.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const CREDENTIALS_FILE: &str = "oauth.json";

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct StoredCredentials {
    pub client_id: String,
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// The token endpoint discovered at login. Refresh posts here rather than
    /// reconstructing `{server_url}/token`, which breaks behind reverse proxies.
    pub token_endpoint: String,
    pub expires_at_unix: i64,
    pub scope: String,
    pub server_url: String,
}

impl std::fmt::Debug for StoredCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredCredentials")
            .field("client_id", &self.client_id)
            .field("access_token", &"<redacted>")
            .field(
                "refresh_token",
                &self.refresh_token.as_ref().map(|_| "<redacted>"),
            )
            .field("token_endpoint", &self.token_endpoint)
            .field("expires_at_unix", &self.expires_at_unix)
            .field("scope", &self.scope)
            .field("server_url", &self.server_url)
            .finish()
    }
}

impl StoredCredentials {
    /// True when the access token is at or past expiry once `skew_secs` of
    /// safety margin is applied.
    pub(crate) fn is_expired(&self, now_unix: i64, skew_secs: i64) -> bool {
        now_unix + skew_secs >= self.expires_at_unix
    }

    /// True when these credentials were issued for `server_url` (trailing
    /// slashes ignored on both sides).
    pub(crate) fn matches_server(&self, server_url: &str) -> bool {
        self.server_url.trim_end_matches('/') == server_url.trim_end_matches('/')
    }
}

/// Resolve the credentials file path (`<app_config_dir>/oauth.json`).
pub(crate) fn credentials_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(CREDENTIALS_FILE))
        .map_err(|err| format!("failed to resolve app config directory: {err}"))
}

/// Load credentials, returning `None` when the file is missing or unparseable
/// (a corrupt file degrades to "signed out", never a hard error). A non-missing
/// read error is logged so it is not silently indistinguishable from absence.
pub(crate) fn load(path: &Path) -> Option<StoredCredentials> {
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
        Err(err) => {
            eprintln!("palette: failed to read oauth credentials: {err}");
            return None;
        }
    };
    match serde_json::from_str(&contents) {
        Ok(creds) => Some(creds),
        Err(err) => {
            eprintln!("palette: ignoring unparseable oauth credentials: {err}");
            None
        }
    }
}

/// Persist credentials atomically with `0o600` perms.
pub(crate) fn save(path: &Path, creds: &StoredCredentials) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let json = serde_json::to_string_pretty(creds).map_err(|err| err.to_string())?;
    crate::persistence::atomic_write(path, json.as_bytes()).map_err(|err| err.to_string())
}

/// Remove the credentials file. Missing file is success (idempotent).
pub(crate) fn clear(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
