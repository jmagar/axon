# Phase 1: Code Quality & Architecture Review

## Code Quality Findings

### Critical

#### CRIT-01: Dead Code — `passthrough.rs` References Non-Existent Module and Field
**File:** `crates/cli/commands/passthrough.rs` lines 1, 117, 121
The file exists on disk but is NOT declared in `commands/mod.rs`. It imports `crate::axon_cli::bridge` (does not exist) and references `cfg.raw_args` (field does not exist on `Config`). If anyone adds `pub mod passthrough;` the build fails immediately. **Fix:** Delete the file.

#### CRIT-02: New Database Pool Created Per Operation
**Files:** `crates/jobs/crawl_jobs.rs:97`, `batch_jobs.rs:46`, `embed_jobs.rs:40`, `extract_jobs.rs:41`
Every public function calls `pool(cfg).await?` which calls `PgPoolOptions::new().max_connections(5).connect(...)` — a brand new pool per call. `run_status` creates 4 separate pools for 4 queries. Workers can exhaust Postgres `max_connections` under load. **Fix:** Create pool once at startup, pass `&PgPool` through.

#### CRIT-03: AMQP Connection Created Per Enqueue
All four job files call `open_channel()` on every `enqueue()`, `clear_*()`, and `doctor()` — full TCP + SASL handshake per operation. `batch_jobs.rs`, `embed_jobs.rs`, `extract_jobs.rs` lack the 5-second timeout that `crawl_jobs.rs` has, so they can hang indefinitely if RabbitMQ is unreachable.

### High

#### HIGH-01: ~1,800 Lines of Near-Identical Job Module Code
`crawl_jobs.rs` (537L), `batch_jobs.rs` (373L), `embed_jobs.rs` (360L), `extract_jobs.rs` (413L) — each independently implements `pool()`, `ensure_schema()`, `open_channel()`, `enqueue()`, `start_*_job()`, `get_*_job()`, `list_*_jobs()`, `cancel_*_job()`, `cleanup_*_jobs()`, `clear_*_jobs()`, `claim_next_pending()`, `claim_pending_by_id()`, `mark_*_job_failed()`, `run_*_worker()`, `*_doctor()`. Only differences: table name, queue name, job config struct, `process_*_job` implementation. Bugs fixed in one must be manually propagated to all four.

#### HIGH-02: ~720 Lines of Identical Subcommand Dispatch Logic
`batch.rs:23-199`, `crawl.rs:18-206`, `embed.rs:15-191`, `extract.rs:17-193` — each contains identical `match subcmd { "status" | "cancel" | "errors" | "list" | "cleanup" | "clear" | "worker" | "doctor" => ... }` blocks. ~180 lines duplicated four times. Adding a new subcommand requires editing all four files.

#### HIGH-03: `reqwest::Client::new()` Called 8+ Times in `ops.rs`
`vector/ops.rs` lines 23, 59, 72, 88, 139, 166, 495, 577 — each function creates its own client. A single `run_ask_native` creates at least 3 separate clients (TEI embed + Qdrant search + LLM call). `reqwest` docs explicitly advise reusing clients. **Fix:** Share a single `reqwest::Client` via `AppContext` or `OnceLock`.

#### HIGH-04: `vectors[0]` and `.remove(0)` Panic on Empty TEI Response
`vector/ops.rs:310`: `ensure_collection(cfg, vectors[0].len())` — panics if TEI returns empty. `ops.rs:366`, `ops.rs:561`: `.remove(0)` panics if TEI returns empty. **Fix:** Check `vectors.is_empty()` and return an error.

#### HIGH-05: Transitive `futures_util` Dependency (now fixed in Cargo.toml)
All four worker files use `use futures_util::StreamExt` but the crate was not in `Cargo.toml` directly — only via `lapin`'s transitive dep. **Status:** Fixed by adding `futures-util = "0.3"` to `Cargo.toml`.

#### HIGH-06: Credentials Leaked in Doctor JSON Output
`crates/cli/commands/doctor.rs:91-96` — `--json` output includes full `cfg.pg_url`, `cfg.redis_url`, `cfg.amqp_url` with embedded credentials. **Fix:** Sanitize URLs with `url::Url::parse()` to redact username/password before display.

### Medium

#### MED-01: 40-Field God Struct `Config` Passed Everywhere
`crates/core/config.rs:73-120` — all CLI flags, service URLs, queue names, performance tuning, and behavior flags in one flat struct. Functions receive all 40 fields even when they need only one.

#### MED-02: `ensure_schema()` Runs DDL on Every Read Operation
Every database operation calls `ensure_schema()` → `CREATE TABLE IF NOT EXISTS`. A simple `list_jobs()` call runs a DDL statement before SELECT. Unnecessary latency and requires DDL-level permissions even for reads.

