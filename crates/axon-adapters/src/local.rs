//! Local filesystem source adapter.

use std::fs;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use axon_api::source::*;
use serde_json::json;
use uuid::Uuid;

use crate::adapter::{Result, SourceAdapter};
use crate::capability::AdapterCapability;
use crate::manifest::item_identity;

pub const MODULE_NAME: &str = "local";

const ADAPTER_NAME: &str = "local";
const ALLOWED_OPTIONS: &[&str] = &[
    "include_globs",
    "exclude_globs",
    "respect_gitignore",
    "follow_symlinks",
    "max_file_bytes",
    "binary_policy",
    "watch_policy",
];

#[derive(Debug, Clone, Default)]
pub struct LocalSourceAdapter;

#[derive(Debug, Clone, Copy)]
struct LocalOptions {
    follow_symlinks: bool,
    max_file_bytes: Option<u64>,
}

impl LocalSourceAdapter {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl SourceAdapter for LocalSourceAdapter {
    fn name(&self) -> &str {
        ADAPTER_NAME
    }

    fn version(&self) -> &str {
        env!("CARGO_PKG_VERSION")
    }

    async fn capabilities(&self) -> Result<AdapterCapability> {
        Ok(AdapterCapability::new(
            AdapterRef {
                name: ADAPTER_NAME.to_string(),
                version: self.version().to_string(),
            },
            SourceKind::Local,
            SourceScope::Directory,
        )
        .with_scope(SourceScope::File)
        .with_scope(SourceScope::Workspace)
        .with_scope(SourceScope::Repo)
        .with_scope(SourceScope::Map))
    }

    async fn discover(&self, plan: &SourcePlan) -> Result<SourceManifest> {
        let capability = self.capabilities().await?;
        capability.validate_scope(plan.route.scope)?;
        validate_adapter(plan)?;
        let options = validate_options(&plan.route.validated_options)?;

        let root = PathBuf::from(&plan.request.source);
        let mut files = Vec::new();
        match plan.route.scope {
            SourceScope::File => files.push(root.clone()),
            SourceScope::Directory
            | SourceScope::Workspace
            | SourceScope::Repo
            | SourceScope::Map => {
                collect_files(&root, options, &mut files)?;
            }
            _ => {
                return Err(ApiError::new(
                    "adapter.local.scope.unsupported",
                    axon_error::ErrorStage::Routing,
                    "local adapter only discovers file-like local scopes",
                )
                .with_context("scope", format!("{:?}", plan.route.scope)));
            }
        }
        files.sort();

        let base_uri = public_base_uri(&plan.route.source.canonical_uri);
        let root_for_keys = if root.is_file() {
            root.parent().unwrap_or_else(|| Path::new(""))
        } else {
            root.as_path()
        };
        let mut items = Vec::new();
        for file in files {
            let metadata = fs::metadata(&file)
                .map_err(|err| fs_error("adapter.local.stat_failed", &file, err))?;
            if let Some(max_file_bytes) = options.max_file_bytes {
                if metadata.len() > max_file_bytes {
                    continue;
                }
            }
            if !metadata.is_file() {
                continue;
            }
            let key = relative_key(root_for_keys, &file)?;
            let identity = item_identity(SourceKind::Local, &base_uri, &key)?;
            items.push(ManifestItem {
                source_id: plan.route.source.source_id.clone(),
                source_item_key: identity.source_item_key,
                canonical_uri: identity.canonical_uri,
                item_kind: ItemKind::LocalFile,
                content_kind: Some(content_kind_for(&file)),
                display_path: Some(key),
                parent_key: None,
                size_bytes: Some(metadata.len()),
                content_hash: None,
                mtime: None,
                version: None,
                fetch_plan: None,
                metadata: MetadataMap::new(),
                graph_hints: Vec::new(),
            });
        }
        items.sort_by(|left, right| left.source_item_key.cmp(&right.source_item_key));

        Ok(SourceManifest {
            source_id: plan.route.source.source_id.clone(),
            generation: SourceGenerationId::from("gen_local_discovery"),
            adapter: plan.route.adapter.clone(),
            scope: plan.route.scope,
            items,
            created_at: Timestamp("2026-07-01T00:00:00Z".to_string()),
            metadata: MetadataMap::new(),
        })
    }

