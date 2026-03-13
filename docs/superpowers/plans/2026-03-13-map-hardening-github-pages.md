# Map Hardening for GitHub Pages Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve `axon map` and low-coverage crawl behavior on GitHub Pages and similar path-rooted static sites by normalizing seed/discovered URLs more aggressively, rejecting malformed extracted links deterministically, and adding an HTML anchor fallback when spider discovery underperforms.

**Architecture:** Keep the existing Spider-first pipeline, but make the map path more deterministic around the edges. Resolve the seed URL once, derive a path-aware scope from the resolved URL, normalize every candidate before dedupe, and only invoke a direct HTML anchor extraction fallback when HTTP/Chrome discovery still returns a very small link set. Reuse the existing shared HTTP client and sitemap discovery instead of introducing a second crawler stack.

**Tech Stack:** Rust, Spider.rs, Reqwest, Tokio, existing Axon crawl engine helpers, existing shared HTTP/content utilities.

---

## Chunk 1: File map and boundaries

### File responsibilities

- `crates/crawl/engine.rs`
  - Owns `crawl_and_collect_map()` and `map_with_sitemap()`.
  - Will remain the orchestration point for HTTP/Chrome map retries, sitemap merge, and the new low-coverage HTML fallback.

- `crates/crawl/engine/url_utils.rs`
  - Owns URL canonicalization, path filtering, and junk-link rejection.
  - Will gain the shared map/candidate normalization helpers and the hardened malformed-URL heuristics.

- `crates/crawl/engine/runtime.rs`
  - Owns Spider `Website` configuration and the `set_on_link_find()` pre-enqueue filter.
  - Most likely no behavioral change beyond continuing to call the strengthened `is_junk_discovered_url()`, but review this file while implementing to ensure map-time filtering still happens before enqueue.

- `crates/core/content.rs`
  - Already owns `extract_links()` and sitemap parsing helpers.
  - Will gain a deterministic anchor extractor that can resolve relative links against a base URL for map fallback use.

- `crates/core/http/client.rs`
  - Already exposes `fetch_html()` via the shared HTTP client.
  - Reuse this instead of introducing a new fetch path.

- `crates/crawl/engine/tests.rs`
  - Primary regression coverage for fallback gating, URL normalization/dedupe behavior, and junk-link rejection.

- `crates/core/content/tests.rs`
  - Add focused unit tests for deterministic anchor extraction and relative URL resolution.

- `docs/commands/map.md`
  - Document the new low-coverage fallback behavior and how path-rooted seeds are scoped.

## Chunk 2: Execution plan

### Task 1: Resolve the seed URL and derive deterministic map scope

**Files:**
- Modify: `crates/crawl/engine/url_utils.rs:3-20`
- Modify: `crates/crawl/engine.rs:82-173`
- Test: `crates/crawl/engine/tests.rs:155-269`
- Reference only: `crates/core/http/client.rs:48-55`

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn test_map_seed_scope_uses_resolved_project_prefix() {
    let seed = "https://example.github.io/project";
    let resolved = "https://example.github.io/project/";

    let scope = derive_map_scope(seed, resolved).expect("scope");

    assert_eq!(scope.host, "example.github.io");
    assert_eq!(scope.path_prefix.as_deref(), Some("/project"));
}

