//! OAuth 2.0 (Authorization Code + PKCE) login client for the Axon server.
//!
//! The full flow runs in the Rust shell because the webview CSP forbids
//! outbound HTTP and there is no shell/deep-link capability. Credentials are
//! cached in `OauthState` (Tauri-managed); refresh is single-flight under the
//! cache lock.

pub(crate) mod callback_server;
pub(crate) mod flow;
pub(crate) mod pkce;
pub(crate) mod store;

use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;

use crate::axon_bridge::BridgeClient;
use crate::oauth::store::StoredCredentials;
use crate::{merged_settings, validate_saved_server_url};

/// Client login timeout, kept below the server's 300s auth-request TTL so the
/// client times out first with a clear message.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(240);
/// Refresh the access token this many seconds before its stated expiry.
const EXPIRY_SKEW_SECS: i64 = 60;
const SCOPE: &str = "axon:read axon:write";

/// Cached credentials for the current process. `Unloaded` until first access,
/// then `Loaded(Some|None)`.
enum CredCache {
    Unloaded,
    Loaded(Option<StoredCredentials>),
}

/// Tauri-managed OAuth state: the credential cache (whose lock also serializes
/// refresh — single-flight) and a guard that serializes interactive logins.
pub(crate) struct OauthState {
    creds: tokio::sync::Mutex<CredCache>,
    login: tokio::sync::Mutex<()>,
}

impl OauthState {
    pub(crate) fn new() -> Self {
        OauthState {
            creds: tokio::sync::Mutex::new(CredCache::Unloaded),
            login: tokio::sync::Mutex::new(()),
        }
    }
}

impl Default for OauthState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OauthStatus {
    pub signed_in: bool,
    pub scope: Option<String>,
    pub expires_at_unix: Option<i64>,
    pub server_url: Option<String>,
}

/// Build a status for the UI: signed in only when the stored credentials match
/// the currently-configured server. On a server mismatch, `signed_in` is false
/// but `server_url` carries the credential's server so the UI can explain it.
pub(crate) fn status_for(creds: Option<&StoredCredentials>, current_server: &str) -> OauthStatus {
    match creds {
        Some(creds) if creds.matches_server(current_server) => OauthStatus {
            signed_in: true,
            scope: Some(creds.scope.clone()),
            expires_at_unix: Some(creds.expires_at_unix),
            server_url: Some(creds.server_url.clone()),
        },
        Some(creds) => OauthStatus {
            signed_in: false,
            scope: None,
            expires_at_unix: None,
            server_url: Some(creds.server_url.clone()),
        },
        None => OauthStatus {
            signed_in: false,
            scope: None,
            expires_at_unix: None,
            server_url: None,
        },
    }
}

#[tauri::command]
pub(crate) async fn axon_oauth_login(
    app: AppHandle,
    bridge: tauri::State<'_, BridgeClient>,
    oauth_state: tauri::State<'_, OauthState>,
) -> Result<OauthStatus, String> {
    // Serialize interactive logins — a second concurrent click is rejected.
    let _login_guard = oauth_state
        .login
        .try_lock()
        .map_err(|_| "a sign-in is already in progress".to_string())?;

    let settings = merged_settings(&app)?;
    let server_url = validate_saved_server_url(&settings.server_url)?;
    let client = bridge.client().clone();

    let creds = run_login(&client, &server_url).await?;
    let path = store::credentials_path(&app)?;
    store::save(&path, &creds)?;
    *oauth_state.creds.lock().await = CredCache::Loaded(Some(creds.clone()));
    Ok(status_for(Some(&creds), &server_url))
}

#[tauri::command]
pub(crate) async fn axon_oauth_logout(
    app: AppHandle,
    oauth_state: tauri::State<'_, OauthState>,
) -> Result<OauthStatus, String> {
    let path = store::credentials_path(&app)?;
    store::clear(&path)?;
    *oauth_state.creds.lock().await = CredCache::Loaded(None);
    Ok(OauthStatus {
        signed_in: false,
        scope: None,
        expires_at_unix: None,
        server_url: None,
    })
}

#[tauri::command]
pub(crate) async fn axon_oauth_status(
    app: AppHandle,
    oauth_state: tauri::State<'_, OauthState>,
) -> Result<OauthStatus, String> {
    let settings = merged_settings(&app)?;
    let server_url = validate_saved_server_url(&settings.server_url)?;
    let mut cache = oauth_state.creds.lock().await;
    ensure_loaded(&app, &mut cache);
    let CredCache::Loaded(slot) = &*cache else {
        unreachable!("ensure_loaded sets Loaded")
    };
    Ok(status_for(slot.as_ref(), &server_url))
}

/// Resolve the token to attach to a bridge request: a valid OAuth access token
/// for `server_url` (refreshing single-flight on expiry), else the static token.
pub(crate) async fn resolve_auth_token(
    app: &AppHandle,
    client: &reqwest::Client,
    server_url: &str,
    static_token: Option<&str>,
    state: &OauthState,
) -> Option<String> {
    let oauth = effective_access_token(app, client, server_url, state).await;
    pick_token(oauth, static_token.map(str::to_string))
}

