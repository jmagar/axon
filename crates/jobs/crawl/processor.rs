use crate::crates::jobs::crawl::sitemap;
use spider::url::Url;
use std::error::Error;

#[derive(Debug, Clone)]
pub(crate) struct StartPlan {
    pub start_url: String,
}

/// Returns the first prefix in `exclude_path_prefix` that matches the URL's path,
/// or `None` if no prefix matches.
fn find_excluded_prefix<'a>(url: &str, exclude_path_prefix: &'a [String]) -> Option<&'a str> {
    let Ok(parsed) = Url::parse(url) else {
        return None;
    };
    let path = parsed.path();
    exclude_path_prefix.iter().find_map(|raw| {
        let p = raw.trim().trim_end_matches('/');
        if p.is_empty() || p == "/" {
            return None;
        }
        let matched = if p.starts_with('/') {
            path == p
                || (path.starts_with(p)
                    && matches!(
                        path.as_bytes().get(p.len()),
                        Some(&b'/') | Some(&b'-') | None
                    ))
        } else {
            path == format!("/{p}")
                || (path.starts_with(&format!("/{p}"))
                    && matches!(
                        path.as_bytes().get(p.len() + 1),
                        Some(&b'/') | Some(&b'-') | None
                    ))
        };
        if matched { Some(raw.as_str()) } else { None }
    })
}

pub(crate) fn build_start_plan(
    start_url: &str,
    exclude_path_prefix: &[String],
) -> Result<StartPlan, Box<dyn Error>> {
    let canonical_start_url =
        sitemap::canonicalize_url(start_url).ok_or("invalid crawl start URL")?;
    if let Some(prefix) = find_excluded_prefix(&canonical_start_url, exclude_path_prefix) {
        return Err(format!(
            "skipping {canonical_start_url} — path excluded by prefix \"{prefix}\""
        )
        .into());
    }
    Ok(StartPlan {
        start_url: canonical_start_url,
    })
}

#[cfg(test)]
mod tests {
    use super::build_start_plan;

    #[test]
    fn build_start_plan_normalizes_url() {
        let plan = build_start_plan("https://example.com/path/#frag", &[]).expect("build plan");
        assert_eq!(plan.start_url, "https://example.com/path".to_string());
    }

    #[test]
    fn build_start_plan_rejects_excluded_start_url() {
        let err = build_start_plan(
            "https://example.com/private/area",
            &["/private".to_string()],
        )
        .expect_err("excluded start URL must fail");
        assert!(err.to_string().contains("path excluded by prefix"));
    }
}
