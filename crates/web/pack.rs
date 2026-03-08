//! Repomix-style packing of crawl output into a single AI-friendly file.
//!
//! Two formats:
//! - Markdown: fenced code blocks with `## File:` headers
//! - XML: `<file path="...">` elements (compatible with Claude/GPT context windows)

/// Build a packed Markdown document from crawl entries.
///
/// Each entry is `(url, relative_path, content)`.
pub fn build_pack_md(domain: &str, entries: &[(String, String, String)]) -> String {
    let mut out = String::with_capacity(entries.iter().map(|(_, _, c)| c.len() + 120).sum());
    out.push_str(&format!("# Crawl Pack: {domain}\n\n"));
    out.push_str(&format!(
        "This file contains {} pages from `{domain}`, packed for LLM consumption.\n\n",
        entries.len()
    ));
    out.push_str("---\n\n");

    for (url, rel_path, content) in entries {
        out.push_str(&format!("## File: {rel_path}\n\n"));
        out.push_str(&format!("Source: {url}\n\n"));
        out.push_str("````markdown\n");
        // Escape any ```````` sequences inside content to prevent fence breakout
        out.push_str(&content.replace("````", "` ` ` `"));
        if !content.ends_with('\n') {
            out.push('\n');
        }
        out.push_str("````\n\n");
    }

    out
}

/// Build a packed XML document from crawl entries.
///
/// Each entry is `(url, relative_path, content)`.
pub fn build_pack_xml(domain: &str, entries: &[(String, String, String)]) -> String {
    let mut out = String::with_capacity(entries.iter().map(|(_, _, c)| c.len() + 200).sum());
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str(&format!(
        "<crawl_pack domain=\"{}\" file_count=\"{}\">\n",
        escape_xml_attr(domain),
        entries.len()
    ));

    for (url, rel_path, content) in entries {
        out.push_str(&format!(
            "  <file path=\"{}\" source=\"{}\">\n",
            escape_xml_attr(rel_path),
            escape_xml_attr(url),
        ));
        out.push_str(&escape_xml_text(content));
        if !content.ends_with('\n') {
            out.push('\n');
        }
        out.push_str("  </file>\n");
    }

    out.push_str("</crawl_pack>\n");
    out
}

fn escape_xml_attr(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 16);
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
    out
}

fn escape_xml_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_md_basic_snapshot() {
        let entries = vec![
            (
                "https://example.com/a".into(),
                "a.md".into(),
                "Hello world".into(),
            ),
            (
                "https://example.com/b".into(),
                "b.md".into(),
                "Second page".into(),
            ),
        ];
        let result = build_pack_md("example.com", &entries);
        insta::assert_snapshot!(result);
    }

    #[test]
    fn pack_md_escapes_fence() {
        let entries = vec![(
            "https://example.com".into(),
            "test.md".into(),
            "before ```` after".into(),
        )];
        let result = build_pack_md("example.com", &entries);
        assert!(!result.contains("before ````"), "fence should be escaped");
        assert!(result.contains("` ` ` `"));
    }

    #[test]
    fn pack_xml_basic() {
        let entries = vec![(
            "https://example.com/page".into(),
            "page.md".into(),
            "Some content".into(),
        )];
        let result = build_pack_xml("example.com", &entries);
        assert!(result.starts_with("<?xml"));
        assert!(result.contains("domain=\"example.com\""));
        assert!(result.contains("file_count=\"1\""));
        assert!(result.contains("path=\"page.md\""));
        assert!(result.contains("Some content"));
    }

    #[test]
    fn pack_xml_escapes_special_chars() {
        let entries = vec![(
            "https://example.com/a&b".into(),
            "a&b.md".into(),
            "<script>alert('xss')</script>".into(),
        )];
        let result = build_pack_xml("example.com", &entries);
        assert!(result.contains("source=\"https://example.com/a&amp;b\""));
        assert!(result.contains("path=\"a&amp;b.md\""));
        assert!(result.contains("&lt;script&gt;"));
        assert!(!result.contains("<script>"));
    }

    #[test]
    fn pack_empty_entries() {
        let entries: Vec<(String, String, String)> = vec![];
        let md = build_pack_md("empty.com", &entries);
        assert!(md.contains("0 pages"));
        let xml = build_pack_xml("empty.com", &entries);
        assert!(xml.contains("file_count=\"0\""));
    }

    #[test]
    fn pack_md_content_without_trailing_newline_no_double_newline() {
        // Content with no trailing newline — the function adds exactly one '\n'
        // before the closing fence. The sequence "hello\n````" must appear.
        // Note: "\n\n````" appears in the output from the blank line before the
        // OPENING fence (Source: url\n\n````markdown). We only verify that no
        // blank line is inserted immediately before the CLOSING fence —
        // i.e. "hello\n\n````" must not appear.
        let entries = vec![(
            "https://example.com/x".into(),
            "x.md".into(),
            "hello".into(),
        )];
        let result = build_pack_md("example.com", &entries);
        assert!(
            result.contains("hello\n````"),
            "expected single newline before closing fence"
        );
        assert!(
            !result.contains("hello\n\n````"),
            "unexpected blank line immediately before closing fence"
        );
    }

    #[test]
    fn pack_md_content_with_trailing_newline_no_extra_blank() {
        // Content already ends with '\n' — no second '\n' should be injected.
        // "hello\n````" must appear; "hello\n\n````" must not.
        let entries = vec![(
            "https://example.com/y".into(),
            "y.md".into(),
            "hello\n".into(),
        )];
        let result = build_pack_md("example.com", &entries);
        assert!(
            result.contains("hello\n````"),
            "expected content+newline then closing fence"
        );
        assert!(
            !result.contains("hello\n\n````"),
            "unexpected extra blank line before closing fence"
        );
    }

    #[test]
    fn pack_xml_file_count_multiple() {
        let entries = vec![
            ("https://a.com/1".into(), "1.md".into(), "c1".into()),
            ("https://a.com/2".into(), "2.md".into(), "c2".into()),
            ("https://a.com/3".into(), "3.md".into(), "c3".into()),
        ];
        let result = build_pack_xml("a.com", &entries);
        assert!(result.contains("file_count=\"3\""));
    }

    #[test]
    fn pack_xml_single_quote_in_domain() {
        // Single quotes are NOT in the escape_xml_attr match arms (only &, ", <, >).
        // They pass through verbatim — this test documents that behaviour.
        let result = build_pack_xml("it's-weird.com", &[]);
        // Must not panic; single quote appears verbatim (not escaped to &apos;)
        assert!(
            result.contains("it's-weird.com"),
            "single quote should appear verbatim"
        );
    }

    #[test]
    fn pack_xml_unicode_content() {
        let entries = vec![(
            "https://example.com/emoji".into(),
            "emoji.md".into(),
            "Hello 🌍".into(),
        )];
        let result = build_pack_xml("example.com", &entries);
        assert!(
            result.contains("Hello 🌍"),
            "emoji should appear verbatim in xml output"
        );
    }

    #[test]
    fn pack_md_multiple_entries_all_present() {
        let entries = vec![
            (
                "https://example.com/alpha".into(),
                "alpha.md".into(),
                "Alpha content".into(),
            ),
            (
                "https://example.com/beta".into(),
                "beta.md".into(),
                "Beta content".into(),
            ),
        ];
        let result = build_pack_md("example.com", &entries);
        assert!(result.contains("## File: alpha.md"), "alpha header missing");
        assert!(result.contains("## File: beta.md"), "beta header missing");
    }
}
