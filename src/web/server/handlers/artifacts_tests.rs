use super::{
    artifact_headers_for_path, infer_content_type, is_structurally_unsafe,
    validate_artifact_path_for_test,
};
use axum::http::StatusCode;

// ── is_structurally_unsafe ────────────────────────────────────────────────────

#[test]
fn safe_relative_path_is_allowed() {
    assert!(!is_structurally_unsafe("screenshots/foo.png"));
}

#[test]
fn bare_filename_is_allowed() {
    assert!(!is_structurally_unsafe("artifact.json"));
}

#[test]
fn parent_dir_component_is_unsafe() {
    assert!(is_structurally_unsafe("../etc/passwd"));
}

#[test]
fn embedded_parent_traversal_is_unsafe() {
    assert!(is_structurally_unsafe("screenshots/../../../etc/passwd"));
}

#[test]
fn absolute_unix_path_is_unsafe() {
    assert!(is_structurally_unsafe("/etc/passwd"));
}

#[test]
fn dotdot_only_is_unsafe() {
    assert!(is_structurally_unsafe(".."));
}

#[test]
fn subdirectory_path_is_safe() {
    assert!(!is_structurally_unsafe("jobs/abc123/output.md"));
}

#[test]
fn unsafe_artifact_paths_are_rejected_structurally() {
    assert!(is_structurally_unsafe("../secret.txt"));
    assert!(is_structurally_unsafe("screenshots/../secret.txt"));
    assert!(is_structurally_unsafe("screenshots/%2e%2e/secret.txt"));
    assert!(is_structurally_unsafe(r"screenshots\\..\\secret.txt"));
    assert!(is_structurally_unsafe(r"C:\\Windows\\secret.txt"));
    assert!(is_structurally_unsafe("screenshots/shot.png\0"));
}

#[test]
fn raster_images_are_inline_but_active_content_is_attachment() {
    assert_eq!(
        artifact_headers_for_path("screenshots/shot.png").content_type,
        "image/png"
    );
    assert!(
        artifact_headers_for_path("screenshots/shot.png")
            .content_disposition
            .is_none()
    );
    assert_eq!(
        artifact_headers_for_path("page.html").content_type,
        "application/octet-stream"
    );
    assert!(
        artifact_headers_for_path("page.html")
            .content_disposition
            .unwrap()
            .starts_with("attachment")
    );
    assert_eq!(
        artifact_headers_for_path("logo.svg").content_type,
        "application/octet-stream"
    );
}

#[tokio::test]
async fn symlink_component_under_output_root_is_forbidden() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("output");
    let screenshots = root.join("screenshots");
    tokio::fs::create_dir_all(&screenshots).await.unwrap();
    tokio::fs::write(screenshots.join("real.png"), b"png")
        .await
        .unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(screenshots.join("real.png"), screenshots.join("alias.png"))
        .unwrap();

    #[cfg(unix)]
    {
        let err = validate_artifact_path_for_test(&root, "screenshots/alias.png")
            .await
            .expect_err("symlink should be rejected");
        assert_eq!(err.status(), StatusCode::FORBIDDEN);
    }
}

// ── infer_content_type ────────────────────────────────────────────────────────

#[test]
fn png_returns_image_png() {
    assert_eq!(infer_content_type("shot.png"), "image/png");
}

#[test]
fn jpg_returns_image_jpeg() {
    assert_eq!(infer_content_type("photo.jpg"), "image/jpeg");
}

#[test]
fn jpeg_returns_image_jpeg() {
    assert_eq!(infer_content_type("photo.jpeg"), "image/jpeg");
}

#[test]
fn json_returns_application_json() {
    assert_eq!(infer_content_type("data.json"), "application/octet-stream");
}

#[test]
fn md_returns_text_markdown() {
    assert_eq!(infer_content_type("README.md"), "application/octet-stream");
}

#[test]
fn log_returns_text_plain() {
    assert_eq!(infer_content_type("run.log"), "application/octet-stream");
}

#[test]
fn unknown_extension_returns_octet_stream() {
    assert_eq!(
        infer_content_type("archive.tar.gz"),
        "application/octet-stream"
    );
}

#[test]
fn no_extension_returns_octet_stream() {
    assert_eq!(infer_content_type("Makefile"), "application/octet-stream");
}

#[test]
fn uppercase_png_extension_returns_image_png() {
    assert_eq!(infer_content_type("SCREENSHOT.PNG"), "image/png");
}

#[test]
fn svg_returns_image_svg() {
    assert_eq!(infer_content_type("logo.svg"), "application/octet-stream");
}

#[test]
fn html_returns_text_html() {
    assert_eq!(infer_content_type("page.html"), "application/octet-stream");
}
