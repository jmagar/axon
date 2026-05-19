//! docs.rs vertical extractor — rustdoc JSON API reference.
//!
//! Matches any `https://docs.rs/{crate}` or `https://docs.rs/{crate}/{version}/...`
//! URL and fetches the gzip-compressed rustdoc JSON from docs.rs instead of
//! scraping HTML. The JSON contains every public item with its doc comment,
//! type signature, and module path — far richer than what HTML scraping produces.
//!
//! docs.rs started building rustdoc JSON on 2025-05-23. Older releases get a
//! graceful 404 and this extractor returns `VerticalTargetNotFound`.
//!
//! `fetch_rustdoc_docs()` is `pub(super)` so `crates_io.rs` can call it
//! without duplicating the logic.

use crate::core::http::http_client;
use crate::extract::context::VerticalContext;
use crate::extract::error::VerticalError;
use crate::extract::types::{ExtractorInfo, ScrapedDoc};

pub const INFO: ExtractorInfo = ExtractorInfo {
    name: "docs_rs",
    label: "docs.rs API Reference",
    description: "Fetches rustdoc JSON from docs.rs — all public items with doc comments, \
        type signatures, and module paths. Structured machine-readable format; \
        no HTML noise.",
    url_patterns: &[
        "https://docs.rs/{crate}",
        "https://docs.rs/{crate}/{version}",
        "https://docs.rs/{crate}/{version}/{module}/...",
    ],
    auto_dispatch: true,
};

/// Returns `true` for any URL on docs.rs with at least a crate name segment.
pub fn matches(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    parsed.host_str().map(|h| h.eq_ignore_ascii_case("docs.rs")) == Some(true)
        && !parsed.path().trim_matches('/').is_empty()
}

pub async fn extract(url: &str, ctx: &VerticalContext) -> Result<ScrapedDoc, VerticalError> {
    let (name, version) =
        parse_crate_and_version(url).ok_or_else(|| VerticalError::VerticalUnsupportedUrl {
            vertical: INFO.name,
            url: url.to_string(),
        })?;

    let ua = ctx.ua();
    let client = http_client().map_err(|_| VerticalError::VerticalTargetUnavailable {
        vertical: INFO.name,
        status: 0,
    })?;

    let api_docs = fetch_rustdoc_docs(client, &name, &version, ua)
        .await
        .ok_or_else(|| VerticalError::VerticalTargetNotFound {
            vertical: INFO.name,
            url: url.to_string(),
        })?;

    // Pull the resolved version from the JSON itself for an accurate title.
    let (markdown, title) = build_markdown(&name, &api_docs, url);

    Ok(ScrapedDoc {
        url: url.to_string(),
        markdown,
        title,
        extractor_name: INFO.name,
        extractor_version: 1,
        structured: None,
        follow_crawl_urls: vec![],
    })
}

/// Parse `(crate_name, version)` from a docs.rs URL.
///
/// - `https://docs.rs/tokio`               → ("tokio", "latest")
/// - `https://docs.rs/tokio/1.38.0`        → ("tokio", "1.38.0")
/// - `https://docs.rs/tokio/latest/tokio/sync` → ("tokio", "latest")
fn parse_crate_and_version(url: &str) -> Option<(String, String)> {
    let parsed = url::Url::parse(url).ok()?;
    let path = parsed.path().trim_matches('/');
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let name = segs.first()?.to_string();
    let version = segs
        .get(1)
        .filter(|v| *v == &"latest" || v.starts_with(|c: char| c.is_ascii_digit()))
        .map(|v| v.to_string())
        .unwrap_or_else(|| "latest".to_string());
    Some((name, version))
}

fn build_markdown(name: &str, api_docs: &str, url: &str) -> (String, Option<String>) {
    let title = format!("{name} API Reference");
    let mut md = format!("# {title}\n\n");
    md.push_str(&format!("Source: {url}\n\n"));
    md.push_str(api_docs);
    (md, Some(title))
}