    async fn acquire(
        &self,
        plan: &SourcePlan,
        diff: &SourceManifestDiff,
    ) -> Result<SourceAcquisition> {
        validate_adapter(plan)?;
        let root = PathBuf::from(&plan.request.source);
        let root_for_keys = if root.is_file() {
            root.parent().unwrap_or_else(|| Path::new(""))
        } else {
            root.as_path()
        };
        let manifest_items = diff
            .added
            .iter()
            .chain(diff.modified.iter())
            .cloned()
            .collect::<Vec<_>>();
        let mut fetched_items = Vec::with_capacity(manifest_items.len());
        for item in &manifest_items {
            let path = root_for_keys.join(&item.source_item_key.0);
            let text = fs::read_to_string(&path)
                .map_err(|err| fs_error("adapter.local.read_failed", &path, err))?;
            fetched_items.push(AcquiredSourceItem {
                manifest_item: item.clone(),
                fetch_status: LifecycleStatus::Completed,
                content_ref: ContentRef::InlineText { text },
                raw_artifact_id: None,
                headers: RedactedHeaders {
                    headers: Vec::new(),
                },
                fetched_at: timestamp(),
                metadata: MetadataMap::new(),
            });
        }

        let manifest = SourceManifest {
            source_id: plan.route.source.source_id.clone(),
            generation: diff.next_generation.clone(),
            adapter: plan.route.adapter.clone(),
            scope: plan.route.scope,
            items: manifest_items,
            created_at: timestamp(),
            metadata: MetadataMap::new(),
        };

        Ok(SourceAcquisition {
            header: stage_header(
                plan.job_id,
                "local_fetch",
                PipelinePhase::Fetching,
                fetched_items.len(),
            ),
            source_id: manifest.source_id.clone(),
            generation: manifest.generation.clone(),
            adapter: manifest.adapter.clone(),
            scope: manifest.scope,
            manifest,
            fetched_items,
            artifacts: Vec::new(),
        })
    }

    async fn normalize(
        &self,
        plan: &SourcePlan,
        acquisition: SourceAcquisition,
    ) -> Result<StageExecutionResult<Vec<SourceDocument>>> {
        let documents = acquisition
            .fetched_items
            .iter()
            .map(|item| local_source_document(plan, &acquisition, item))
            .collect::<Vec<_>>();
        Ok(StageExecutionResult {
            header: stage_header(
                plan.job_id,
                "local_normalize",
                PipelinePhase::Normalizing,
                documents.len(),
            ),
            data: documents,
        })
    }
}

fn validate_adapter(plan: &SourcePlan) -> Result<()> {
    if plan.route.adapter.name == ADAPTER_NAME {
        return Ok(());
    }
    Err(ApiError::new(
        "adapter.local.mismatch",
        axon_error::ErrorStage::Routing,
        "route selected a different adapter",
    )
    .with_context("adapter", plan.route.adapter.name.clone()))
}

fn validate_options(options: &AdapterOptions) -> Result<LocalOptions> {
    for key in options.values.keys() {
        if !ALLOWED_OPTIONS.contains(&key.as_str()) {
            return Err(ApiError::new(
                "adapter.local.option.unsupported",
                axon_error::ErrorStage::Routing,
                "local adapter option is not supported",
            )
            .with_context("option", key.clone()));
        }
    }
    require_string_array(options, "include_globs")?;
    require_string_array(options, "exclude_globs")?;
    require_bool(options, "respect_gitignore")?;
    let follow_symlinks = optional_bool(options, "follow_symlinks")?.unwrap_or(false);
    let max_file_bytes = optional_u64(options, "max_file_bytes")?;
    require_enum(options, "binary_policy", &["skip", "metadata", "include"])?;
    require_enum(options, "watch_policy", &["manual", "auto", "disabled"])?;
    Ok(LocalOptions {
        follow_symlinks,
        max_file_bytes,
    })
}

fn require_string_array(options: &AdapterOptions, key: &str) -> Result<()> {
    let Some(value) = options.values.get(key) else {
        return Ok(());
    };
    let valid = value
        .as_array()
        .is_some_and(|values| values.iter().all(|value| value.is_string()));
    valid
        .then_some(())
        .ok_or_else(|| option_invalid(key, "expected an array of strings"))
}

fn require_bool(options: &AdapterOptions, key: &str) -> Result<()> {
    optional_bool(options, key).map(|_| ())
}

fn optional_bool(options: &AdapterOptions, key: &str) -> Result<Option<bool>> {
    let Some(value) = options.values.get(key) else {
        return Ok(None);
    };
    value
        .as_bool()
        .map(Some)
        .ok_or_else(|| option_invalid(key, "expected a boolean"))
}

fn optional_u64(options: &AdapterOptions, key: &str) -> Result<Option<u64>> {
    let Some(value) = options.values.get(key) else {
        return Ok(None);
    };
    value
        .as_u64()
        .map(Some)
        .ok_or_else(|| option_invalid(key, "expected an unsigned integer"))
}

fn require_enum(options: &AdapterOptions, key: &str, allowed: &[&str]) -> Result<()> {
    let Some(value) = options.values.get(key) else {
        return Ok(());
    };
    let Some(value) = value.as_str() else {
        return Err(option_invalid(key, "expected a string"));
    };
    allowed
        .contains(&value)
        .then_some(())
        .ok_or_else(|| option_invalid(key, "unsupported value"))
}

fn option_invalid(key: &str, message: &str) -> ApiError {
    ApiError::new(
        "adapter.local.option.invalid",
        axon_error::ErrorStage::Routing,
        message,
    )
    .with_context("option", key.to_string())
}

fn collect_files(root: &Path, options: LocalOptions, files: &mut Vec<PathBuf>) -> Result<()> {
    let entries =
        fs::read_dir(root).map_err(|err| fs_error("adapter.local.read_dir_failed", root, err))?;
    for entry in entries {
        let entry = entry.map_err(|err| fs_error("adapter.local.read_dir_failed", root, err))?;
        let path = entry.path();
        let metadata = if options.follow_symlinks {
            fs::metadata(&path)
        } else {
            fs::symlink_metadata(&path)
        }
        .map_err(|err| fs_error("adapter.local.stat_failed", &path, err))?;
        if metadata.file_type().is_symlink() && !options.follow_symlinks {
            continue;
        }
        if metadata.is_dir() {
            collect_files(&path, options, files)?;
        } else if metadata.is_file() {
            files.push(path);
        }
    }
    Ok(())
}

fn relative_key(root: &Path, file: &Path) -> Result<String> {
    let relative = file.strip_prefix(root).unwrap_or(file);
    let key = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("/");
    if key.is_empty() {
        return Err(ApiError::new(
            "adapter.local.item_key.invalid",
            axon_error::ErrorStage::Normalizing,
            "local item key must not be empty",
        ));
    }
    Ok(key)
}

fn public_base_uri(canonical_uri: &str) -> String {
    if let Some((scheme, rest)) = canonical_uri.split_once("://") {
        if scheme == "local" {
            return format!("local://{}", rest.trim_matches('/'));
        }
    }
    "local://source".to_string()
}

fn content_kind_for(path: &Path) -> ContentKind {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "md" | "markdown" => ContentKind::Markdown,
        "html" | "htm" => ContentKind::Html,
        "json" => ContentKind::Json,
        "yaml" | "yml" => ContentKind::Yaml,
        "toml" => ContentKind::Toml,
        "xml" => ContentKind::Xml,
        "rs" | "go" | "js" | "jsx" | "ts" | "tsx" | "py" | "java" | "kt" | "swift" | "c" | "cc"
        | "cpp" | "h" | "hpp" | "cs" | "rb" | "php" | "sh" | "zsh" | "fish" => ContentKind::Code,
        _ => ContentKind::PlainText,
    }
}

