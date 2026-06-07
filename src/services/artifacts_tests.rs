use super::artifacts::{ArtifactHandle, ArtifactKind, atomic_write_under};
use uuid::Uuid;

#[test]
fn artifact_handle_rejects_parent_dir_relative_path() {
    let result = ArtifactHandle::new(
        ArtifactKind::Markdown,
        "../secret.md",
        Some("https://example.com".to_string()),
        None,
        "abc123".to_string(),
        12,
        Some(1),
        None,
    );

    assert!(result.is_err());
}

#[test]
fn artifact_id_is_stable_for_kind_path_and_hash() {
    let one = ArtifactHandle::new(
        ArtifactKind::CrawlManifest,
        "domains/example.com/job-1/manifest.jsonl",
        Some("https://example.com".to_string()),
        Some(Uuid::nil()),
        "abc123".to_string(),
        128,
        Some(4),
        Some("/home/axon/.axon/output/domains/example.com/job-1/manifest.jsonl".to_string()),
    )
    .expect("artifact handle");
    let two = ArtifactHandle::new(
        ArtifactKind::CrawlManifest,
        "domains/example.com/job-1/manifest.jsonl",
        Some("https://example.com".to_string()),
        Some(Uuid::nil()),
        "abc123".to_string(),
        128,
        Some(4),
        None,
    )
    .expect("artifact handle");

    assert_eq!(one.artifact_id, two.artifact_id);
    assert_eq!(one.kind, ArtifactKind::CrawlManifest);
}

#[tokio::test]
async fn atomic_write_under_rejects_parent_traversal() {
    let temp = tempfile::TempDir::new().expect("tempdir");

    let err = atomic_write_under(temp.path(), "../escape.txt", b"secret")
        .await
        .expect_err("parent traversal must be rejected");

    assert!(err.to_string().contains("unsafe artifact relative_path"));
    assert!(!temp.path().join("../escape.txt").exists());
}

#[tokio::test]
async fn atomic_write_under_cleans_temp_file_on_create_failure() {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let root_file = temp.path().join("not-a-dir");
    std::fs::write(&root_file, "occupied").expect("root file");

    let err = atomic_write_under(&root_file, "nested/output.md", b"content")
        .await
        .expect_err("root file cannot contain nested artifact");

    assert!(err.to_string().contains("not a directory") || err.to_string().contains("os error"));
    let temp_files = std::fs::read_dir(temp.path())
        .expect("read tempdir")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp-"))
        .count();
    assert_eq!(temp_files, 0, "failed writes must not leave temp artifacts");
}

#[tokio::test]
async fn atomic_write_under_writes_relative_path_inside_root() {
    let temp = tempfile::TempDir::new().expect("tempdir");

    let path = atomic_write_under(temp.path(), "screenshots/shot.png", b"png")
        .await
        .expect("write artifact");

    assert_eq!(path, temp.path().join("screenshots/shot.png"));
    assert_eq!(std::fs::read(path).expect("read artifact"), b"png");
}

#[cfg(unix)]
#[tokio::test]
async fn atomic_write_under_rejects_symlinked_parent_escape() {
    use std::os::unix::fs::symlink;

    let root = tempfile::TempDir::new().expect("root");
    let outside = tempfile::TempDir::new().expect("outside");
    symlink(outside.path(), root.path().join("redirect")).expect("symlink");

    let err = atomic_write_under(root.path(), "redirect/escape.txt", b"secret")
        .await
        .expect_err("symlinked parent must not escape root");

    assert!(err.to_string().contains("escaped output root"));
    assert!(!outside.path().join("escape.txt").exists());
}
