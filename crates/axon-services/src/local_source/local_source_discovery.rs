use std::path::{Path, PathBuf};

use anyhow::Context;
use axon_api::source::*;
use axon_vector::ops::file_ingest::{SelectionPolicy, collect_files};
use axon_vector::ops::input::classify::path_extension;
use sha2::{Digest, Sha256};
use url::Url;

use super::{LOCAL_ADAPTER_VERSION, LocalSourceIndexInput};

#[derive(Debug, Clone)]
pub(super) struct LocalItem {
    pub item_key: String,
    pub canonical_uri: String,
    pub content: String,
    pub content_kind: ContentKind,
    pub language: Option<String>,
    pub manifest_item: ManifestItem,
}

pub(super) async fn discover_items(
    root: &Path,
    root_is_file: bool,
    source_id: &SourceId,
    source_token: &str,
) -> anyhow::Result<Vec<LocalItem>> {
    let paths = if root_is_file {
        vec![root.to_path_buf()]
    } else {
        collect_files(root, SelectionPolicy::Permissive).await?
    };
    let mut items = Vec::with_capacity(paths.len());
    for path in paths {
        items.push(local_item(root, root_is_file, &path, source_id, source_token).await?);
    }
    items.sort_by(|a, b| a.item_key.cmp(&b.item_key));
    Ok(items)
}

async fn local_item(
    root: &Path,
    root_is_file: bool,
    path: &Path,
    source_id: &SourceId,
    source_token: &str,
) -> anyhow::Result<LocalItem> {
    let bytes = tokio::fs::read(path)
        .await
        .with_context(|| format!("failed to read local source file {}", path.display()))?;
    let metadata = tokio::fs::metadata(path)
        .await
        .with_context(|| format!("failed to stat local source file {}", path.display()))?;
    let item_key = item_key_for_path(root, root_is_file, path)?;
    let content = String::from_utf8(bytes.clone())
        .with_context(|| format!("local source file {} is not valid UTF-8", path.display()))?;
    let extension = path_extension(&item_key).to_ascii_lowercase();
    let content_kind = content_kind_for_extension(&extension);
    let language = language_for_extension(&extension).map(ToOwned::to_owned);
    let canonical_uri = item_canonical_uri(source_token, &item_key);
    let size_bytes = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    Ok(LocalItem {
        item_key: item_key.clone(),
        canonical_uri: canonical_uri.clone(),
        content,
        content_kind,
        language,
        manifest_item: ManifestItem {
            source_id: source_id.clone(),
            source_item_key: SourceItemKey::new(item_key.clone()),
            canonical_uri,
            item_kind: ItemKind::LocalFile,
            content_kind: Some(content_kind),
            display_path: Some(item_key),
            parent_key: None,
            size_bytes: Some(size_bytes),
            content_hash: Some(content_hash(&bytes)),
            mtime: modified_at(metadata.modified().ok()),
            version: None,
            fetch_plan: None,
            metadata: MetadataMap::new(),
            graph_hints: Vec::new(),
        },
    })
}

pub(super) fn collection_spec(collection: &str, dimensions: u32) -> CollectionSpec {
    CollectionSpec {
        collection: collection.to_string(),
        dense: VectorConfig {
            name: "dense".to_string(),
            dimensions,
            distance: VectorDistance::Cosine,
        },
        payload_indexes: vec![
            payload_index("source_id"),
            payload_index("source_generation"),
            payload_index("source_item_key"),
            payload_index("document_id"),
            payload_index("chunk_id"),
        ],
        sparse: None,
        aliases: Vec::new(),
        distance: Some(VectorDistance::Cosine),
        metadata: MetadataMap::new(),
    }
}

