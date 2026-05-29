use super::*;
use crate::core::http::{build_client, get_allow_loopback, set_allow_loopback};
use httpmock::prelude::*;
use serial_test::serial;

struct LoopbackGuard {
    previous: bool,
}

impl LoopbackGuard {
    fn allow() -> Self {
        let previous = get_allow_loopback();
        set_allow_loopback(true);
        Self { previous }
    }
}

impl Drop for LoopbackGuard {
    fn drop(&mut self) {
        set_allow_loopback(self.previous);
    }
}

fn probe_client() -> reqwest::Client {
    build_client(PROBE_TIMEOUT_SECS, Some(axon_ua())).expect("probe client")
}

#[tokio::test]
#[serial]
async fn detects_mcp_and_replays_session_id() {
    let _loopback = LoopbackGuard::allow();
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(POST).path("/mcp").body_includes("initialize");
            then.status(200)
                .header("content-type", "application/json")
                .header("mcp-session-id", "sess-123")
                .json_body(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "serverInfo": { "name": "demo-mcp", "version": "0.9" },
                        "capabilities": {}
                    }
                }));
        })
        .await;
    // tools/list only matches when the session id assigned by initialize is replayed.
    server
        .mock_async(|when, then| {
            when.method(POST)
                .path("/mcp")
                .body_includes("tools/list")
                .header("mcp-session-id", "sess-123");
            then.status(200)
                .header("content-type", "application/json")
                .json_body(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": { "tools": [ { "name": "search" }, { "name": "fetch" } ] }
                }));
        })
        .await;

    let result = probe_one(&probe_client(), &server.url("/mcp"))
        .await
        .expect("mcp probe result");
    assert_eq!(result.protocol, Some(RpcProtocol::Mcp));
    assert_eq!(result.transport, Some(RpcTransport::Http));
    assert_eq!(result.server_name.as_deref(), Some("demo-mcp"));
    assert_eq!(result.server_version.as_deref(), Some("0.9"));
    assert_eq!(
        result.tools,
        vec!["search".to_string(), "fetch".to_string()]
    );
}

#[tokio::test]
#[serial]
async fn parses_mcp_over_sse_streamable_http() {
    let _loopback = LoopbackGuard::allow();
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(POST).path("/mcp").body_includes("initialize");
            then.status(200)
                .header("content-type", "text/event-stream")
                .body(concat!(
                    "event: message\n",
                    "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":",
                    "{\"serverInfo\":{\"name\":\"sse-srv\",\"version\":\"3\"},\"capabilities\":{}}}\n",
                    "\n"
                ));
        })
        .await;

    let result = probe_one(&probe_client(), &server.url("/mcp"))
        .await
        .expect("sse mcp probe result");
    assert_eq!(result.protocol, Some(RpcProtocol::Mcp));
    assert_eq!(result.server_name.as_deref(), Some("sse-srv"));
}

#[tokio::test]
#[serial]
async fn detects_openrpc_via_rpc_discover() {
    let _loopback = LoopbackGuard::allow();
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(POST).path("/rpc").body_includes("rpc.discover");
            then.status(200)
                .header("content-type", "application/json")
                .json_body(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {
                        "openrpc": "1.2.6",
                        "methods": [ { "name": "eth_call" }, { "name": "eth_blockNumber" } ]
                    }
                }));
        })
        .await;

    let result = probe_one(&probe_client(), &server.url("/rpc"))
        .await
        .expect("openrpc probe result");
    assert_eq!(result.protocol, Some(RpcProtocol::Openrpc));
    assert!(result.methods.contains(&"eth_call".to_string()));
}

#[tokio::test]
#[serial]
async fn detects_jsonrpc_via_list_methods() {
    let _loopback = LoopbackGuard::allow();
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(POST)
                .path("/jsonrpc")
                .body_includes("system.listMethods");
            then.status(200)
                .header("content-type", "application/json")
                .json_body(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 3,
                    "result": [ "system.listMethods", "ping" ]
                }));
        })
        .await;

    let result = probe_one(&probe_client(), &server.url("/jsonrpc"))
        .await
        .expect("listMethods probe result");
    assert_eq!(result.protocol, Some(RpcProtocol::Jsonrpc2));
    assert!(result.methods.contains(&"ping".to_string()));
}

#[tokio::test]
#[serial]
async fn detects_jsonrpc_via_method_not_found_code() {
    let _loopback = LoopbackGuard::allow();
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(POST)
                .path("/rpc")
                .body_includes("__axon_probe__");
            then.status(200)
                .header("content-type", "application/json")
                .json_body(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 4,
                    "error": { "code": -32601, "message": "Method not found" }
                }));
        })
        .await;

    let result = probe_one(&probe_client(), &server.url("/rpc"))
        .await
        .expect("fingerprint probe result");
    assert_eq!(result.protocol, Some(RpcProtocol::Jsonrpc2));
    assert!(result.methods.is_empty());
}

#[tokio::test]
#[serial]
async fn detects_sse_transport_via_get() {
    let _loopback = LoopbackGuard::allow();
    let server = MockServer::start_async().await;
    // No POST mocks: every JSON-RPC POST 404s, falling through to the SSE GET probe.
    server
        .mock_async(|when, then| {
            when.method(GET).path("/sse");
            then.status(200)
                .header("content-type", "text/event-stream")
                .body("event: ping\ndata: {}\n\n");
        })
        .await;

    let result = probe_one(&probe_client(), &server.url("/sse"))
        .await
        .expect("sse transport probe result");
    assert_eq!(result.protocol, Some(RpcProtocol::Mcp));
    assert_eq!(result.transport, Some(RpcTransport::Sse));
}

#[tokio::test]
#[serial]
async fn non_rpc_endpoint_yields_no_probe() {
    let _loopback = LoopbackGuard::allow();
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(POST).path("/api");
            then.status(200)
                .header("content-type", "application/json")
                .json_body(serde_json::json!({ "hello": "world" }));
        })
        .await;
    server
        .mock_async(|when, then| {
            when.method(GET).path("/api");
            then.status(200)
                .header("content-type", "application/json")
                .json_body(serde_json::json!({ "hello": "world" }));
        })
        .await;

    assert!(
        probe_one(&probe_client(), &server.url("/api"))
            .await
            .is_none()
    );
}

#[test]
fn parse_sse_event_concatenates_data_lines() {
    let block = "event: message\ndata: {\"a\":1,\ndata: \"b\":2}";
    let value = parse_sse_event(block).expect("parsed sse json");
    assert_eq!(value.get("a").and_then(Value::as_i64), Some(1));
    assert_eq!(value.get("b").and_then(Value::as_i64), Some(2));
}
