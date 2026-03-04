use crate::crates::jobs::common::test_config;
use crate::crates::vector::ops::tei::tei_client::tei_embed;
use httpmock::{HttpMockResponse, MockServer};
use std::sync::{Arc, Mutex};

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
