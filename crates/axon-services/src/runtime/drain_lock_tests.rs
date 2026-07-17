use super::*;

fn lock_path(dir: &tempfile::TempDir) -> PathBuf {
    drain_lock_path(dir.path())
}

#[tokio::test]
async fn holder_excludes_second_holder_until_dropped() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = lock_path(&dir);

    let first = WorkerDrainLock::try_hold(&path)
        .await
        .expect("first try_hold")
        .expect("first holder acquires");

    let second = WorkerDrainLock::try_hold(&path)
        .await
        .expect("second try_hold");
    assert!(second.is_none(), "lock must be exclusive while held");
    assert!(WorkerDrainLock::is_held(&path).await.expect("is_held"));

    drop(first);

    let third = WorkerDrainLock::try_hold(&path).await.expect("third");
    assert!(third.is_some(), "lock must be reacquirable after release");
}

#[tokio::test]
async fn is_held_probe_does_not_keep_the_lock() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = lock_path(&dir);

    assert!(!WorkerDrainLock::is_held(&path).await.expect("probe"));
    // The probe above must have released — acquiring now must succeed.
    let holder = WorkerDrainLock::try_hold(&path).await.expect("try_hold");
    assert!(holder.is_some());
}

#[tokio::test]
async fn lock_file_is_created_on_first_use() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = lock_path(&dir);
    assert!(!path.exists());
    let _holder = WorkerDrainLock::try_hold(&path).await.expect("try_hold");
    assert!(path.exists(), "lock database file should be created");
}
