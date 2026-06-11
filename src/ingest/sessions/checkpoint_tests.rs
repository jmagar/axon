use super::*;
use crate::ingest::sessions::watch::validate::{SessionProvider, ValidatedSessionPath};
use crate::jobs::store::open_sqlite_pool;
use std::path::{Path, PathBuf};

#[tokio::test]
async fn checkpoint_skips_unchanged_file_and_records_success() {
    let temp = tempfile::tempdir().unwrap();
    let db_path = temp.path().join("jobs.db");
    let pool = open_sqlite_pool(&db_path.to_string_lossy()).await.unwrap();
    let path = temp.path().join(".codex/sessions/session.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "first").unwrap();

    let validated = test_validated_codex_path(&path);
    let meta = SessionFileMetadata::from_validated_path(&validated).unwrap();
    assert!(!checkpoint_metadata_matches(&pool, &meta).await.unwrap());
    let hash = stream_content_hash(&validated.canonical).await.unwrap();
    record_success(&pool, &meta, Some(&hash)).await.unwrap();
    assert!(checkpoint_metadata_matches(&pool, &meta).await.unwrap());

    std::fs::write(&path, "second").unwrap();
    let changed = SessionFileMetadata::from_validated_path(&validated).unwrap();
    assert!(!checkpoint_metadata_matches(&pool, &changed).await.unwrap());
}

#[tokio::test]
async fn checkpoint_records_and_lists_errors() {
    let temp = tempfile::tempdir().unwrap();
    let db_path = temp.path().join("jobs.db");
    let pool = open_sqlite_pool(&db_path.to_string_lossy()).await.unwrap();
    let path = temp.path().join(".claude/projects/-tmp-axon/bad.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "{bad").unwrap();
    let validated = test_validated_claude_path(&path);
    let meta = SessionFileMetadata::from_validated_path(&validated).unwrap();

    record_error(&pool, &meta, "parse_failed", "parse failed: [REDACTED]")
        .await
        .unwrap();
    let errors = list_recent_errors(&pool, 10).await.unwrap();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].path_hash, meta.path_hash);
    assert_eq!(errors[0].provider, "claude");
    assert_eq!(errors[0].error_code, "parse_failed");
    assert!(!errors[0].error_redacted.contains("Bearer "));
}

#[tokio::test]
async fn session_watch_status_counts_checkpoints_and_errors() {
    let temp = tempfile::tempdir().unwrap();
    let db_path = temp.path().join("jobs.db");
    let pool = open_sqlite_pool(&db_path.to_string_lossy()).await.unwrap();
    let good = temp.path().join(".codex/sessions/good.jsonl");
    let bad = temp.path().join(".claude/projects/-tmp-axon/bad.jsonl");
    std::fs::create_dir_all(good.parent().unwrap()).unwrap();
    std::fs::create_dir_all(bad.parent().unwrap()).unwrap();
    std::fs::write(&good, "good").unwrap();
    std::fs::write(&bad, "bad").unwrap();
    let good_meta =
        SessionFileMetadata::from_validated_path(&test_validated_codex_path(&good)).unwrap();
    let bad_meta =
        SessionFileMetadata::from_validated_path(&test_validated_claude_path(&bad)).unwrap();

    record_success(&pool, &good_meta, Some("hash"))
        .await
        .unwrap();
    record_error(&pool, &bad_meta, "parse_failed", "parse failed")
        .await
        .unwrap();

    let status = watch_status(&pool, 5).await.unwrap();

    assert_eq!(status.checkpoint_count, 2);
    assert_eq!(status.error_count, 1);
    assert_eq!(status.recent_errors.len(), 1);
    assert!(
        checkpoint_success_exists_for_path_hash(&pool, &good_meta.path_hash)
            .await
            .unwrap()
    );
    assert!(
        !checkpoint_success_exists_for_path_hash(&pool, &bad_meta.path_hash)
            .await
            .unwrap()
    );
}

fn test_validated_codex_path(path: &Path) -> ValidatedSessionPath {
    test_validated_path(path, SessionProvider::Codex)
}

fn test_validated_claude_path(path: &Path) -> ValidatedSessionPath {
    test_validated_path(path, SessionProvider::Claude)
}

fn test_validated_path(path: &Path, provider: SessionProvider) -> ValidatedSessionPath {
    let canonical = path.canonicalize().unwrap();
    let basename = path.file_name().unwrap().to_string_lossy().to_string();
    let path_hash = format!("test-{}", basename);
    ValidatedSessionPath {
        canonical,
        provider,
        relative: PathBuf::from(&basename),
        basename: basename.clone(),
        redacted_display: format!("{}:{basename}:{path_hash}", provider.as_str()),
        path_hash,
    }
}
