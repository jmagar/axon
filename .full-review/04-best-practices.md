# Phase 4: Best Practices & Standards

## Framework & Language Findings

---

### Critical

**BP-C1: Blocking `std::fs` I/O in async functions — not yet fully fixed** (`crates/cli/commands/scrape.rs`, `batch.rs`, `extract.rs`, `crawl/engine.rs:301-303`)
- `scrape.rs` lines 35/45-46: `fs::write`, `fs::create_dir_all` called inside `async fn run_scrape` without `tokio::fs` or `spawn_blocking`
- `engine.rs` lines 301/303: `fs::remove_dir_all` and `fs::create_dir_all` called synchronously before the `tokio::spawn` in `run_crawl_once`
- In `batch.rs`/`extract.rs` CLI command files: blocking fs calls remain in hot loops
- Fix: `tokio::fs::write(...).await`, `tokio::fs::create_dir_all(...).await` uniformly

**BP-C2: `BufWriter<std::fs::File>` inside `tokio::spawn` with interleaved async I/O** (`crates/crawl/engine.rs:309,316,355-357`)
- `run_crawl_once` creates `BufWriter<File>` (sync) on the caller, moves it into `tokio::spawn`, then mixes sync `writeln!(manifest, ...)` / `manifest.flush()` with `tokio::fs::write(...).await`
- Sync `flush()` on a full write buffer blocks the Tokio executor thread during heavy crawls
- Fix: Use `tokio::io::BufWriter<tokio::fs::File>` with `AsyncWriteExt` inside the spawn

**BP-C3: `fetch_text_with_retry` bypasses `validate_url` — SSRF gap for sitemap-derived URLs** (`crates/crawl/engine.rs:80-108`)
- `fetch_html` calls `validate_url` before fetching, but `fetch_text_with_retry` calls `client.get(url).send()` directly
- `fetch_text_with_retry` is used for sitemap XML fetches and sitemap backfill page fetches — all URLs derived from crawled site content
- A malicious site's sitemap could list RFC-1918 or loopback URLs; hostname-scope check does not block private IPs
- Fix: Call `validate_url(url)` at the entry of `fetch_text_with_retry`, return `None` on failure

---

### High

**BP-H1: `Box<dyn Error>` used universally — not `Send`, no typed errors** (all files)
- `Box<dyn Error>` is `!Send` — cannot be used in `tokio::spawn` return types without a compiler error; latent hazard for refactoring
- Unactionable error messages (e.g., `"TEI returned no vectors"`) — no structured fields for programmatic distinction
- Fix: Add `anyhow = "1"` + `thiserror = "2"` to `Cargo.toml`; replace `Box<dyn Error>` with `anyhow::Result<T>` in application code (`anyhow::Error` is `Send + Sync`); use `thiserror` for library boundary error enums

**BP-H2: `reqwest::Client::new()` called per function — no connection reuse** (`crates/vector/ops.rs` — 8 call sites; `crates/extract/remote_extract.rs`)
- Each call to `tei_embed`, `ensure_collection`, `qdrant_upsert`, `qdrant_search`, etc. allocates a new TCP pool + TLS context
- 500-chunk embed job creates multiple clients, preventing any connection reuse to TEI/Qdrant
- Fix: `std::sync::LazyLock<reqwest::Client>` for a process-global client, or pass `Arc<reqwest::Client>` through function signatures

**BP-H3: `PgPool` created + schema DDL run on every public function call** (`crates/jobs/*.rs` — all four job modules)
- Every `get_job`, `list_jobs`, `cancel_job`, `cleanup_jobs` independently calls `pool(cfg).await?` + `ensure_schema(pool).await?`
- `doctor` runs four workers in parallel → 4 concurrent pool creations + 8–12 DDL statements
- Fix: Create `Arc<PgPool>` once at worker/command init; run `ensure_schema` once; pass pool as parameter

---

### Medium

**BP-M1: `DefaultHasher` for output filenames — not stable across Rust versions** (`crates/core/content.rs:66-68`)
- Rust docs explicitly warn: DefaultHasher algorithm "may change at any time"
- Filenames used for cross-run cache/dedup break across build versions
- Fix: Use a stable hash (e.g., `xxhash`, `fnv`), or remove the hash and rely solely on the `idx` counter

