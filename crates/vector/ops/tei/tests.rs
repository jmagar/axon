use crate::crates::jobs::common::test_config;
use crate::crates::vector::ops::tei::tei_client::tei_embed;
use httpmock::{HttpMockResponse, MockServer};
use std::env;
use std::sync::{Arc, Mutex};

/// Guard that restores (or removes) an env var on drop.
///
/// Use only inside tests annotated with `#[serial_test::serial]` to prevent concurrent
/// env mutation across test threads.
struct EnvGuard {
    key: &'static str,
    original: Option<String>,
}
impl EnvGuard {
    #[allow(unsafe_code)]
    fn set(key: &'static str, value: &str) -> Self {
        let original = env::var(key).ok();
        // SAFETY: caller must hold the serial_test lock (see #[serial] annotation) so no
        // other test thread reads or writes env vars concurrently.
        unsafe { env::set_var(key, value) };
        EnvGuard { key, original }
    }
}
impl Drop for EnvGuard {
    #[allow(unsafe_code)]
    fn drop(&mut self) {
        // SAFETY: same serial_test lock guarantees exclusive env access for the duration
        // of the test and its cleanup.
        unsafe {
            match &self.original {
                Some(v) => env::set_var(self.key, v),
                None => env::remove_var(self.key),
            }
        }
    }
}

/// Empty input slice must short-circuit before any HTTP call.
#[tokio::test]
async fn tei_embed_empty_input_returns_empty_vec() {
    // Port 1 is unreachable — any HTTP attempt would cause the test to fail.
    let mut cfg = test_config("postgresql://dummy@127.0.0.1:1/dummy");
    cfg.tei_url = "http://127.0.0.1:1".to_string();

    let result = tei_embed(&cfg, &[]).await.unwrap();
    assert!(
        result.is_empty(),
        "empty input must return empty vec without HTTP call"
    );
}

/// On a 429 response, tei_embed must retry and succeed on the second attempt.
#[tokio::test]
async fn tei_embed_retries_on_429() {
    let server = MockServer::start_async().await;
    let call_count = Arc::new(Mutex::new(0usize));
    let cc = Arc::clone(&call_count);

    server
        .mock_async(|when, then| {
            when.method(httpmock::Method::POST).path("/embed");
            then.respond_with(move |_req: &httpmock::HttpMockRequest| {
                let mut count = cc.lock().unwrap();
                *count += 1;
                if *count == 1 {
                    // First call: rate-limited.
                    HttpMockResponse::builder().status(429).build()
                } else {
                    // Retry: success with one embedding vector.
                    HttpMockResponse::builder()
                        .status(200)
                        .header("content-type", "application/json")
                        .body("[[0.1,0.2,0.3,0.4]]")
                        .build()
                }
            });
        })
        .await;

    let mut cfg = test_config("postgresql://dummy@127.0.0.1:1/dummy");
    cfg.tei_url = server.base_url();

    let inputs = vec!["hello world".to_string()];
    let result = tei_embed(&cfg, &inputs)
        .await
        .expect("tei_embed must succeed after retry");
    assert_eq!(
        result.len(),
        1,
        "must return one vector after 429→retry→200"
    );
}

/// On a 413 response, tei_embed must split the batch and re-request each half.
#[tokio::test]
async fn tei_embed_splits_batch_on_413() {
    let server = MockServer::start_async().await;

    // Specific mock (registered first = higher precedence in httpmock): 413 when BOTH items are
    // present in the body. Single-item requests only contain one string, so they fall through.
    server
        .mock_async(|when, then| {
            when.method(httpmock::Method::POST)
                .path("/embed")
                .body_includes("input-alpha")
                .body_includes("input-beta");
            then.status(413);
        })
        .await;

    // Fallback mock (registered second = lower precedence): 200 for single-item calls.
    server
        .mock_async(|when, then| {
            when.method(httpmock::Method::POST).path("/embed");
            then.status(200)
                .json_body(serde_json::json!([[0.1f32, 0.2, 0.3, 0.4]]));
        })
        .await;

    let mut cfg = test_config("postgresql://dummy@127.0.0.1:1/dummy");
    cfg.tei_url = server.base_url();

    let inputs = vec!["input-alpha".to_string(), "input-beta".to_string()];
    let result = tei_embed(&cfg, &inputs)
        .await
        .expect("tei_embed must succeed after batch split");
    assert_eq!(
        result.len(),
        2,
        "must return two vectors (one per item after split)"
    );
}