#### MED-03: `run_crawl_once` Unconditionally Deletes Output Directory
`crawl/engine.rs:288-289`: `fs::remove_dir_all(output_dir)` wipes the entire output directory before each crawl. `batch_jobs.rs:265-267` same pattern. Silent data loss if paths overlap.

#### MED-04: Naive HTML Parsing with String Search
`core/content.rs:63-95` — `extract_links` and `extract_meta_description` use manual `find("href=\"")` scanning. Breaks on single-quoted attrs, spaces around `=`, uppercase `HREF`, `<script>` tags, HTML comments. O(n²) dedup with `.iter().any()`.

#### MED-05: `text[..140]` Panics on Multi-byte UTF-8
`vector/ops.rs:379-383` — `text.len()` is byte count; slicing at byte 140 panics if it falls mid-character. **Fix:** `text.char_indices().nth(140).map(|(i, _)| &text[..i]).unwrap_or(&text)`.

#### MED-06: `CrawlSummary` Not `Clone` — Manual Field Copying ×3
`crawl/engine.rs:377-401` — three separate manual struct copies. **Fix:** `#[derive(Clone)]` on `CrawlSummary`.

#### MED-07: `is_multiple_of()` Is Nightly-Only API
`crawl/engine.rs:265, 505` — `parsed_sitemaps.is_multiple_of(64)` is `#![feature(unsigned_is_multiple_of)]`, requires nightly Rust. **Fix:** `parsed_sitemaps % 64 == 0`.

#### MED-08: `process_job` Manually Copies 18 Config Fields
`crawl_jobs.rs:338-361` — `let mut job_cfg = cfg.clone()` then 18 explicit field assignments from the deserialized job config. Silent bugs if new fields are added.

#### MED-09: `qdrant_scroll_all` Loads Entire Collection Into Memory
`vector/ops.rs:87-132` — `run_sources_native` and `run_domains_native` paginate the entire Qdrant collection into a `Vec`. Memory exhaustion risk for large collections.

### Low

- **LOW-01:** `search` command hardcodes DuckDuckGo HTML scraping — fragile to HTML changes
- **LOW-02:** Inconsistent error type strategy — some spawn tasks return `Result<..., String>` while others use `Box<dyn Error>`
- **LOW-03:** `normalize_local_service_url` uses fragile string `.replace()` chains that could match partial strings
- **LOW-04:** `build_transform_config()` creates same struct on every call (hot path during crawl)
- **LOW-05:** `batch` direct mode silently swallows fetch errors — no failed URL reporting
- **LOW-06:** `symbol_for_status` and `status_text` duplicate same match arms — consolidate
- **LOW-07:** `Config` cloned per-job in workers (14 `String` fields); use `Arc<Config>` at worker level
- **LOW-08:** `ensure_collection` discards Qdrant response with `let _ = ...` — dimension mismatch errors silently ignored
- **LOW-09:** `qdrant_upsert` sends all points in single request — no batching unlike `tei_embed`
- **LOW-10:** `use futures_util::StreamExt` inside function body in all 4 worker files

---

## Architecture Findings

### Critical

#### C1: Connection Pool Created Per-Operation (No Connection Reuse)
Same as CRIT-02 above. A single `run_status` call creates 4 PgPools, runs 4 `CREATE TABLE IF NOT EXISTS` DDL statements, runs 4 queries, drops all 4 pools — 8 database round-trips for what should be 4 queries. Workers creating a new pool per job will exhaust Postgres connections under load.

#### C2: Schema Migration via `CREATE TABLE IF NOT EXISTS` on Every Call
No migration strategy, no version tracking, no rollback. Schema evolution is impossible — `CREATE TABLE IF NOT EXISTS` does not alter existing tables. Concurrent workers race to create tables.

#### C3: Dead Code — `passthrough.rs` References Missing `bridge` Module
Same as CRIT-01. Legacy scaffolding from when commands were shelled out to a Node.js CLI. Delete it.

### High

#### H1: ~1,400 Lines of Near-Identical Job Module Code
Same as HIGH-01. The only differences across all 4 job files: table name, queue name, job config struct, `process_*_job()` implementation. Drift already exists: `crawl_jobs.rs:142` has an AMQP connection timeout that the other three lack. **Recommendation:** Generic `JobStore<T>` or macro-based infrastructure extraction.

#### H2: ~720 Lines of Identical Subcommand Dispatch Boilerplate
Same as HIGH-02. Four command files each have an identical `match subcmd {}` block.

