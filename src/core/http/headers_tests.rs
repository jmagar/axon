use super::*;

#[test]
fn parses_valid_headers() {
    let raw = vec![
        "Authorization: Bearer token123".to_string(),
        "X-Custom: value".to_string(),
    ];
    let map = parse_custom_headers(&raw);
    assert_eq!(map.len(), 2);
    assert_eq!(map.get("authorization").unwrap(), "Bearer token123");
    assert_eq!(map.get("x-custom").unwrap(), "value");
}

#[test]
fn rejects_hop_by_hop_and_internal_forwarding_headers() {
    let raw = vec![
        "Host: example.com".to_string(),
        "X-Forwarded-For: 127.0.0.1".to_string(),
    ];
    let err = validate_custom_header_policy(&raw).expect_err("forwarding headers rejected");
    assert!(err.contains("not allowed"));
}

#[test]
fn parser_skips_rejected_forwarding_headers_defensively() {
    let raw = vec![
        "Authorization: Bearer token123".to_string(),
        "Connection: keep-alive".to_string(),
        "X-Forwarded-Host: internal".to_string(),
    ];
    let map = parse_custom_headers(&raw);
    assert_eq!(map.len(), 1);
    assert!(map.contains_key("authorization"));
}

#[test]
fn skips_malformed_headers() {
    let raw = vec![
        "Valid: header".to_string(),
        "no-colon-space".to_string(),
        "".to_string(),
    ];
    let map = parse_custom_headers(&raw);
    assert_eq!(map.len(), 1);
}

#[test]
fn empty_input_returns_empty_map() {
    let map = parse_custom_headers(&[]);
    assert!(map.is_empty());
}
