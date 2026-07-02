use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use axon_api::source::*;
use uuid::Uuid;

use crate::SourceAdapter;
use crate::local::LocalSourceAdapter;

#[tokio::test]
async fn local_adapter_declares_task1_scopes_and_accepts_options() {
    let adapter = LocalSourceAdapter::new();

    let capability = adapter.capabilities().await.unwrap();
    assert_eq!(capability.adapter.name, "local");
    assert_eq!(capability.source_kind, SourceKind::Local);
    assert_eq!(capability.default_scope, SourceScope::Directory);
    for scope in [
        SourceScope::File,
        SourceScope::Directory,
        SourceScope::Workspace,
        SourceScope::Repo,
        SourceScope::Map,
    ] {
        assert!(
            capability.scopes.contains(&scope),
            "missing local scope {scope:?}"
        );
    }

    let mut plan = source_plan(temp_source_dir(), SourceScope::Directory);
    plan.route.validated_options.values = local_options();

    adapter
        .discover(&plan)
        .await
        .expect("task1 local options should validate");
}

#[tokio::test]
async fn local_adapter_rejects_unknown_options() {
    let adapter = LocalSourceAdapter::new();
    let mut plan = source_plan(temp_source_dir(), SourceScope::Directory);
    plan.route
        .validated_options
        .values
        .insert("surprise".to_string(), "nope".into());

    let err = adapter
        .discover(&plan)
        .await
        .expect_err("unknown local options should fail validation");

    assert_eq!(err.code.0, "adapter.local.option.unsupported");
    assert_eq!(err.stage, axon_error::ErrorStage::Routing);
}

#[tokio::test]
async fn local_file_discovery_uses_public_stable_identity() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    let file_path = root.join("notes.md");
    fs::write(&file_path, "# local").unwrap();

    let plan = source_plan(file_path, SourceScope::File);
    let manifest = adapter.discover(&plan).await.unwrap();

    assert_eq!(manifest.items.len(), 1);
    let item = &manifest.items[0];
    assert_eq!(item.source_item_key, SourceItemKey::from("notes.md"));
    assert_eq!(
        item.canonical_uri,
        format!("{}/notes.md", plan.route.source.canonical_uri)
    );
    assert!(!item.source_item_key.0.contains("/home/"));
    assert!(!item.canonical_uri.contains("/home/"));
}

#[tokio::test]
async fn local_directory_discovery_emits_sorted_relative_file_items() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("README.md"), "# Axon").unwrap();
    fs::write(root.join("src/lib.rs"), "pub fn local() {}").unwrap();

    let plan = source_plan(root, SourceScope::Directory);
    let manifest = adapter.discover(&plan).await.unwrap();
    let keys = manifest
        .items
        .iter()
        .map(|item| item.source_item_key.0.as_str())
        .collect::<Vec<_>>();

    assert_eq!(keys, vec!["README.md", "src/lib.rs"]);
    for item in &manifest.items {
        assert!(item.canonical_uri.starts_with("local://"));
        assert!(!item.canonical_uri.contains("/home/"));
        assert!(!item.source_item_key.0.starts_with('/'));
    }
}

#[tokio::test]
async fn local_adapter_acquires_and_normalizes_source_documents() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("README.md"), "# Axon").unwrap();
    fs::write(root.join("src/lib.rs"), "pub fn local() {}").unwrap();
    let plan = source_plan(root, SourceScope::Directory);
    let manifest = adapter.discover(&plan).await.unwrap();
    let diff = manifest_diff(&plan, manifest.items.clone());

    let acquisition = adapter.acquire(&plan, &diff).await.unwrap();
    assert_eq!(acquisition.fetched_items.len(), 2);
    assert!(matches!(
        acquisition.fetched_items[0].content_ref,
        ContentRef::InlineText { .. }
    ));

    let normalized = adapter.normalize(&plan, acquisition).await.unwrap();
    assert_eq!(normalized.data.len(), 2);
    let docs = normalized.data;
    assert_eq!(docs[0].source_id, SourceId::from("src_local_test"));
    assert_eq!(docs[0].source_item_key, SourceItemKey::from("README.md"));
    assert_eq!(docs[0].metadata["source_kind"], "local");
    assert_eq!(docs[0].metadata["source_adapter"], "local");
    assert_eq!(docs[0].metadata["source_scope"], "directory");
    assert_eq!(
        docs[0].metadata["item_canonical_uri"],
        docs[0].canonical_uri
    );
    assert!(!serde_json::to_string(&docs).unwrap().contains("/home/"));
}

