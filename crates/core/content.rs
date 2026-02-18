use spider::url::Url;
use spider_transformations::transformation::content::{
    transform_content_input, ReturnFormat, TransformConfig, TransformInput,
};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub fn build_transform_config() -> TransformConfig {
    TransformConfig {
        return_format: ReturnFormat::Markdown,
        readability: true,
        clean_html: true,
        main_content: true,
        filter_images: true,
        filter_svg: true,
    }
}

pub fn to_markdown(html: &str) -> String {
    let input = TransformInput {
        url: None,
        content: html.as_bytes(),
        screenshot_bytes: None,
        encoding: None,
        selector_config: None,
        ignore_tags: None,
    };
    transform_content_input(input, &build_transform_config())
        .trim()
        .to_string()
}

/// Redact credentials from a URL, replacing username and password with `***`.
/// Returns `"***redacted***"` if the URL cannot be parsed.
pub fn redact_url(url: &str) -> String {
    match Url::parse(url) {
        Ok(mut parsed) => {
            if !parsed.username().is_empty() || parsed.password().is_some() {
                let _ = parsed.set_username("***");
                let _ = parsed.set_password(Some("***"));
            }
            parsed.to_string()
        }
        Err(_) => "***redacted***".to_string(),
    }
}

pub fn url_to_filename(url: &str, idx: u32) -> String {
    let parsed = Url::parse(url).ok();
    let host = parsed
        .as_ref()
        .and_then(|u| u.host_str())
        .unwrap_or("unknown-host");
    let path = parsed.as_ref().map(|u| u.path()).unwrap_or("/unknown-path");

    let stem_raw = format!("{host}{path}");
    let mut stem = String::with_capacity(stem_raw.len());
    for ch in stem_raw.chars() {
        if ch.is_ascii_alphanumeric() {
            stem.push(ch.to_ascii_lowercase());
        } else {
            stem.push('-');
        }
    }

    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    let hash = hasher.finish();
    format!("{:04}-{stem}-{hash:016x}.md", idx)
}

pub fn find_between<'a>(haystack: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let s = haystack.find(start)? + start.len();
    let e = haystack[s..].find(end)? + s;
    Some(haystack[s..e].trim())
}

pub fn extract_meta_description(html: &str) -> Option<String> {
    // Lowercase once upfront to avoid repeated allocations.
    let lower = html.to_ascii_lowercase();
    let marker = "name=\"description\"";
    let idx = lower.find(marker)?;
    let content_idx = lower[idx..].find("content=\"")? + idx + "content=\"".len();
    let rest = &html[content_idx..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

pub fn extract_links(html: &str, limit: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while let Some(rel) = html[pos..].find("href=\"") {
        let start = pos + rel + 6;
        let remain = &html[start..];
        let Some(end_rel) = remain.find('"') else {
            break;
        };
        let link = remain[..end_rel].trim();
        if (link.starts_with("http://") || link.starts_with("https://"))
            && !out.iter().any(|x| x == link)
        {
            out.push(link.to_string());
            if out.len() >= limit {
                break;
            }
        }
        pos = start + end_rel + 1;
    }
    out
}

pub fn extract_loc_values(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while let Some(start_rel) = xml[pos..].find("<loc>") {
        let start = pos + start_rel + 5;
        if let Some(end_rel) = xml[start..].find("</loc>") {
            let end = start + end_rel;
            let value = xml[start..end].trim();
            if !value.is_empty() {
                out.push(value.to_string());
            }
            pos = end + 6;
        } else {
            break;
        }
    }
    out
}