**BP-M2: Redundant `ALTER TABLE` in `ensure_schema` for crawl_jobs** (`crates/jobs/crawl_jobs.rs:136-138`)
- `result_json JSONB` is already in `CREATE TABLE IF NOT EXISTS`; the subsequent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS result_json` is a leftover migration artifact
- Called per operation (per BP-H3), so this dead DDL runs on every CLI interaction
- Fix: Remove the redundant `ALTER TABLE` statement

**BP-M3: `futures_util::StreamExt` imported inside function bodies** (`crates/jobs/*.rs` — 4 files)
- `use futures_util::StreamExt` buried inside `run_worker` function body in all four job files
- Fix: Move to module-level imports

**BP-M4: No `rust-toolchain.toml` and no `[profile.release]` optimizations** (`Cargo.toml`)
- No pinned toolchain → different Rust versions produce different binaries
- No release optimizations → larger binary, no LTO
- Fix:
  ```toml
  # rust-toolchain.toml
  [toolchain]
  channel = "stable"

  # Cargo.toml
  [profile.release]
  opt-level = 3
  lto = "thin"
  codegen-units = 1
  strip = true
  ```

**BP-M5: Debug format `{:?}` for user-facing enum display** (`scrape.rs:15`, `crawl.rs:247`)
- Shows `"AutoSwitch"` and `"Markdown"` instead of CLI names `"auto-switch"` and `"markdown"`
- Fix: Implement `Display` on `RenderMode` and `ScrapeFormat`, or add `as_str()` matching `#[value(name = ...)]`

**BP-M6: No context size cap before LLM request in `run_ask_native`** (`crates/vector/ops.rs:581-609`)
- 8 chunks × 2000 chars = up to 16,000 chars of context with no guard
- Exceeding LLM context window produces unhelpful HTTP 400 via `error_for_status()`
- Fix: Truncate `context` to configurable max (e.g., 12,000 chars) before constructing request; log warning on truncation

---

### Low

**BP-L1: Two binary targets compile the same `main.rs` twice** (`Cargo.toml:9-15`)
- `cortex` and `axon` both point to `path = "main.rs"` — doubles build time
- Fix: Keep one binary; add a symlink or alias for the other name

**BP-L2: Broad version specifiers for rapidly-evolving crates** (`Cargo.toml`)
- `spider = "2"` and `spider_transformations = "2"` are wide; Spider API is evolving fast
- Fix: Tighten to current minor version (e.g., `"2.45"`)

**BP-L3: `edition = "2021"` — Rust 2024 available** (`Cargo.toml`)
- Rust 2024 stabilized in 1.85; migration is low-effort via `cargo fix --edition`
- Low priority modernization opportunity

**BP-L4: `RenderMode` stored as `String` in job configs** (`crates/jobs/crawl_jobs.rs:27-49`)
- `render_mode_from_str` silently falls back to `AutoSwitch` for unknown values — loses type safety
- Fix: Derive `serde::Serialize/Deserialize` on `RenderMode` directly; store typed in `CrawlJobConfig`

**BP-L5: `let _ = url; let _ = err` silently drops error context** (`crates/crawl/engine.rs:515-517`)
- Failed page URL and error are discarded; only `failed_fetches += 1` is recorded
- Fix: `log_warn(&format!("page fetch failed: {url}: {err}"))` before incrementing counter

---

## CI/CD & DevOps Findings

---

### Critical

**CD-C1: No CI/CD pipeline exists** (absent `.github/workflows/`)
- No build gate, no test gate, no lint check, no security scan — every push ships unverified
- Fix: Add `.github/workflows/ci.yml` with `cargo check`, `cargo clippy -- -D warnings`, `cargo fmt --check`, `cargo audit`, `docker build` smoke test

---

### High

**CD-H1: No dependency CVE scanning** (absent `deny.toml`, `audit.toml`)
- 5,667-line `Cargo.lock` with transitive deps from `reqwest`, `lapin`, `sqlx`, `redis`, `spider` — any CVE is invisible
- Fix: `cargo audit` in CI; `cargo deny` with `deny.toml` for license + advisory DB checks

**CD-H2: Full source tree copied into runtime image** (`docker/Dockerfile:38`)
- `COPY --from=builder /src /app` puts `CLAUDE.md`, `EXAMPLES-CAPABILITY-AUDIT.md`, all Rust source, `Cargo.toml`, `Cargo.lock`, and the Dockerfile itself in every production image layer
- `.dockerignore` does NOT help — it filters the build context sent to the daemon, not what `COPY --from=builder` copies
- Fix: Remove line 38 entirely; only the binary and s6 scripts belong in the runtime image

**CD-H3: Container runs as root — no `USER` instruction** (`docker/Dockerfile`)
- s6-overlay and all four workers run as UID 0; combined with bind-mounted host directories and arbitrary external web content fetching, this is the highest-risk combination
- Fix: Add `RUN groupadd -r axon && useradd -r -g axon -u 1001 axon` and `USER axon`; configure s6-overlay for non-root operation

**CD-H4: s6 log directories never created** (`docker/Dockerfile`, `docker/s6/services.d/*/log/run`)
- All four `log/run` scripts reference `/var/log/axon/<worker-name>` directories that do not exist in the image
- s6-log fails silently on first start; log rotation never functions
- Fix: Add to Dockerfile runtime stage:
  ```dockerfile
  RUN mkdir -p \
      /var/log/axon/crawl-worker \
      /var/log/axon/batch-worker \
      /var/log/axon/embed-worker \
      /var/log/axon/extract-worker
  ```

**CD-H5: Unstructured plain-text logging** (`crates/core/logging.rs`)
- Three log functions output `eprintln!` with ANSI codes; no log level field, no component field, no job ID, no timestamp in the message
- s6-log captures to rotating files but output is grep-only at 3am
- Fix: Adopt `tracing` + `tracing-subscriber` with JSON formatter; structured fields enable `jq`-based querying and any log aggregation pipeline

**CD-H6: No rollback plan or versioned image artifacts**
- Deploying a broken build requires: revert code → full Rust recompile → restart; no "pull previous image" path
- Fix: Tag images with `$(git rev-parse --short HEAD)` before `docker compose up`; keep last 3 built images on host

---

### Medium

**CD-M1: No image versioning for rollback** (absent build scripts)
- No tagging strategy; rebuild is the only rollback mechanism
- Fix: `scripts/build.sh` that tags with git SHA

**CD-M2: Unpinned base images in Dockerfile** (`docker/Dockerfile:1,9`)
- `rust:bookworm` and `debian:stable-slim` are rolling tags; non-reproducible builds; supply chain risk
- Fix: Pin to digests or `rust:1.85-bookworm` / `debian:12.9-slim`

**CD-M3: s6-overlay downloaded without checksum verification** (`docker/Dockerfile:29-32`)
- `curl | tar` with no `sha256sum` verification; tampered release artifacts would be silently installed
- Fix: Fetch corresponding `.sha256` file and verify before extraction

**CD-M4: No `HEALTHCHECK` in Dockerfile** (`docker/Dockerfile`)
- Health check defined only in `docker-compose.yaml`; not available when image is run outside Compose (Portainer, `docker run`, etc.)
- Fix: Add `HEALTHCHECK CMD /usr/local/bin/healthcheck-workers.sh` to Dockerfile

**CD-M5: Qdrant service missing health check; workers use `condition: service_started`** (`docker-compose.yaml`)
- Qdrant takes several seconds to initialize; workers starting before Qdrant is ready fail first embed operations silently
- Fix:
  ```yaml
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:6333/healthz"]
    interval: 10s
    timeout: 5s
    retries: 5
  ```
  Then change `condition: service_started` → `condition: service_healthy` for `axon-qdrant`

**CD-M6: Floating image tags in docker-compose** (`docker-compose.yaml`)
- `redis:alpine`, `rabbitmq:management`, `qdrant/qdrant:latest` — all floating; silent version changes on `docker compose pull`
- Fix: Pin to `redis:7.4-alpine`, `rabbitmq:4.0-management`, `qdrant/qdrant:v1.13.1`

**CD-M7: No resource limits on any service** (`docker-compose.yaml`)
- High-concurrency crawl worker (192 connections) can OOM the host, killing Postgres/RabbitMQ, corrupting in-flight jobs
- Fix: Add `deploy.resources.limits` with CPU and memory caps to `axon-workers`

**CD-M8: RabbitMQ running with implicit `guest:guest` credentials** (`docker-compose.yaml`, `config.rs:519`)
- No `RABBITMQ_DEFAULT_USER/PASS` in docker-compose; `guest` account may be silently rejected by RabbitMQ's localhost-only restriction, causing constant fallback to Postgres polling
- Fix: Set explicit RabbitMQ credentials in docker-compose; update `.env.example` and code default

**CD-M9: Hardcoded credential defaults baked into source** (`crates/core/config.rs:503,519`)
- `postgresql://axon:postgres@...` and `amqp://guest:guest@...` are compiled into the binary
- If env file fails to load (see CD-L1), binary silently uses these weak defaults
- Fix: Require non-empty env vars or fail fast with a clear error message

