# Phase 2: Security & Performance Review

## Security Findings

**Full report written to:** `docs/reports/2026-02-17-security-audit.md`

**Total: 21 findings — 2 Critical, 4 High, 6 Medium, 5 Low, 4 Informational**

### Critical

#### CRIT-01: Credential Exposure in `doctor` JSON/Terminal Output
**CVSS 3.1: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N) | CWE-200, CWE-532**
**Files:** `crates/cli/commands/doctor.rs:90-97`, all four `*_jobs.rs:doctor()` functions, `crawl_jobs.rs:175-184`

`--json` output serializes full `cfg.pg_url`, `cfg.redis_url`, `cfg.amqp_url` including embedded credentials (`postgresql://axon:postgres@...`, `amqp://guest:guest@...`). Terminal path also leaks via `muted(&cfg.pg_url)` etc. at lines 125-137. Additionally, connection timeout error messages in all four job files include the full URL with password.

```rust
// Immediate fix — add and apply everywhere:
fn redact_url(url: &str) -> String {
    match url::Url::parse(url) {
        Ok(mut p) => {
            if !p.username().is_empty() || p.password().is_some() {
                let _ = p.set_username("***");
                let _ = p.set_password(Some("***"));
            }
            p.to_string()
        }
        Err(_) => "***redacted***".to_string(),
    }
}
```

#### CRIT-02: Panic on Multi-Byte UTF-8 Slice in Query/Ask Pipeline
**CVSS 3.1: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H) | CWE-135, CWE-129**
**File:** `crates/vector/ops.rs:379-382`

```rust
let snippet = if text.len() > 140 { &text[..140] ... }  // PANICS on non-ASCII
```
`text.len()` is byte count. Any crawled content with CJK, accented characters, or emoji where byte 140 falls mid-character panics the CLI or crashes a worker.

```rust
// Fix:
let end = text.floor_char_boundary(140); // Rust 1.73+
let snippet = &text[..end];
```

### High

#### HIGH-01: No SSRF Protection
**CVSS 3.1: 6.5 | CWE-918**
**Files:** `crates/core/http.rs:10-18`, `scrape.rs:20`, `batch.rs:238`, `crawl/engine.rs:32`, `vector/ops.rs:299`

`fetch_html()` and `Website::new()` accept any URL with no validation. `cortex scrape http://169.254.169.254/latest/meta-data/` fetches cloud instance metadata. `cortex scrape http://axon-redis:6379/` probes internal Docker services. Every command accepting a URL (`scrape`, `crawl`, `map`, `batch`, `extract`, `embed`) passes user input directly.

Fix: URL validation function blocking non-http/https schemes, localhost, RFC-1918 ranges (`10.x`, `172.16-31.x`, `192.168.x`), link-local (`169.254.x`), and `.internal`/`.local` TLDs.

#### HIGH-02: `vectors[0]` / `.remove(0)` Panic if TEI Returns Empty
**CVSS 3.1: 6.5 | CWE-129**
**File:** `crates/vector/ops.rs:310, 366, 561`

Three locations index/remove from TEI result vectors without checking emptiness. Worker crashes if TEI misbehaves. Fix: guard with `if vectors.is_empty() { return Err(...) }`.

#### HIGH-03: Unconditional Recursive Directory Deletion Before Crawl
**CVSS 3.1: 6.2 | CWE-73**
**Files:** `crates/crawl/engine.rs:288-289`, `crates/cli/commands/batch.rs:223-226`

`fs::remove_dir_all(output_dir)` runs without confirmation before every `--wait true` crawl. `--output-dir` is user-controlled. A job payload in the DB could target arbitrary paths (worker context).

#### HIGH-04: Unauthenticated Services Bound to All Interfaces
**CVSS 3.1: 6.3 | CWE-306**
**Files:** All vector ops, `docker-compose.yaml`, `config.rs:502`

Qdrant (no API key), TEI (no auth), Redis (no password), RabbitMQ (`guest:guest` default hardcoded at `config.rs:502`), PostgreSQL (`axon:postgres` default). All ports bound to `0.0.0.0` — accessible from any host on the network segment.

Fix: Bind ports to `127.0.0.1` in docker-compose, enable Qdrant API key auth, Redis `requirepass`, change RabbitMQ credentials, strong Postgres passwords.

### Medium

