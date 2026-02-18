# Phase 3: Testing & Documentation Review

## Test Coverage Findings

**Current coverage: 0%** — The codebase has zero `#[test]` blocks, zero `#[cfg(test)]` modules, and no `[dev-dependencies]` in `Cargo.toml`. Every code path — including security-critical SSRF validation and credential redaction — is entirely unverified.

---

### Critical

**TC-01: Zero tests exist** (`crates/` — all files)
- No `#[test]`, `#[cfg(test)]`, `#[tokio::test]`, or `tests/` directory anywhere
- No `[dev-dependencies]` in `Cargo.toml` — `tokio` test feature, `wiremock`, `tempfile` all absent
- Any regression in any function (security, correctness, data integrity) will only surface in production
- **Fix:** Add `[dev-dependencies]` and establish the `#[cfg(test)]` pattern in at least one file to unblock all other test work:
  ```toml
  [dev-dependencies]
  tokio = { version = "1", features = ["full", "test-util"] }
  wiremock = "0.6"
  tempfile = "3"
  ```

**TC-02: `validate_url` SSRF protection untested** (`crates/core/http.rs`)
- The only SSRF defense; called from `fetch_html`, batch worker, sitemap backfill
- IPv6 link-local detection uses bitmask `segs[0] & 0xffc0 == 0xfe80` — an off-by-one silently breaks the block
- `normalize_url` pre-pass (bare `localhost` → `https://localhost`) interacts with `validate_url` — ordering untested
- **Required test cases:** public https/http pass; 127.0.0.1, ::1, 169.254.x.x (AWS metadata), fc00::/7, fe80::/10, 10.0.0.0/8, 172.16.0.0/12 (including boundary 172.15.x/172.32.x), 192.168.0.0/16, `.internal`, `.local`, `.INTERNAL` (case), `file://`, `data:`, `ftp://` all block; invalid URL rejects

**TC-03: `redact_url` credential sanitization untested** (`crates/core/content.rs`)
- Called in all four job workers for error messages — any silent failure leaks credentials to logs
- AMQP URL scheme (`amqp://`) is non-standard; `Url::parse` handling needs verification
- **Required test cases:** PostgreSQL URL, AMQP URL, URL without credentials (passthrough), unparseable input (sentinel), password-only URL

---

### High

**TC-04: `chunk_text` sliding window untested** (`crates/vector/ops.rs:246`)
- Every document through the embed pipeline uses this function
- Recently changed from `Vec<char>` to `Vec<usize>` byte offsets — easy fence-post error
- **Required test cases:** text ≤ 2000 chars (1 chunk), exactly 2000 (1 chunk, not 2), 2001 (2 chunks with 201-char second), 4100 chars (≥3 chunks with correct 200-char overlap), multi-byte UTF-8 (CJK/emoji — no codepoint splitting), empty string

**TC-05: `should_fallback_to_chrome` decision logic untested** (`crates/crawl/engine.rs:110`)
- Pure function, zero I/O — the single easiest test target in the codebase, yet untested
- Decides whether to re-crawl entire site with Chrome; wrong threshold wastes or misses JS content
- **Required test cases:** 61/100 thin (ratio > 0.60 → fallback), exactly 60/100 (not > 0.60 → no fallback), low `markdown_files < (max_pages/10).max(10)`, threshold clamp for small `max_pages`, zero `pages_seen` (no division-by-zero)

**TC-06: `normalize_url` edge cases untested** (`crates/core/http.rs`)
- Called before `validate_url` in `fetch_html`; interaction between the two is untested
- `localhost` → `https://localhost` → `validate_url` blocks it — is this the correct flow?
- **Required test cases:** bare domain with/without path, https/http passthrough, whitespace trimming, empty string, `localhost`, bare `[::1]`

