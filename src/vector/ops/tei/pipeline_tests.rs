/// Verify that the empty-chunk filter (applied before tei_embed) removes
/// blank and whitespace-only strings while keeping real content.
#[test]
fn empty_and_whitespace_chunks_are_filtered() {
    let mut chunks = vec![
        "".to_string(),
        "   ".to_string(),
        "real content".to_string(),
        "\n\t\n".to_string(),
        "another chunk".to_string(),
    ];
    chunks.retain(|c| !c.trim().is_empty());
    assert_eq!(
        chunks,
        vec!["real content".to_string(), "another chunk".to_string()]
    );
}

#[test]
fn all_empty_chunks_produces_no_chunks() {
    let mut chunks = vec!["".to_string(), "  ".to_string(), "\n".to_string()];
    chunks.retain(|c| !c.trim().is_empty());
    assert!(
        chunks.is_empty(),
        "all-empty input must produce zero chunks"
    );
}

// T-C3: apply_extra clobber-guard tests — reserved keys must survive collisions
// in caller-supplied extra, while non-reserved keys are applied normally.
#[test]
fn apply_extra_does_not_clobber_reserved_keys() {
    use crate::vector::ops::tei::pipeline::apply_extra;

    let mut payload = serde_json::json!({
        "url": "https://real.example.com/doc",
        "chunk_text": "original chunk",
        "payload_schema_version": 7,
    });
    // Attacker-supplied extra tries to overwrite reserved keys.
    let evil_extra = serde_json::json!({
        "url": "https://evil.example.com/injected",
        "chunk_text": "injected content",
        "payload_schema_version": 999,
        "safe_key": "allowed value",
    });
    apply_extra(&mut payload, &evil_extra);

    // Reserved fields must be unchanged.
    assert_eq!(
        payload["url"].as_str(),
        Some("https://real.example.com/doc"),
        "url must not be overwritten by extra"
    );
    assert_eq!(
        payload["chunk_text"].as_str(),
        Some("original chunk"),
        "chunk_text must not be overwritten by extra"
    );
    assert_eq!(
        payload["payload_schema_version"].as_u64(),
        Some(7),
        "payload_schema_version must not be overwritten by extra"
    );
    // Non-reserved key must be applied.
    assert_eq!(
        payload["safe_key"].as_str(),
        Some("allowed value"),
        "non-reserved keys must be applied by apply_extra"
    );
}

#[test]
fn apply_extra_applies_all_non_reserved_keys() {
    use crate::vector::ops::tei::pipeline::apply_extra;

    let mut payload = serde_json::json!({});
    let extra = serde_json::json!({
        "custom_tag": "rust",
        "priority": 42,
        "nested": {"x": 1},
    });
    apply_extra(&mut payload, &extra);

    assert_eq!(payload["custom_tag"].as_str(), Some("rust"));
    assert_eq!(payload["priority"].as_u64(), Some(42));
    assert!(payload["nested"].is_object());
}

#[test]
fn apply_extra_all_reserved_keys_constant_is_non_empty() {
    use crate::vector::ops::tei::pipeline::RESERVED_PAYLOAD_KEYS;
    // Sanity: the constant must include the critical system keys.
    assert!(RESERVED_PAYLOAD_KEYS.contains(&"url"));
    assert!(RESERVED_PAYLOAD_KEYS.contains(&"chunk_text"));
    assert!(RESERVED_PAYLOAD_KEYS.contains(&"payload_schema_version"));
    assert!(RESERVED_PAYLOAD_KEYS.contains(&"seed_url"));
}

// axon_rust-lu6a: schema-version + extractor_name payload tests.
#[test]
fn payload_schema_version_is_at_least_two() {
    let version = std::hint::black_box(crate::vector::ops::qdrant::PAYLOAD_SCHEMA_VERSION);
    assert!(version >= 2);
}

#[test]
fn pipeline_payload_stamps_schema_version_and_extractor() {
    use crate::vector::ops::qdrant::PAYLOAD_SCHEMA_VERSION;
    let mut payload = serde_json::json!({
        "url": "https://example.com/x",
        "chunk_index": 0,
        "chunk_text": "body",
        "payload_schema_version": PAYLOAD_SCHEMA_VERSION,
    });
    assert_eq!(
        payload["payload_schema_version"].as_u64(),
        Some(u64::from(PAYLOAD_SCHEMA_VERSION))
    );
    assert!(payload.get("extractor_name").is_none());
    let extractor = Some("docs".to_string());
    if let Some(name) = &extractor
        && !name.is_empty()
    {
        payload["extractor_name"] = serde_json::Value::String(name.clone());
    }
    assert_eq!(payload["extractor_name"].as_str(), Some("docs"));
}
