use super::*;
use crate::ingest::sessions::watch::validate::SessionWatchRoots;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[test]
fn pending_files_debounce_and_coalesce_same_path() {
    let mut pending = PendingFiles::default();
    let now = Instant::now();
    let path = PathBuf::from("/tmp/a.jsonl");

    assert!(pending.push(path.clone(), now));
    assert!(pending.push(path.clone(), now + Duration::from_millis(100)));
    assert_eq!(pending.files.len(), 1);
    assert_eq!(pending.coalesced_events, 1);
    assert!(
        pending
            .debounced_paths(now + Duration::from_millis(849), Duration::from_millis(750))
            .is_empty()
    );
    assert_eq!(
        pending.debounced_paths(now + Duration::from_millis(850), Duration::from_millis(750)),
        vec![path]
    );
}

#[test]
fn pending_files_requeue_resets_stability_and_honors_retry_cap() {
    let mut pending = PendingFiles::default();
    let now = Instant::now();
    let path = PathBuf::from("/tmp/a.jsonl");

    assert!(pending.push(path.clone(), now));
    assert!(pending.requeue(path.clone(), now + Duration::from_secs(1), 2));
    assert!(pending.requeue(path.clone(), now + Duration::from_secs(2), 2));
    assert!(!pending.requeue(path, now + Duration::from_secs(3), 2));
}

#[test]
fn pending_overflow_requests_rescan() {
    let mut pending = PendingFiles::default();
    for i in 0..MAX_PENDING_FILES {
        assert!(pending.push(PathBuf::from(format!("/tmp/{i}.jsonl")), Instant::now()));
    }
    assert!(!pending.push(PathBuf::from("/tmp/overflow.jsonl"), Instant::now()));
}

#[test]
fn remove_event_sets_prune_flag_for_supported_path() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".codex/sessions");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("gone.jsonl");
    let roots = SessionWatchRoots::for_home(temp.path());
    let target = WatchTarget::Directory(root.clone());
    let mut pending = PendingFiles::default();
    let overflow = AtomicBool::new(false);
    let prune = AtomicBool::new(false);

    handle_remove_path(&path, &roots, &[target], &mut pending, &overflow, &prune);

    assert!(!overflow.load(Ordering::Relaxed));
    assert!(prune.load(Ordering::Relaxed));
}
