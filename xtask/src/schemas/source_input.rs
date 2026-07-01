use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceInput {
    pub path: String,
    pub sha256: String,
}

pub fn source_inputs(root: &Path, paths: &[&str]) -> Result<Vec<SourceInput>> {
    let mut inputs = Vec::with_capacity(paths.len());
    for path in paths {
        inputs.push(source_input(root, PathBuf::from(path))?);
    }
    inputs.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(inputs)
}

fn source_input(root: &Path, rel_path: PathBuf) -> Result<SourceInput> {
    let path = root.join(&rel_path);
    let bytes = if path.is_dir() {
        directory_bytes(root, &rel_path)?
    } else {
        std::fs::read(&path)
            .with_context(|| format!("failed to read schema source input {}", rel_path.display()))?
    };
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    Ok(SourceInput {
        path: rel_path.to_string_lossy().to_string(),
        sha256,
    })
}

fn directory_bytes(root: &Path, rel_path: &Path) -> Result<Vec<u8>> {
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root.join(rel_path)) {
        let entry = entry?;
        if entry.file_type().is_file() {
            files.push(entry.path().to_path_buf());
        }
    }
    files.sort();

    let mut bytes = Vec::new();
    for path in files {
        let repo_rel = path
            .strip_prefix(root)?
            .to_string_lossy()
            .replace('\\', "/");
        bytes.extend_from_slice(repo_rel.as_bytes());
        bytes.push(0);
        bytes.extend_from_slice(&std::fs::read(&path)?);
        bytes.push(0);
    }
    Ok(bytes)
}