#[tokio::test]
async fn local_document_ids_do_not_collide_for_lossy_path_shapes() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    fs::create_dir_all(root.join("a")).unwrap();
    fs::write(root.join("a/b.rs"), "pub fn nested() {}").unwrap();
    fs::write(root.join("a_b.rs"), "pub fn flat() {}").unwrap();
    let plan = source_plan(root, SourceScope::Directory);
    let manifest = adapter.discover(&plan).await.unwrap();
    let diff = manifest_diff(&plan, manifest.items.clone());
    let acquisition = adapter.acquire(&plan, &diff).await.unwrap();
    let normalized = adapter.normalize(&plan, acquisition).await.unwrap();
    let mut ids = normalized
        .data
        .iter()
        .map(|document| document.document_id.clone())
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();

    assert_eq!(ids.len(), 2);
}

#[tokio::test]
async fn local_adapter_rejects_diff_item_keys_that_escape_root() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    fs::write(root.join("README.md"), "# Axon").unwrap();
    fs::write(root.join("..outside.md"), "# not this").unwrap();
    let plan = source_plan(root, SourceScope::Directory);
    let mut item = adapter.discover(&plan).await.unwrap().items[0].clone();
    item.source_item_key = SourceItemKey::from("../..outside.md");
    let diff = manifest_diff(&plan, vec![item]);

    let err = adapter
        .acquire(&plan, &diff)
        .await
        .expect_err("escaped source item key must not be read");

    assert_eq!(err.code.0, "adapter.local.item_key.escape");
}

#[tokio::test]
async fn local_manifest_fingerprint_changes_for_same_size_file_edits() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    let file = root.join("README.md");
    fs::write(&file, "abcd").unwrap();
    let plan = source_plan(root, SourceScope::Directory);

    let first = adapter.discover(&plan).await.unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    fs::write(&file, "wxyz").unwrap();
    let second = adapter.discover(&plan).await.unwrap();

    assert_eq!(
        first.items[0].source_item_key,
        second.items[0].source_item_key
    );
    assert_ne!(first.items[0].content_hash, second.items[0].content_hash);
    assert!(second.items[0].mtime.is_some());
}

#[tokio::test]
async fn local_adapter_applies_include_exclude_gitignore_and_binary_policy() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::create_dir_all(root.join("target")).unwrap();
    fs::write(root.join(".gitignore"), "ignored.md\n").unwrap();
    fs::write(root.join("src/lib.rs"), "pub fn local() {}").unwrap();
    fs::write(root.join("README.md"), "# Axon").unwrap();
    fs::write(root.join("ignored.md"), "# ignored").unwrap();
    fs::write(root.join("target/generated.rs"), "pub fn generated() {}").unwrap();
    fs::write(root.join("image.png"), [0, 159, 146, 150]).unwrap();
    let mut plan = source_plan(root, SourceScope::Directory);
    plan.route.validated_options.values = local_options();

    let manifest = adapter.discover(&plan).await.unwrap();
    let keys = manifest
        .items
        .iter()
        .map(|item| item.source_item_key.0.as_str())
        .collect::<Vec<_>>();

    assert_eq!(keys, vec!["src/lib.rs"]);
}

#[tokio::test]
async fn local_include_globs_can_opt_into_default_pruned_directories() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    fs::create_dir_all(root.join("target")).unwrap();
    fs::write(root.join("target/generated.rs"), "pub fn generated() {}").unwrap();
    let mut plan = source_plan(root, SourceScope::Directory);
    plan.route.validated_options.values.insert(
        "include_globs".to_string(),
        vec!["target/generated.rs"].into(),
    );

    let manifest = adapter.discover(&plan).await.unwrap();
    let keys = manifest
        .items
        .iter()
        .map(|item| item.source_item_key.0.as_str())
        .collect::<Vec<_>>();

    assert_eq!(keys, vec!["target/generated.rs"]);
}

#[tokio::test]
async fn local_repo_scope_prunes_generated_and_lock_files() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    fs::create_dir_all(root.join(".git/objects")).unwrap();
    fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join(".git/config"), "[core]").unwrap();
    fs::write(root.join("node_modules/pkg/index.js"), "export {}").unwrap();
    fs::write(root.join("Cargo.lock"), "# lock").unwrap();
    fs::write(root.join("README.md"), "# Axon").unwrap();
    fs::write(root.join("src/lib.rs"), "pub fn local() {}").unwrap();

    let plan = source_plan(root, SourceScope::Repo);
    let manifest = adapter.discover(&plan).await.unwrap();
    let keys = manifest
        .items
        .iter()
        .map(|item| item.source_item_key.0.as_str())
        .collect::<Vec<_>>();

    assert_eq!(keys, vec!["README.md", "src/lib.rs"]);
}

