mod docker_stats;
mod download;
pub mod execute;
mod pack;
mod shell;
pub mod tailscale_auth;

use crate::crates::core::config::Config;
use crate::crates::core::logging::log_info;
use crate::crates::services::acp::{AcpConnectionHandle, PermissionResponderMap};
use axum::Router;
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Query, State};
use axum::http::{HeaderMap, HeaderValue, Method, Request, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::error::Error;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use tailscale_auth::{AuthOutcome, DenyReason, auth_log_message, check_auth};
use tokio::sync::{Mutex, broadcast};

/// Global semaphore limiting concurrent ACP sessions (pulse_chat + pulse_chat_probe).
/// Prevents unbounded `spawn_blocking` thread consumption — each ACP session holds a
/// thread for up to 300 seconds.  Read from `AXON_ACP_MAX_CONCURRENT_SESSIONS` env var;
/// default 5.  (SEC-8 / PERF-1 / PERF-10)
pub(crate) static ACP_SESSION_SEMAPHORE: std::sync::LazyLock<tokio::sync::Semaphore> =
    std::sync::LazyLock::new(|| {
        let max = std::env::var("AXON_ACP_MAX_CONCURRENT_SESSIONS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(8); // matches the default in crates/web/execute/sync_mode.rs
        tokio::sync::Semaphore::new(max)
    });

/// Shared state across all WS connections.
pub(crate) struct AppState {
    /// Docker stats broadcast — poller sends, every WS client subscribes.
    stats_tx: broadcast::Sender<String>,
    /// Registry of completed job IDs → output directories for download routes.
    job_dirs: Arc<DashMap<String, PathBuf>>,
    /// Static API token for the WS gate. Set from AXON_WEB_API_TOKEN.
    /// Same token used by the Next.js proxy for /api/* routes.
    /// None = gate disabled (open WS, trusted-network deployments only).
    api_token: Option<String>,
    /// Base server config — shared across all connections.
    pub(crate) cfg: Arc<Config>,
}

/// State for download routes — lighter than AppState (no WS/stats fields).
pub(crate) struct DownloadAuthState {
    pub job_dirs: Arc<DashMap<String, PathBuf>>,
    pub api_token: Option<String>,
}

/// Query parameters for the `/ws` upgrade request.
#[derive(Deserialize)]
struct WsQuery {
    token: Option<String>,
}

const DEFAULT_CORS_ALLOW_HEADERS: &str = "authorization, content-type, x-api-key";
const DEFAULT_CORS_ALLOW_METHODS: &str = "GET, POST, OPTIONS";
const CORS_VARY_VALUE: &str =
    "Origin, Access-Control-Request-Method, Access-Control-Request-Headers";

// ── Server startup ────────────────────────────────────────────────────────────

/// Start the axum server on the given port, running until interrupted.
pub async fn start_server(port: u16, cfg: Arc<Config>) -> Result<(), Box<dyn Error>> {
    let (stats_tx, _) = broadcast::channel::<String>(64);
    let job_dirs: Arc<DashMap<String, PathBuf>> = Arc::new(DashMap::new());

    let api_token = std::env::var("AXON_WEB_API_TOKEN")
        .ok()
        .filter(|t| !t.is_empty());

    match &api_token {
        Some(_) => log_info("WS gate: api token"),
        None => log_info("WS gate: open in debug/test builds; set AXON_WEB_API_TOKEN for auth"),
    }

    let state = Arc::new(AppState {
        stats_tx: stats_tx.clone(),
        job_dirs: job_dirs.clone(),
        api_token: api_token.clone(),
        cfg: cfg.clone(),
    });

    // Spawn Docker stats poller in background
    tokio::spawn(docker_stats::run_stats_loop(stats_tx));

    let download_state = Arc::new(DownloadAuthState {
        job_dirs: job_dirs.clone(),
        api_token,
    });

    let download_routes = Router::new()
        .route("/download/{job_id}/pack.md", get(download::serve_pack_md))
        .route("/download/{job_id}/pack.xml", get(download::serve_pack_xml))
        .route("/download/{job_id}/archive.zip", get(download::serve_zip))
        .route("/download/{job_id}/file/{*path}", get(download::serve_file))
        .with_state(download_state);

    let app = Router::new()
        .route("/ws", get(ws_upgrade))
        .route("/ws/shell", get(shell_ws_upgrade))
        .route("/output/{*path}", get(serve_output_file))
        .with_state(state)
        .merge(download_routes)
        .layer(middleware::from_fn_with_state(
            cfg.clone(),
            web_cors_middleware,
        ));

    let host = std::env::var("AXON_SERVE_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    log_info(&format!(
        "Axon web UI starting with AXON_SERVE_HOST={} port={}",
        host, port
    ));
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

// ── Auth helper ───────────────────────────────────────────────────────────────

/// Perform token auth for HTTP handlers.
fn http_auth(
    req_headers: &HeaderMap,
    query_token: Option<&str>,
    api_token: Option<&str>,
) -> AuthOutcome {
    check_auth(req_headers, query_token, api_token)
}

// ── Output file serving ───────────────────────────────────────────────────────

/// `GET /output/{*path}` — serve files from the CLI output directory.
///
/// Protected by the same auth stack as `/ws`. Path traversal is prevented
/// via canonicalization + prefix check.
async fn serve_output_file(
    axum::extract::Path(file_path): axum::extract::Path<String>,
    req_headers: HeaderMap,
    Query(params): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    use axum::http::{StatusCode, header};

    let auth = http_auth(
        &req_headers,
        params.token.as_deref(),
        state.api_token.as_deref(),
    );
    if matches!(auth, AuthOutcome::Denied(_)) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }

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

    let mut resp_headers = HeaderMap::new();
    resp_headers.insert(header::CONTENT_TYPE, content_type.parse().unwrap());
    // Allow browser caching for 5 minutes (screenshots are immutable once written)
    resp_headers.insert(
        header::CACHE_CONTROL,
        "public, max-age=300".parse().unwrap(),
    );

    (resp_headers, bytes).into_response()
}

// ── WebSocket handler ────────────────────────────────────────────────────────

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    Query(params): Query<WsQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<Arc<AppState>>,
) -> Response {
    if !websocket_origin_is_allowed(&headers, &state.cfg.web_allowed_origins) {
        return (StatusCode::FORBIDDEN, "forbidden: origin not allowed").into_response();
    }

    let outcome = http_auth(
        &headers,
        params.token.as_deref(),
        state.api_token.as_deref(),
    );

    let log_msg = auth_log_message(&outcome, addr);
    match &outcome {
        AuthOutcome::Token => log::info!("{log_msg}"),
        AuthOutcome::Denied(_) => log::warn!("{log_msg}"),
    }

    if matches!(outcome, AuthOutcome::Denied(_)) {
        let body = match outcome {
            AuthOutcome::Denied(DenyReason::NoAuthConfigured) => {
                "unauthorized: configure AXON_WEB_API_TOKEN"
            }
            _ => "unauthorized",
        };
        return (StatusCode::UNAUTHORIZED, body).into_response();
    }

    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn shell_ws_upgrade(
    ws: WebSocketUpgrade,
    Query(params): Query<WsQuery>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<Arc<AppState>>,
) -> Response {
    let allowed_origins = effective_shell_allowed_origins(
        &state.cfg.shell_allowed_origins,
        &state.cfg.web_allowed_origins,
    );
    if !websocket_origin_is_allowed(&headers, allowed_origins) {
        return (StatusCode::FORBIDDEN, "forbidden: shell origin not allowed").into_response();
    }

    // H-07: also accept IPv4-mapped loopback (::ffff:127.0.0.1) which Rust's
    // IpAddr::is_loopback() returns false for on some platforms.
    let is_loopback = match addr.ip() {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => {
            v6.is_loopback() || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
        }
    };

    // Loopback (localhost) connections are always allowed — they originate from the
    // local machine (Next.js dev server, local reverse proxy, etc.).
    if !is_loopback {
        // Non-loopback: apply the same auth check as the main /ws endpoint.
        let outcome = http_auth(
            &headers,
            params.token.as_deref(),
            state.api_token.as_deref(),
        );
        let log_msg = auth_log_message(&outcome, addr);
        match &outcome {
            AuthOutcome::Token => log::info!("shell ws: {log_msg}"),
            AuthOutcome::Denied(_) => log::warn!("shell ws: {log_msg}"),
        }
        if matches!(outcome, AuthOutcome::Denied(_)) {
            return (
                StatusCode::FORBIDDEN,
                "shell access denied — set AXON_WEB_API_TOKEN",
            )
                .into_response();
        }
    }

    ws.on_upgrade(shell::handle_shell_ws)
}

pub(crate) async fn web_cors_middleware(
    State(cfg): State<Arc<Config>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    cors_middleware(request, next, &cfg.web_allowed_origins).await
}

pub(crate) async fn cors_middleware(
    request: Request<Body>,
    next: Next,
    allowed_origins: &[String],
) -> Response {
    let origin = request.headers().get(header::ORIGIN).cloned();
    let host = request.headers().get(header::HOST).cloned();
    let allow_origin = origin
        .as_ref()
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            cors_origin_header_value(
                value,
                host.as_ref().and_then(|header| header.to_str().ok()),
                allowed_origins,
            )
        });

    if request.method() == Method::OPTIONS && origin.is_some() {
        return match allow_origin {
            Some(allow_origin) => preflight_cors_response(&request, allow_origin),
            None => (StatusCode::FORBIDDEN, "forbidden: origin not allowed").into_response(),
        };
    }

    if origin.is_some() && allow_origin.is_none() {
        return (StatusCode::FORBIDDEN, "forbidden: origin not allowed").into_response();
    }

    let mut response = next.run(request).await;
    if let Some(allow_origin) = allow_origin {
        set_cors_response_headers(response.headers_mut(), allow_origin);
    }
    response
}

