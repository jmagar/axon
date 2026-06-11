use super::*;
use crate::core::config::Config;
use crate::ingest::sessions::checkpoint::{
    SessionFileMetadata, checkpoint_success_exists_for_path_hash, list_recent_errors,
    record_success,
};
use crate::ingest::sessions::watch::validate::SessionWatchRoots;
use crate::ingest::sessions::{IngestSessionsPreparedRequest, PreparedSessionDoc};
use crate::jobs::backend::{BackendResult, JobKind, JobPayload, JobSidecarPayload};
use crate::services::context::ServiceContext;
use crate::services::runtime::ServiceJobRuntime;
use async_trait::async_trait;
use httpmock::Method::POST;
use httpmock::MockServer;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use uuid::Uuid;

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

#[test]
fn collect_watch_dirs_skips_symlinks_and_includes_nested_dirs() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".codex/sessions");
    let nested = root.join("2026/06/11");
    std::fs::create_dir_all(&nested).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&nested, root.join("link-to-nested")).unwrap();

    let dirs = collect_watch_dirs(&root).unwrap();

    assert!(dirs.contains(&root.canonicalize().unwrap()));
    assert!(dirs.contains(&root.join("2026").canonicalize().unwrap()));
    assert!(dirs.contains(&root.join("2026/06").canonicalize().unwrap()));
    assert!(dirs.contains(&nested.canonicalize().unwrap()));
    #[cfg(unix)]
    assert!(!dirs.contains(&root.join("link-to-nested")));
}

#[test]
fn watch_targets_accepts_single_file_by_watching_parent() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join(".codex/sessions");
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join("one.jsonl");
    std::fs::write(&file, "{}\n").unwrap();

    let options = test_watch_options(Some(file.clone()));
    let cfg = Config::default();
    let roots = SessionWatchRoots::for_home(temp.path());
    let targets = watch_targets(&cfg, &roots, &options).unwrap();

    assert_eq!(targets.len(), 1);
    match &targets[0] {
        WatchTarget::File { path, parent } => {
            assert_eq!(path, &file.canonicalize().unwrap());
            assert_eq!(parent, &root.canonicalize().unwrap());
        }
        other => panic!("expected file target, got {other:?}"),
    }
}

#[test]
fn default_watch_targets_respect_provider_filters() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(temp.path().join(".claude/projects")).unwrap();
    std::fs::create_dir_all(temp.path().join(".codex/sessions")).unwrap();
    std::fs::create_dir_all(temp.path().join(".gemini/history")).unwrap();

    let cfg = Config {
        sessions_codex: true,
        ..Config::default()
    };
    let roots = SessionWatchRoots::for_home(temp.path());
    let options = test_watch_options(None);
    let targets = watch_targets(&cfg, &roots, &options).unwrap();

    assert_eq!(targets.len(), 1);
    assert!(targets[0].root().ends_with(".codex/sessions"));
}

#[tokio::test]
async fn process_stable_file_skips_unchanged_checkpoint() {
    let temp = tempfile::tempdir().unwrap();
    let db_path = temp.path().join("jobs.db");
    let pool = crate::jobs::store::open_sqlite_pool(&db_path.to_string_lossy())
        .await
        .unwrap();
    let root = temp.path().join(".codex/sessions");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("session.jsonl");
    std::fs::write(
        &path,
        serde_json::json!({
            "type": "response_item",
            "payload": {
                "role": "user",
                "content": [{ "type": "input_text", "text": "already indexed" }]
            }
        })
        .to_string()
            + "\n",
    )
    .unwrap();
    let validated = test_validated_codex_path(&path);
    let meta = SessionFileMetadata::from_validated_path(&validated).unwrap();
    record_success(&pool, &meta, None).await.unwrap();

    let cfg = Config::default();
    let outcome = process_session_file_for_watch(&cfg, &pool, &validated, WatchOutputMode::quiet())
        .await
        .unwrap();

    assert_eq!(outcome, ProcessOutcome::SkippedUnchanged);
}

#[tokio::test]
async fn process_stable_file_records_parse_error_without_panic() {
    let temp = tempfile::tempdir().unwrap();
    let db_path = temp.path().join("jobs.db");
    let pool = crate::jobs::store::open_sqlite_pool(&db_path.to_string_lossy())
        .await
        .unwrap();
    let root = temp.path().join(".claude/projects/-tmp-axon");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("bad.jsonl");
    std::fs::write(&path, "{not-json\n").unwrap();

    let cfg = Config::default();
    let validated = test_validated_claude_path(&path);
    let outcome = process_session_file_for_watch(&cfg, &pool, &validated, WatchOutputMode::quiet())
        .await
        .unwrap();

    assert_eq!(outcome, ProcessOutcome::NoContent);
}