/// Non-success HTTP responses (not just 429/503) should also retry.
#[serial_test::serial]
#[tokio::test]
async fn tei_embed_retries_on_500() {
    let server = MockServer::start_async().await;
    let call_count = Arc::new(Mutex::new(0usize));
    let cc = Arc::clone(&call_count);

    server
        .mock_async(|when, then| {
            when.method(httpmock::Method::POST).path("/embed");
            then.respond_with(move |_req: &httpmock::HttpMockRequest| {
                let mut count = cc.lock().unwrap();
                *count += 1;
                if *count == 1 {
                    HttpMockResponse::builder()
                        .status(500)
                        .body("temporary failure")
                        .build()
                } else {
                    HttpMockResponse::builder()
                        .status(200)
                        .header("content-type", "application/json")
                        .body("[[0.9,0.8,0.7,0.6]]")
                        .build()
                }
            });
        })
        .await;

    let mut cfg = test_config("postgresql://dummy@127.0.0.1:1/dummy");
    cfg.tei_url = server.base_url();

    // Pin retry-related env vars so ambient overrides can't change test behavior.
    let _retry_guard = EnvGuard::set("TEI_MAX_RETRIES", "5");
    let _timeout_guard = EnvGuard::set("TEI_REQUEST_TIMEOUT_MS", "10000");

    let inputs = vec!["retry-on-500".to_string()];
    let result = tei_embed(&cfg, &inputs)
        .await
        .expect("tei_embed must succeed after retry on 500");
    assert_eq!(result.len(), 1, "must return one embedding vector");
}

// ── Named / Unnamed point format tests ─────────────────────────────────────

#[test]
fn named_mode_point_has_dense_and_bm42_in_vector_field() {
    use crate::crates::vector::ops::tei::build_point_for_test;
    use crate::crates::vector::ops::tei::qdrant_store::VectorMode;

    let dense = vec![0.1f32, 0.2, 0.3, 0.4];
    let chunk = "embed axon qdrant vector search collection";
    let point = build_point_for_test(dense, chunk, "https://ex.com/a", 0, VectorMode::Named);

    let vector_obj = point["vector"]
        .as_object()
        .expect("vector must be an object for Named mode");
    assert!(
        vector_obj.contains_key("dense"),
        "Named point must have 'dense' key"
    );
    assert!(
        vector_obj.contains_key("bm42"),
        "Named point must have 'bm42' key"
    );

    let bm42 = &vector_obj["bm42"];
    assert!(bm42["indices"].is_array(), "bm42.indices must be an array");
    assert!(bm42["values"].is_array(), "bm42.values must be an array");
    assert_eq!(
        bm42["indices"].as_array().unwrap().len(),
        bm42["values"].as_array().unwrap().len(),
        "bm42 indices and values must have the same length"
    );
}

#[test]
fn unnamed_mode_point_has_flat_array_vector() {
    use crate::crates::vector::ops::tei::build_point_for_test;
    use crate::crates::vector::ops::tei::qdrant_store::VectorMode;

    let dense = vec![0.1f32, 0.2, 0.3, 0.4];
    let chunk = "embed qdrant vector";
    let point = build_point_for_test(dense, chunk, "https://ex.com/b", 0, VectorMode::Unnamed);

    assert!(
        point["vector"].is_array(),
        "Unnamed point must have a flat array vector"
    );
}

#[test]
fn named_mode_bm42_values_non_empty_for_content_chunk() {
    use crate::crates::vector::ops::tei::build_point_for_test;
    use crate::crates::vector::ops::tei::qdrant_store::VectorMode;

    let dense = vec![0.1f32, 0.2, 0.3, 0.4];
    let chunk = "axon hybrid search qdrant embedding pipeline";
    let point = build_point_for_test(dense, chunk, "https://ex.com/c", 0, VectorMode::Named);

    let bm42 = &point["vector"]["bm42"];
    let values = bm42["values"].as_array().unwrap();
    assert!(
        !values.is_empty(),
        "non-empty chunk must produce non-empty sparse vector"
    );
}

/// Hard client errors should fail fast (no retry storm).
#[tokio::test]
async fn tei_embed_fails_fast_on_404() {
    let server = MockServer::start_async().await;
    let call_count = Arc::new(Mutex::new(0usize));
    let cc = Arc::clone(&call_count);

    server
        .mock_async(|when, then| {
            when.method(httpmock::Method::POST).path("/embed");
            then.respond_with(move |_req: &httpmock::HttpMockRequest| {
                let mut count = cc.lock().unwrap();
                *count += 1;
                HttpMockResponse::builder()
                    .status(404)
                    .body("not found")
                    .build()
            });
        })
        .await;

    let mut cfg = test_config("postgresql://dummy@127.0.0.1:1/dummy");
    cfg.tei_url = server.base_url();

    let inputs = vec!["fail-fast-404".to_string()];
    let err = tei_embed(&cfg, &inputs)
        .await
        .expect_err("tei_embed must fail fast on 404");
    let msg = err.to_string();
    assert!(
        msg.contains("status 404"),
        "unexpected error message: {msg}"
    );
    assert_eq!(*call_count.lock().unwrap(), 1, "404 should not be retried");
}