#[test]
fn test_map_scope_allows_root_seed_without_path_filter() {
    let scope = derive_map_scope("https://example.github.io/", "https://example.github.io/")
        .expect("scope");

    assert_eq!(scope.path_prefix, None);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test test_map_seed_scope_uses_resolved_project_prefix -- --exact`
Expected: FAIL with unresolved function/type errors for `derive_map_scope`.

- [ ] **Step 3: Write minimal implementation**

```rust
struct MapScope {
    host: String,
    path_prefix: Option<String>,
}

fn derive_map_scope(requested_url: &str, resolved_url: &str) -> Option<MapScope> {
    let canonical = canonicalize_url_for_dedupe(resolved_url)
        .or_else(|| canonicalize_url_for_dedupe(requested_url))?;
    let parsed = spider::url::Url::parse(&canonical).ok()?;
    let path = parsed.path().trim_end_matches('/');

    Some(MapScope {
        host: parsed.host_str()?.to_string(),
        path_prefix: if path.is_empty() { None } else { Some(path.to_string()) },
    })
}
```

- [ ] **Step 4: Wire seed resolution into the map path**

Implement a small async helper used by `map_with_sitemap()` that:
- uses the shared HTTP client,
- performs a short `HEAD` request first and falls back to `GET`,
- follows redirects,
- derives the final map scope from the resolved URL,
- preserves the original path if only the hostname changes.

Keep this helper private to the crawl engine unless another caller truly needs it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test test_map_seed_scope_uses_resolved_project_prefix test_map_scope_allows_root_seed_without_path_filter -- --exact`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/crawl/engine.rs crates/crawl/engine/url_utils.rs crates/crawl/engine/tests.rs
git commit -m "feat: derive deterministic map scope from resolved seed urls"
```

### Task 2: Harden discovered-URL normalization and malformed-link rejection

**Files:**
- Modify: `crates/crawl/engine/url_utils.rs:93-156`
- Modify: `crates/crawl/engine.rs:100-113`
- Test: `crates/crawl/engine/tests.rs:343-421`
- Reference only: `crates/crawl/engine/runtime.rs:202-210`

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn test_junk_url_rejects_percent_encoded_doctype_blob() {
    assert!(is_junk_discovered_url(
        "https://example.com/%3C!doctype%20html%3E%3Chtml%3E"
    ));
}

#[test]
fn test_normalize_map_candidate_strips_fragment_and_trailing_slash() {
    let scope = MapScope {
        host: "example.github.io".to_string(),
        path_prefix: Some("/project".to_string()),
    };

    let normalized = normalize_map_candidate_url(
        "https://example.github.io/project/docs/#intro",
        &scope,
        true,
    );

    assert_eq!(normalized.as_deref(), Some("https://example.github.io/project/docs"));
}

#[test]
fn test_normalize_map_candidate_rejects_out_of_scope_paths() {
    let scope = MapScope {
        host: "example.github.io".to_string(),
        path_prefix: Some("/project".to_string()),
    };

    assert!(normalize_map_candidate_url(
        "https://example.github.io/other/docs",
        &scope,
        true,
    )
    .is_none());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test test_junk_url_rejects_percent_encoded_doctype_blob -- --exact`
Expected: FAIL if the new junk case is not rejected.

- [ ] **Step 3: Write minimal implementation**

Implement two focused helpers in `url_utils.rs`:

```rust
fn is_probably_html_blob(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.contains("%3c!doctype")
        || lower.contains("%3chtml")
        || lower.contains("%3chead")
        || lower.contains("%3cbody")
}

fn normalize_map_candidate_url(raw: &str, scope: &MapScope, drop_query: bool) -> Option<String> {
    if is_junk_discovered_url(raw) {
        return None;
    }

    let mut parsed = spider::url::Url::parse(raw).ok()?;
    parsed.set_fragment(None);
    if drop_query {
        parsed.set_query(None);
    }

    let canonical = canonicalize_url_for_dedupe(parsed.as_ref())?;
    url_within_scope(&canonical, scope).then_some(canonical)
}
```

Make `is_junk_discovered_url()` call the new HTML-blob helper before returning `false`.

- [ ] **Step 4: Update the map collector loop to normalize before counting**

In `crawl_and_collect_map()`:
- stop incrementing `summary.pages_seen` for raw Spider links,
- normalize/filter each candidate first,
- only increment `pages_seen` and push into `urls` for accepted canonical URLs.

This keeps `pages_seen` aligned with the actual deduped result set and avoids low-coverage false positives caused by junk candidates.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test test_junk_url_rejects_percent_encoded_doctype_blob test_normalize_map_candidate_strips_fragment_and_trailing_slash test_normalize_map_candidate_rejects_out_of_scope_paths -- --exact`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/crawl/engine.rs crates/crawl/engine/url_utils.rs crates/crawl/engine/tests.rs
git commit -m "fix: normalize and reject malformed map candidates"
```

### Task 3: Add deterministic HTML anchor fallback for low-coverage map runs

**Files:**
- Modify: `crates/core/content.rs:199-220`
- Modify: `crates/crawl/engine.rs:138-173`
- Test: `crates/core/content/tests.rs`
- Test: `crates/crawl/engine/tests.rs:263-269`
- Reference only: `crates/core/http/client.rs:48-55`

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn test_extract_anchor_hrefs_resolves_relative_links_against_base_url() {
    let html = r#"
        <a href="/project/docs/intro/">Intro</a>
        <a href="./api">API</a>
        <a href="#local">Local</a>
        <a href="javascript:void(0)">Ignore</a>
    "#;

    let links = extract_anchor_hrefs("https://example.github.io/project/", html, 10);

    assert_eq!(
        links,
        vec![
            "https://example.github.io/project/docs/intro/".to_string(),
            "https://example.github.io/project/api".to_string(),
        ]
    );
}

#[test]
fn test_should_retry_map_with_html_fallback_for_two_or_fewer_urls() {
    assert!(should_retry_map_with_html_fallback(0));
    assert!(should_retry_map_with_html_fallback(1));
    assert!(should_retry_map_with_html_fallback(2));
    assert!(!should_retry_map_with_html_fallback(3));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test test_extract_anchor_hrefs_resolves_relative_links_against_base_url -- --exact`
Expected: FAIL with unresolved function errors for `extract_anchor_hrefs`.

- [ ] **Step 3: Write minimal implementation**

Add a new deterministic extractor in `crates/core/content.rs`:

```rust
pub fn extract_anchor_hrefs(base_url: &str, html: &str, limit: usize) -> Vec<String> {
    let base = spider::url::Url::parse(base_url).ok();
    let mut out = Vec::new();
    let mut pos = 0usize;

    while let Some(rel) = html[pos..].find("href=") {
        // parse quoted hrefs, resolve relative URLs against `base`,
        // skip empty, fragment-only, javascript:, mailto:, and duplicate results
        // stop at `limit`
    }

    out
}
```

Then in `map_with_sitemap()`:
- keep the current HTTP-first / Chrome-second behavior,
- after Chrome retry (if any), if the accepted URL count is still `<= 2`, fetch the seed HTML once with the shared client,
- extract deterministic anchor links,
- normalize/filter/dedupe them with the same scope helper from Task 2,
- merge them before sitemap URLs are appended.

Do **not** use this fallback when the map already has healthy coverage.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test test_extract_anchor_hrefs_resolves_relative_links_against_base_url test_should_retry_map_with_html_fallback_for_two_or_fewer_urls -- --exact`
Expected: PASS.

- [ ] **Step 5: Add an engine-level regression for merge behavior**

Write a focused pure-function test around a helper such as `merge_map_candidate_urls()` so you can verify:
- crawler URLs remain first,
- fallback URLs add only net-new scoped entries,
- sitemap URLs still append and dedupe,
- the final output remains canonical.

Avoid an integration test that requires a live remote site for this logic.

- [ ] **Step 6: Commit**

```bash
git add crates/core/content.rs crates/core/content/tests.rs crates/crawl/engine.rs crates/crawl/engine/tests.rs
git commit -m "feat: add deterministic html fallback for low coverage maps"
```

### Task 4: Document the behavior and run end-to-end verification

**Files:**
- Modify: `docs/commands/map.md`
- Modify: `docs/commands/crawl.md`
- Test: `crates/crawl/engine/tests.rs`
- Test: `crates/core/content/tests.rs`

- [ ] **Step 1: Update the command docs**

Add short sections covering:
- that `map` now resolves redirects before deriving scope,
- that path-rooted seeds keep results within the same path subtree,
- that low-coverage maps may use a deterministic HTML anchor fallback,
- that sitemap discovery is still appended after crawler/fallback results,
- that malformed discovered URLs are rejected before entering the final result set.

- [ ] **Step 2: Run the focused unit test suites**

Run: `cargo test engine -- --nocapture`
Expected: PASS.

Run: `cargo test content -- --nocapture`
Expected: PASS.

- [ ] **Step 3: Run a targeted real-world verification**

Run:

```bash
./scripts/axon map https://atrawog.github.io/mcp-oauth-gateway --render-mode auto-switch --json
```

Expected:
- returns more than one URL,
- includes URLs rooted under the project path,
- no malformed HTML-blob URLs in output,
- no screenshot filename errors.

- [ ] **Step 4: Run a second verification on a different GitHub Pages site**

Run:

```bash
./scripts/axon map https://rust-lang.github.io/mdBook/ --render-mode auto-switch --json
```

Expected:
- returns multiple docs URLs,
- remains scoped to the requested site/path,
- does not explode query-string or fragment variants into duplicates.

- [ ] **Step 5: Commit**

```bash
git add docs/commands/map.md docs/commands/crawl.md
git commit -m "docs: describe map scope normalization and low coverage fallback"
```

## Implementation notes

- Prefer pure helpers for scope derivation, candidate normalization, and merge behavior so the tricky parts stay unit-testable.
- Reuse `canonicalize_url_for_dedupe()` rather than adding a second canonicalization policy.
- Do not alter the existing `crawl_raw()` vs `crawl()` split documented in `crates/crawl/AGENTS.md`.
- Reuse the shared HTTP client (`http_client()` / `fetch_html()`) instead of building a new Reqwest client.
- Keep `readability: false` and `clean_html: false` exactly as documented in `crates/core/AGENTS.md`.
- If you need to touch `Config`, update all inline test config builders noted in `crates/core/AGENTS.md`.

## Review checkpoints

- After Task 1, verify the resolved seed/path scope logic is pure and covered by unit tests.
- After Task 2, verify `pages_seen` semantics still make sense and the junk filter does not regress legitimate URLs.
- After Task 3, verify the HTML fallback is gated tightly enough that it does not become the default path.
- Before finishing, use `@verification-before-completion` and request review via `@requesting-code-review`.

Plan complete and saved to `docs/superpowers/plans/2026-03-13-map-hardening-github-pages.md`. Ready to execute?
