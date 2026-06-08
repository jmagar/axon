use super::*;

fn test_ctx(repo_root: PathBuf) -> FileEmbedCtx {
    FileEmbedCtx {
        cfg: Config::test_default(),
        repo_root,
        owner: "owner".into(),
        name: "repo".into(),
        default_branch: "main".into(),
        repo_description: None,
        pushed_at: None,
        is_private: Some(false),
    }
}

#[tokio::test]
async fn read_file_embed_docs_writes_symbol_payload_contract() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let src_dir = tmp.path().join("src");
    tokio::fs::create_dir_all(&src_dir)
        .await
        .expect("create src");
    tokio::fs::write(
        src_dir.join("lib.rs"),
        format!(
            "struct Response;\n\nimpl Response {{\n    pub fn parse(&self) {{\n{}\n    }}\n}}\n",
            (0..90)
                .map(|i| format!("        let value_{i} = {i};"))
                .collect::<Vec<_>>()
                .join("\n")
        ),
    )
    .await
    .expect("write rust file");

    let docs = read_file_embed_docs(&test_ctx(tmp.path().to_path_buf()), "src/lib.rs")
        .await
        .expect("read docs");

    let method_doc = docs
        .iter()
        .find(|doc| {
            doc.extra
                .as_ref()
                .and_then(|extra| extra.get("symbol_name"))
                .and_then(|value| value.as_str())
                == Some("Response::parse")
        })
        .expect("method doc with symbol payload");
    let extra = method_doc.extra.as_ref().expect("github payload");
    assert_eq!(extra["provider"], "github");
    assert_eq!(extra["git_content_kind"], "file");
    assert_eq!(extra["chunking_method"], "tree_sitter");
    assert_eq!(extra["symbol_name"], "Response::parse");
    assert_eq!(extra["symbol_kind"], "method");
    assert_eq!(extra["symbol_extraction_status"], "ok");
    assert!(
        method_doc
            .url
            .starts_with("https://github.com/owner/repo/blob/main/src/lib.rs#L")
    );
}

#[tokio::test]
async fn read_file_embed_docs_reports_unexpected_read_failures() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let err = read_file_embed_docs(&test_ctx(tmp.path().to_path_buf()), "missing.rs")
        .await
        .expect_err("missing file should be a read failure");
    assert!(err.contains("stat failed for missing.rs"));
}