- **MED-01:** Credentials passed via CLI args (`--pg-url`, `--openai-api-key`) visible in `ps aux` (CWE-214)
- **MED-02:** Credentials in connection timeout error messages across all four job files (CWE-209)
- **MED-03:** Prompt injection risk in extract command — user prompt + crawled HTML sent unsanitized to LLM (CWE-77)
- **MED-04:** `--output-dir` / `--output` paths not validated — `--output /etc/cron.d/evil` with sufficient privileges (CWE-22)
- **MED-05:** `DefaultHasher` for filenames — not stable across Rust versions; non-deterministic cross-version (CWE-328)
- **MED-06:** `Dockerfile` `COPY . .` + `COPY --from=builder /src /app` includes `.env` in runtime image if present; no `.dockerignore` (CWE-200)

### Low / Informational

- **LOW-01:** `url_to_filename()` stem not length-bounded — crafted URLs can produce filenames exceeding filesystem limits
- **LOW-02:** No rate limiting on Qdrant/TEI calls
- **LOW-03:** Default Qdrant collection `spider_rust` hardcoded — shared instances collide
- **LOW-04:** `rabbitmq:management` image exposes management plugin
- **LOW-05:** No TLS for backend service communication (acceptable for same-host)
- **INFO-01:** All SQL parameterized — zero SQL injection surface ✓
- **INFO-02:** `.gitignore` correctly excludes `.env` ✓
- **INFO-03:** No `unsafe` blocks in codebase ✓
- **INFO-04:** No command injection in CLI dispatch ✓

---

## Performance Findings

**Total: 26 findings — 6 Critical, 7 High, 8 Medium, 5 Low**

### Critical

#### C-1: New `PgPool` Created Per Operation + DDL on Every Read
**Files:** `jobs/crawl_jobs.rs:97`, `batch_jobs.rs:46`, `embed_jobs.rs:40`, `extract_jobs.rs:41`
**Impact:** 200-800ms latency per CLI command; `status` opens 4 independent pools (up to 20 connections); DDL `CREATE TABLE IF NOT EXISTS` runs before every SELECT; server-side connections linger past pool drop

`run_status` creates 4 pools × 5 max_connections = 20 Postgres connections for 4 read-only queries. Postgres default `max_connections=100` exhausts at ~5 concurrent `status` calls. Fix: `once_cell::sync::OnceCell<PgPool>` shared pool; `ensure_schema` called once at startup.

#### C-2: New AMQP TCP+SASL Connection Per Enqueue
**Files:** All four `jobs/*_jobs.rs:open_channel()`
**Impact:** 50-300ms per job enqueue (TCP SYN-ACK + SASL multi-round-trip); inconsistent — `crawl_jobs.rs` has 5s timeout, others can hang indefinitely

`clear_jobs` opens two full AMQP connections (one for enqueue, one for purge) for a single command.

#### C-3: New `reqwest::Client` on Every Vector Operation (8+ Locations)
**File:** `vector/ops.rs:23, 59, 72, 88, 139, 166, 495, 577`
**Impact:** New TLS context + connection pool per call. `embed_path_native` with 1000 docs creates 1000+ `reqwest::Client` instances. `run_ask_native` creates ≥3 clients per invocation

Fix: Accept `&reqwest::Client` parameter in all helper functions; create once at top-level call.

#### C-4: `qdrant_scroll_all` Loads Entire Collection Into Memory
**File:** `vector/ops.rs:87-132`
**Impact:** ~500MB heap at 1M points × 500-byte payload; OOM risk; `sources` and `domains` commands are O(N collection size)

Fix: Stream-and-aggregate pattern — accumulate `BTreeMap<url, count>` per page, drop page after processing.

#### C-5: Blocking `std::fs` I/O in Async Context
**Files:** `crawl/engine.rs:342`, `batch_jobs.rs:266-282`, `vector/ops.rs:227`
**Impact:** Tokio worker thread starvation during high-concurrency crawl; broadcast channel fills → `RecvError::Lagged` → silent page loss (data loss scenario, not just performance)

Fix: `tokio::fs::*` or `tokio::task::spawn_blocking` wrappers.

#### C-6: `qdrant_upsert` Sends All Points in Single HTTP Request (Unbounded)
**File:** `vector/ops.rs:68-85`
**Impact:** 500-page crawl at 10 chunks/page = 5000 points = ~15MB vector payload in one request; Qdrant segment locked for full duration; no retry on partial failure

Fix: Batch with `chunks(256)`, consistent with `tei_embed`'s existing batch splitting.

### High

#### H-1: New Redis Client Per Job Processing
**Files:** All four `jobs/*_jobs.rs:process_*()`
**Impact:** 10-30ms per job; 4 workers × N jobs/minute = 4N redundant TCP handshakes