fn preflight_cors_response(request: &Request<Body>, allow_origin: HeaderValue) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NO_CONTENT;
    set_cors_response_headers(response.headers_mut(), allow_origin);

    let requested_headers = request
        .headers()
        .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static(DEFAULT_CORS_ALLOW_HEADERS));
    response
        .headers_mut()
        .insert(header::ACCESS_CONTROL_ALLOW_HEADERS, requested_headers);
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static(DEFAULT_CORS_ALLOW_METHODS),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );
    response
}

fn set_cors_response_headers(headers: &mut HeaderMap, allow_origin: HeaderValue) {
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, allow_origin);
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
    headers.insert(header::VARY, HeaderValue::from_static(CORS_VARY_VALUE));
}

pub(crate) fn effective_shell_allowed_origins<'a>(
    shell_allowed_origins: &'a [String],
    web_allowed_origins: &'a [String],
) -> &'a [String] {
    if shell_allowed_origins.is_empty() {
        web_allowed_origins
    } else {
        shell_allowed_origins
    }
}

fn websocket_origin_is_allowed(headers: &HeaderMap, allowed_origins: &[String]) -> bool {
    let Some(origin) = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    else {
        return true;
    };
    cors_origin_header_value(
        origin,
        headers
            .get(header::HOST)
            .and_then(|value| value.to_str().ok()),
        allowed_origins,
    )
    .is_some()
}

