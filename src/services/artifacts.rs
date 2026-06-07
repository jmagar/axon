use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::error::Error;
use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

#[derive(Debug)]
pub enum ArtifactWriteError {
    Validation(String),
    RootNotDirectory(PathBuf),
    MissingParent(PathBuf),
    EscapedRoot(PathBuf),
    Io {
        operation: &'static str,
        path: PathBuf,
        source: io::Error,
    },
}

impl ArtifactWriteError {
    fn io(operation: &'static str, path: impl Into<PathBuf>, source: io::Error) -> Self {
        Self::Io {
            operation,
            path: path.into(),
            source,
        }
    }
}

impl fmt::Display for ArtifactWriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Validation(message) => f.write_str(message),
            Self::RootNotDirectory(path) => {
                write!(f, "artifact root is not a directory: {}", path.display())
            }
            Self::MissingParent(path) => {
                write!(f, "artifact path has no parent: {}", path.display())
            }
            Self::EscapedRoot(path) => {
                write!(f, "artifact path escaped output root: {}", path.display())
            }
            Self::Io {
                operation,
                path,
                source,
            } => write!(
                f,
                "artifact write failed during {operation} for {}: {source}",
                path.display()
            ),
        }
    }
}

impl Error for ArtifactWriteError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

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
    reject_unsafe_relative_path(&relative_string).map_err(ArtifactWriteError::Validation)?;

    if root.exists() && !root.is_dir() {
        return Err(ArtifactWriteError::RootNotDirectory(root.to_path_buf()));
    }
    tokio::fs::create_dir_all(root)
        .await
        .map_err(|err| ArtifactWriteError::io("create root directory", root, err))?;
    let canonical_root = tokio::fs::canonicalize(root)
        .await
        .map_err(|err| ArtifactWriteError::io("canonicalize root", root, err))?;

    let final_path = root.join(relative);
    let parent = final_path
        .parent()
        .ok_or_else(|| ArtifactWriteError::MissingParent(final_path.clone()))?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|err| ArtifactWriteError::io("create parent directory", parent, err))?;
    let canonical_parent = tokio::fs::canonicalize(parent)
        .await
        .map_err(|err| ArtifactWriteError::io("canonicalize parent", parent, err))?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err(ArtifactWriteError::EscapedRoot(final_path));
    }

    let file_name = final_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("artifact");
    let tmp_name = format!(".{file_name}.tmp-{}-{}", std::process::id(), Uuid::new_v4());
    let tmp_path = parent.join(tmp_name);
    let write_result = async {
        let mut file = tokio::fs::File::create(&tmp_path)
            .await
            .map_err(|err| ArtifactWriteError::io("create temp file", &tmp_path, err))?;
        tokio::io::AsyncWriteExt::write_all(&mut file, bytes)
            .await
            .map_err(|err| ArtifactWriteError::io("write temp file", &tmp_path, err))?;
        file.sync_all()
            .await
            .map_err(|err| ArtifactWriteError::io("sync temp file", &tmp_path, err))?;
        tokio::fs::rename(&tmp_path, &final_path)
            .await
            .map_err(|err| ArtifactWriteError::io("rename temp file", &final_path, err))?;
        if let Ok(parent_dir) = tokio::fs::File::open(parent).await {
            let _ = parent_dir.sync_all().await;
        }
        Ok::<(), ArtifactWriteError>(())
    }
    .await;

    if let Err(err) = write_result {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(err);
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
