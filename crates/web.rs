mod docker_stats;
mod download;
mod execute;
mod pack;
mod shell;

use crate::crates::core::logging::log_info;
use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use redis::AsyncCommands;
use serde::Deserialize;
use std::error::Error;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, broadcast};

/// Shared state across all WS connections.
pub(crate) struct AppState {
    /// Docker stats broadcast — poller sends, every WS client subscribes.
    stats_tx: broadcast::Sender<String>,
    /// Registry of completed job IDs → output directories for download routes.
    job_dirs: Arc<DashMap<String, PathBuf>>,
    /// Redis connection manager for OAuth token validation (None = gate disabled).
    oauth_redis: Option<redis::aio::ConnectionManager>,
    /// Redis key prefix for OAuth tokens (e.g. `axon:mcp:oauth`).
    oauth_prefix: String,
}

// ── OAuth bearer-token gate ───────────────────────────────────────────────────

/// Minimal shape of the access-token record stored by the MCP OAuth server.
/// We only need `expires_at_unix`; other fields are intentionally ignored.
#[derive(Deserialize)]
struct BearerTokenRecord {
    expires_at_unix: u64,
}

fn unix_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        // L-02: return u64::MAX on clock error so all tokens appear expired (fail-closed)
        .unwrap_or(u64::MAX)
}

async fn validate_bearer_token(
    conn_mgr: &redis::aio::ConnectionManager,
    prefix: &str,
    token: &str,
) -> bool {
    // H-06: reject tokens that don't match the atk_ prefix before hitting Redis
    if !token.starts_with("atk_") {
        return false;
    }
    let key = format!("{prefix}:access_token:{token}");
    let mut conn = conn_mgr.clone();
    let raw: Option<String> = match conn.get(&key).await {
        Ok(v) => v,
        Err(e) => {
            log::warn!("ws oauth: redis GET failed for token validation: {e}");
            return false;
        }
    };
    let Some(json) = raw else { return false };
    let Ok(rec) = serde_json::from_str::<BearerTokenRecord>(&json) else {
        return false;
    };
    unix_now_secs() <= rec.expires_at_unix
}

/// Query parameters for the `/ws` upgrade request.
#[derive(Deserialize)]
struct WsQuery {
    token: Option<String>,
}

// ── Server startup ────────────────────────────────────────────────────────────