pub(crate) fn cors_origin_header_value(
    origin: &str,
    request_host: Option<&str>,
    allowed_origins: &[String],
) -> Option<HeaderValue> {
    let is_allowed = if allowed_origins.is_empty() {
        origin_matches_host(origin, request_host?)
    } else {
        allowed_origins.iter().any(|allowed| allowed == origin)
    };

    is_allowed
        .then(|| HeaderValue::from_str(origin).ok())
        .flatten()
}

fn origin_matches_host(origin: &str, request_host: &str) -> bool {
    parse_origin_authority(origin)
        .map(|origin_host| origin_host.eq_ignore_ascii_case(request_host.trim()))
        .unwrap_or(false)
}

fn parse_origin_authority(origin: &str) -> Option<String> {
    origin
        .parse::<Uri>()
        .ok()
        .and_then(|uri| uri.authority().map(|authority| authority.to_string()))
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
    /// Permission response: the tool_call_id being responded to.
    #[serde(default)]
    tool_call_id: String,
    /// Permission response: the chosen option_id.
    #[serde(default)]
    option_id: String,
    /// Session ID context for permission_response validation (SEC-7).
    /// Optional/backward-compatible — clients that omit it get an empty string.
    #[serde(default)]
    session_id: String,
}

/// Per-connection state shared across the read loop and spawned tasks.
#[expect(
    clippy::type_complexity,
    reason = "type alias lives in sync_mode, not accessible here"
)]
struct WsConnState {
    exec_tx: tokio::sync::mpsc::Sender<String>,
    tracking_tx: tokio::sync::mpsc::Sender<String>,
    crawl_job_id: Arc<Mutex<Option<String>>>,
    crawl_base_dir: Arc<Mutex<Option<PathBuf>>>,
    permission_responders: PermissionResponderMap,
    conn_cfg: Arc<Config>,
    /// Persistent ACP adapter for Pulse chat — created on first pulse_chat message,
    /// reused for all subsequent turns. Tuple stores the agent key so a different
    /// agent triggers a fresh adapter spawn. Dropping kills the old process.
    acp_connection: Arc<Mutex<Option<(String, Arc<AcpConnectionHandle>)>>>,
}