// ── Rustdoc JSON fetching (also used by crates_io.rs) ─────────────────────────

/// Fetch and convert the rustdoc JSON gzip for the crate to markdown.
///
/// Tries the specific version first, then falls back to "latest". Returns
/// `None` when docs.rs has no JSON for this version or on any network error.
///
/// `pub(super)` so `crates_io.rs` can call this without duplicating logic.
pub(super) async fn fetch_rustdoc_docs(
    client: &reqwest::Client,
    name: &str,
    version: &str,
    ua: &str,
) -> Option<String> {
    for ver in [version, "latest"] {
        let url = format!("https://docs.rs/crate/{name}/{ver}/json.gz");
        if let Some(md) = try_fetch_rustdoc_gz(client, &url, ua, name).await {
            return Some(md);
        }
    }
    None
}

async fn try_fetch_rustdoc_gz(
    client: &reqwest::Client,
    url: &str,
    ua: &str,
    crate_name: &str,
) -> Option<String> {
    let resp = client.get(url).header("User-Agent", ua).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    let json = decompress_and_parse_gz(&bytes)?;
    Some(rustdoc_to_markdown(&json, crate_name))
}

fn decompress_and_parse_gz(bytes: &[u8]) -> Option<serde_json::Value> {
    use flate2::read::GzDecoder;
    use std::io::Read;
    let mut decoder = GzDecoder::new(bytes);
    let mut buf = Vec::new();
    decoder.read_to_end(&mut buf).ok()?;
    serde_json::from_slice(&buf).ok()
}

/// Item kinds that are containers or sub-items — skipped to avoid redundancy.
fn should_skip_kind(kind: &str) -> bool {
    matches!(
        kind,
        "module"
            | "impl"
            | "use"
            | "extern_crate"
            | "struct_field"
            | "variant"
            | "assoc_type"
            | "assoc_const"
            | "keyword"
            | "primitive"
    )
}

/// Convert rustdoc JSON to a markdown section listing every public item with
/// its doc comment. Capped at 150 000 chars for very large crates.
fn rustdoc_to_markdown(data: &serde_json::Value, crate_name: &str) -> String {
    let Some(index) = data["index"].as_object() else {
        return String::new();
    };
    let paths = data["paths"].as_object();

    let mut items: Vec<(String, &str, &str)> = vec![];
    for (id, item) in index {
        if item["visibility"].as_str() != Some("public") {
            continue;
        }
        let docs = match item["docs"].as_str().filter(|d| !d.is_empty()) {
            Some(d) => d,
            None => continue,
        };
        let kind = match item["inner"]
            .as_object()
            .and_then(|o| o.keys().next())
            .map(|s| s.as_str())
        {
            Some(k) => k,
            None => continue,
        };
        if should_skip_kind(kind) {
            continue;
        }
        let path = paths
            .and_then(|p| p.get(id.as_str()))
            .and_then(|v| v["path"].as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join("::")
            })
            .unwrap_or_else(|| item["name"].as_str().unwrap_or("?").to_string());
        items.push((path, kind, docs));
    }

    items.sort_by(|a, b| a.0.cmp(&b.0));

    // Use crate_version from the JSON if present.
    let version = data["crate_version"].as_str().unwrap_or("?");
    let mut md = format!("## {crate_name} {version} API Reference\n\n");
    let mut total = 0usize;
    const CAP: usize = 150_000;
    let count = items.len();

    for (path, kind, docs) in &items {
        if total >= CAP {
            break;
        }
        let preview: String = docs.chars().take(600).collect();
        let suffix = if docs.len() > 600 { "..." } else { "" };
        let entry = format!("### `{path}` ({kind})\n\n{preview}{suffix}\n\n");
        total += entry.len();
        md.push_str(&entry);
    }

    md.push_str(&format!("*{count} public items with documentation.*\n"));
    md
}

#[cfg(test)]
#[path = "docs_rs_tests.rs"]
mod tests;