pub(super) fn source_summary(
    input: &LocalSourceIndexInput,
    source_id: &SourceId,
    source_token: &str,
    scope: SourceScope,
) -> SourceSummary {
    SourceSummary {
        source_id: source_id.clone(),
        canonical_uri: format!("local://{source_token}"),
        display_name: input
            .root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("local-source")
            .to_string(),
        source_kind: SourceKind::Local,
        adapter: local_adapter_ref(),
        authority: AuthorityLevel::UserPinned,
        status: LifecycleStatus::Running,
        counts: SourceCounts {
            items_total: 0,
            items_changed: 0,
            documents_total: 0,
            chunks_total: 0,
            vector_points_total: 0,
            bytes_total: 0,
        },
        created_at: timestamp(),
        updated_at: timestamp(),
        tags: vec![format!("{scope:?}").to_ascii_lowercase()],
        watch_id: None,
        last_job_id: Some(input.job_id),
    }
}

pub(super) fn local_adapter_ref() -> AdapterRef {
    AdapterRef {
        name: "local".to_string(),
        version: LOCAL_ADAPTER_VERSION.to_string(),
    }
}

pub(super) fn local_source_id(root: &Path) -> SourceId {
    SourceId::new(format!("src_local_{}", source_token(root)))
}

pub(super) fn source_token(root: &Path) -> String {
    stable_token(&file_url_for_path(root).unwrap_or_else(|_| root.display().to_string()))
}

pub(super) fn timestamp() -> Timestamp {
    Timestamp(chrono::Utc::now().to_rfc3339())
}

fn payload_index(field_name: &str) -> PayloadIndexSpec {
    PayloadIndexSpec {
        field_name: field_name.to_string(),
        field_schema: PayloadFieldSchema::Keyword,
        required_for_filters: true,
    }
}

fn file_url_for_path(path: &Path) -> anyhow::Result<String> {
    Url::from_file_path(path)
        .map(|url| url.to_string())
        .map_err(|()| anyhow::anyhow!("failed to build file URL for {}", path.display()))
}

fn item_canonical_uri(source_token: &str, item_key: &str) -> String {
    format!("local://{source_token}/{}", item_key.replace(' ', "%20"))
}

fn item_key_for_path(root: &Path, root_is_file: bool, path: &Path) -> anyhow::Result<String> {
    let relative = if root_is_file {
        path.file_name()
            .map(PathBuf::from)
            .ok_or_else(|| anyhow::anyhow!("file path {} has no file name", path.display()))?
    } else {
        path.strip_prefix(root)
            .with_context(|| {
                format!(
                    "failed to relativize {} under {}",
                    path.display(),
                    root.display()
                )
            })?
            .to_path_buf()
    };
    let key = relative
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("local source item key must be UTF-8"))?
        .replace('\\', "/");
    if key.is_empty() {
        anyhow::bail!("local source item key cannot be empty");
    }
    Ok(key)
}

fn content_kind_for_extension(extension: &str) -> ContentKind {
    match extension {
        "md" | "mdx" | "rst" => ContentKind::Markdown,
        "json" => ContentKind::Json,
        "yaml" | "yml" => ContentKind::Yaml,
        "toml" => ContentKind::Toml,
        "xml" => ContentKind::Xml,
        "txt" | "text" => ContentKind::PlainText,
        _ => ContentKind::Code,
    }
}

fn language_for_extension(extension: &str) -> Option<&'static str> {
    match extension {
        "rs" => Some("rust"),
        "py" => Some("python"),
        "js" | "jsx" => Some("javascript"),
        "ts" | "tsx" => Some("typescript"),
        "go" => Some("go"),
        "java" => Some("java"),
        "kt" | "kts" => Some("kotlin"),
        "md" | "mdx" => Some("markdown"),
        _ => None,
    }
}

fn content_hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}

pub(super) fn stable_token(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    let mut token = String::with_capacity(24);
    for byte in &digest[..12] {
        use std::fmt::Write as _;
        let _ = write!(&mut token, "{byte:02x}");
    }
    token
}

fn modified_at(time: Option<std::time::SystemTime>) -> Option<Timestamp> {
    time.map(|time| {
        let datetime: chrono::DateTime<chrono::Utc> = time.into();
        Timestamp(datetime.to_rfc3339())
    })
}
