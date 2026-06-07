use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::error::Error;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

type ArtifactWriteError = Box<dyn Error + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ArtifactKind {
    Markdown,
    CrawlManifest,
    ExtractSummary,
    ExtractItems,
    Screenshot,
    Log,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArtifactHandle {
    pub artifact_id: String,
    pub kind: ArtifactKind,
    pub relative_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<Uuid>,
    pub content_hash: String,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debug_path: Option<String>,
}

impl ArtifactHandle {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        kind: ArtifactKind,
        relative_path: impl Into<String>,
        source_url: Option<String>,
        job_id: Option<Uuid>,
        content_hash: String,
        bytes: u64,
        line_count: Option<u64>,
        debug_path: Option<String>,
    ) -> Result<Self, String> {
        let relative_path = relative_path.into().replace('\\', "/");
        reject_unsafe_relative_path(&relative_path)?;
        let artifact_id = artifact_id(kind, &relative_path, &content_hash);
        Ok(Self {
            artifact_id,
            kind,
            relative_path,
            source_url,
            job_id,
            content_hash,
            bytes,
            line_count,
            debug_path,
        })
    }
}

fn reject_unsafe_relative_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("artifact relative_path is empty".to_string());
    }
    if Path::new(path).components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(format!("unsafe artifact relative_path: {path}"));
    }
    Ok(())
}

pub async fn atomic_write_under(
    root: impl AsRef<Path>,
    relative_path: impl AsRef<Path>,
    bytes: &[u8],
) -> Result<PathBuf, ArtifactWriteError> {
    let root = root.as_ref();
    let relative = relative_path.as_ref();
    let relative_string = relative.to_string_lossy().replace('\\', "/");
    reject_unsafe_relative_path(&relative_string)
        .map_err(|err| -> ArtifactWriteError { err.into() })?;

    if root.exists() && !root.is_dir() {
        return Err(format!("artifact root is not a directory: {}", root.display()).into());
    }
    tokio::fs::create_dir_all(root).await?;
    let canonical_root = tokio::fs::canonicalize(root).await?;

    let final_path = root.join(relative);
    let parent = final_path
        .parent()
        .ok_or_else(|| -> ArtifactWriteError { "artifact path has no parent".into() })?;
    tokio::fs::create_dir_all(parent).await?;
    let canonical_parent = tokio::fs::canonicalize(parent).await?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err(format!(
            "artifact path escaped output root: {}",
            final_path.display()
        )
        .into());
    }

    let file_name = final_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("artifact");
    let tmp_name = format!(".{file_name}.tmp-{}-{}", std::process::id(), Uuid::new_v4());
    let tmp_path = parent.join(tmp_name);
    let write_result = async {
        let mut file = tokio::fs::File::create(&tmp_path).await?;
        tokio::io::AsyncWriteExt::write_all(&mut file, bytes).await?;
        file.sync_all().await?;
        tokio::fs::rename(&tmp_path, &final_path).await?;
        if let Ok(parent_dir) = tokio::fs::File::open(parent).await {
            let _ = parent_dir.sync_all().await;
        }
        Ok::<(), std::io::Error>(())
    }
    .await;

    if let Err(err) = write_result {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(err.into());
    }

    Ok(final_path)
}

fn artifact_id(kind: ArtifactKind, relative_path: &str, content_hash: &str) -> String {
    let mut hasher = Sha256::new();
    hash_field(&mut hasher, format!("{kind:?}").as_bytes());
    hash_field(&mut hasher, relative_path.as_bytes());
    hash_field(&mut hasher, content_hash.as_bytes());
    format!("art_{}", hex::encode(&hasher.finalize()[..16]))
}

fn hash_field(hasher: &mut Sha256, value: &[u8]) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}
