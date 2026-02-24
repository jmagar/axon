/// HTTP download handlers for crawl results.
///
/// Four routes:
/// - `GET /download/{job_id}/pack.md`  — Repomix-style packed Markdown
/// - `GET /download/{job_id}/pack.xml` — Repomix-style packed XML
/// - `GET /download/{job_id}/archive.zip` — ZIP of all markdown files
/// - `GET /download/{job_id}/file/*path` — Single file download
use std::io::Write;
use std::path::{Path, PathBuf};

use axum::extract::{Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use dashmap::DashMap;
use std::sync::Arc;

use super::pack;

/// Maximum files per download (guards against zip bombs / OOM).
/// Override with `AXON_DOWNLOAD_MAX_FILES` env var.
fn max_files() -> usize {
    std::env::var("AXON_DOWNLOAD_MAX_FILES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2000)
}

/// Validate a job ID string: must be a valid UUID (hex + dashes, 36 chars).
fn is_valid_job_id(id: &str) -> bool {
    id.len() == 36
        && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
        && id.chars().filter(|&c| c == '-').count() == 4
}

/// Look up and validate the job directory from the DashMap registry.
fn validate_job_dir(
    job_dirs: &DashMap<String, PathBuf>,
    job_id: &str,
) -> Result<PathBuf, (StatusCode, &'static str)> {
    if !is_valid_job_id(job_id) {
        return Err((StatusCode::BAD_REQUEST, "invalid job ID format"));
    }
    let dir = job_dirs
        .get(job_id)
        .map(|r| r.value().clone())
        .ok_or((StatusCode::NOT_FOUND, "job not found in registry"))?;

    if !dir.is_dir() {
        return Err((StatusCode::NOT_FOUND, "job output directory not found"));
    }
    Ok(dir)
}

/// Read the manifest.jsonl and collect (url, relative_path) pairs.
async fn read_manifest(
    job_dir: &Path,
) -> Result<Vec<(String, String)>, (StatusCode, &'static str)> {
    let manifest = job_dir.join("manifest.jsonl");
    let raw = tokio::fs::read_to_string(&manifest)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "manifest.jsonl not found"))?;

    let mut entries = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let url = entry
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let rel = entry
            .get("relative_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !rel.is_empty() {
            entries.push((url, rel));
        }
    }

    if entries.len() > max_files() {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "too many files — increase AXON_DOWNLOAD_MAX_FILES",
        ));
    }

    Ok(entries)
}

/// Read all markdown file contents from a manifest, returning (url, rel_path, content).
async fn load_all_files(
    job_dir: &Path,
) -> Result<(String, Vec<(String, String, String)>), (StatusCode, &'static str)> {
    let manifest_entries = read_manifest(job_dir).await?;
    let mut loaded = Vec::with_capacity(manifest_entries.len());
    let mut domain = String::new();

    for (url, rel_path) in &manifest_entries {
        if domain.is_empty() {
            if let Ok(parsed) = reqwest::Url::parse(url) {
                domain = parsed.host_str().unwrap_or("unknown").to_string();
            }
        }
        let file_path = job_dir.join(rel_path);
        match tokio::fs::read_to_string(&file_path).await {
            Ok(content) => loaded.push((url.clone(), rel_path.clone(), content)),
            Err(_) => continue, // skip unreadable files
        }
    }

    if domain.is_empty() {
        domain = "unknown".to_string();
    }

    Ok((domain, loaded))
}

/// `GET /download/{job_id}/pack.md`
pub async fn serve_pack_md(
    AxumPath(job_id): AxumPath<String>,
    State(job_dirs): State<Arc<DashMap<String, PathBuf>>>,
) -> Response {
    let job_dir = match validate_job_dir(&job_dirs, &job_id) {
        Ok(d) => d,
        Err((status, msg)) => return (status, msg).into_response(),
    };

    let (domain, entries) = match load_all_files(&job_dir).await {
        Ok(v) => v,
        Err((status, msg)) => return (status, msg).into_response(),
    };

    let body = pack::build_pack_md(&domain, &entries);
    let filename = format!("{domain}-pack.md");

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "text/markdown; charset=utf-8".parse().unwrap(),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{filename}\"")
            .parse()
            .unwrap(),
    );

    (headers, body).into_response()
}

/// `GET /download/{job_id}/pack.xml`
pub async fn serve_pack_xml(
    AxumPath(job_id): AxumPath<String>,
    State(job_dirs): State<Arc<DashMap<String, PathBuf>>>,
) -> Response {
    let job_dir = match validate_job_dir(&job_dirs, &job_id) {
        Ok(d) => d,
        Err((status, msg)) => return (status, msg).into_response(),
    };

    let (domain, entries) = match load_all_files(&job_dir).await {
        Ok(v) => v,
        Err((status, msg)) => return (status, msg).into_response(),
    };

    let body = pack::build_pack_xml(&domain, &entries);
    let filename = format!("{domain}-pack.xml");

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "application/xml; charset=utf-8".parse().unwrap(),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{filename}\"")
            .parse()
            .unwrap(),
    );

    (headers, body).into_response()
}

