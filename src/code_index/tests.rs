use super::*;
use tempfile::tempdir;

#[tokio::test]
async fn manifest_uses_metadata_fast_path_for_unchanged_files() {
    let dir = tempdir().unwrap();
    tokio::fs::write(dir.path().join("lib.rs"), "pub fn one() {}\n")
        .await
        .unwrap();
    let store = store::CodeIndexStore::open_in_memory().await.unwrap();
    store.init_schema().await.unwrap();
    let identity = CodeIndexIdentity::for_test(dir.path(), "origin:axon", "axon", "tei-test");

    let first = manifest::build_manifest(&store, &identity, manifest::ManifestOptions::default())
        .await
        .unwrap();
    assert_eq!(first.files.len(), 1);
    assert_eq!(first.files[0].relative_path, "lib.rs");
    assert!(first.files[0].hash.is_some());
    store.commit_manifest(&identity, &first).await.unwrap();

    let second = manifest::build_manifest(&store, &identity, manifest::ManifestOptions::default())
        .await
        .unwrap();
    assert_eq!(second.files[0].hash, first.files[0].hash);
    assert_eq!(second.files[0].hash_source, manifest::HashSource::Stored);
}

#[tokio::test]
async fn sentinel_pending_file_is_modified_even_when_hash_matches() {
    let dir = tempdir().unwrap();
    tokio::fs::write(dir.path().join("lib.rs"), "pub fn one() {}\n")
        .await
        .unwrap();
    let store = store::CodeIndexStore::open_in_memory().await.unwrap();
    store.init_schema().await.unwrap();
    let identity = CodeIndexIdentity::for_test(dir.path(), "origin:axon", "axon", "tei-test");
    let manifest =
        manifest::build_manifest(&store, &identity, manifest::ManifestOptions::default())
            .await
            .unwrap();
    store.commit_manifest(&identity, &manifest).await.unwrap();
    store.mark_file_pending(&identity, "lib.rs").await.unwrap();

    let diff = store.diff_manifest(&identity, &manifest).await.unwrap();
    assert_eq!(diff.modified_paths(), vec!["lib.rs"]);
}

#[test]
fn path_prefix_rejects_absolute_parent_and_escape_segments() {
    assert!(config::validate_path_prefix("/etc").is_err());
    assert!(config::validate_path_prefix("../src").is_err());
    assert!(config::validate_path_prefix("src/../../secrets").is_err());
    assert_eq!(
        config::validate_path_prefix("src/vector").unwrap(),
        Some("src/vector/".to_string())
    );
}