#[tokio::test]
async fn upload_prepared_sessions_requires_accepted_job_response() {
    let server = MockServer::start_async().await;
    let mock = server
        .mock_async(|when, then| {
            when.method(POST)
                .path("/v1/ingest/sessions/prepared")
                .header("authorization", "Bearer test-token");
            then.status(202)
                .header("content-type", "application/json")
                .json_body(serde_json::json!({
                    "result": { "job_id": "job-123" }
                }));
        })
        .await;

    let label = upload_prepared_sessions_to_server_with_auth(
        &server.base_url(),
        "test-token",
        IngestSessionsPreparedRequest {
            docs: vec![PreparedSessionDoc {
                url: "file:///tmp/session.jsonl".to_string(),
                title: Some("session".to_string()),
                text: "hello from a session".to_string(),
                session_platform: "codex".to_string(),
                session_project: None,
                session_date: None,
                session_turn_count: Some(1),
                session_file: "session.jsonl".to_string(),
                extra: serde_json::json!({}),
            }],
            project: None,
            collection: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(label, "job-123");
    mock.assert_async().await;
}

#[tokio::test]
async fn upload_prepared_sessions_rejects_success_without_job_id() {
    let server = MockServer::start_async().await;
    let mock = server
        .mock_async(|when, then| {
            when.method(POST)
                .path("/v1/ingest/sessions/prepared")
                .header("authorization", "Bearer test-token");
            then.status(200)
                .header("content-type", "application/json")
                .json_body(serde_json::json!({ "ok": true }));
        })
        .await;

    let error = upload_prepared_sessions_to_server_with_auth(
        &server.base_url(),
        "test-token",
        IngestSessionsPreparedRequest {
            docs: vec![PreparedSessionDoc {
                url: "file:///tmp/session.jsonl".to_string(),
                title: Some("session".to_string()),
                text: "hello from a session".to_string(),
                session_platform: "codex".to_string(),
                session_project: None,
                session_date: None,
                session_turn_count: Some(1),
                session_file: "session.jsonl".to_string(),
                extra: serde_json::json!({}),
            }],
            project: None,
            collection: None,
        },
    )
    .await
    .unwrap_err()
    .to_string();

    assert!(error.contains("202 Accepted"));
    mock.assert_async().await;
}

#[tokio::test]
async fn remote_watch_acceptance_records_upload_checkpoint() {
    let server = MockServer::start_async().await;
    let mock = server
        .mock_async(|when, then| {
            when.method(POST)
                .path("/v1/ingest/sessions/prepared")
                .header("authorization", "Bearer remote-token");
            then.status(202)
                .header("content-type", "application/json")
                .json_body(serde_json::json!({
                    "result": { "job_id": "remote-job-123" }
                }));
        })
        .await;

    let temp = tempfile::tempdir().unwrap();
    let db_path = temp.path().join("jobs.db");
    let pool = crate::jobs::store::open_sqlite_pool(&db_path.to_string_lossy())
        .await
        .unwrap();
    let root = temp.path().join(".codex/sessions");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("remote.jsonl");
    std::fs::write(
        &path,
        serde_json::json!({
            "type": "response_item",
            "payload": {
                "role": "user",
                "content": [{ "type": "input_text", "text": "remote acceptance is not completion" }]
            }
        })
        .to_string()
            + "\n",
    )
    .unwrap();

    let cfg = Config::default();
    let runtime = Arc::new(AckingRuntime::default());
    let service_context = ServiceContext::from_runtime(Arc::new(cfg.clone()), runtime);
    let mut options = test_watch_options(None);
    options.upload_to_server = true;
    options.upload_server_url = Some(server.base_url());
    options.upload_token = Some("remote-token".to_string());

    let validated = test_validated_codex_path(&path);
    let outcomes = process_session_batch_for_watch(
        &cfg,
        &service_context,
        &pool,
        vec![validated.clone()],
        &options,
    )
    .await
    .unwrap();

    assert!(matches!(
        outcomes.as_slice(),
        [ProcessOutcome::RemoteAccepted { job }] if job == "remote-job-123"
    ));
    assert!(
        checkpoint_success_exists_for_path_hash(&pool, &validated.path_hash)
            .await
            .unwrap()
    );
    mock.assert_async().await;
}

#[tokio::test]
async fn project_filtered_watch_skip_does_not_record_success_checkpoint() {
    let temp = tempfile::tempdir().unwrap();
    let db_path = temp.path().join("jobs.db");
    let pool = crate::jobs::store::open_sqlite_pool(&db_path.to_string_lossy())
        .await
        .unwrap();
    let root = temp.path().join(".codex/sessions/2026/06/11");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("filtered.jsonl");
    std::fs::write(
        &path,
        serde_json::json!({
            "type": "session_meta",
            "payload": { "cwd": "/tmp/other-project", "model": "gpt-5" }
        })
        .to_string()
            + "\n"
            + &serde_json::json!({
                "type": "response_item",
                "payload": {
                    "role": "user",
                    "content": [{ "type": "input_text", "text": "this should be filtered" }]
                }
            })
            .to_string()
            + "\n",
    )
    .unwrap();

    let cfg = Config {
        sessions_project: Some("axon".to_string()),
        ..Config::default()
    };
    let runtime = Arc::new(AckingRuntime::default());
    let service_context = ServiceContext::from_runtime(Arc::new(cfg.clone()), runtime);
    let options = test_watch_options(None);
    let validated = test_validated_codex_path(&path);

    let outcomes = process_session_batch_for_watch(
        &cfg,
        &service_context,
        &pool,
        vec![validated.clone()],
        &options,
    )
    .await
    .unwrap();

    assert_eq!(outcomes, vec![ProcessOutcome::SkippedFiltered]);
    assert!(
        !checkpoint_success_exists_for_path_hash(&pool, &validated.path_hash)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn local_watch_sync_failure_records_error_without_enqueue_success() {
    let temp = tempfile::tempdir().unwrap();
    let db_path = temp.path().join("jobs.db");
    let pool = crate::jobs::store::open_sqlite_pool(&db_path.to_string_lossy())
        .await
        .unwrap();
    let root = temp.path().join(".codex/sessions");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("sync-fail.jsonl");
    std::fs::write(
        &path,
        serde_json::json!({
            "type": "response_item",
            "payload": {
                "role": "user",
                "content": [{ "type": "input_text", "text": "must not checkpoint on enqueue" }]
            }
        })
        .to_string()
            + "\n",
    )
    .unwrap();
    let cfg = Config {
        collection: "invalid/collection".to_string(),
        ..Config::default()
    };
    let runtime = Arc::new(AckingRuntime::default());
    let service_context = ServiceContext::from_runtime(Arc::new(cfg.clone()), runtime.clone());
    let options = test_watch_options(None);
    let validated = test_validated_codex_path(&path);

    let outcomes = process_session_batch_for_watch(
        &cfg,
        &service_context,
        &pool,
        vec![validated.clone()],
        &options,
    )
    .await
    .unwrap();

    assert!(matches!(
        outcomes.as_slice(),
        [ProcessOutcome::RetryableFailure(_)]
    ));
    assert_eq!(runtime.enqueued.load(Ordering::Relaxed), 0);
    assert!(
        !checkpoint_success_exists_for_path_hash(&pool, &validated.path_hash)
            .await
            .unwrap()
    );
    let errors = list_recent_errors(&pool, 10).await.unwrap();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].path_hash, validated.path_hash);
}

#[test]
fn max_processing_concurrency_is_clamped_for_batch_preparation() {
    let mut options = test_watch_options(None);
    options.max_processing_concurrency = 0;
    assert_eq!(effective_processing_concurrency(&options), 1);
    options.max_processing_concurrency = 7;
    assert_eq!(effective_processing_concurrency(&options), 7);
}

#[test]
fn redact_error_detail_removes_home_paths_and_tokens() {
    let home = std::env::var("HOME").unwrap();
    let detail = redact_error_detail(&format!(
        "failed to read {home}/.codex/sessions/private.jsonl bearer secret-token"
    ));

    assert!(!detail.contains(&home));
    assert!(!detail.contains("secret-token"));
    assert!(detail.contains("[REDACTED-HOME]") || detail.contains("[REDACTED-SESSION-ROOT]"));
}

fn test_watch_options(path: Option<PathBuf>) -> SessionWatchOptions {
    SessionWatchOptions {
        path,
        debounce: Duration::from_millis(750),
        settle: Duration::from_millis(500),
        max_retries: 5,
        max_batch_docs: 50,
        max_processing_concurrency: 2,
        rescan_cooldown: Duration::from_secs(5),
        initial_scan: false,
        upload_to_server: false,
        upload_server_url: None,
        upload_token: None,
        verbose_paths: false,
        json: false,
    }
}

#[derive(Default)]
struct AckingRuntime {
    enqueued: AtomicBoolCounter,
}

#[derive(Default)]
struct AtomicBoolCounter(std::sync::atomic::AtomicUsize);

impl AtomicBoolCounter {
    fn fetch_add(&self, value: usize, ordering: Ordering) {
        self.0.fetch_add(value, ordering);
    }

    fn load(&self, ordering: Ordering) -> usize {
        self.0.load(ordering)
    }
}

#[async_trait]
impl ServiceJobRuntime for AckingRuntime {
    fn mode_name(&self) -> &'static str {
        "acking-test"
    }

    async fn enqueue(&self, _payload: JobPayload) -> BackendResult<Uuid> {
        self.enqueued.fetch_add(1, Ordering::Relaxed);
        Ok(Uuid::new_v4())
    }

    async fn enqueue_with_sidecar(
        &self,
        _payload: JobPayload,
        _sidecar: JobSidecarPayload,
    ) -> BackendResult<Uuid> {
        self.enqueued.fetch_add(1, Ordering::Relaxed);
        Ok(Uuid::new_v4())
    }

    async fn wait_for_job(&self, _id: Uuid, _kind: JobKind) -> BackendResult<String> {
        Ok("completed".to_string())
    }

    async fn job_errors(&self, _id: Uuid, _kind: JobKind) -> BackendResult<Option<String>> {
        Ok(None)
    }

    async fn has_active_jobs(&self, _kind: JobKind) -> BackendResult<bool> {
        Ok(false)
    }

    async fn list_jobs(
        &self,
        _kind: JobKind,
        _limit: i64,
        _offset: i64,
    ) -> Result<Vec<crate::services::types::ServiceJob>, Box<dyn Error + Send + Sync>> {
        Ok(vec![])
    }

    async fn job_status(
        &self,
        _kind: JobKind,
        _id: Uuid,
    ) -> Result<Option<crate::services::types::ServiceJob>, Box<dyn Error + Send + Sync>> {
        Ok(None)
    }

    async fn cancel_job(
        &self,
        _kind: JobKind,
        _id: Uuid,
    ) -> Result<bool, Box<dyn Error + Send + Sync>> {
        Ok(false)
    }

    async fn cleanup_jobs(&self, _kind: JobKind) -> Result<u64, Box<dyn Error + Send + Sync>> {
        Ok(0)
    }

    async fn clear_jobs(&self, _kind: JobKind) -> Result<u64, Box<dyn Error + Send + Sync>> {
        Ok(0)
    }

    async fn recover_jobs(
        &self,
        _kind: JobKind,
        _stale_threshold_ms: i64,
    ) -> Result<u64, Box<dyn Error + Send + Sync>> {
        Ok(0)
    }

    async fn count_jobs(&self, _kind: JobKind) -> Result<i64, Box<dyn Error + Send + Sync>> {
        Ok(0)
    }

    async fn count_jobs_by_status(
        &self,
        _kind: JobKind,
    ) -> Result<
        std::collections::HashMap<crate::jobs::status::JobStatus, i64>,
        Box<dyn Error + Send + Sync>,
    > {
        Ok(std::collections::HashMap::new())
    }
}

fn test_validated_codex_path(path: &Path) -> ValidatedSessionPath {
    test_validated_path(path, validate::SessionProvider::Codex)
}

fn test_validated_claude_path(path: &Path) -> ValidatedSessionPath {
    test_validated_path(path, validate::SessionProvider::Claude)
}

fn test_validated_path(path: &Path, provider: validate::SessionProvider) -> ValidatedSessionPath {
    let canonical = path.canonicalize().unwrap();
    let basename = path.file_name().unwrap().to_string_lossy().to_string();
    let path_hash = format!("watch-test-{basename}");
    ValidatedSessionPath {
        canonical,
        provider,
        relative: PathBuf::from(&basename),
        basename: basename.clone(),
        redacted_display: format!("{}:{basename}:{}", provider.as_str(), &path_hash[..12]),
        path_hash,
    }
}
