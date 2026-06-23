//! Transport-neutral client/server contract DTOs.
//!
//! `ArtifactHandle` is the path-safe handle to a service-produced output file
//! (crawl markdown, screenshot, extract items). It is shared by the services
//! result types, the HTTP routes, and the jobs layer, so it lives here rather
//! than under services.

use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct ArtifactHandle {
    pub kind: String,
    pub relative_path: String,
    pub display_path: String,
    pub bytes: u64,
    pub line_count: Option<u64>,
    pub job_id: Option<String>,
    pub url: Option<String>,
}

impl ArtifactHandle {
    pub fn new(
        kind: impl Into<String>,
        relative_path: impl Into<String>,
        display_path: impl Into<String>,
        bytes: u64,
        line_count: Option<u64>,
        job_id: Option<String>,
        url: Option<String>,
    ) -> Self {
        Self {
            kind: kind.into(),
            relative_path: normalize_relative_path(relative_path.into()),
            display_path: display_path.into(),
            bytes,
            line_count,
            job_id,
            url,
        }
    }

    pub fn try_from_path(
        kind: impl Into<String>,
        root: &Path,
        path: &Path,
        bytes: u64,
        line_count: Option<u64>,
        job_id: Option<String>,
        url: Option<String>,
    ) -> Option<Self> {
        if !path.is_absolute() || !root.is_absolute() {
            return None;
        }
        let relative_path = path
            .strip_prefix(root)
            .ok()?
            .to_string_lossy()
            .replace('\\', "/");
        if relative_path_is_unsafe(&relative_path) {
            return None;
        }
        Some(Self::new(
            kind,
            relative_path,
            path.to_string_lossy().into_owned(),
            bytes,
            line_count,
            job_id,
            url,
        ))
    }
}

fn normalize_relative_path(path: String) -> String {
    path.replace('\\', "/").trim_start_matches('/').to_string()
}

fn relative_path_is_unsafe(path: &str) -> bool {
    if path.is_empty() || path.contains('\0') || path.contains('\\') {
        return true;
    }
    let decoded = percent_decode_str(path).decode_utf8_lossy();
    if decoded.contains(':')
        || decoded.contains('\\')
        || decoded
            .split('/')
            .any(|segment| segment == "." || segment == "..")
    {
        return true;
    }
    Path::new(decoded.as_ref()).components().any(|component| {
        matches!(
            component,
            std::path::Component::CurDir
                | std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    })
}