/// The cached OAuth access token for `server_url`, refreshed if expired. Holds
/// the cache lock across any refresh so concurrent callers single-flight.
async fn effective_access_token(
    app: &AppHandle,
    client: &reqwest::Client,
    server_url: &str,
    state: &OauthState,
) -> Option<String> {
    let mut cache = state.creds.lock().await;
    ensure_loaded(app, &mut cache);
    let CredCache::Loaded(slot) = &mut *cache else {
        unreachable!("ensure_loaded sets Loaded")
    };

    // Snapshot the fields needed before any await (ends the borrow on `slot`).
    let (client_id, token_endpoint, refresh_token, access_token, valid) = {
        let creds = slot.as_ref()?;
        if !creds.matches_server(server_url) {
            return None;
        }
        (
            creds.client_id.clone(),
            creds.token_endpoint.clone(),
            creds.refresh_token.clone(),
            creds.access_token.clone(),
            !creds.is_expired(now_unix(), EXPIRY_SKEW_SECS),
        )
    };
    if valid {
        return Some(access_token);
    }

    // Expired. Re-validate the stored endpoint, then single-flight a refresh.
    let refresh_token = refresh_token?;
    let token_endpoint = flow::require_secure_url(&token_endpoint).ok()?.to_string();
    match flow::refresh_access_token(client, &token_endpoint, &client_id, &refresh_token).await {
        Ok(token) => {
            let refreshed = credentials_from_token(client_id, server_url, token_endpoint, token);
            let access = refreshed.access_token.clone();
            if let Ok(path) = store::credentials_path(app) {
                let _ = store::save(&path, &refreshed);
            }
            *slot = Some(refreshed);
            Some(access)
        }
        Err(err) => {
            eprintln!("palette: OAuth token refresh failed, falling back: {err}");
            None
        }
    }
}

/// Run the browser-based authorization-code flow and return fresh credentials.
async fn run_login(
    client: &reqwest::Client,
    server_url: &str,
) -> Result<StoredCredentials, String> {
    flow::require_secure_url(server_url)?;
    let meta = flow::discover(client, server_url).await?;
    let registration_endpoint = meta.registration_endpoint.clone().ok_or_else(|| {
        "this server does not support OAuth login (dynamic client registration is disabled) — \
         use a static bearer token instead"
            .to_string()
    })?;
    // Validate every server-supplied endpoint before using it.
    flow::require_secure_url(&meta.authorization_endpoint)?;
    flow::require_secure_url(&meta.token_endpoint)?;
    flow::require_secure_url(&registration_endpoint)?;

    let listener = callback_server::bind().await?;
    let client_id =
        flow::register_client(client, &registration_endpoint, &listener.redirect_uri).await?;

    let verifier = pkce::generate_code_verifier();
    let challenge = pkce::code_challenge_s256(&verifier);
    let state = pkce::generate_state();
    let authorize_url = flow::build_authorize_url(
        &meta,
        &client_id,
        &listener.redirect_uri,
        SCOPE,
        &state,
        &challenge,
    )?;

    if let Err(err) = open::that(&authorize_url) {
        return Err(format!(
            "failed to open the system browser — open this URL manually to sign in:\n{authorize_url}\n({err})"
        ));
    }

    let code = listener
        .await_code(&state, LOGIN_TIMEOUT)
        .await
        .map_err(|err| {
            format!("{err}. If the browser did not open, sign in here:\n{authorize_url}")
        })?;

    let token = flow::exchange_code(
        client,
        &meta.token_endpoint,
        &code,
        &client_id,
        &listener.redirect_uri,
        &verifier,
    )
    .await?;

    Ok(credentials_from_token(
        client_id,
        server_url,
        meta.token_endpoint,
        token,
    ))
}

fn credentials_from_token(
    client_id: String,
    server_url: &str,
    token_endpoint: String,
    token: flow::TokenResponse,
) -> StoredCredentials {
    StoredCredentials {
        client_id,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        token_endpoint,
        expires_at_unix: now_unix() + token.expires_in as i64,
        scope: token.scope,
        server_url: server_url.trim_end_matches('/').to_string(),
    }
}

/// Populate the cache from disk on first use. Caller holds the cache lock.
fn ensure_loaded(app: &AppHandle, cache: &mut CredCache) {
    if let CredCache::Unloaded = cache {
        let loaded = store::credentials_path(app)
            .ok()
            .and_then(|path| store::load(&path));
        *cache = CredCache::Loaded(loaded);
    }
}

/// Prefer an OAuth token over the static bearer token.
pub(crate) fn pick_token(oauth: Option<String>, static_token: Option<String>) -> Option<String> {
    oauth.or(static_token)
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "oauth_tests.rs"]
mod tests;