/// `GET /download/{job_id}/archive.zip`
pub async fn serve_zip(
    AxumPath(job_id): AxumPath<String>,
    State(job_dirs): State<Arc<DashMap<String, PathBuf>>>,
) -> Response {
    let job_dir = match validate_job_dir(&job_dirs, &job_id) {
        Ok(d) => d,
        Err((status, msg)) => return (status, msg).into_response(),
    };

    let (domain, entries) = match load_all_files(&job_dir).await {
        Ok(v) => v,
        Err((status, msg)) => return (status, msg).into_response(),
    };

    // Capture filename before moving domain into the blocking closure
    let filename = format!("{domain}-crawl.zip");
    let zip_result = tokio::task::spawn_blocking(move || build_zip(&domain, &entries)).await;

    match zip_result {
        Ok(Ok(bytes)) => {
            let mut headers = HeaderMap::new();
            headers.insert(header::CONTENT_TYPE, "application/zip".parse().unwrap());
            headers.insert(
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\"")
                    .parse()
                    .unwrap(),
            );
            (headers, bytes).into_response()
        }
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("zip creation failed: {e}"),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("zip task panicked: {e}"),
        )
            .into_response(),
    }
}

/// Build a ZIP archive from entries. Runs in a blocking context.
fn build_zip(
    _domain: &str,
    entries: &[(String, String, String)],
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let buf = Vec::with_capacity(entries.iter().map(|(_, _, c)| c.len()).sum::<usize>());
    let cursor = std::io::Cursor::new(buf);
    let mut zip = zip::ZipWriter::new(cursor);

    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for (_, rel_path, content) in entries {
        zip.start_file(rel_path, options)?;
        zip.write_all(content.as_bytes())?;
    }

    let cursor = zip.finish()?;
    Ok(cursor.into_inner())
}

/// `GET /download/{job_id}/file/{path}`
pub async fn serve_file(
    AxumPath((job_id, file_path)): AxumPath<(String, String)>,
    State(job_dirs): State<Arc<DashMap<String, PathBuf>>>,
) -> Response {
    let job_dir = match validate_job_dir(&job_dirs, &job_id) {
        Ok(d) => d,
        Err((status, msg)) => return (status, msg).into_response(),
    };

    // Reject obvious traversal attempts before touching the filesystem
    if file_path.contains("..") || file_path.contains('\0') {
        return (StatusCode::BAD_REQUEST, "invalid file path").into_response();
    }

    let full_path = job_dir.join(&file_path);

    // Canonicalize both paths and verify containment
    let Ok(canonical_base) = tokio::fs::canonicalize(&job_dir).await else {
        return (StatusCode::NOT_FOUND, "job directory not found").into_response();
    };
    let Ok(canonical_file) = tokio::fs::canonicalize(&full_path).await else {
        return (StatusCode::NOT_FOUND, "file not found").into_response();
    };

    if !canonical_file.starts_with(&canonical_base) {
        return (StatusCode::FORBIDDEN, "path outside job directory").into_response();
    }

    let content = match tokio::fs::read_to_string(&canonical_file).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::NOT_FOUND, "file not found").into_response(),
    };

    let filename = canonical_file
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download.md".to_string());

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "text/markdown; charset=utf-8".parse().unwrap(),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{filename}\"")
            .parse()
            .unwrap(),
    );

    (headers, content).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_job_ids() {
        assert!(is_valid_job_id("550e8400-e29b-41d4-a716-446655440000"));
        assert!(is_valid_job_id("a1b2c3d4-e5f6-7890-abcd-ef1234567890"));
    }

    #[test]
    fn invalid_job_ids() {
        assert!(!is_valid_job_id(""));
        assert!(!is_valid_job_id("../../../etc/passwd"));
        assert!(!is_valid_job_id("not-a-uuid-at-all"));
        assert!(!is_valid_job_id("550e8400-e29b-41d4-a716-44665544000")); // 35 chars
        assert!(!is_valid_job_id("550e8400-e29b-41d4-a716-4466554400000")); // 37 chars
        assert!(!is_valid_job_id("550e8400%e29b-41d4-a716-446655440000")); // % char
    }

    #[test]
    fn zip_roundtrip() {
        let entries = vec![
            (
                "https://example.com/a".to_string(),
                "markdown/a.md".to_string(),
                "Hello from A".to_string(),
            ),
            (
                "https://example.com/b".to_string(),
                "markdown/b.md".to_string(),
                "Hello from B".to_string(),
            ),
        ];
        let bytes = build_zip("example.com", &entries).expect("zip should build");
        assert!(!bytes.is_empty());
        // Verify it's a valid ZIP by checking magic bytes
        assert_eq!(&bytes[0..2], b"PK");
    }
}
