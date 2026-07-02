use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axon_jobs::boundary::{FakeJobWatchStore, JobStore};
use axon_ledger::store::FakeLedgerStore;
use axon_vectors::store::FakeVectorStore;

use super::*;
use crate::context::{ServiceContext, TargetLocalSourceRuntime};
use crate::test_support::NoopServiceRuntime;
use axon_api::source::*;
use axon_embedding::fake::FakeEmbeddingProvider;

#[derive(Default)]
struct CaptureEvents {
    events: Mutex<Vec<CodeSearchWatchEvent>>,
}

impl CodeSearchWatchEventSink for CaptureEvents {
    fn emit(&self, event: CodeSearchWatchEvent) {
        self.events.lock().expect("events").push(event);
    }
}

fn init_git_repo(root: &Path) {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["init", "-q"])
        .status()
        .expect("git init");
}

fn target_context(
    source_jobs: Arc<FakeJobWatchStore>,
    vectors: Arc<FakeVectorStore>,
) -> ServiceContext {
    let cfg = Arc::new(axon_core::config::Config::test_default());
    ServiceContext::from_runtime(cfg, Arc::new(NoopServiceRuntime))
        .with_target_local_source_runtime(TargetLocalSourceRuntime::new(
            source_jobs,
            Arc::new(FakeLedgerStore::new()),
            Arc::new(FakeEmbeddingProvider::new("fake-embedding", 8)),
            vectors,
            ProviderId::new("fake-embedding"),
            "fake-embedding",
            8,
        ))
}

#[test]
fn watcher_event_storm_coalesces_to_one_refresh() {
    let root = PathBuf::from("/workspace/repo");
    let mut dirty = BTreeMap::new();
    let old_enough = Instant::now() - Duration::from_secs(5);

    for _ in 0..100 {
        mark_dirty_root(&mut dirty, root.clone(), old_enough);
    }

    let refreshes_started = due_dirty_roots(&dirty, Duration::from_secs(1)).len();

    assert_eq!(refreshes_started, 1);
    assert_eq!(dirty.get(&root).map(|state| state.paths), Some(100));
}

#[tokio::test]
async fn watch_refresh_stays_on_legacy_until_target_search_is_wired() {
    let repo = tempfile::tempdir().expect("repo");
    init_git_repo(repo.path());
    tokio::fs::write(
        repo.path().join("lib.rs"),
        "pub fn answer() -> i32 { 42 }\n",
    )
    .await
    .expect("source file");
    let source_jobs = Arc::new(FakeJobWatchStore::new());
    let vectors = Arc::new(FakeVectorStore::new("fake-vector"));
    let ctx = target_context(source_jobs.clone(), vectors.clone());
    let events = CaptureEvents::default();

    let err = refresh_code_search_watch_root(&ctx, &events, repo.path(), "file_change")
        .await
        .expect_err("legacy refresh lacks sqlite runtime in this unit test");
    assert!(err.to_string().contains("SQLite service runtime"));

    assert!(
        events
            .events
            .lock()
            .expect("events")
            .iter()
            .any(|event| matches!(event, CodeSearchWatchEvent::RefreshStarted { .. }))
    );
    assert!(vectors.calls().await.is_empty());

    let jobs = JobStore::list(
        source_jobs.as_ref(),
        JobListRequest {
            status: None,
            kind: Some(JobKind::Source),
            source_id: None,
            watch_id: None,
            limit: Some(10),
            cursor: None,
        },
    )
    .await
    .expect("jobs");
    assert!(jobs.items.is_empty());
}