#### H-2: Sequential DB Queries in `run_status`
**File:** `commands/status.rs:9-21`
**Impact:** Wall time = sum of 4 queries (~800ms) instead of max (~200ms)
Fix: `tokio::try_join!` on all four list calls.

#### H-3: `Config` Cloned Per Job (14+ String Fields)
**Files:** `jobs/*_jobs.rs:process_*()`
**Impact:** 14 heap allocations per job dispatch; strings don't change between jobs

#### H-4: `ensure_collection` Called Per Document in Embed Loop
**File:** `vector/ops.rs:310`
**Impact:** 1 extra HTTP Qdrant round-trip per document; 1000-doc embed = 1000 no-op `PUT /collections` calls

Fix: Boolean gate `if !collection_ensured { ensure_collection(...); collection_ensured = true; }`.

#### H-5: Serial URL Processing in Batch Worker (No JoinSet)
**File:** `batch_jobs.rs:272-288`
**Impact:** 100 URLs at 500ms each = 50s serial vs ~500ms parallel; the `--wait true` CLI path correctly uses `JoinSet` — worker does not

#### H-6: Serial URL/LLM Processing in Extract Worker
**File:** `extract_jobs.rs:272-306`
**Impact:** N URLs × (crawl + LLM latency) sequential; broadcast channel buffer of 16 too small for LLM latency

#### H-7: Sync `read_inputs` Loads All Files Before Embedding
**File:** `vector/ops.rs:218-240`
**Impact:** All file content in memory simultaneously before first embed begins; blocking on tokio thread

Fix: Stream files one-at-a-time with `tokio::fs::read_dir` + process-as-read pipeline.

### Medium

- **M-1:** `build_transform_config()` reconstructed per page in hot crawl loop (move outside loop)
- **M-2:** `DefaultHasher` per filename call, non-deterministic across Rust versions
- **M-3:** `chunk_text` materializes full `Vec<char>` (~200KB per 50KB doc, 200MB total for 1000-doc embed)
- **M-4:** `qdrant_retrieve_by_url` accumulates all chunks before printing
- **M-5:** `to_markdown` called in `crawl_and_collect_map` but result discarded (only char count needed)
- **M-6:** `normalize_local_service_url` chains 8 `.replace()` calls with 8 intermediate allocations
- **M-7:** Polling fallback fixed at 800ms interval (up to 800ms job start latency; no adaptive backoff)
- **M-8:** `extract_meta_description` lowercases entire HTML string twice

### Low

- **L-1:** AMQP consumer processes one job at a time; no `basic_qos(prefetch=1)` set
- **L-2:** O(N²) link deduplication in `extract_links` (200 links → 40K comparisons)
- **L-3:** Preflight sitemap fetch blocks return on every `--wait false` crawl enqueue
- **L-4:** `rabbitmq:management` image in production compose (~50MB overhead + management plugin CPU)
- **L-5:** `qdrant/qdrant:latest` unpinned — silent API breakage on `docker compose pull`
- **L-6:** `TEI_MAX_CLIENT_BATCH_SIZE` read from env on every TEI call (should be in Config)

### Scalability Cliffs (in order of severity)

| Cliff | Trigger | Failure Mode |
|-------|---------|--------------|
| **Postgres connection exhaustion** | ~5 concurrent `status` calls | New pools per op × 5 max_connections = 20 conns/invocation; Postgres default max=100 |
| **Broadcast channel lag / page loss** | High-concurrency crawl + slow disk | `fs::write` blocks tokio threads; channel fills; `RecvError::Lagged` drops pages silently |
| **CLI OOM** | ~500K Qdrant points + `sources`/`domains` call | `qdrant_scroll_all` materializes entire collection; ~500MB at 1M points |
| **AMQP connection churn** | Burst job submission | TCP connections opened and immediately closed at submission rate |
| **TEI throughput cap** | Large embed workloads | Serial per-document TEI calls; network RTT dominates instead of inference throughput |

---

## Critical Issues for Phase 3 Context

1. **Zero tests** — no test files in the codebase. Testing review (Phase 3) will primarily be a gap analysis.
2. **Data loss scenario** — `fs::write` blocking in async crawl collector can silently drop pages via broadcast lag. Needs test coverage specifically for this race condition.
3. **All panics are untested** — `vectors[0]`, `&text[..140]`, `.remove(0)` — none have test coverage.
4. **Job infrastructure duplication** — any documentation review must note the 4× job module duplication makes documentation requirements 4× worse.
5. **`passthrough.rs` dead code** — should be deleted before documentation review to avoid confusion.
