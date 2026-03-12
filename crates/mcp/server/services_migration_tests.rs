#[test]
fn migrated_mcp_handlers_do_not_import_jobs_layers_directly() {
    let checks = [
        (
            "handlers_embed_ingest.rs",
            include_str!("handlers_embed_ingest.rs"),
            &["crate::crates::jobs::embed", "crate::crates::jobs::ingest"][..],
        ),
        (
            "handlers_crawl_extract.rs",
            include_str!("handlers_crawl_extract.rs"),
            &["crate::crates::jobs::crawl", "crate::crates::jobs::extract"][..],
        ),
        (
            "handlers_refresh_status.rs",
            include_str!("handlers_refresh_status.rs"),
            &["crate::crates::jobs::refresh"][..],
        ),
        (
            "handlers_system.rs",
            include_str!("handlers_system.rs"),
            &["crawl::screenshot::spider_screenshot_with_options"][..],
        ),
    ];

    for (file, source, forbidden_fragments) in checks {
        for forbidden in forbidden_fragments {
            assert!(
                !source.contains(forbidden),
                "{file} still contains forbidden direct-layer reference: {forbidden}"
            );
        }
    }
}