#[tokio::test]
async fn local_repo_scope_respects_nested_gitignore_and_nested_globs() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    fs::create_dir_all(root.join(".git")).unwrap();
    fs::create_dir_all(root.join("src/deep")).unwrap();
    fs::write(root.join("src/.gitignore"), "ignored-dir/\n").unwrap();
    fs::create_dir_all(root.join("src/ignored-dir")).unwrap();
    fs::write(root.join("src/deep/mod.rs"), "pub mod deep;").unwrap();
    fs::write(root.join("src/ignored-dir/lib.rs"), "pub fn ignored() {}").unwrap();
    fs::write(root.join("README.md"), "# Axon").unwrap();
    let mut plan = source_plan(root, SourceScope::Repo);
    plan.route
        .validated_options
        .values
        .insert("include_globs".to_string(), vec!["src/**/*.rs"].into());
    plan.route
        .validated_options
        .values
        .insert("respect_gitignore".to_string(), true.into());

    let manifest = adapter.discover(&plan).await.unwrap();
    let keys = manifest
        .items
        .iter()
        .map(|item| item.source_item_key.0.as_str())
        .collect::<Vec<_>>();

    assert_eq!(keys, vec!["src/deep/mod.rs"]);
}

#[tokio::test]
async fn local_repo_scope_respects_gitignore_by_default() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    fs::create_dir_all(root.join(".git")).unwrap();
    fs::write(root.join(".gitignore"), "ignored.rs\n").unwrap();
    fs::write(root.join("ignored.rs"), "pub fn ignored() {}").unwrap();
    fs::write(root.join("visible.rs"), "pub fn visible() {}").unwrap();

    let plan = source_plan(root, SourceScope::Repo);
    let manifest = adapter.discover(&plan).await.unwrap();
    let keys = manifest
        .items
        .iter()
        .map(|item| item.source_item_key.0.as_str())
        .collect::<Vec<_>>();

    assert_eq!(keys, vec!["visible.rs"]);
}

#[tokio::test]
async fn local_binary_policy_metadata_keeps_manifest_but_skips_document_body() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    fs::write(root.join("image.png"), [0, 159, 146, 150]).unwrap();
    let mut plan = source_plan(root, SourceScope::Directory);
    plan.route.validated_options.values = binary_options("metadata");
    let manifest = adapter.discover(&plan).await.unwrap();
    let diff = manifest_diff(&plan, manifest.items.clone());

    let acquisition = adapter.acquire(&plan, &diff).await.unwrap();
    let normalized = adapter.normalize(&plan, acquisition).await.unwrap();

    assert_eq!(manifest.items.len(), 1);
    assert_eq!(
        manifest.items[0].content_kind,
        Some(ContentKind::BinaryMetadata)
    );
    assert!(normalized.data.is_empty());
}

#[tokio::test]
async fn local_binary_policy_include_acquires_inline_bytes() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    fs::write(root.join("image.png"), [0, 159, 146, 150]).unwrap();
    let mut plan = source_plan(root, SourceScope::Directory);
    plan.route.validated_options.values = binary_options("include");
    let manifest = adapter.discover(&plan).await.unwrap();
    let diff = manifest_diff(&plan, manifest.items.clone());

    let acquisition = adapter.acquire(&plan, &diff).await.unwrap();

    assert_eq!(acquisition.fetched_items.len(), 1);
    assert_eq!(
        manifest.items[0].content_kind,
        Some(ContentKind::BinaryMetadata)
    );
    assert!(matches!(
        acquisition.fetched_items[0].content_ref,
        ContentRef::InlineBytes { .. }
    ));
}

#[tokio::test]
async fn local_adapter_errors_do_not_leak_absolute_paths() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    let missing = root.join("missing.md");
    let plan = source_plan(missing, SourceScope::File);

    let err = adapter.discover(&plan).await.unwrap_err();
    let serialized = serde_json::to_string(&err).unwrap();

    assert!(!serialized.contains(root.to_string_lossy().as_ref()));
    assert!(!serialized.contains("/home/"));
    assert_eq!(
        err.details.get("path_hint").map(String::as_str),
        Some("missing.md")
    );
}

#[tokio::test]
async fn local_map_scope_discovers_manifest_but_acquires_no_documents() {
    let adapter = LocalSourceAdapter::new();
    let root = temp_source_dir();
    fs::write(root.join("README.md"), "# Axon").unwrap();
    let plan = source_plan(root, SourceScope::Map);
    let manifest = adapter.discover(&plan).await.unwrap();
    let diff = manifest_diff(&plan, manifest.items.clone());

    let acquisition = adapter.acquire(&plan, &diff).await.unwrap();
    let normalized = adapter.normalize(&plan, acquisition).await.unwrap();

    assert_eq!(manifest.items.len(), 1);
    assert!(normalized.data.is_empty());
}

