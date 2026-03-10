use super::super::common::{internal_error, invalid_params};
use rmcp::ErrorData;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use uuid::Uuid;

pub const MCP_ARTIFACT_DIR_ENV: &str = "AXON_MCP_ARTIFACT_DIR";

/// Detect a context name from the client's working directory.
///
/// Walks up from CWD looking for a `.git` directory. If found, returns the
/// repo root's directory name. Otherwise returns the CWD's directory name.
/// Result is cached for the process lifetime (MCP server runs as a subprocess
/// whose CWD is fixed at launch).
pub fn client_context_name() -> &'static str {
    static CONTEXT: OnceLock<String> = OnceLock::new();
    CONTEXT.get_or_init(|| {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        // Walk up looking for .git
        let mut dir = cwd.as_path();
        loop {
            if dir.join(".git").exists() {
                return dir
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "default".to_string());
            }
            match dir.parent() {
                Some(parent) if parent != dir => dir = parent,
                _ => break,
            }
        }
        // No git repo — use CWD dirname
        cwd.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "default".to_string())
    })
}

pub fn artifact_root() -> PathBuf {
    let base = std::env::var(MCP_ARTIFACT_DIR_ENV)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("AXON_DATA_DIR")
                .ok()
                .map(|d| d.trim().to_string())
                .filter(|d| !d.is_empty())
                .map(|d| PathBuf::from(d).join("axon/artifacts"))
        })
        .unwrap_or_else(|| PathBuf::from(".cache/axon-mcp"));
    base.join(client_context_name())
}

fn fallback_artifact_root() -> PathBuf {
    std::env::temp_dir()
        .join("axon-mcp")
        .join(client_context_name())
}

async fn ensure_dir(path: &Path) -> Result<(), std::io::Error> {
    tokio::fs::create_dir_all(path).await
}

async fn is_writable(path: &Path) -> bool {
    let probe = path.join(format!(
        ".axon-write-probe-{}-{}",
        std::process::id(),
        Uuid::new_v4().simple()
    ));
    match tokio::fs::File::create(&probe).await {
        Ok(_) => {
            let _ = tokio::fs::remove_file(&probe).await;
            true
        }
        Err(_) => false,
    }
}

pub async fn ensure_artifact_root() -> Result<PathBuf, ErrorData> {
    let root = artifact_root();
    if ensure_dir(&root).await.is_ok() && is_writable(&root).await {
        return Ok(root);
    }
    let fallback = fallback_artifact_root();
    if fallback != root {
        if let Err(fallback_err) = ensure_dir(&fallback).await {
            return Err(internal_error(format!(
                "artifact dir '{}' is not writable; fallback '{}' also failed ({fallback_err})",
                root.display(),
                fallback.display()
            )));
        }
        if !is_writable(&fallback).await {
            return Err(internal_error(format!(
                "artifact dir '{}' and fallback '{}' are both not writable",
                root.display(),
                fallback.display()
            )));
        }
        return Ok(fallback);
    }
    Err(internal_error(format!(
        "artifact dir '{}' is not writable",
        root.display()
    )))
}

pub async fn build_artifact_path(stem: &str, ext: &str) -> Result<PathBuf, ErrorData> {
    let root = ensure_artifact_root().await?;
    Ok(root.join(format!("{stem}.{ext}")))
}