/// Start the axum server on the given port, running until interrupted.
pub async fn start_server(port: u16) -> Result<(), Box<dyn Error>> {
    let (stats_tx, _) = broadcast::channel::<String>(64);
    let job_dirs: Arc<DashMap<String, PathBuf>> = Arc::new(DashMap::new());

    // Initialise Redis connection for OAuth gate (optional — gate disabled if absent)
    let redis_url = std::env::var("GOOGLE_OAUTH_REDIS_URL")
        .or_else(|_| std::env::var("AXON_REDIS_URL"))
        .ok();
    let oauth_prefix =
        std::env::var("GOOGLE_OAUTH_REDIS_PREFIX").unwrap_or_else(|_| "axon:mcp:oauth".to_string());

    let oauth_redis = if let Some(url) = redis_url {
        match redis::Client::open(url) {
            Ok(client) => match redis::aio::ConnectionManager::new(client).await {
                Ok(mgr) => {
                    log_info(&format!("WS OAuth gate: active (prefix={})", oauth_prefix));
                    Some(mgr)
                }
                Err(e) => {
                    log::warn!("WS OAuth gate: Redis connection failed ({e}); gate disabled");
                    None
                }
            },
            Err(e) => {
                log::warn!("WS OAuth gate: invalid Redis URL ({e}); gate disabled");
                None
            }
        }
    } else {
        log_info("WS OAuth gate: disabled (no Redis URL configured)");
        None
    };

    let state = Arc::new(AppState {
        stats_tx: stats_tx.clone(),
        job_dirs: job_dirs.clone(),
        oauth_redis,
        oauth_prefix,
    });

    // Spawn Docker stats poller in background
    tokio::spawn(docker_stats::run_stats_loop(stats_tx));

    // Download routes use a separate state (just the DashMap) to avoid
    // coupling the download handlers to the full AppState.
    let download_routes = Router::new()
        .route("/download/{job_id}/pack.md", get(download::serve_pack_md))
        .route("/download/{job_id}/pack.xml", get(download::serve_pack_xml))
        .route("/download/{job_id}/archive.zip", get(download::serve_zip))
        .route("/download/{job_id}/file/{*path}", get(download::serve_file))
        .with_state(job_dirs);

    let app = Router::new()
        .route("/ws", get(ws_upgrade))
        .route("/ws/shell", get(shell_ws_upgrade))
        .route("/output/{*path}", get(serve_output_file))
        .with_state(state)
        .merge(download_routes);

    let host = std::env::var("AXON_SERVE_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], port)));

    log_info(&format!("Axon web UI listening on http://{addr}"));

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to listen for ctrl+c");
}

// ── Output file serving ───────────────────────────────────────────────────────

/// `GET /output/{*path}` — serve files from the CLI output directory.
///
/// Used to display screenshots and other generated assets in the browser.
/// Path traversal is prevented via canonicalization + prefix check.
async fn serve_output_file(
    axum::extract::Path(file_path): axum::extract::Path<String>,
) -> Response {
    use axum::http::{HeaderMap, StatusCode, header};

    // Reject obvious traversal
    if file_path.contains("..") || file_path.contains('\0') {
        return (StatusCode::BAD_REQUEST, "invalid path").into_response();
    }

    let base = execute::files::output_dir();
    let full_path = base.join(&file_path);

    // Canonicalize both and verify containment
    let Ok(canonical_base) = tokio::fs::canonicalize(&base).await else {
        return (StatusCode::NOT_FOUND, "output directory not found").into_response();
    };
    let Ok(canonical_file) = tokio::fs::canonicalize(&full_path).await else {
        return (StatusCode::NOT_FOUND, "file not found").into_response();
    };

    if !canonical_file.starts_with(&canonical_base) {
        return (StatusCode::FORBIDDEN, "path outside output directory").into_response();
    }

    let bytes = match tokio::fs::read(&canonical_file).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::NOT_FOUND, "file not found").into_response(),
    };

    // Sniff content type from extension
    let content_type = match canonical_file.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("md") => "text/markdown; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        _ => "application/octet-stream",
    };

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, content_type.parse().unwrap());
    // Allow browser caching for 5 minutes (screenshots are immutable once written)
    headers.insert(
        header::CACHE_CONTROL,
        "public, max-age=300".parse().unwrap(),
    );

    (headers, bytes).into_response()
}

// ── WebSocket handler ────────────────────────────────────────────────────────

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    Query(params): Query<WsQuery>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if let Some(ref conn_mgr) = state.oauth_redis {
        match params.token.as_deref().filter(|t| !t.is_empty()) {
            None => {
                log::warn!("ws upgrade rejected: no bearer token from {}", addr.ip());
                return (
                    axum::http::StatusCode::UNAUTHORIZED,
                    "bearer token required",
                )
                    .into_response();
            }
            Some(token) => {
                if !validate_bearer_token(conn_mgr, &state.oauth_prefix, token).await {
                    log::warn!(
                        "ws upgrade rejected: invalid or expired token from {}",
                        addr.ip()
                    );
                    return (
                        axum::http::StatusCode::UNAUTHORIZED,
                        "invalid or expired bearer token",
                    )
                        .into_response();
                }
            }
        }
    }
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn shell_ws_upgrade(
    ws: WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    // H-07: also accept IPv4-mapped loopback (::ffff:127.0.0.1) which Rust's
    // IpAddr::is_loopback() returns false for on some platforms.
    let is_loopback = match addr.ip() {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => {
            v6.is_loopback() || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
        }
    };
    if !is_loopback {
        return (
            axum::http::StatusCode::FORBIDDEN,
            "Shell access is restricted to localhost",
        )
            .into_response();
    }
    ws.on_upgrade(shell::handle_shell_ws)
}

/// Incoming WS message from the browser.
#[derive(Deserialize)]
struct WsClientMsg {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(default)]
    mode: String,
    #[serde(default)]
    input: String,
    #[serde(default)]
    flags: serde_json::Value,
    #[serde(default)]
    id: String,
    #[serde(default)]
    path: String,
}

