//! Route-existence + deprecation-signaling tests for the memory REST surface.
//!
//! Uses the real `spawn_full_test_server` HTTP harness (`crate::server::
//! test_support`) established by the Phase 3A durable-job-cutover work — no
//! separate `test_app()`/`route_exists()` helper pattern is invented here.

use crate::server::test_support::{EnvGuard, spawn_full_test_server, stop};
use axon_authz::http::AuthPolicy;
use axum::http::StatusCode;
use serial_test::serial;

#[tokio::test]
#[serial]
async fn rest_exposes_per_verb_memory_routes() {
    let _env = EnvGuard::set(Some("secret"));
    let (base, shutdown, handle) =
        spawn_full_test_server(AuthPolicy::Mounted { auth_state: None }).await;
    let client = reqwest::Client::new();
    let memory_id = "mem_test";

    let routes: &[(&str, String)] = &[
        ("POST", "/v1/memories".to_string()),
        ("POST", "/v1/memories/search".to_string()),
        ("GET", format!("/v1/memories/{memory_id}")),
        ("POST", format!("/v1/memories/{memory_id}/link")),
        ("POST", format!("/v1/memories/{memory_id}/supersede")),
        ("POST", format!("/v1/memories/{memory_id}/reinforce")),
        ("POST", format!("/v1/memories/{memory_id}/contradict")),
        ("POST", format!("/v1/memories/{memory_id}/pin")),
        ("POST", format!("/v1/memories/{memory_id}/archive")),
        ("DELETE", format!("/v1/memories/{memory_id}")),
        ("POST", "/v1/memories/review".to_string()),
        ("POST", format!("/v1/memories/{memory_id}/compact")),
    ];

    for (method, path) in routes {
        let response = match *method {
            "GET" => client.get(format!("{base}{path}")).bearer_auth("secret"),
            "DELETE" => client.delete(format!("{base}{path}")).bearer_auth("secret"),
            "POST" => client
                .post(format!("{base}{path}"))
                .bearer_auth("secret")
                .json(&serde_json::json!({})),
            other => unreachable!("unexpected test method {other}"),
        }
        .send()
        .await
        .unwrap_or_else(|err| panic!("{method} {path} failed: {err}"));

        // A route that doesn't exist returns the enveloped 404 with
        // `route.not_found`; anything else (including a validation 400 from
        // an empty body) proves the route is registered and dispatching.
        assert_ne!(
            response.status(),
            StatusCode::NOT_FOUND,
            "missing route {method} {path}"
        );
    }

    stop(shutdown, handle).await;
}

#[tokio::test]
#[serial]
async fn old_passthrough_route_still_works_but_logs_deprecation() {
    let _env = EnvGuard::set(Some("secret"));
    let (base, shutdown, handle) =
        spawn_full_test_server(AuthPolicy::Mounted { auth_state: None }).await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("{base}/v1/memory"))
        .bearer_auth("secret")
        .json(&serde_json::json!({ "subaction": "search" }))
        .send()
        .await
        .expect("legacy memory request");

    assert_ne!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response
            .headers()
            .get("deprecation")
            .and_then(|value| value.to_str().ok()),
        Some("true"),
        "POST /v1/memory should carry a Deprecation response header"
    );
    assert!(
        response
            .headers()
            .get("link")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.contains("/v1/memories")),
        "POST /v1/memory should link its successor route"
    );

    stop(shutdown, handle).await;
}

#[tokio::test]
#[serial]
async fn new_per_verb_routes_do_not_carry_deprecation_header() {
    let _env = EnvGuard::set(Some("secret"));
    let (base, shutdown, handle) =
        spawn_full_test_server(AuthPolicy::Mounted { auth_state: None }).await;
    let client = reqwest::Client::new();

    let response = client
        .post(format!("{base}/v1/memories/search"))
        .bearer_auth("secret")
        .json(&serde_json::json!({ "query": "test" }))
        .send()
        .await
        .expect("memories search request");

    assert!(response.headers().get("deprecation").is_none());

    stop(shutdown, handle).await;
}

#[tokio::test]
#[serial]
async fn rest_exposes_import_and_export_routes_with_size_limit() {
    let _env = EnvGuard::set(Some("secret"));
    let (base, shutdown, handle) =
        spawn_full_test_server(AuthPolicy::Mounted { auth_state: None }).await;
    let client = reqwest::Client::new();

    // Route existence: a well-formed empty-scope export request must not 404.
    let export_response = client
        .post(format!("{base}/v1/memories/export"))
        .bearer_auth("secret")
        .json(&serde_json::json!({}))
        .send()
        .await
        .expect("memories export request");
    assert_ne!(export_response.status(), StatusCode::NOT_FOUND);

    let import_response = client
        .post(format!("{base}/v1/memories/import"))
        .bearer_auth("secret")
        .json(&serde_json::json!({ "records": [], "mode": "merge" }))
        .send()
        .await
        .expect("memories import request");
    assert_ne!(import_response.status(), StatusCode::NOT_FOUND);

    // Oversized body: exceed the 10 MiB import/export limit and confirm 413.
    let oversized_body = vec![b'0'; 10 * 1024 * 1024 + 1];
    let oversized_response = client
        .post(format!("{base}/v1/memories/import"))
        .bearer_auth("secret")
        .header("content-type", "application/json")
        .body(oversized_body)
        .send()
        .await
        .expect("oversized memories import request");
    assert_eq!(
        oversized_response.status(),
        StatusCode::PAYLOAD_TOO_LARGE,
        "import body over the size limit should be rejected with 413"
    );

    stop(shutdown, handle).await;
}