#### H3: God-Struct Config (50+ Fields) Passed to Every Function
`tei_embed()` receives the full Config including database URLs, API keys, queue names, and crawl settings — but only needs `tei_url`. Only `redis_healthy()` correctly accepts just a `&str`. Violates Interface Segregation. Makes unit testing nearly impossible without constructing a full Config. **Recommendation:** `InfraConfig`, `VectorConfig`, `CrawlConfig`, `LlmConfig` sub-structs.

#### H4: No Error Type Hierarchy — `Box<dyn Error>` Everywhere
No `thiserror`-based error enum. Callers cannot match error types for specific recovery. No structured error context. Worker error recovery limited to stringifying errors into DB columns.

#### H5: `reqwest::Client` Created Per-Request in `vector/ops.rs`
Same as HIGH-03. 8+ instantiations in `ops.rs` alone.

### Medium

#### M1: `sources`/`domains` Commands Load Entire Vector Collection Into Memory
Same as MED-09. No streaming, no limit.

#### M2: Blocking Filesystem I/O in Async Context
`crawl/engine.rs:342, 289-291` — `fs::write`, `fs::remove_dir_all`, `fs::create_dir_all` in async functions. `batch.rs:223-226`, `vector/ops.rs:223-236` same. Blocks tokio worker threads. **Fix:** `tokio::fs` or `tokio::task::spawn_blocking`.

#### M3: AMQP Connection Created Per-Enqueue
Same as CRIT-03 on the architecture level. Per-enqueue connections add latency for workers that enqueue follow-on jobs.

#### M4: Inconsistent Connection Timeout Handling
`crawl_jobs.rs:142` has 5s AMQP timeout; `batch_jobs.rs:82`, `embed_jobs.rs:76`, `extract_jobs.rs:77` have no timeout. Batch/embed/extract workers can hang indefinitely.

#### M5: String-Based Job Status — No Type Safety
Status values (`"pending"`, `"running"`, `"completed"`, `"failed"`, `"canceled"`) are raw strings in DB, SQL, and UI code. A typo silently fails to match. No compile-time exhaustiveness check.

#### M6: Qdrant Upsert Sends All Points in Single Request
Same as LOW-09. Unlike `tei_embed` which auto-splits on 413, `qdrant_upsert` sends unbounded payload.

#### M7: Module Naming — `crates/` Is Misleading
`crates/` contains internal modules, not separate Cargo crates. Import paths `crate::axon_cli::crates::core::config::Config` are 7 segments deep — `axon_cli` wrapper and `crates` intermediate add no value.

### Low

- **L1:** Hand-rolled HTML/XML parsing in `content.rs` (single quotes, `HREF`, `<script>` contamination)
- **L2:** `CommandKind` requires manual mapping from `CliCommand` — new commands need two enum updates
- **L3:** `url_to_filename` uses `DefaultHasher` (not stable across Rust versions)
- **L4:** `text.len() > 140` UTF-8 panic (same as MED-05)
- **L5:** Docker runtime image copies entire source tree (`COPY --from=builder /src /app`)
- **L6:** `search` command hardcodes DuckDuckGo HTML scraping
- **L7:** `use futures_util::StreamExt` inside function body (style)
- **L8:** `#[allow(clippy::module_inception)]` suppressions on `crawl/mod.rs`, `vector/mod.rs`

---

## Compile Fixes Applied During Review

The following blocking compile errors were found and fixed before review analysis began:

| Fix | Cargo.toml Change |
|-----|-------------------|
| `redis::AsyncCommands` missing (needs `aio` feature) | `redis = { version = "0.27", features = ["tokio-comp"] }` |
| `futures_util` undeclared direct dependency | `futures-util = "0.3"` added |
| `sqlx` missing `uuid`/`chrono` type support | `sqlx` features: `+ "uuid", "chrono"` |
| `DateTime<Utc>` not `Serialize` | `chrono = { version = "0.4", features = ["serde"] }` |
| `with_remote_multimodal` requires spider `openai` feature (→ Chrome dep) | `remote_extract.rs` refactored to always use direct API fallback path |

**Result:** `cargo check` now passes cleanly.

---

## Critical Issues for Phase 2 Context

1. **HIGH-06 (Security):** Doctor command outputs full database connection strings including credentials in JSON mode. AMQP URL contains `guest:guest@` by default. This is an immediate credential exposure risk.

2. **MED-05 (Security/Stability):** UTF-8 byte slicing in `ops.rs:379` — a panic vector reachable from query/ask commands with certain payloads.

3. **HIGH-04 (Stability):** `vectors[0]` index panic in embed pipeline — reachable if TEI server misbehaves or returns empty for whitespace-only input.

4. **MED-03 (Data Safety):** Output directory unconditionally wiped before each `--wait true` crawl — silent data loss.

5. **No tests at all** — zero test files in the codebase. All correctness assumptions are unverified.
