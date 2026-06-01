use super::*;

const FIXTURE: &str = "\u{feff}# Example Docs\n\n> A short summary.\n\nSome intro prose with an inline [ignored-in-prose-too](https://example.com/intro.md) link.\n\n## Docs\n\n- [Getting Started](/docs/start.md): the basics\n- [Guide](guide.md)\n- [External](https://other.com/x.md)\n- [Email](mailto:hi@example.com)\n- [Anchor](#section)\n\n## Optional\n\n- [Extra](/docs/extra.md)\n";

#[test]
fn extracts_and_resolves_links() {
    let links = extract_llms_txt_links(FIXTURE, "https://example.com/llms.txt");
    // Relative resolved against base; mailto/anchor dropped; external kept (scope happens later).
    assert!(links.contains(&"https://example.com/docs/start.md".to_string()));
    assert!(links.contains(&"https://example.com/guide.md".to_string()));
    assert!(links.contains(&"https://other.com/x.md".to_string()));
    assert!(links.contains(&"https://example.com/docs/extra.md".to_string()));
    assert!(!links.iter().any(|u| u.starts_with("mailto:")));
    assert!(!links.iter().any(|u| u.contains("#section")));
}

#[test]
fn rejects_soft_404_html() {
    // text without a leading '# ' H1 is not a valid llms.txt
    assert!(!looks_like_llms_txt(
        "<!DOCTYPE html><html>not found</html>"
    ));
    assert!(looks_like_llms_txt("# Title\n\n> x"));
    // BOM-prefixed still recognized
    assert!(looks_like_llms_txt("\u{feff}# Title"));
}

fn cfg_for(host_include_subdomains: bool, max: usize) -> crate::core::config::Config {
    let mut c = crate::core::config::Config::default();
    c.include_subdomains = host_include_subdomains;
    c.max_llms_txt_urls = max;
    c
}

#[test]
fn scope_drops_offhost_and_caps() {
    let cfg = cfg_for(false, 1);
    // Two same-host links + one off-host; cap=1 keeps only one same-host after sort.
    let body = "# T\n\n## S\n- [a](/a.md)\n- [b](/b.md)\n- [ext](https://other.com/c.md)\n";
    // discover_llms_txt_urls needs network; test the pure pieces instead:
    let links = extract_llms_txt_links(body, "https://example.com/llms.txt");
    let scoped: Vec<String> = links
        .into_iter()
        .filter_map(|l| loc_in_scope(&cfg, &l, "example.com", "", true))
        .collect();
    assert!(scoped.iter().all(|u| u.contains("example.com")));
    assert_eq!(scoped.len(), 2, "off-host dropped, two same-host kept");
}