pub async fn validate_artifact_path(raw: &str) -> Result<PathBuf, ErrorData> {
    let root = tokio::fs::canonicalize(ensure_artifact_root().await?)
        .await
        .map_err(|e| internal_error(e.to_string()))?;
    let candidate = PathBuf::from(raw);
    let canonical = if candidate.is_absolute() {
        tokio::fs::canonicalize(&candidate)
            .await
            .map_err(|e| invalid_params(format!("artifact path not found: {e}")))?
    } else {
        let cwd = std::env::current_dir().map_err(|e| internal_error(e.to_string()))?;
        let from_cwd = cwd.join(&candidate);
        match tokio::fs::canonicalize(&from_cwd).await {
            Ok(p) => p,
            Err(_) => tokio::fs::canonicalize(root.join(&candidate))
                .await
                .map_err(|e| invalid_params(format!("artifact path not found: {e}")))?,
        }
    };
    if !canonical.starts_with(&root) {
        return Err(invalid_params(format!(
            "artifact path must be inside {}",
            root.display()
        )));
    }
    // Reject symlink-backed paths: use symlink_metadata (lstat) to check whether the
    // resolved path itself — or any component of it relative to the artifact root — is
    // a symlink. Following symlinks via canonicalize() is not sufficient because a
    // symlink *inside* the root can point to a target *outside* the root.
    if std::fs::symlink_metadata(&canonical)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(invalid_params("artifact path must not be a symlink"));
    }
    Ok(canonical)
}

pub async fn resolve_artifact_output_path(raw: &str) -> Result<PathBuf, ErrorData> {
    let candidate = PathBuf::from(raw);
    if candidate.as_os_str().is_empty() {
        return Err(invalid_params("output path cannot be empty"));
    }
    if candidate.is_absolute() {
        return Err(invalid_params(format!(
            "output path must be relative to {}",
            ensure_artifact_root().await?.display()
        )));
    }
    if candidate.components().any(|c| {
        matches!(
            c,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return Err(invalid_params(
            "output path cannot contain traversal components",
        ));
    }
    let resolved = ensure_artifact_root().await?.join(candidate);
    // If the target path already exists, reject it if it is a symlink to prevent
    // writes from being silently redirected outside the artifact root.
    if std::fs::symlink_metadata(&resolved)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(invalid_params("output path must not be a symlink"));
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;
    use std::sync::Mutex;
    use tempfile::tempdir;

    static ENV_CWD_LOCK: Mutex<()> = Mutex::new(());

    #[allow(unsafe_code)]
    #[test]
    fn ensure_artifact_root_uses_env_override_with_context_subdir() {
        let _guard = ENV_CWD_LOCK.lock().expect("lock poisoned");
        let tmp = tempdir().expect("tempdir");
        let override_path = tmp.path().join("custom-artifacts");
        // SAFETY: guarded by ENV_CWD_LOCK; no concurrent env mutation in this module.
        unsafe {
            env::set_var(MCP_ARTIFACT_DIR_ENV, &override_path);
        }
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio rt");
        let root = rt.block_on(ensure_artifact_root()).expect("artifact root");
        // Context subdir is appended to the override path
        let expected = override_path.join(client_context_name());
        assert_eq!(root, expected);
        assert!(root.exists());
        // SAFETY: guarded by ENV_CWD_LOCK; no concurrent env mutation in this module.
        unsafe {
            env::remove_var(MCP_ARTIFACT_DIR_ENV);
        }
    }

    #[allow(unsafe_code)]
    #[test]
    fn ensure_artifact_root_falls_back_when_primary_root_is_invalid() {
        let _guard = ENV_CWD_LOCK.lock().expect("lock poisoned");
        // SAFETY: guarded by ENV_CWD_LOCK; no concurrent env mutation in this module.
        unsafe {
            env::remove_var(MCP_ARTIFACT_DIR_ENV);
        }
        let cwd_before = env::current_dir().expect("cwd");
        let tmp = tempdir().expect("tempdir");
        env::set_current_dir(tmp.path()).expect("chdir temp");
        fs::write(tmp.path().join(".cache"), b"not-a-directory").expect("create file .cache");
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio rt");
        let root = rt
            .block_on(ensure_artifact_root())
            .expect("artifact root fallback");
        let expected_fallback = fallback_artifact_root();
        assert_eq!(root, expected_fallback);
        assert!(root.exists());
        env::set_current_dir(cwd_before).expect("restore cwd");
    }
}