**TC-07: `content.rs` parsing utilities untested** (`crates/core/content.rs`)
- `extract_meta_description`: reads from case-lowered string for tag lookup but original `html` for content value — `Content="..."` attribute is silently missed
- `extract_links`: O(n²) deduplication — no performance boundary test
- `extract_loc_values`: manual `<loc>` parser — silent failure on CDATA or namespace-prefixed entries
- **Required test cases:** `find_between` (found/missing start/end/trim), `extract_meta_description` (found/absent), `extract_links` (absolute/relative/deduplicate/limit), `extract_loc_values` (single/multiple/empty `<loc>`)

---

### Medium

**TC-08: Job state machine untested** (`crates/jobs/*.rs`)
- `render_mode_from_str` maps `"chrome"`, `"http"`, catch-all `_ → AutoSwitch` — typo in stored config silently becomes AutoSwitch
- Test the pure mapping without Postgres:
  ```rust
  assert!(matches!(render_mode_from_str("http"), RenderMode::Http));
  assert!(matches!(render_mode_from_str("typo"), RenderMode::AutoSwitch));
  ```

**TC-09: `normalize_local_service_url` URL-parse rewrite untested** (`crates/core/config.rs:354`)
- Recently refactored from string `.replace()` chains to `Url::parse` — regression risk
- Test (skipping if `/.dockerenv` exists): `axon-postgres:5432` → `127.0.0.1:53432`, unknown host passes through, malformed URL passes through

**TC-10: TEI 413 batch-splitting order untested** (`crates/vector/ops.rs:42`)
- LIFO stack halves batches on 413; wrong stack order silently misaligns vectors with texts
- Requires `wiremock`; critical for embedding correctness

**TC-11: Sitemap URL scoping untested** (`crates/crawl/engine.rs:252`)
- Path-prefix logic: `/docs` should NOT match `/documentation`
- Subdomain flag changes host matching behavior
- Extract `is_url_in_scope()` as a testable helper: exact path, nested path, sibling path, subdomain allowed/denied

---

### Low

**TC-12: `performance_defaults` profile values untested** (`crates/core/config.rs:399`)
- Pure function returning six-tuple; accidentally swapped profile entries would silently reduce concurrency
- Test that each profile's clamp ranges match documented values and that `Max > HighStable` in concurrency

---

### Test Pyramid Assessment

| Layer | Current | Recommended minimum |
|---|---|---|
| Unit (pure functions) | 0 | ~80 tests: `content.rs`, `http.rs`, `engine.rs`, `ops.rs`, `config.rs` |
| Integration (mock HTTP) | 0 | ~20 tests: `tei_embed`, `qdrant_upsert`, `fetch_html` via `wiremock` |
| Integration (real infra) | 0 | ~10 tests: job lifecycle, schema migration via `docker-compose` in CI |
| E2E | 0 | 1-2 smoke tests: local static server → crawl → embed → query |

**Priority implementation order:**
1. `validate_url` + `redact_url` (security-critical, zero deps)
2. `should_fallback_to_chrome` + `chunk_text` + all of `content.rs` (pure functions)
3. `normalize_url` + `normalize_local_service_url` (env-side-effect caveat)
4. `tei_embed` 413 retry (needs `wiremock`)
5. Job state machine integration tests (`sqlx::test` + real Postgres in CI)
6. E2E smoke test via local static HTTP server

---

## Documentation Findings

---

### Critical

**DOC-01: Binary name `axon_cli_rust` in CLAUDE.md is wrong** (`CLAUDE.md`)
- Every build/run command references `axon_cli_rust` (e.g., `cargo build --release --example axon_cli_rust`)
- Actual `Cargo.toml` defines `[[bin]] name = "cortex"` and `[[bin]] name = "axon"`. No `axon_cli_rust` example exists.
- `Dockerfile` builds `--bin cortex`; `README.md` uses `cortex`
- **Fix:** Replace all `axon_cli_rust` references in `CLAUDE.md` with `cortex`. Update Quick Start to match `README.md`.

---

### High

