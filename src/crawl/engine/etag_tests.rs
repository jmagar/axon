use super::*;
use crate::crawl::manifest::ManifestEntry;
use std::collections::{HashMap, HashSet};

fn entry(url: &str, hash: &str) -> ManifestEntry {
    ManifestEntry {
        url: url.to_string(),
        relative_path: format!("markdown/{}.md", url_slug(url)),
        markdown_chars: 1234,
        content_hash: Some(hash.to_string()),
        changed: true,
        structured: None,
    }
}

fn url_slug(url: &str) -> String {
    url.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

// ── reconcile_targets: the zombie-safety predicate ──────────────────────────

#[test]
fn reconcile_targets_selects_only_seeded_and_absent() {
    let mut prev = HashMap::new();
    prev.insert("https://x/a".to_string(), entry("https://x/a", "h1"));
    prev.insert("https://x/b".to_string(), entry("https://x/b", "h2"));
    prev.insert("https://x/c".to_string(), entry("https://x/c", "h3"));

    // a: seeded + absent → reconcile (a 304 skip)
    // b: seeded but arrived (e.g. changed, re-fetched) → NOT reconciled
    // c: arrived, never seeded → NOT reconciled
    let seeded: HashSet<String> = ["https://x/a", "https://x/b"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let arrived: HashSet<String> = ["https://x/b", "https://x/c"]
        .iter()
        .map(|s| s.to_string())
        .collect();

    let targets = reconcile_targets(&prev, &seeded, &arrived);
    assert_eq!(targets, vec!["https://x/a".to_string()]);
}

#[test]
fn reconcile_targets_empty_seed_yields_no_zombies() {
    // The safe-by-construction property: with no working seed, nothing is
    // reconciled even when previous_manifest URLs are absent from arrivals.
    let mut prev = HashMap::new();
    prev.insert("https://x/gone".to_string(), entry("https://x/gone", "h1"));
    let seeded = HashSet::new();
    let arrived = HashSet::new();
    assert!(reconcile_targets(&prev, &seeded, &arrived).is_empty());
}

#[test]
fn reconcile_targets_orphan_with_validator_is_the_irreducible_residual() {
    // A genuinely-removed page that still carried a validator is indistinguishable
    // from a 304 at this layer; it IS reconciled (kept one more run). This test
    // pins that documented behavior so a future change is a conscious decision.
    let mut prev = HashMap::new();
    prev.insert(
        "https://x/removed".to_string(),
        entry("https://x/removed", "h1"),
    );
    let seeded: HashSet<String> = ["https://x/removed"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let arrived = HashSet::new();
    assert_eq!(
        reconcile_targets(&prev, &seeded, &arrived),
        vec!["https://x/removed".to_string()]
    );
}

// ── reconcile_unmodified: end-to-end relink + manifest append ────────────────

#[tokio::test]
async fn reconcile_unmodified_relinks_archived_markdown_and_appends_entry() {
    let tmp = tempfile::tempdir().unwrap();
    let output_dir = tmp.path();
    let markdown_dir = output_dir.join("markdown");
    let recycling_bin = output_dir.join("markdown.old");
    tokio::fs::create_dir_all(&markdown_dir).await.unwrap();
    tokio::fs::create_dir_all(&recycling_bin).await.unwrap();

    // Previous crawl produced one page; its markdown is archived in markdown.old.
    let prev_entry = entry("https://x/stable", "hash-stable");
    let filename = Path::new(&prev_entry.relative_path).file_name().unwrap();
    tokio::fs::write(recycling_bin.join(filename), b"# stable content")
        .await
        .unwrap();

    // Fresh (empty) manifest for this run, as collect_crawl_pages would have left.
    tokio::fs::write(output_dir.join("manifest.jsonl"), b"")
        .await
        .unwrap();

    let mut previous_manifest = HashMap::new();
    previous_manifest.insert(prev_entry.url.clone(), prev_entry.clone());
    let seeded: HashSet<String> = [prev_entry.url.clone()].into_iter().collect();
    let arrived: HashSet<String> = HashSet::new(); // 304-skipped this run.

    let reconciled = reconcile_unmodified(output_dir, &previous_manifest, &seeded, &arrived).await;
    assert_eq!(reconciled, 1);

    // Markdown was relinked into the live dir.
    assert!(
        tokio::fs::try_exists(markdown_dir.join(filename))
            .await
            .unwrap()
    );

    // Manifest gained a reused (changed=false) entry for the URL.
    let manifest = tokio::fs::read_to_string(output_dir.join("manifest.jsonl"))
        .await
        .unwrap();
    let line = manifest
        .lines()
        .find(|l| l.contains("https://x/stable"))
        .unwrap();
    let parsed: ManifestEntry = serde_json::from_str(line).unwrap();
    assert_eq!(parsed.url, "https://x/stable");
    assert!(!parsed.changed, "reused entry must be marked unchanged");
    assert_eq!(parsed.content_hash.as_deref(), Some("hash-stable"));
}

#[tokio::test]
async fn reconcile_unmodified_skips_when_archive_missing() {
    let tmp = tempfile::tempdir().unwrap();
    let output_dir = tmp.path();
    tokio::fs::create_dir_all(output_dir.join("markdown"))
        .await
        .unwrap();
    tokio::fs::create_dir_all(output_dir.join("markdown.old"))
        .await
        .unwrap();
    tokio::fs::write(output_dir.join("manifest.jsonl"), b"")
        .await
        .unwrap();

    // Seeded + absent, but no archived markdown exists → cannot relink → skip.
    let prev_entry = entry("https://x/missing", "h");
    let mut previous_manifest = HashMap::new();
    previous_manifest.insert(prev_entry.url.clone(), prev_entry.clone());
    let seeded: HashSet<String> = [prev_entry.url.clone()].into_iter().collect();
    let arrived = HashSet::new();

    let reconciled = reconcile_unmodified(output_dir, &previous_manifest, &seeded, &arrived).await;
    assert_eq!(reconciled, 0);
    let manifest = tokio::fs::read_to_string(output_dir.join("manifest.jsonl"))
        .await
        .unwrap();
    assert!(manifest.trim().is_empty());
}

// ── sidecar round-trip + carry-forward ──────────────────────────────────────

#[tokio::test]
async fn sidecar_round_trips() {
    let tmp = tempfile::tempdir().unwrap();
    let mut data = HashMap::new();
    data.insert(
        "https://x/a".to_string(),
        EtagEntry {
            etag: Some("\"abc\"".to_string()),
            last_modified: Some("Wed, 21 Oct 2026 07:28:00 GMT".to_string()),
        },
    );
    write_sidecar(tmp.path(), &data).await.unwrap();
    let loaded = load_sidecar(tmp.path()).await;
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded["https://x/a"].etag.as_deref(), Some("\"abc\""));
}

#[tokio::test]
async fn load_sidecar_absent_is_empty_not_error() {
    let tmp = tempfile::tempdir().unwrap();
    assert!(load_sidecar(tmp.path()).await.is_empty());
}

// ── the spider seam: seeding materializes the cache and round-trips ──────────

#[test]
fn seed_website_etag_cache_materializes_and_round_trips() {
    // This is the make-or-break test for cross-run benefit: spider's ETag cache
    // is lazily built inside crawl setup, so seeding must force materialization
    // and successfully store()/get() validators. If this fails, conditional
    // re-crawl is inert and the feature must fall back to documented-gap.
    let mut website = Website::new("http://127.0.0.1/");
    website.configuration.with_etag_cache(true);

    let mut sidecar = HashMap::new();
    sidecar.insert(
        "http://127.0.0.1/page".to_string(),
        EtagEntry {
            etag: Some("\"v1\"".to_string()),
            last_modified: None,
        },
    );

    let seeded = seed_website_etag_cache(&mut website, &sidecar);
    assert_eq!(
        seeded.len(),
        1,
        "seeding must materialize the cache and store the validator"
    );

    let cache = website
        .get_etag_cache()
        .expect("cache must exist after seeding");
    let got = cache.get("http://127.0.0.1/page");
    assert!(got.is_some(), "seeded validator must be retrievable");
    let (etag, _last_mod) = got.unwrap();
    assert_eq!(etag.as_deref(), Some("\"v1\""));

    // Conditional headers are now non-empty → spider will send If-None-Match.
    assert!(
        !cache
            .conditional_headers("http://127.0.0.1/page")
            .is_empty(),
        "conditional headers must be produced for a seeded URL"
    );
}

#[test]
fn build_next_sidecar_carries_forward_unrefreshed_validators() {
    // A URL that 304'd this run has no live-cache entry (spider returns before
    // re-storing), so carry-forward from the previous sidecar must preserve it.
    let mut website = Website::new("http://127.0.0.1/");
    website.configuration.with_etag_cache(true);
    let _ = seed_website_etag_cache(&mut website, &HashMap::new());

    let mut previous = HashMap::new();
    previous.insert(
        "http://127.0.0.1/stable".to_string(),
        EtagEntry {
            etag: Some("\"keep\"".to_string()),
            last_modified: None,
        },
    );
    // "stable" did NOT arrive this run (304-skipped) → not in arrived set.
    let arrived: HashSet<String> = HashSet::new();
    let next = build_next_sidecar(&website, &previous, &arrived);
    assert_eq!(
        next.get("http://127.0.0.1/stable")
            .and_then(|e| e.etag.as_deref()),
        Some("\"keep\""),
        "304'd URL's validator must survive into the next sidecar"
    );
}

// ── the wire seam: seeded validators survive crawl setup and spider sends
//    If-None-Match, and a 304 yields zero broadcast pages (bead axon_rust-hiyf) ──
//
// This closes the one link the in-memory seam test cannot: that the seeded cache
// survives `crawl_raw()`'s internal setup and that spider actually puts the
// conditional header on the wire. A bare `Website` is built directly (not via
// `configure_website`) so axon's SSRF blacklist does not drop the loopback mock;
// production seeds public URLs where the blacklist is irrelevant.
//
// IMPORTANT (verified against spider 2.51 source): spider only consults the ETag
// cache for *discovered links* fetched through `crawl_concurrent_raw` — the start
// URL goes through `crawl_establish`, which does not. So the test seeds the
// *linked* page, not the start page, and asserts the conditional request fires
// for the discovered link.
#[tokio::test]
#[serial_test::serial]
async fn seeded_validators_drive_conditional_request_and_304_drops_page() {
    use httpmock::prelude::*;

    crate::core::http::set_allow_loopback(true);

    let server = MockServer::start();
    let stable_path = "/stable";
    let stable_url = format!("{}{}", server.base_url(), stable_path);

    // Start page links to the stable page so spider discovers + dispatches it
    // through the concurrent fetch loop (the only path that consults the cache).
    server.mock(|when, then| {
        when.method(GET).path("/");
        then.status(200)
            .header("content-type", "text/html")
            .body(format!(
                "<html><body><a href=\"{stable_url}\">stable</a></body></html>"
            ));
    });

    // The stable page mock only matches when If-None-Match is present and returns
    // a bodyless 304. If spider did not send the validator, this never matches and
    // `hits()` stays 0.
    let conditional = server.mock(|when, then| {
        when.method(GET)
            .path(stable_path)
            .header_exists("if-none-match");
        then.status(304);
    });

    let mut website = Website::new(&server.base_url());
    website.with_depth(2);
    website.configuration.with_etag_cache(true);

    let mut sidecar = HashMap::new();
    sidecar.insert(
        stable_url.clone(),
        EtagEntry {
            etag: Some("\"v1\"".to_string()),
            last_modified: None,
        },
    );
    let seeded = seed_website_etag_cache(&mut website, &sidecar);
    assert_eq!(seeded.len(), 1, "validator must seed before crawl");

    let mut rx = website.subscribe(16);
    website.crawl_raw().await;
    website.unsubscribe();

    // The conditional request was actually sent (seed survived setup + header on
    // the wire) and matched the 304 mock.
    assert!(
        conditional.calls() >= 1,
        "spider must send If-None-Match for the seeded discovered link (hits={})",
        conditional.calls()
    );

    // The 304'd stable page yields no content page in the broadcast — spider drops
    // it. This is exactly the silent skip the reconciliation path recovers.
    let mut pages = Vec::new();
    while let Ok(p) = rx.try_recv() {
        pages.push(p);
    }
    let delivered_stable = pages
        .iter()
        .any(|p| p.get_url().contains(stable_path) && !p.get_html_bytes_u8().is_empty());
    assert!(
        !delivered_stable,
        "304 page must NOT be delivered with content to the collector"
    );

    crate::core::http::set_allow_loopback(false);
}
