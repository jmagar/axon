use super::process::{redact_error_detail, validate_event_path};
use super::queue::PendingFiles;
use super::validate::{SessionWatchRoots, validate_event_path_missing_ok};
use super::{MAX_WATCH_DIRS, SessionWatchOptions};
use anyhow::{Result, anyhow};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone)]
pub(crate) enum WatchTarget {
    Directory(PathBuf),
    File { path: PathBuf, parent: PathBuf },
}

impl WatchTarget {
    pub(crate) fn root(&self) -> &Path {
        match self {
            Self::Directory(path) => path,
            Self::File { parent, .. } => parent,
        }
    }

    pub(crate) fn allowed_file(&self) -> Option<&Path> {
        match self {
            Self::Directory(_) => None,
            Self::File { path, .. } => Some(path),
        }
    }
}

pub(crate) fn canonical_path_allowed(canonical: &Path, targets: &[WatchTarget]) -> bool {
    targets.iter().any(|target| match target {
        WatchTarget::Directory(root) => canonical.starts_with(root),
        WatchTarget::File { path, .. } => canonical == path,
    })
}

fn event_path_allowed_missing_ok(path: &Path, targets: &[WatchTarget]) -> bool {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    canonical_path_allowed(&canonical, targets)
}

pub(crate) fn handle_remove_path(
    path: &Path,
    roots: &SessionWatchRoots,
    targets: &[WatchTarget],
    pending: &mut PendingFiles,
    _overflow_rescan: &AtomicBool,
    prune_missing: &AtomicBool,
) {
    if validate_event_path_missing_ok(roots, path).is_some()
        && event_path_allowed_missing_ok(path, targets)
    {
        pending.remove(path);
        prune_missing.store(true, Ordering::Relaxed);
    }
}

fn default_session_roots() -> Vec<PathBuf> {
    vec![
        crate::ingest::sessions::expand_home("~/.claude/projects"),
        crate::ingest::sessions::expand_home("~/.codex/sessions"),
        crate::ingest::sessions::expand_home("~/.gemini/history"),
        crate::ingest::sessions::expand_home("~/.gemini/tmp"),
    ]
}

pub(crate) fn watch_targets(options: &SessionWatchOptions) -> Result<Vec<WatchTarget>> {
    if let Some(path) = &options.path {
        let link_meta = std::fs::symlink_metadata(path)?;
        if link_meta.file_type().is_symlink() {
            return Err(anyhow!("session watch path is a symlink"));
        }
        let canonical = path.canonicalize()?;
        if canonical.is_file() {
            let parent = canonical
                .parent()
                .map(Path::to_path_buf)
                .ok_or_else(|| anyhow!("session file has no parent"))?;
            return Ok(vec![WatchTarget::File {
                path: canonical,
                parent,
            }]);
        }
        return Ok(vec![WatchTarget::Directory(canonical)]);
    }
    default_session_roots()
        .into_iter()
        .filter(|path| path.exists())
        .map(|path| {
            let link_meta = std::fs::symlink_metadata(&path)?;
            if link_meta.file_type().is_symlink() {
                return Err(anyhow!("session watch root is a symlink"));
            }
            path.canonicalize()
                .map(WatchTarget::Directory)
                .map_err(Into::into)
        })
        .collect()
}

pub(crate) fn collect_watch_dirs(root: &Path) -> Result<Vec<PathBuf>> {
    let mut dirs = Vec::new();
    if root.is_file() {
        if let Some(parent) = root.parent() {
            collect_watch_dirs_inner(parent, &mut dirs, true)?;
        }
    } else {
        collect_watch_dirs_inner(root, &mut dirs, true)?;
    }
    Ok(dirs)
}

fn collect_watch_dirs_inner(path: &Path, dirs: &mut Vec<PathBuf>, is_root: bool) -> Result<()> {
    if dirs.len() >= MAX_WATCH_DIRS {
        return Err(anyhow!(
            "session watcher directory budget exceeded ({MAX_WATCH_DIRS})"
        ));
    }
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => {
            if is_root {
                return Err(anyhow!("failed to inspect session watch path: {error}"));
            }
            tracing::warn!(
                detail = %redact_error_detail(&error.to_string()),
                "skipping unreadable session watch path"
            );
            return Ok(());
        }
    };
    if metadata.file_type().is_symlink() || metadata.is_file() || !metadata.is_dir() {
        return Ok(());
    }
    let canonical = path.canonicalize()?;
    dirs.push(canonical);
    let read_dir = match std::fs::read_dir(path) {
        Ok(read_dir) => read_dir,
        Err(error) => {
            if is_root {
                return Err(anyhow!("failed to read session watch directory: {error}"));
            }
            tracing::warn!(
                detail = %redact_error_detail(&error.to_string()),
                "skipping unreadable session watch directory"
            );
            return Ok(());
        }
    };
    let mut entries = read_dir
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect::<Vec<_>>();
    entries.sort();
    for entry in entries {
        collect_watch_dirs_inner(&entry, dirs, false)?;
    }
    Ok(())
}

pub(crate) fn collect_validated_files(
    roots: &SessionWatchRoots,
    target: &WatchTarget,
) -> Vec<super::validate::ValidatedSessionPath> {
    let mut files = Vec::new();
    if let Some(path) = target.allowed_file() {
        if let Some(validated) = validate_event_path(roots, path) {
            files.push(validated);
        }
        return files;
    }
    collect_validated_files_inner(roots, target.root(), &mut files);
    files.sort_by(|left, right| left.canonical.cmp(&right.canonical));
    files
}

fn collect_validated_files_inner(
    roots: &SessionWatchRoots,
    root: &Path,
    files: &mut Vec<super::validate::ValidatedSessionPath>,
) {
    let Ok(metadata) = std::fs::symlink_metadata(root) else {
        return;
    };
    if metadata.file_type().is_symlink() {
        return;
    }
    if metadata.is_file() {
        if let Some(validated) = validate_event_path(roots, root) {
            files.push(validated);
        }
        return;
    }
    if !metadata.is_dir() {
        return;
    }
    let Ok(read_dir) = std::fs::read_dir(root) else {
        return;
    };
    let mut entries = read_dir
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect::<Vec<_>>();
    entries.sort();
    for entry in entries {
        collect_validated_files_inner(roots, &entry, files);
    }
}
