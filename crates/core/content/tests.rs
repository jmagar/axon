use super::*;

#[test]
fn test_redact_url_postgres() {
    let url = "postgresql://axon:secret123@localhost:5432/axon";
    let redacted = redact_url(url);
    assert!(!redacted.contains("secret123"));
    assert!(redacted.contains("***"));
}

#[test]
fn test_redact_url_amqp() {
    let url = "amqp://guest:guest@localhost:5672";
    let redacted = redact_url(url);
    assert!(!redacted.contains("guest:guest"));
}

#[test]
fn test_redact_url_no_credentials() {
    let url = "http://example.com/path";
    assert_eq!(redact_url(url), url);
}

#[test]
fn test_redact_url_unparseable() {
    let result = redact_url("not a url at all !!!@#$");
    assert_eq!(result, "***redacted***");
}

#[test]
fn test_redact_url_username_only() {
    let url = "postgresql://admin@localhost:5432/db";
    let redacted = redact_url(url);
    assert!(!redacted.contains("admin@"));
    assert!(redacted.contains("***"));
}

#[test]
fn test_redact_url_redis_with_password() {
    let url = "redis://:mypassword@localhost:6379";
    let redacted = redact_url(url);
    assert!(!redacted.contains("mypassword"));
}

#[test]
fn test_default_engine_extracts_json_ld() {
    let html = r#"
        <html><head>
        <script type="application/ld+json">{"@type":"Article","headline":"Hello"}</script>
        </head></html>
    "#;
    let engine = DeterministicExtractionEngine::with_default_parsers();
    let page = engine.extract("https://example.com", html);
    assert!(!page.items.is_empty());
    assert!(page.parser_hits.iter().any(|x| x == "json-ld"));
}

#[test]
fn test_default_engine_dedups_identical_json_ld_items() {
    let html = r#"
        <html><head>
        <script type="application/ld+json">{"@type":"Article","headline":"Hello"}</script>
        <script type="application/ld+json">{"@type":"Article","headline":"Hello"}</script>
        </head></html>
    "#;
    let engine = DeterministicExtractionEngine::with_default_parsers();
    let page = engine.extract("https://example.com", html);
    assert_eq!(page.items.len(), 1);
}

#[test]
fn test_extract_attr_case_insensitive() {
    let tag = r#"<meta PROPERTY = "og:title" content="Example">"#;
    assert_eq!(
        deterministic::extract_attr(tag, "property").as_deref(),
        Some("og:title")
    );
}

#[test]
fn test_estimate_llm_cost_usd_zero_for_unknown_model() {
    let cost = deterministic::estimate_llm_cost_usd("unknown-model", 10_000, 1_000);
    assert_eq!(cost, 0.0);
}

#[test]
fn test_estimate_llm_cost_usd_known_model() {
    let cost = deterministic::estimate_llm_cost_usd("gpt-4o-mini", 100_000, 20_000);
    assert!(cost > 0.0);
}
