mod deterministic;

#[cfg(test)]
mod tests;

pub use deterministic::{
    DeterministicExtractionEngine, DeterministicParser, ExtractRun, ExtractionMetrics,
    PageExtraction,
};

use super::http::http_client;
use deterministic::{extract_items_fallback, FallbackResponse};
use spider::url::Url;
use spider::website::Website;
use spider_transformations::transformation::content::{
    transform_content_input, ReturnFormat, TransformConfig, TransformInput,
};
use std::collections::HashMap;
use std::error::Error;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

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
    let stem: String = stem_raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .take(80)
        .collect();

    format!("{:04}-{stem}.md", idx)
}

pub fn find_between<'a>(haystack: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let s = haystack.find(start)? + start.len();
    let e = haystack[s..].find(end)? + s;
    Some(haystack[s..e].trim())
}

pub fn extract_meta_description(html: &str) -> Option<String> {
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
    let lower = xml.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(start) = lower[cursor..].find("<loc>") {
        let start_idx = cursor + start + "<loc>".len();
        let Some(end_rel) = lower[start_idx..].find("</loc>") else {
            break;
        };
        let end_idx = start_idx + end_rel;
        let value = xml[start_idx..end_idx].trim();
        if !value.is_empty() {
            out.push(value.replace("&amp;", "&"));
        }
        cursor = end_idx + "</loc>".len();
    }
    out
}

pub fn normalize_prefix(prefix: &str) -> Option<String> {
    let trimmed = prefix.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return None;
    }
    let mut value = if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    };
    if value.len() > 1 && value.ends_with('/') {
        value.truncate(value.len() - 1);
    }
    Some(value)
}

pub fn is_excluded_url_path(url: &str, prefixes: &[String]) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let path = parsed.path();
    prefixes
        .iter()
        .filter_map(|p| normalize_prefix(p))
        .any(|p| path == p || (path.starts_with(&p) && path.as_bytes().get(p.len()) == Some(&b'/')))
}

pub fn canonicalize_url(url: &str) -> Option<String> {
    let mut parsed = Url::parse(url).ok()?;
    parsed.set_fragment(None);
    let path = parsed.path().to_string();
    if path.len() > 1 && path.ends_with('/') {
        parsed.set_path(path.trim_end_matches('/'));
    }
    Some(parsed.to_string())
}

pub fn extract_robots_sitemaps(robots_txt: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in robots_txt.lines() {
        let line = line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if !key.trim().eq_ignore_ascii_case("sitemap") {
            continue;
        }
        let url = value.trim();
        if !url.is_empty() {
            out.push(url.to_string());
        }
    }
    out.sort();
    out.dedup();
    out
}

pub async fn run_extract_with_engine(
    start_url: &str,
    prompt: &str,
    limit: u32,
    openai_base_url: &str,
    openai_api_key: &str,
    openai_model: &str,
    engine: Arc<DeterministicExtractionEngine>,
) -> Result<ExtractRun, Box<dyn Error>> {
    let api_url = format!("{}/chat/completions", openai_base_url.trim_end_matches('/'));
    let has_fallback = !openai_base_url.is_empty()
        && !openai_api_key.is_empty()
        && !openai_model.is_empty()
        && openai_base_url.starts_with("http");

    let api_key = openai_api_key.to_string();
    let model = openai_model.to_string();
    let prompt_text = prompt.to_string();

    let mut website = Website::new(start_url)
        .with_limit(limit)
        .build()
        .map_err(|_| "build website")?;

    let mut rx = website.subscribe(16).ok_or("subscribe failed")?;
    let client = http_client()?.clone();
    let engine_for_task = Arc::clone(&engine);

    let collect = tokio::spawn(async move {
        let mut all_results: Vec<serde_json::Value> = vec![];
        let mut pages_visited = 0usize;
        let mut pages_with_data = 0usize;
        let mut metrics = ExtractionMetrics::default();
        let mut parser_hits: HashMap<String, usize> = HashMap::new();
        let fallback_limiter = Arc::new(Semaphore::new(4));
        let mut fallback_tasks: JoinSet<(String, Result<FallbackResponse, String>)> =
            JoinSet::new();

        while let Ok(page) = rx.recv().await {
            pages_visited += 1;
            let page_url = page.get_url().to_string();
            let html = page.get_html();
            if html.is_empty() {
                continue;
            }

            let deterministic = engine_for_task.extract(&page_url, &html);
            if !deterministic.items.is_empty() {
                metrics.deterministic_pages += 1;
                pages_with_data += 1;
                all_results.extend(deterministic.items);
                for hit in deterministic.parser_hits {
                    *parser_hits.entry(hit).or_insert(0) += 1;
                }
                continue;
            }

            if !has_fallback {
                continue;
            }

            metrics.llm_fallback_pages += 1;
            metrics.llm_requests += 1;
            let api_url_cloned = api_url.clone();
            let api_key_cloned = api_key.clone();
            let model_cloned = model.clone();
            let prompt_cloned = prompt_text.clone();
            let client_cloned = client.clone();
            let limiter = Arc::clone(&fallback_limiter);
            let markdown = to_markdown(&html);

            fallback_tasks.spawn(async move {
                let Some(permit) = limiter.acquire_owned().await.ok() else {
                    return (page_url, Err("fallback limiter closed".to_string()));
                };
                let _permit = permit;
                let fallback = extract_items_fallback(
                    &client_cloned,
                    &api_url_cloned,
                    &api_key_cloned,
                    &model_cloned,
                    &prompt_cloned,
                    &page_url,
                    &markdown,
                )
                .await
                .map_err(|err| err.to_string());
                (page_url, fallback)
            });

            while let Some(joined) = fallback_tasks.try_join_next() {
                if let Ok((_page_url, Ok(fallback))) = joined {
                    metrics.prompt_tokens += fallback.prompt_tokens;
                    metrics.completion_tokens += fallback.completion_tokens;
                    metrics.total_tokens += fallback.total_tokens;
                    metrics.estimated_cost_usd += fallback.estimated_cost_usd;
                    if !fallback.items.is_empty() {
                        pages_with_data += 1;
                        all_results.extend(fallback.items);
                    }
                }
            }
        }

        while let Some(joined) = fallback_tasks.join_next().await {
            if let Ok((_page_url, Ok(fallback))) = joined {
                metrics.prompt_tokens += fallback.prompt_tokens;
                metrics.completion_tokens += fallback.completion_tokens;
                metrics.total_tokens += fallback.total_tokens;
                metrics.estimated_cost_usd += fallback.estimated_cost_usd;
                if !fallback.items.is_empty() {
                    pages_with_data += 1;
                    all_results.extend(fallback.items);
                }
            }
        }

        (
            all_results,
            pages_visited,
            pages_with_data,
            metrics,
            parser_hits,
        )
    });

    website.crawl_raw().await;
    website.unsubscribe();

    let (results, pages_visited, pages_with_data, metrics, parser_hits) = collect.await?;

    Ok(ExtractRun {
        start_url: start_url.to_string(),
        pages_visited,
        pages_with_data,
        results,
        metrics,
        parser_hits,
    })
}