**DOC-02: `passthrough.rs` listed in architecture diagram but does not exist** (`CLAUDE.md`)
- `CLAUDE.md` architecture shows `commands/passthrough.rs` — this file was deleted; it does not exist
- Actual commands: `batch.rs`, `common.rs`, `crawl.rs`, `doctor.rs`, `embed.rs`, `extract.rs`, `map.rs`, `mod.rs`, `scrape.rs`, `search.rs`, `status.rs`
- **Fix:** Remove the `passthrough.rs` line from the architecture diagram

**DOC-03: 7 environment variables undocumented** (`CLAUDE.md`, `.env.example`, `config.rs`, `ops.rs`)

| Env Var | Where Read | Purpose |
|---|---|---|
| `NUQ_DATABASE_URL` | `config.rs` | Legacy fallback alias for `AXON_PG_URL` |
| `NUQ_RABBITMQ_URL` | `config.rs` | Legacy fallback alias for `AXON_AMQP_URL` |
| `REDIS_URL` | `config.rs` | Generic fallback alias for `AXON_REDIS_URL` |
| `AXON_COLLECTION` | `config.rs` | Override for Qdrant collection (clap `env`) |
| `AXON_ENV_FILE` | `Dockerfile` | Path to `.env` loaded inside container by s6 |
| `TEI_MAX_CLIENT_BATCH_SIZE` | `ops.rs:27` | TEI batch size override (default 64, max 128) |
| `CORTEX_NO_COLOR` | `config.rs` | Disable ANSI color output |

**Fix:** Add all seven to `.env.example` with comments; add to CLAUDE.md env var table

**DOC-04: Performance profile table missing backfill concurrency column** (`CLAUDE.md`)
- `performance_defaults()` returns a 6-tuple; the documented table has only 5 columns — the backfill concurrency column is absent
- Backfill values: `HighStable` CPUs×6 (32–128), `Balanced` CPUs×3 (16–64), `Extreme` CPUs×10 (64–256), `Max` CPUs×20 (128–1024)
- **Fix:** Add `Backfill concurrency` column to the profile table

**DOC-05: Zero `///` Rust doc comments on any public function or struct** (all `crates/`)
- No `pub fn` or `pub struct` in the codebase has a `///` doc comment (sole exception: `redact_url`)
- Critical undocumented logic: `chunk_text` (overlap semantics), `should_fallback_to_chrome` (60%/10% thresholds), `normalize_local_service_url` (Docker detection), `tei_embed` (413 split), `validate_url` (blocked ranges), `run_ask_native` (8-hit RAG window)
- **Fix:** Add `///` to all public functions with non-obvious behavior; `cargo doc` should produce useful output

**DOC-06: 26 global CLI flags undocumented** (`CLAUDE.md`, `README.md`)
- CLAUDE.md documents 11 flags; `GlobalArgs` in `config.rs` has 37 total
- High-impact undocumented flags: `--respect-robots` (defaults `false`, legal/ethical concern), `--delay-ms` (rate limiting), `--include-subdomains` (defaults `true` — surprises users), `--concurrency-limit` (single knob for all workers), `--drop-thin-markdown`, `--discover-sitemaps`, `--min-markdown-chars`
- **Fix:** Add complete global flags reference table to CLAUDE.md

**DOC-07: `search` command described as "requires search provider" — actually hardcodes DuckDuckGo HTML** (`CLAUDE.md`, `commands/search.rs`)
- Actual implementation: `format!("https://duckduckgo.com/html/?q={encoded}")` with HTML scraping
- No API key, no provider config — breaks if DuckDuckGo changes its HTML
- `--limit` behavior: requests `limit * 5` links then truncates — invisible to users
- **Fix:** Document that `search` uses DuckDuckGo HTML scraping, requires no API key, and is fragile to HTML changes

---

### Medium

**DOC-08: Postgres image version wrong in CLAUDE.md** (`CLAUDE.md`, `docker-compose.yaml`)
- CLAUDE.md shows `postgres:alpine`; actual `docker-compose.yaml` line 25: `postgres:17-alpine`
- **Fix:** Update CLAUDE.md to `postgres:17-alpine`