async fn handle_ws(socket: WebSocket, state: Arc<AppState>) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Channel for the execute task to send messages back through the WS
    let (exec_tx, mut exec_rx) = tokio::sync::mpsc::channel::<String>(256);

    // Per-connection state: last crawl output dir for read_file resolution
    let crawl_base_dir: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));

    // Per-connection state: current async job ID for cancel support
    let crawl_job_id: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    // Shared job_dirs registry for registering completed jobs
    let job_dirs = state.job_dirs.clone();

    // Subscribe to Docker stats broadcast
    let mut stats_rx = state.stats_tx.subscribe();

    // Track crawl_files messages to capture the output_dir for read_file
    let base_dir_tracker = crawl_base_dir.clone();
    let job_dirs_tracker = job_dirs.clone();
    let (tracking_tx, mut tracking_rx) = tokio::sync::mpsc::channel::<String>(256);

    // Forward task: sends exec output + stats to the WS client,
    // and tracks crawl_files messages to capture base_dir + register job_dirs
    let forward = tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(msg) = exec_rx.recv() => {
                    // Sniff crawl_files messages to extract output_dir and job_id
                    if msg.contains("\"crawl_files\"") {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&msg) {
                            if let Some(dir) = parsed.get("output_dir").and_then(|v| v.as_str()) {
                                *base_dir_tracker.lock().await = Some(PathBuf::from(dir));
                            }
                            // Register in job_dirs for download routes
                            if let (Some(job_id), Some(dir)) = (
                                parsed.get("job_id").and_then(|v| v.as_str()),
                                parsed.get("output_dir").and_then(|v| v.as_str()),
                            ) {
                                job_dirs_tracker.insert(job_id.to_string(), PathBuf::from(dir));
                            }
                        }
                    }
                    if ws_tx.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                Some(msg) = tracking_rx.recv() => {
                    if ws_tx.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                Ok(stats_msg) = stats_rx.recv() => {
                    if ws_tx.send(Message::Text(stats_msg.into())).await.is_err() {
                        break;
                    }
                }
                else => break,
            }
        }
    });

    // Read loop: receives commands from the browser
    while let Some(Ok(msg)) = ws_rx.next().await {
        if let Message::Text(text) = msg {
            let Ok(client_msg) = serde_json::from_str::<WsClientMsg>(&text) else {
                let _ = exec_tx
                    .send(r#"{"type":"error","message":"invalid JSON"}"#.to_string())
                    .await;
                continue;
            };

            match client_msg.msg_type.as_str() {
                "execute" => {
                    let tx = exec_tx.clone();
                    let job_id = crawl_job_id.clone();
                    tokio::spawn(async move {
                        execute::handle_command(
                            &client_msg.mode,
                            &client_msg.input,
                            &client_msg.flags,
                            tx,
                            job_id,
                        )
                        .await;
                    });
                }
                "cancel" => {
                    let tx = exec_tx.clone();
                    let job_id_arc = crawl_job_id.clone();
                    let cancel_mode = client_msg.mode.clone();
                    tokio::spawn(async move {
                        // Use stored async job ID if available, fall back to client-provided ID
                        let stored = job_id_arc.lock().await.clone();
                        let id = stored.or_else(|| {
                            if client_msg.id.is_empty() {
                                None
                            } else {
                                Some(client_msg.id.clone())
                            }
                        });
                        if let Some(id) = id {
                            execute::handle_cancel(&cancel_mode, &id, tx).await;
                        }
                    });
                }
                "read_file" => {
                    if !client_msg.path.is_empty() {
                        let tx = tracking_tx.clone();
                        let path = client_msg.path.clone();
                        let base = crawl_base_dir.clone();
                        tokio::spawn(async move {
                            let guard = base.lock().await;
                            if let Some(base_dir) = guard.as_ref() {
                                execute::handle_read_file(&path, base_dir, tx).await;
                            } else {
                                let _ = tx
                                    .send(
                                        r#"{"type":"error","message":"no crawl output available"}"#
                                            .to_string(),
                                    )
                                    .await;
                            }
                        });
                    }
                }
                _ => {}
            }
        }
    }

    forward.abort();
}