/// Create a fresh `PermissionResponderMap` for a new WS connection.
///
/// Key type is currently `String` (tool_call_id only).
/// TODO(SEC-7): Change to `(session_id, tool_call_id)` composite key to prevent
/// cross-session collisions. Requires updating `crates/services/acp.rs` type
/// alias AND `crates/services/acp/bridge.rs` insert site to use the same tuple.
fn init_permission_responders() -> PermissionResponderMap {
    Arc::new(DashMap::new())
}

async fn handle_ws(socket: WebSocket, state: Arc<AppState>) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    let (exec_tx, mut exec_rx) = tokio::sync::mpsc::channel::<String>(256);
    let (tracking_tx, mut tracking_rx) = tokio::sync::mpsc::channel::<String>(256);

    let crawl_base_dir: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
    let crawl_job_id: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let permission_responders = init_permission_responders();

    let job_dirs = state.job_dirs.clone();
    let mut stats_rx = state.stats_tx.subscribe();

    // Forward task: sends exec output + stats to the WS client,
    // and tracks crawl_files messages to capture base_dir + register job_dirs
    let base_dir_tracker = crawl_base_dir.clone();
    let job_dirs_tracker = job_dirs.clone();
    let forward = tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(msg) = exec_rx.recv() => {
                    if msg.contains("\"crawl_files\"")
                        && let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&msg) {
                            if let Some(dir) = parsed.get("output_dir").and_then(|v| v.as_str()) {
                                *base_dir_tracker.lock().await = Some(PathBuf::from(dir));
                            }
                            if let (Some(job_id), Some(dir)) = (
                                parsed.get("job_id").and_then(|v| v.as_str()),
                                parsed.get("output_dir").and_then(|v| v.as_str()),
                            ) {
                                job_dirs_tracker.insert(job_id.to_string(), PathBuf::from(dir));
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

    let conn = WsConnState {
        exec_tx,
        tracking_tx,
        crawl_job_id,
        crawl_base_dir,
        permission_responders,
        conn_cfg: state.cfg.clone(),
        acp_connection: Arc::new(Mutex::new(None)),
    };

    // Read loop: receives commands from the browser
    while let Some(Ok(msg)) = ws_rx.next().await {
        if let Message::Text(text) = msg {
            let Ok(client_msg) = serde_json::from_str::<WsClientMsg>(&text) else {
                let _ = conn
                    .exec_tx
                    .send(r#"{"type":"error","message":"invalid JSON"}"#.to_string())
                    .await;
                continue;
            };
            handle_ws_message(&conn, client_msg).await;
        }
    }

    forward.abort();
}

/// Dispatch a single parsed WS client message to the appropriate handler.
async fn handle_ws_message(conn: &WsConnState, client_msg: WsClientMsg) {
    match client_msg.msg_type.as_str() {
        "execute" => {
            let tx = conn.exec_tx.clone();
            let job_id = conn.crawl_job_id.clone();
            let cmd_cfg = conn.conn_cfg.clone();
            let perm_map = conn.permission_responders.clone();
            let acp_conn = conn.acp_connection.clone();
            // Move owned Strings into the spawned future.  handle_command
            // takes owned String/Value so no &str borrow escapes the spawn
            // boundary, satisfying the `Send + 'static` bound for tokio::spawn.
            let exec_mode = client_msg.mode;
            let exec_input = client_msg.input;
            let exec_flags = client_msg.flags;
            tokio::spawn(async move {
                execute::handle_command(
                    exec_mode, exec_input, exec_flags, tx, job_id, cmd_cfg, perm_map, acp_conn,
                )
                .await;
            });
        }
        "cancel" => {
            let tx = conn.exec_tx.clone();
            let job_id_arc = conn.crawl_job_id.clone();
            let cancel_mode = client_msg.mode;
            let cancel_cfg = conn.conn_cfg.clone();
            tokio::spawn(async move {
                let stored = job_id_arc.lock().await.clone();
                let id = stored.or(if client_msg.id.is_empty() {
                    None
                } else {
                    Some(client_msg.id)
                });
                if let Some(id) = id {
                    execute::handle_cancel(&cancel_mode, &id, tx, cancel_cfg).await;
                }
            });
        }
        "permission_response" => {
            route_permission_response(
                &conn.permission_responders,
                client_msg.tool_call_id,
                client_msg.option_id,
                client_msg.session_id,
            );
        }
        "read_file" => {
            if !client_msg.path.is_empty() {
                let tx = conn.tracking_tx.clone();
                let path = client_msg.path;
                let base = conn.crawl_base_dir.clone();
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

/// Route a `permission_response` message to the waiting ACP session.
///
/// Looks up `(session_id, tool_call_id)` in `permission_responders` and sends
/// `option_id`. The compound key prevents cross-session routing (SEC-7):
/// two concurrent sessions cannot receive each other's responses even if their
/// `tool_call_id` values collide.
fn route_permission_response(
    permission_responders: &PermissionResponderMap,
    tool_call_id: String,
    option_id: String,
    session_id: String,
) {
    if tool_call_id.is_empty() || option_id.is_empty() {
        log::warn!("permission_response with empty tool_call_id or option_id — ignoring");
        return;
    }
    log::debug!("permission_response: session_id={session_id} tool_call_id={tool_call_id}");
    // DashMap: remove returns Option<(K, V)> — no separate lock needed.
    if let Some((_, sender)) =
        permission_responders.remove(&(session_id.clone(), tool_call_id.clone()))
    {
        let _ = sender.send(option_id);
    } else {
        log::warn!(
            "permission_response for unknown key: session_id={session_id} \
             tool_call_id={tool_call_id} (already responded or wrong session)"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{cors_origin_header_value, effective_shell_allowed_origins};

    #[test]
    fn cors_allows_explicit_origin() {
        let allowed = vec!["https://axon.example.com".to_string()];
        let value = cors_origin_header_value(
            "https://axon.example.com",
            Some("127.0.0.1:49000"),
            &allowed,
        );

        assert_eq!(
            value.as_ref().and_then(|header| header.to_str().ok()),
            Some("https://axon.example.com")
        );
    }

    #[test]
    fn cors_allows_same_host_when_allowlist_is_empty() {
        let value =
            cors_origin_header_value("http://localhost:49000", Some("localhost:49000"), &[]);

        assert_eq!(
            value.as_ref().and_then(|header| header.to_str().ok()),
            Some("http://localhost:49000")
        );
    }

    #[test]
    fn cors_rejects_cross_origin_when_allowlist_is_empty() {
        let value =
            cors_origin_header_value("https://axon.example.com", Some("localhost:49000"), &[]);

        assert!(value.is_none());
    }

    #[test]
    fn shell_origin_allowlist_falls_back_to_web_allowlist() {
        let web_allowed = vec!["https://axon.example.com".to_string()];
        let shell_allowed: Vec<String> = Vec::new();

        assert_eq!(
            effective_shell_allowed_origins(&shell_allowed, &web_allowed),
            web_allowed.as_slice()
        );
    }
}