**CD-M10: No environment separation (dev/prod)** (`docker-compose.yaml`)
- One stack, one schema, one Qdrant collection — tests and production share state
- `ensure_schema()` runs DDL on every startup — schema migration happens inside application code without history
- Fix: `AXON_ENV=dev|prod` variable; separate DB and Qdrant collection per environment; proper migration tool

**CD-M11: No container capability dropping or `no-new-privileges`** (`docker-compose.yaml`)
- Default Docker capability set includes `CAP_NET_ADMIN`, `CAP_NET_RAW`, `CAP_SYS_CHROOT`
- Fix:
  ```yaml
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
  ```

---

### Low

**CD-L1: Stale fallback path in cont-init script** (`docker/s6/cont-init.d/10-load-axon-env:4`)
- Fallback: `/app/examples/axon_cli/.env` — this path does not exist in the current codebase
- Dockerfile sets `AXON_ENV_FILE=/app/.env` which wins in practice, but the stale fallback is a maintenance hazard
- Fix: Change fallback to `${AXON_ENV_FILE:-/app/.env}`

**CD-L2: No s6 `finish` scripts — tight crash loops on worker failure**
- Crashed workers restart immediately with no backoff; sustained failure burns CPU
- Fix: Add `finish` script with `s6-sleep 5` to each worker service directory

**CD-L3: All volumes use absolute host bind mounts** (`docker-compose.yaml`)
- Hard-codes `/home/jmagar/appdata/axon-*` paths; non-portable; requires manual directory creation
- Context: acceptable for a homelab deployment; document as pre-flight step in README

---

## Summary

| Category | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Framework & Language | 3 | 3 | 6 | 5 | **17** |
| CI/CD & DevOps | 1 | 6 | 11 | 3 | **21** |
| **Combined** | **4** | **9** | **17** | **8** | **38** |