fn local_options() -> MetadataMap {
    let mut values = MetadataMap::new();
    values.insert("include_globs".to_string(), vec!["**/*.rs"].into());
    values.insert("exclude_globs".to_string(), vec!["target/**"].into());
    values.insert("respect_gitignore".to_string(), true.into());
    values.insert("follow_symlinks".to_string(), false.into());
    values.insert("max_file_bytes".to_string(), 1024.into());
    values.insert("binary_policy".to_string(), "skip".into());
    values.insert("watch_policy".to_string(), "manual".into());
    values
}

fn binary_options(policy: &str) -> MetadataMap {
    let mut values = MetadataMap::new();
    values.insert("binary_policy".to_string(), policy.into());
    values
}

fn source_plan(path: PathBuf, scope: SourceScope) -> SourcePlan {
    let canonical_uri = format!("local://{}", slug(&path));
    SourcePlan {
        job_id: JobId::new(Uuid::from_u128(298)),
        request: SourceRequest::new(path.to_string_lossy().to_string()),
        route: RoutePlan {
            source: ResolvedSource {
                requested_uri: path.to_string_lossy().to_string(),
                canonical_uri: canonical_uri.clone(),
                source_id: SourceId::from("src_local_test"),
                source_kind: SourceKind::Local,
                display_name: "local test".to_string(),
                candidate_adapters: vec![AdapterCandidate {
                    adapter: AdapterRef {
                        name: "local".to_string(),
                        version: env!("CARGO_PKG_VERSION").to_string(),
                    },
                    supported_scopes: vec![scope],
                    confidence: 1.0,
                    reason: "test".to_string(),
                }],
                default_scope: scope,
                available_scopes: vec![scope],
                authority: AuthorityLevel::Inferred,
                confidence: 1.0,
                reason: "test".to_string(),
                authority_hint: None,
                warnings: Vec::new(),
            },
            adapter: AdapterRef {
                name: "local".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
            scope,
            provider_requirements: Vec::new(),
            credential_requirements: Vec::new(),
            execution_affinity: ExecutionAffinity::Worker,
            safety_class: SafetyClass::LocalFilesystem,
            option_schema_id: "adapter:local:options:v1".to_string(),
            validated_options: AdapterOptions::default(),
            chunking_hints: Vec::new(),
            parser_hints: Vec::new(),
            graph_fact_kinds: Vec::new(),
            watch_supported: true,
            refresh_supported: true,
        },
        stage_plan: Vec::new(),
        limits: EffectiveLimits {
            request: SourceLimits::default(),
            adapter_defaults: SourceLimits::default(),
            config_defaults: SourceLimits::default(),
            effective: SourceLimits::default(),
        },
        config_snapshot_id: ConfigSnapshotId::from("cfg_local_test"),
        provider_reservations: Vec::new(),
    }
}

fn manifest_diff(plan: &SourcePlan, items: Vec<ManifestItem>) -> SourceManifestDiff {
    let added_count = items.len() as u64;
    SourceManifestDiff {
        header: StageResultHeader {
            job_id: plan.job_id,
            stage_id: StageId::new(Uuid::from_u128(29801)),
            phase: PipelinePhase::Diffing,
            status: LifecycleStatus::Completed,
            started_at: timestamp(),
            completed_at: Some(timestamp()),
            counts: StageCounts {
                items_total: Some(items.len() as u64),
                items_done: items.len() as u64,
                documents_total: None,
                documents_done: 0,
                chunks_total: None,
                chunks_done: 0,
                bytes_total: None,
                bytes_done: 0,
            },
            warnings: Vec::new(),
            error: None,
        },
        source_id: plan.route.source.source_id.clone(),
        previous_generation: None,
        next_generation: SourceGenerationId::from("gen_local_test"),
        added: items,
        modified: Vec::new(),
        removed: Vec::new(),
        unchanged: Vec::new(),
        skipped: Vec::new(),
        failed: Vec::new(),
        counts: DiffCounts {
            added: added_count,
            modified: 0,
            removed: 0,
            unchanged: 0,
            skipped: 0,
            failed: 0,
        },
    }
}

fn timestamp() -> Timestamp {
    Timestamp("2026-07-01T00:00:00Z".to_string())
}

fn temp_source_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("axon-local-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn slug(path: &Path) -> String {
    let mut counts = BTreeMap::new();
    path.components()
        .filter_map(|component| component.as_os_str().to_str())
        .filter(|part| !part.is_empty() && *part != "/")
        .map(|part| {
            let count = counts.entry(part.to_string()).or_insert(0);
            *count += 1;
            if *count == 1 {
                part.to_string()
            } else {
                format!("{part}-{count}")
            }
        })
        .collect::<Vec<_>>()
        .join("-")
}
