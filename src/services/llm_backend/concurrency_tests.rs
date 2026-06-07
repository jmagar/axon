use super::*;

#[test]
fn completion_concurrency_defaults_to_four() {
    assert_eq!(parse_completion_concurrency_limit(None), 4);
}

#[test]
fn completion_concurrency_rejects_zero() {
    assert_eq!(parse_completion_concurrency_limit(Some("0")), 4);
}

#[test]
fn completion_concurrency_clamps_to_semaphore_max() {
    let huge = (Semaphore::MAX_PERMITS + 1).to_string();
    assert_eq!(
        parse_completion_concurrency_limit(Some(&huge)),
        Semaphore::MAX_PERMITS
    );
}

#[tokio::test]
async fn completion_limiter_is_keyed_by_backend_and_limit() {
    let first = acquire_completion_permit_for_key("openai:http://one", 1)
        .await
        .expect("first permit");

    let second_same_key = tokio::time::timeout(
        std::time::Duration::from_millis(25),
        acquire_completion_permit_for_key("openai:http://one", 1),
    )
    .await;
    assert!(
        second_same_key.is_err(),
        "same key and limit should share the saturated one-permit limiter"
    );

    let second_different_limit = tokio::time::timeout(
        std::time::Duration::from_millis(25),
        acquire_completion_permit_for_key("openai:http://one", 2),
    )
    .await;
    assert!(
        second_different_limit.is_ok(),
        "different limit should use a different limiter instead of first request winning"
    );

    let second_different_backend = tokio::time::timeout(
        std::time::Duration::from_millis(25),
        acquire_completion_permit_for_key("gemini:default", 1),
    )
    .await;
    assert!(
        second_different_backend.is_ok(),
        "different backend key should use an independent limiter"
    );

    drop(first);
}
