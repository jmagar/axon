//! The four SFTP `#[tauri::command]`s: connect (with TOFU host-key gating),
//! list a directory, read a file, and disconnect — plus the two known-hosts
//! management commands. See `sftp_bridge.rs`'s module doc for the
//! registration gate: these are only wired into `lib.rs`'s
//! `invoke_handler!` once this module exists and its handshake goes through
//! `handler::SftpClientHandler`.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::{
    ConnectionId, SftpConnections, new_connection_id, normalize_remote_path,
    validate_private_key_path,
};
use crate::sftp_bridge::handler::{HandshakeOutcome, SftpClientHandler};
use crate::sftp_known_hosts::{
    KnownHostEntry, load_known_hosts, pin_host_key, revoke_host_key, save_known_hosts,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SftpConnectionInput {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub private_key_path: String,
    /// Set by the frontend on a re-connect attempt after the user confirmed
    /// `SftpTrustPrompt` for this exact host/port/fingerprint.
    #[serde(default)]
    pub trust_new_host: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum SftpConnectResult {
    Connected { connection_id: ConnectionId },
    PendingTrust { entry: KnownHostEntry },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_unix: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SftpDirListing {
    pub path: String,
    pub entries: Vec<SftpEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SftpFileContents {
    pub path: String,
    pub content: String,
}

/// SFTP file previews are read over the network (unlike local disk reads),
/// so latency scales with both file size and round-trip time. This reuses
/// `files_bridge::MAX_TEXT_FILE_BYTES`'s 5 MiB ceiling as a first pass —
/// revisit with a smaller cap if remote previews prove too slow in practice
/// (tracked as an open question, not a hard requirement for v1).
const MAX_SFTP_TEXT_FILE_BYTES: usize = 5 * 1024 * 1024;

#[tauri::command]
pub(crate) async fn sftp_connect(
    app: AppHandle,
    connections: tauri::State<'_, SftpConnections>,
    profile: SftpConnectionInput,
) -> Result<SftpConnectResult, String> {
    let key_path = validate_private_key_path(std::path::Path::new(&profile.private_key_path))?;
    let known_hosts = load_known_hosts(&app)?;

    let outcome = Arc::new(Mutex::new(None));
    let handler = SftpClientHandler {
        host: profile.host.clone(),
        port: profile.port,
        known_hosts,
        trust_new_host: profile.trust_new_host,
        outcome: outcome.clone(),
    };

    let config = Arc::new(russh::client::Config::default());
    let connect_result =
        russh::client::connect(config, (profile.host.as_str(), profile.port), handler).await;

    let handshake_outcome = outcome.lock().ok().and_then(|mut g| g.take());
    let proceeded_entry = match handshake_outcome {
        Some(HandshakeOutcome::NeedsTrustPrompt { entry }) => {
            return Ok(SftpConnectResult::PendingTrust { entry });
        }
        Some(HandshakeOutcome::Mismatch {
            pinned_fingerprint,
            seen_fingerprint,
        }) => {
            return Err(format!(
                "host key for {}:{} changed (expected {pinned_fingerprint}, got {seen_fingerprint}) — \
                 refusing to connect. If this change is expected, revoke the old pinned key first.",
                profile.host, profile.port
            ));
        }
        Some(HandshakeOutcome::Proceeded { entry }) => Some(entry),
        None => None,
    };

    let mut session = connect_result.map_err(|err| err.to_string())?;

    // The handshake succeeded and check_server_key accepted the key. If this
    // was a first-trust confirmation (trust_new_host), persist the pin now
    // that the connection is actually proven live, not merely offered — the
    // exact entry the handler observed during the handshake (host/port/
    // key_type/fingerprint) is reused verbatim, no re-derivation needed.
    if profile.trust_new_host
        && let Some(mut entry) = proceeded_entry
    {
        entry.first_seen_unix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut store = load_known_hosts(&app)?;
        pin_host_key(&mut store, entry);
        save_known_hosts(&app, &store)?;
    }

    let key = russh::keys::load_secret_key(&key_path, None).map_err(|err| err.to_string())?;
    let key = Arc::new(key);
    let auth = session
        .authenticate_publickey(
            profile.username.clone(),
            russh::keys::PrivateKeyWithHashAlg::new(key, Some(russh::keys::HashAlg::Sha256)),
        )
        .await
        .map_err(|err| err.to_string())?;
    if !auth.success() {
        return Err(format!(
            "authentication failed for {}@{}:{}",
            profile.username, profile.host, profile.port
        ));
    }

    let channel = session
        .channel_open_session()
        .await
        .map_err(|err| err.to_string())?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|err| err.to_string())?;
    let stream = channel.into_stream();
    let sftp = russh_sftp::client::SftpSession::new(stream)
        .await
        .map_err(|err| err.to_string())?;

    let connection_id = new_connection_id();
    connections
        .0
        .lock()
        .await
        .insert(connection_id.clone(), sftp);
    Ok(SftpConnectResult::Connected { connection_id })
}

#[tauri::command]
pub(crate) async fn sftp_list_dir(
    connections: tauri::State<'_, SftpConnections>,
    connection_id: String,
    path: Option<String>,
) -> Result<SftpDirListing, String> {
    let target = path.unwrap_or_default();
    let normalized = normalize_remote_path(&target)?;
    let guard = connections.0.lock().await;
    let sftp = guard
        .get(&connection_id)
        .ok_or_else(|| "SFTP connection not found".to_string())?;
    let list_path = if normalized.is_empty() {
        ".".to_string()
    } else {
        normalized.clone()
    };
    let read_dir = sftp
        .read_dir(&list_path)
        .await
        .map_err(|err| err.to_string())?;
    let mut entries = Vec::new();
    for entry in read_dir {
        let metadata = entry.metadata();
        entries.push(SftpEntry {
            name: entry.file_name(),
            path: entry.path(),
            is_dir: entry.file_type().is_dir(),
            size: metadata.size.unwrap_or(0),
            modified_unix: metadata.mtime.map(u64::from),
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(SftpDirListing {
        path: normalized,
        entries,
    })
}

#[tauri::command]
pub(crate) async fn sftp_read_file(
    connections: tauri::State<'_, SftpConnections>,
    connection_id: String,
    path: String,
) -> Result<SftpFileContents, String> {
    let normalized = normalize_remote_path(&path)?;
    let guard = connections.0.lock().await;
    let sftp = guard
        .get(&connection_id)
        .ok_or_else(|| "SFTP connection not found".to_string())?;
    let bytes = sftp
        .read(&normalized)
        .await
        .map_err(|err| err.to_string())?;
    if bytes.len() > MAX_SFTP_TEXT_FILE_BYTES {
        return Err(format!(
            "file is too large to preview ({} bytes, limit {MAX_SFTP_TEXT_FILE_BYTES})",
            bytes.len()
        ));
    }
    let content =
        String::from_utf8(bytes).map_err(|_| "file is not valid UTF-8 text".to_string())?;
    Ok(SftpFileContents {
        path: normalized,
        content,
    })
}

#[tauri::command]
pub(crate) async fn sftp_disconnect(
    connections: tauri::State<'_, SftpConnections>,
    connection_id: String,
) -> Result<(), String> {
    let mut guard = connections.0.lock().await;
    if let Some(sftp) = guard.remove(&connection_id) {
        let _ = sftp.close().await;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn sftp_list_known_hosts(app: AppHandle) -> Result<Vec<KnownHostEntry>, String> {
    Ok(load_known_hosts(&app)?.0)
}

#[tauri::command]
pub(crate) fn sftp_revoke_known_host(
    app: AppHandle,
    host: String,
    port: u16,
) -> Result<(), String> {
    let mut store = load_known_hosts(&app)?;
    revoke_host_key(&mut store, &host, port);
    save_known_hosts(&app, &store)
}
