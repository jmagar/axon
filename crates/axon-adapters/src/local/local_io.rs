use std::fs;
use std::fs::Metadata;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use axon_api::source::{ApiError, ContentRef};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;

use crate::adapter::Result;
use crate::local_select::LocalOptions;

pub(super) fn read_content_ref(path: &Path, options: &LocalOptions) -> Result<ContentRef> {
    enforce_read_size(path, options)?;
    if options.includes_binary_body(path) {
        let bytes =
            fs::read(path).map_err(|err| fs_error("adapter.local.read_failed", path, err))?;
        return Ok(ContentRef::InlineBytes {
            bytes_base64: BASE64_STANDARD.encode(bytes),
            mime_type: "application/octet-stream".to_string(),
        });
    }
    let text =
        fs::read_to_string(path).map_err(|err| fs_error("adapter.local.read_failed", path, err))?;
    Ok(ContentRef::InlineText { text })
}

pub(super) fn safe_item_path(root: &Path, item_key: &str) -> Result<PathBuf> {
    let key = Path::new(item_key);
    if key.is_absolute()
        || key
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(ApiError::new(
            "adapter.local.item_key.escape",
            axon_error::ErrorStage::Fetching,
            "local source item key escapes the local source root",
        ));
    }
    let root = fs::canonicalize(root)
        .map_err(|err| fs_error("adapter.local.root_stat_failed", root, err))?;
    let candidate = root.join(key);
    let canonical = fs::canonicalize(&candidate)
        .map_err(|err| fs_error("adapter.local.stat_failed", &candidate, err))?;
    if canonical.starts_with(&root) {
        Ok(canonical)
    } else {
        Err(ApiError::new(
            "adapter.local.item_key.escape",
            axon_error::ErrorStage::Fetching,
            "local source item key escapes the local source root",
        ))
    }
}

pub(super) fn content_fingerprint(metadata: &Metadata) -> String {
    let modified_ns = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("stat:{}:{modified_ns}", metadata.len())
}

fn enforce_read_size(path: &Path, options: &LocalOptions) -> Result<()> {
    let Some(max_file_bytes) = options.max_file_bytes else {
        return Ok(());
    };
    let metadata =
        fs::metadata(path).map_err(|err| fs_error("adapter.local.stat_failed", path, err))?;
    if metadata.len() <= max_file_bytes {
        return Ok(());
    }
    Err(ApiError::new(
        "adapter.local.file_too_large",
        axon_error::ErrorStage::Fetching,
        "local source item exceeds max_file_bytes",
    )
    .with_context("path_hint", public_path_hint(path))
    .with_context("max_file_bytes", max_file_bytes.to_string()))
}

pub(super) fn fs_error(code: &'static str, path: &Path, err: std::io::Error) -> ApiError {
    ApiError::new(code, axon_error::ErrorStage::Discovering, err.to_string())
        .with_context("path_hint", public_path_hint(path))
}

pub(super) fn public_path_hint(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| "local-source-item".to_string())
}
