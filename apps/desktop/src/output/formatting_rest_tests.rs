use super::*;

#[test]
fn screenshot_with_artifact_handle_formats_cleanly() {
    let json = r#"{
        "url": "https://example.com",
        "artifact_handle": {
            "relative_path": "screenshots/example.com-2024.png",
            "bytes": 153600
        }
    }"#;
    let result = rest_output_text("screenshot", json).unwrap();
    assert!(result.contains("https://example.com"), "should show URL");
    assert!(
        result.contains("150.0 KB"),
        "should show human-readable size"
    );
    assert!(
        result.contains("artifact: screenshots/example.com-2024.png"),
        "should show relative path"
    );
    assert!(
        !result.contains("size_bytes"),
        "must not leak raw JSON keys"
    );
    assert!(
        !result.contains("/home/"),
        "must not contain absolute server paths"
    );
}

#[test]
fn screenshot_without_artifact_handle_falls_back_to_size_bytes() {
    let json = r#"{"url": "https://example.com", "size_bytes": 2048}"#;
    let result = rest_output_text("screenshot", json).unwrap();
    assert!(result.contains("https://example.com"));
    assert!(result.contains("2.0 KB"));
}

#[test]
fn screenshot_without_artifact_handle_shows_no_raw_path_lines() {
    let json = r#"{
        "url": "https://example.com",
        "path": "/home/axon/.axon/screenshots/example.png",
        "size_bytes": 512
    }"#;
    let result = rest_output_text("screenshot", json).unwrap();
    assert!(
        !result.contains("/home/axon"),
        "absolute server path must not appear in output"
    );
    assert!(result.contains("https://example.com"));
}

#[test]
fn format_bytes_below_1kb() {
    assert_eq!(format_bytes(512), "512 B");
    assert_eq!(format_bytes(0), "0 B");
    assert_eq!(format_bytes(1023), "1023 B");
}

#[test]
fn format_bytes_kb_range() {
    assert_eq!(format_bytes(1024), "1.0 KB");
    assert_eq!(format_bytes(153_600), "150.0 KB");
}

#[test]
fn format_bytes_mb_range() {
    assert_eq!(format_bytes(1_048_576), "1.0 MB");
    assert_eq!(format_bytes(5_242_880), "5.0 MB");
}
