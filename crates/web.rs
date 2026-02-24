mod docker_stats;
mod execute;

use crate::crates::core::logging::log_info;
use axum::Router;
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::error::Error;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::broadcast;

// Release: static assets compiled into the binary
#[cfg(not(debug_assertions))]
const INDEX_HTML: &str = include_str!("web/static/index.html");
#[cfg(not(debug_assertions))]
const STYLE_CSS: &str = include_str!("web/static/style.css");
#[cfg(not(debug_assertions))]
const NEURAL_JS: &str = include_str!("web/static/neural.js");
#[cfg(not(debug_assertions))]
const APP_JS: &str = include_str!("web/static/app.js");

/// In debug builds, resolve the static assets directory relative to the source.
#[cfg(debug_assertions)]
fn static_dir() -> std::path::PathBuf {
    // Cargo sets CARGO_MANIFEST_DIR at compile time
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("crates")
        .join("web")
        .join("static")
}

/// Read a static file from disk (debug) or panic with a clear message.
#[cfg(debug_assertions)]
fn read_static(name: &str) -> String {
    let path = static_dir().join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| format!("<!-- ERROR: could not read {}: {} -->", path.display(), e))
}

/// Shared state across all WS connections.
pub(crate) struct AppState {
    /// Docker stats broadcast — poller sends, every WS client subscribes.
    stats_tx: broadcast::Sender<String>,
}

/// Start the axum server on the given port, running until interrupted.
pub async fn start_server(port: u16) -> Result<(), Box<dyn Error>> {
    let (stats_tx, _) = broadcast::channel::<String>(64);

    let state = Arc::new(AppState {
        stats_tx: stats_tx.clone(),
    });

    // Spawn Docker stats poller in background
    tokio::spawn(docker_stats::run_stats_loop(stats_tx));

    let app = Router::new()
        .route("/", get(serve_index))
        .route("/style.css", get(serve_css))
        .route("/neural.js", get(serve_neural_js))
        .route("/app.js", get(serve_app_js))
        .route("/ws", get(ws_upgrade))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    #[cfg(debug_assertions)]
    log_info(&format!(
        "Axon web UI listening on http://0.0.0.0:{port} (dev mode — hot reload from {})",
        static_dir().display()
    ));
    #[cfg(not(debug_assertions))]
    log_info(&format!("Axon web UI listening on http://0.0.0.0:{port}"));

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to listen for ctrl+c");
}

// ── Static asset handlers ────────────────────────────────────────────────────
// Debug: read from disk on every request (hot reload).
// Release: serve compiled-in strings.

#[cfg(not(debug_assertions))]
async fn serve_index() -> Html<&'static str> {
    Html(INDEX_HTML)
}
#[cfg(debug_assertions)]
async fn serve_index() -> Html<String> {
    Html(read_static("index.html"))
}

#[cfg(not(debug_assertions))]
async fn serve_css() -> impl IntoResponse {
    ([("content-type", "text/css; charset=utf-8")], STYLE_CSS)
}
#[cfg(debug_assertions)]
async fn serve_css() -> impl IntoResponse {
    (
        [("content-type", "text/css; charset=utf-8")],
        read_static("style.css"),
    )
}

#[cfg(not(debug_assertions))]
async fn serve_neural_js() -> impl IntoResponse {
    (
        [("content-type", "application/javascript; charset=utf-8")],
        NEURAL_JS,
    )
}
#[cfg(debug_assertions)]
async fn serve_neural_js() -> impl IntoResponse {
    (
        [("content-type", "application/javascript; charset=utf-8")],
        read_static("neural.js"),
    )
}

#[cfg(not(debug_assertions))]
async fn serve_app_js() -> impl IntoResponse {
    (
        [("content-type", "application/javascript; charset=utf-8")],
        APP_JS,
    )
}
#[cfg(debug_assertions)]
async fn serve_app_js() -> impl IntoResponse {
    (
        [("content-type", "application/javascript; charset=utf-8")],
        read_static("app.js"),
    )
}

// ── WebSocket handler ────────────────────────────────────────────────────────

async fn ws_upgrade(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> Response {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
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
}

async fn handle_ws(socket: WebSocket, state: Arc<AppState>) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Channel for the execute task to send messages back through the WS
    let (exec_tx, mut exec_rx) = tokio::sync::mpsc::channel::<String>(256);

    // Subscribe to Docker stats broadcast
    let mut stats_rx = state.stats_tx.subscribe();

    // Forward task: sends exec output + stats to the WS client
    let forward = tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(msg) = exec_rx.recv() => {
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
                    tokio::spawn(async move {
                        execute::handle_command(
                            &client_msg.mode,
                            &client_msg.input,
                            &client_msg.flags,
                            tx,
                        )
                        .await;
                    });
                }
                "cancel" => {
                    if !client_msg.id.is_empty() {
                        let tx = exec_tx.clone();
                        let id = client_msg.id.clone();
                        tokio::spawn(async move {
                            execute::handle_cancel(&id, tx).await;
                        });
                    }
                }
                _ => {}
            }
        }
    }

    forward.abort();
}
