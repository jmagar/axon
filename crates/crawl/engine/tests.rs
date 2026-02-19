use super::*;

fn summary(pages_seen: u32, thin: u32, markdown_files: u32) -> CrawlSummary {
    CrawlSummary {
        pages_seen,
        thin_pages: thin,
        markdown_files,
        elapsed_ms: 0,
    }
}

#[test]
fn test_fallback_when_no_markdown_files() {
    assert!(should_fallback_to_chrome(&summary(100, 0, 0), 200));
}

#[test]
fn test_fallback_thin_ratio_above_threshold() {
    assert!(should_fallback_to_chrome(&summary(100, 61, 50), 200));
}

#[test]
fn test_no_fallback_at_threshold() {
    assert!(!should_fallback_to_chrome(&summary(100, 60, 50), 200));
}

#[test]
fn test_fallback_low_coverage() {
    assert!(should_fallback_to_chrome(&summary(100, 10, 5), 200));
}

#[test]
fn test_no_divide_by_zero() {
    assert!(should_fallback_to_chrome(&summary(0, 0, 0), 200));
}

#[test]
fn test_no_fallback_healthy_crawl() {
    assert!(!should_fallback_to_chrome(&summary(200, 10, 150), 200));
}

#[test]
fn test_fallback_low_max_pages() {
    assert!(should_fallback_to_chrome(&summary(50, 5, 8), 50));
}

#[test]
fn test_no_fallback_small_crawl_sufficient_coverage() {
    assert!(!should_fallback_to_chrome(&summary(50, 5, 15), 50));
}

#[test]
fn test_exclude_path_prefix_matches_segment_boundary() {
    let excludes = vec!["/de".to_string()];
    assert!(is_excluded_url_path("https://example.com/de", &excludes));
    assert!(is_excluded_url_path(
        "https://example.com/de/docs",
        &excludes
    ));
    assert!(!is_excluded_url_path(
        "https://example.com/developer",
        &excludes
    ));
    assert!(!is_excluded_url_path(
        "https://example.com/design",
        &excludes
    ));
}

#[test]
fn test_exclude_path_prefix_handles_non_normalized_input() {
    let excludes = vec!["de/".to_string()];
    assert!(is_excluded_url_path("https://example.com/de", &excludes));
    assert!(is_excluded_url_path(
        "https://example.com/de/guide",
        &excludes
    ));
    assert!(!is_excluded_url_path(
        "https://example.com/developer",
        &excludes
    ));
}

#[test]
fn test_canonicalize_url_for_dedupe_trailing_slash_and_fragment() {
    let a = canonicalize_url_for_dedupe("https://example.com/docs/");
    let b = canonicalize_url_for_dedupe("https://example.com/docs#intro");
    assert_eq!(a, b);
    assert_eq!(a.as_deref(), Some("https://example.com/docs"));
}

#[test]
fn test_canonicalize_url_for_dedupe_root_and_default_port() {
    let a = canonicalize_url_for_dedupe("https://example.com:443/");
    let b = canonicalize_url_for_dedupe("https://example.com/");
    assert_eq!(a, b);
    assert_eq!(a.as_deref(), Some("https://example.com/"));
}

#[test]
fn test_regex_escape_escapes_hyphen() {
    assert_eq!(regex_escape("foo-bar"), "foo\\-bar");
}
