use super::*;
use crate::context::{ServiceContext, TargetLocalSourceRuntime};
use crate::test_support::NoopServiceRuntime;
use crate::types::{CodeSearchCaller, CodeSearchFreshness, CodeSearchResult};
use axon_api::source::*;
use axon_code_index::FreshnessWarning;
use axon_core::config::Config;
use axon_embedding::fake::FakeEmbeddingProvider;
use axon_jobs::boundary::{FakeJobWatchStore, JobStore};
use axon_ledger::store::FakeLedgerStore;
use axon_vectors::store::FakeVectorStore;
use std::process::Command;
use std::sync::Arc;

// ── code-search backend selection ─────────────────────────────────────────

#[test]
fn code_search_refresh_backend_defaults_to_legacy() {
    assert_eq!(
        CodeSearchRefreshBackend::from_config_value(None).unwrap(),
        CodeSearchRefreshBackend::LegacyCodeIndex
    );
    assert_eq!(
        CodeSearchRefreshBackend::from_config_value(Some("")).unwrap(),
        CodeSearchRefreshBackend::LegacyCodeIndex
    );
}

#[test]
fn code_search_refresh_backend_accepts_explicit_legacy_aliases() {
    for value in ["legacy", "legacy-code-index", "code-index"] {
        assert_eq!(
            CodeSearchRefreshBackend::from_config_value(Some(value)).unwrap(),
            CodeSearchRefreshBackend::LegacyCodeIndex
        );
    }
}

#[test]
fn code_search_refresh_backend_accepts_explicit_target_gate() {
    for value in ["target-local", "target-local-source", "source-local"] {
        assert_eq!(
            CodeSearchRefreshBackend::from_config_value(Some(value)).unwrap(),
            CodeSearchRefreshBackend::TargetLocalSource
        );
    }
}

#[test]
fn code_search_refresh_backend_rejects_unknown_values() {
    let err = CodeSearchRefreshBackend::from_config_value(Some("target")).unwrap_err();
    assert!(err.contains("AXON_CODE_SEARCH_REFRESH_BACKEND"));
    assert!(err.contains("target"));
}

#[tokio::test]
async fn target_code_search_refresh_uses_local_source_runtime_when_available() {
    let repo = tempfile::tempdir().expect("repo");
    Command::new("git")
        .arg("-C")
        .arg(repo.path())
        .args(["init", "-q"])
        .status()
        .expect("git init");
    std::fs::write(
        repo.path().join("lib.rs"),
        "pub fn answer() -> i32 { 42 }\n",
    )
    .expect("source file");

    let cfg = Arc::new(Config::test_default());
    let service_jobs = Arc::new(NoopServiceRuntime);
    let source_jobs = Arc::new(FakeJobWatchStore::new());
    let ledger = Arc::new(FakeLedgerStore::new());
    let embedder = Arc::new(FakeEmbeddingProvider::new("fake-embedding", 8));
    let vectors = Arc::new(FakeVectorStore::new("fake-vector"));
    let ctx = ServiceContext::from_runtime(cfg, service_jobs).with_target_local_source_runtime(
        TargetLocalSourceRuntime::new(
            source_jobs.clone(),
            ledger,
            embedder,
            vectors.clone(),
            ProviderId::new("fake-embedding"),
            "fake-embedding",
            8,
        ),
    );

    let refreshed = refresh_code_search_index_with_backend(
        &ctx,
        Some(repo.path()),
        CodeSearchCaller::Cli,
        CodeSearchRefreshBackend::TargetLocalSource,
        None,
    )
    .await
    .expect("target refresh");

    assert_eq!(refreshed.freshness.status, "fresh");
    assert_eq!(refreshed.freshness.warning, None);
    assert_eq!(refreshed.freshness.indexed_files, 1);
    assert_eq!(refreshed.freshness.removed_files, 0);
    assert_eq!(
        vectors.calls().await,
        vec!["ensure_collection", "upsert", "mark_generation_committed"]
    );
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
    assert_eq!(jobs.items.len(), 1);
}
#[test]
fn code_search_result_marks_snippets_untrusted() {
    let result = CodeSearchResult {
        query: "find parser".to_string(),
        content_trust: "untrusted_local_code".to_string(),
        results: vec![],
        freshness: CodeSearchFreshness {
            status: "skipped".to_string(),
            warning: None,
            indexed_files: 0,
            removed_files: 0,
        },
    };
    let value = serde_json::to_value(result).unwrap();
    assert_eq!(
        value["content_trust"].as_str(),
        Some("untrusted_local_code")
    );
}

#[test]
fn code_search_missing_index_freshness_warns() {
    let freshness = code_search_missing_index_freshness(CodeSearchFreshness {
        status: "skipped".to_string(),
        warning: None,
        indexed_files: 0,
        removed_files: 0,
    });
    assert_eq!(freshness.status, "stale");
    assert_eq!(
        freshness.warning.as_deref(),
        Some("no committed code index; rerun without --no-freshness to build it")
    );
}

#[test]
fn code_search_freshness_marks_warning_branches_stale() {
    for warning in [
        FreshnessWarning::AlreadyRunning,
        FreshnessWarning::TimedOut { timeout_ms: 5000 },
        FreshnessWarning::Failed {
            error: "embed failed".to_string(),
        },
    ] {
        let freshness = code_search_freshness("fresh", Some(warning), 0, 0);
        assert_eq!(freshness.status, "stale");
        assert!(freshness.warning.is_some());
    }

    let skipped = code_search_freshness("skipped", None, 0, 0);
    assert_eq!(skipped.status, "skipped");
    assert!(skipped.warning.is_none());
}

#[test]
fn code_search_allowed_roots_error_does_not_leak_absolute_path() {
    let message = code_search_outside_allowed_roots_message();
    assert_eq!(
        message,
        "code_search cwd is outside AXON_CODE_SEARCH_ALLOWED_ROOTS"
    );
    assert!(!message.contains("/"));
}

#[tokio::test]
async fn code_search_resolution_errors_do_not_echo_probe_paths() {
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("secret-checkout");
    let err = resolve_code_search_root(Some(&missing), CodeSearchCaller::Cli)
        .await
        .unwrap_err()
        .to_string();
    assert_eq!(err, "code_search cwd could not be resolved");
    assert!(!err.contains(dir.path().to_string_lossy().as_ref()));
}

#[tokio::test]
async fn code_search_project_origin_is_checkout_scoped() {
    let a = tempfile::tempdir().expect("tempdir a");
    let b = tempfile::tempdir().expect("tempdir b");
    let origin_a = code_search_project_origin(a.path()).await;
    let origin_b = code_search_project_origin(b.path()).await;
    assert_ne!(origin_a, origin_b);
}
