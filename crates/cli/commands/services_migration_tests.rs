#[test]
fn migrated_cli_commands_do_not_import_raw_business_logic_layers() {
    let checks = [
        (
            "evaluate.rs",
            include_str!("evaluate.rs"),
            &["vector::ops::run_evaluate_native"][..],
        ),
        (
            "suggest.rs",
            include_str!("suggest.rs"),
            &["vector::ops::run_suggest_native"][..],
        ),
        (
            "crawl.rs",
            include_str!("crawl.rs"),
            &["jobs::crawl::start_crawl_jobs_batch"][..],
        ),
        (
            "embed.rs",
            include_str!("embed.rs"),
            &["vector::ops::embed_path_native"][..],
        ),
        (
            "scrape.rs",
            include_str!("scrape.rs"),
            &[
                "crawl::scrape::{build_scrape_website, fetch_single_page, select_output}",
                "vector::ops::embed_path_native",
            ][..],
        ),
        (
            "refresh.rs",
            include_str!("refresh.rs"),
            &["jobs::refresh::{"][..],
        ),
        (
            "debug.rs",
            include_str!("debug.rs"),
            &["build_doctor_report", "http_client()"][..],
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