fn local_source_document(
    plan: &SourcePlan,
    acquisition: &SourceAcquisition,
    item: &AcquiredSourceItem,
) -> SourceDocument {
    let item_key = &item.manifest_item.source_item_key.0;
    let mut metadata = MetadataMap::new();
    metadata.insert("source_family".to_string(), json!("code"));
    metadata.insert("source_kind".to_string(), json!("local"));
    metadata.insert("source_adapter".to_string(), json!(plan.route.adapter.name));
    metadata.insert("source_scope".to_string(), json!(plan.route.scope));
    metadata.insert(
        "item_canonical_uri".to_string(),
        json!(item.manifest_item.canonical_uri),
    );
    metadata.insert("committed_generation".to_string(), json!("uncommitted"));
    metadata.insert("visibility".to_string(), json!("internal"));
    metadata.insert("redaction_status".to_string(), json!("clean"));
    SourceDocument {
        document_id: DocumentId::from(format!("doc_{}", sanitize_document_key(item_key))),
        source_id: acquisition.source_id.clone(),
        source_item_key: item.manifest_item.source_item_key.clone(),
        canonical_uri: item.manifest_item.canonical_uri.clone(),
        content_kind: item
            .manifest_item
            .content_kind
            .unwrap_or(ContentKind::PlainText),
        content: item.content_ref.clone(),
        metadata,
        title: item.manifest_item.display_path.clone(),
        language: None,
        path: item.manifest_item.display_path.clone(),
        mime_type: None,
        structured_payload: None,
        artifact_id: item.raw_artifact_id.clone(),
        chunk_hints: plan.route.chunking_hints.clone(),
        parser_hints: plan.route.parser_hints.clone(),
    }
}

fn stage_header(
    job_id: JobId,
    stage_id: &'static str,
    phase: PipelinePhase,
    item_count: usize,
) -> StageResultHeader {
    StageResultHeader {
        job_id,
        stage_id: named_stage_id(stage_id),
        phase,
        status: LifecycleStatus::Completed,
        started_at: timestamp(),
        completed_at: Some(timestamp()),
        counts: StageCounts {
            items_total: Some(item_count as u64),
            items_done: item_count as u64,
            documents_total: Some(item_count as u64),
            documents_done: item_count as u64,
            chunks_total: None,
            chunks_done: 0,
            bytes_total: None,
            bytes_done: 0,
        },
        warnings: Vec::new(),
        error: None,
    }
}

fn timestamp() -> Timestamp {
    Timestamp("2026-07-01T00:00:00Z".to_string())
}

fn named_stage_id(stage_id: &str) -> StageId {
    StageId::new(Uuid::new_v5(&Uuid::NAMESPACE_OID, stage_id.as_bytes()))
}

fn sanitize_document_key(key: &str) -> String {
    key.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}

fn fs_error(code: &'static str, path: &Path, err: std::io::Error) -> ApiError {
    ApiError::new(code, axon_error::ErrorStage::Discovering, err.to_string())
        .with_context("path", path.display().to_string())
}