**DOC-09: Architecture diagram missing 6 files; wrong file listed** (`CLAUDE.md`)
- Missing: `commands/doctor.rs`, `commands/status.rs`, `commands/search.rs`, `core/ui.rs`, `jobs/batch_jobs.rs`, `jobs/extract_jobs.rs`
- `ops.rs` function list omits `run_sources_native()`, `run_domains_native()`, `run_stats_native()`
- **Fix:** Regenerate architecture tree from actual filesystem

**DOC-10: AMQP → Postgres polling fallback undocumented** (`CLAUDE.md`, `crawl_jobs.rs`, `embed_jobs.rs`)
- When AMQP is unavailable, workers silently degrade to 800ms Postgres polling
- `start_crawl_job()` logs a warning and continues if AMQP enqueue fails
- Operators seeing "amqp unavailable" logs may think the system is broken when it's degraded-but-functional
- **Fix:** Add "Worker Resilience" section: workers fall back to Postgres polling at 800ms interval when AMQP is unreachable

**DOC-11: Database schema not documented** (`CLAUDE.md`)
- Four tables auto-created: `axon_crawl_jobs`, `axon_embed_jobs`, `axon_batch_jobs`, `axon_extract_jobs`
- Schema is auto-applied via `CREATE TABLE IF NOT EXISTS` on every worker/job start
- Inline `ALTER TABLE` for `result_json` column reveals ad hoc schema evolution
- **Fix:** Add "Database Schema" section documenting columns, status lifecycle (`pending → running → completed/failed/canceled`), and auto-migration behavior

**DOC-12: SSRF protection not mentioned in any user-facing doc** (`CLAUDE.md`, `README.md`)
- `validate_url()` blocks private IPs, link-local, loopback, `.internal`/`.local` TLDs
- Operators running Axon as a service need to know which commands enforce this and what gets blocked
- **Fix:** Add "Security" section to README.md and CLAUDE.md listing protected commands and blocked ranges

**DOC-13: Crawl output structure undocumented** (`CLAUDE.md`)
- `output_dir/markdown/*.md` (filename: `{index:04}-{host}{path}-{hash:016x}.md`)
- `output_dir/manifest.jsonl` (per-page: `{url, file_path, markdown_chars, source?}`)
- `output_dir/jobs/<uuid>/` (async job output)
- **Fix:** Add "Output Structure" section to CLAUDE.md

**DOC-14: "Parent Spider workspace" note is stale** (`CLAUDE.md`)
- `Cargo.toml` exists and is complete; project is already standalone
- CLAUDE.md still says "all `cargo` commands run from `../../` (the workspace root)"
- **Fix:** Remove stale workspace note; update Quick Start to standalone instructions

---

### Low

**DOC-15: `.env.example` `POSTGRES_*` vars unexplained** (`.env.example`)
- `POSTGRES_USER/PASSWORD/DB` are Docker image init vars, not read by the Rust binary
- No warning that `POSTGRES_PASSWORD=postgres` is a placeholder
- **Fix:** Add comments distinguishing Docker init vars from CLI vars; warn that `postgres` password must be changed

**DOC-16: `stderr` vs `stdout` separation undocumented** (`CLAUDE.md`, `logging.rs`)
- `log_info/warn/done` → `eprintln!` (stderr); result output → `println!` (stdout)
- Operators piping `cortex scrape url | jq` need to know status messages go to stderr
- **Fix:** One-line note in CLAUDE.md: "Progress/diagnostic output → `stderr`; results → `stdout`. Suppress with `2>/dev/null`."

---

## Summary

| Category | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Test Coverage | 3 | 4 | 4 | 1 | **12** |
| Documentation | 1 | 6 | 7 | 2 | **16** |
| **Combined** | **4** | **10** | **11** | **3** | **28** |
