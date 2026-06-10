use super::*;

#[tokio::test]
async fn generic_file_docs_chunk_rust_as_code_with_symbols() {
    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path();
    std::fs::write(root.join("lib.rs"), "fn alpha() {}\n\nfn beta() {}\n").unwrap();
    let target = GenericGitTarget {
        host: "example.com".into(),
        name: "repo".into(),
        clone_url: "https://example.com/r.git".into(),
        web_url: "https://example.com/r".into(),
    };
    let docs = file_docs(root, &target, "main", root.join("lib.rs"), "git", "git")
        .await
        .unwrap();
    assert!(!docs.is_empty());
    let extra = docs[0].extra.as_ref().unwrap();
    assert_eq!(extra["code_chunking_method"], "tree_sitter");
    assert_eq!(extra["code_file_type"], "source");
    assert!(
        docs.iter()
            .any(|d| d.extra.as_ref().unwrap()["symbol_kind"] == "function"),
        "expected at least one function-symbol chunk"
    );
}

#[test]
fn parses_explicit_https_git_target() {
    let target = parse_generic_git_target("git:https://example.com/org/repo.git").unwrap();
    assert_eq!(target.host, "example.com");
    assert_eq!(target.name, "repo");
    assert_eq!(target.clone_url, "https://example.com/org/repo.git");
    assert_eq!(target.web_url, "https://example.com/org/repo");
}

#[test]
fn rejects_non_https_generic_git_target() {
    assert!(parse_generic_git_target("git:ssh://example.com/org/repo.git").is_err());
    assert!(parse_generic_git_target("git:http://example.com/org/repo.git").is_err());
}
