use crate::crates::core::content::is_excluded_url_path;
use crate::crates::jobs::crawl::sitemap;
use std::error::Error;

#[derive(Debug, Clone)]
pub(crate) struct StartPlan {
    pub start_url: String,
}

pub(crate) fn build_start_plan(
    start_url: &str,
    exclude_path_prefix: &[String],
) -> Result<StartPlan, Box<dyn Error>> {
    let canonical_start_url =
        sitemap::canonicalize_url(start_url).ok_or("invalid crawl start URL")?;
    if is_excluded_url_path(&canonical_start_url, exclude_path_prefix) {
        return Err(format!("skipping {canonical_start_url} — path excluded by prefix").into());
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
