# axon_cli — Cortex CLI (Rust + Spider.rs)

Web crawl, scrape, batch, extract, embed, and query — all in one binary backed by a self-hosted RAG stack.

## Quick Start

```bash
# Start infrastructure (Postgres, Redis, RabbitMQ, Qdrant)
docker compose up -d

# Build the CLI
cargo build --release --bin cortex

# Run the CLI (binary lives in target/release/)
./target/release/cortex --help

# Or build + run in one shot (also available as 'axon' binary)
cargo run --bin cortex -- scrape https://example.com --wait true
```

> **Note:** Two binary aliases are compiled: `cortex` (primary) and `axon`. Both run the same entrypoint.

## Commands

| Command | Purpose | Async? |
|---------|---------|--------|
| `scrape <url>` | Single-page scrape to markdown | No |
| `crawl <url>` | Full site crawl, saves markdown files | Yes (default) |
| `map <url>` | Discover all URLs without scraping | No |
| `batch <urls...>` | Bulk scrape multiple URLs | Yes (default) |
| `extract <urls...>` | LLM-powered structured data extraction | Yes (default) |
| `search <query>` | Web search (requires search provider) | No |
| `embed [input]` | Embed file/dir/URL into Qdrant | Yes (default) |
| `query <text>` | Semantic vector search | No |
| `retrieve <url>` | Fetch stored document chunks from Qdrant | No |
| `ask <question>` | RAG: search + LLM answer | No |
| `sources` | List all indexed URLs + chunk counts | No |
| `domains` | List indexed domains + stats | No |
| `stats` | Qdrant collection stats | No |
| `status` | Show async job queue status | No |
| `doctor` | Diagnose service connectivity | No |

### Job Subcommands (for crawl / batch / extract / embed)

```bash
cortex crawl status <job_id>
cortex crawl cancel <job_id>
cortex crawl errors <job_id>
cortex crawl list
cortex crawl cleanup
cortex crawl clear
cortex crawl worker   # run a worker inline
```

### Key Global Flags

```
--wait <bool>            Run synchronously and block (default: false — enqueue async)
--collection <name>      Qdrant collection name (default: spider_rust)
--embed <bool>           Auto-embed scraped content (default: true)
--max-pages <n>          Page cap for crawl (default: 200; 0 = uncapped)
--max-depth <n>          Crawl depth (default: 5)
--render-mode <mode>     http | chrome | auto-switch (default: auto-switch)
--format <fmt>           markdown | html | rawHtml | json (default: markdown)
--performance-profile    high-stable | extreme | balanced | max (default: high-stable)
--output-dir <dir>       Output directory (default: .cache/axon-rust/output)
--json                   Machine-readable JSON output on stdout
--yes                    Skip confirmation prompts
```

## Architecture

```
axon_cli/
├── mod.rs                  # Entry: parse_args() → run() dispatch
├── crates/
│   ├── mod.rs              # pub mod cli, core, crawl, extract, jobs, vector
│   ├── cli/
│   │   ├── mod.rs
│   │   └── commands/       # One file per command (scrape, crawl, map, batch, …)
│   │       ├── common.rs   # run_embed_and_save(), shared embed/save helpers
│   │       └── passthrough.rs  # Pass-through to Spider Cloud / remote API
│   ├── core/
│   │   ├── config.rs       # CLI parsing (clap), Config struct, performance profiles
│   │   ├── content.rs      # HTML→markdown, URL→filename, transform pipeline
│   │   ├── health.rs       # redis_healthy() connectivity check
│   │   ├── http.rs         # build_client(), fetch_html()
│   │   ├── logging.rs      # log_info(), log_warn(), log_done() structured output
│   │   └── ui.rs           # ANSI color helpers (primary, accent, muted, status_text)
│   ├── crawl/
│   │   ├── mod.rs
│   │   └── engine.rs       # crawl_and_collect_map(), run_crawl_once(),
│   │                       # crawl_sitemap_urls(), append_sitemap_backfill(),
│   │                       # try_auto_switch(), should_fallback_to_chrome()
│   ├── extract/
│   │   ├── mod.rs
│   │   └── remote_extract.rs  # LLM extraction via OpenAI-compatible API
│   ├── jobs/               # AMQP-backed async job workers
│   │   ├── crawl_jobs.rs
│   │   ├── batch_jobs.rs
│   │   ├── extract_jobs.rs
│   │   └── embed_jobs.rs
│   └── vector/
│       ├── mod.rs
│       └── ops.rs          # tei_embed(), qdrant_upsert(), qdrant_search(),
│                           # run_query_native(), run_ask_native(), run_sources_native(), …
├── docker/
│   ├── Dockerfile          # Multi-stage build; s6-overlay for service supervision
│   └── s6/
│       ├── cont-init.d/    # 10-load-axon-env: loads .env on container startup
│       └── services.d/     # crawl-worker, batch-worker, extract-worker, embed-worker
├── docker-compose.yaml     # Full stack: postgres, redis, rabbitmq, qdrant, axon-workers
├── .env                    # Secrets (gitignored)
└── .env.example            # Template — copy to .env and fill in
```

## Infrastructure

### Docker Services

| Service | Image | Exposed Port | Purpose |
|---------|-------|-------------|---------|
| `axon-postgres` | postgres:17-alpine | `53432` | Job persistence |
| `axon-redis` | redis:alpine | `53379` | Queue state / caching |
| `axon-rabbitmq` | rabbitmq:management | `45535` | AMQP job queue |
| `axon-qdrant` | qdrant/qdrant | `53333`, `53334` (gRPC) | Vector store |
| `axon-workers` | built from Dockerfile | — | 4 workers (crawl/batch/extract/embed) |

All services live on the `cortex` bridge network. Data persisted to `/home/jmagar/appdata/axon-*`.

```bash
# Start all services
docker compose up -d

# Start just infrastructure (no workers)
docker compose up -d axon-postgres axon-redis axon-rabbitmq axon-qdrant

# Check health
docker compose ps

# Tail worker logs
docker compose logs -f axon-workers
```

### External Service: TEI (Text Embeddings Inference)

TEI is **not** in docker-compose — it's an external self-hosted service. Set `TEI_URL` in `.env`.

```bash
TEI_URL=http://YOUR_TEI_HOST:52000
```

## Environment Variables

Copy `.env.example` → `.env` and fill in values:

```bash
# Postgres
AXON_PG_URL=postgresql://axon:postgres@axon-postgres:5432/axon

# Redis
AXON_REDIS_URL=redis://axon-redis:6379

# RabbitMQ
AXON_AMQP_URL=amqp://axon-rabbitmq:5672

# Qdrant
QDRANT_URL=http://axon-qdrant:6333

# TEI embeddings (external — required for embed/query/ask)
TEI_URL=http://REPLACE_WITH_TEI_HOST:52000

# LLM (required for extract and ask commands)
OPENAI_BASE_URL=http://YOUR_LLM_HOST/v1
OPENAI_API_KEY=your-key-or-empty
OPENAI_MODEL=your-model-name

# Optional queue name overrides
AXON_CRAWL_QUEUE=axon.crawl.jobs
AXON_BATCH_QUEUE=axon.batch.jobs
AXON_EXTRACT_QUEUE=axon.extract.jobs
AXON_EMBED_QUEUE=axon.embed.jobs
```

### Dev vs Container URL Resolution

The CLI auto-detects whether it's running inside Docker:
- **Inside Docker** (`/.dockerenv` exists): uses container-internal DNS (`axon-postgres:5432`, etc.)
- **Outside Docker** (local dev): rewrites to localhost with mapped ports (`127.0.0.1:53432`, etc.)

**So `.env` can use container DNS** — `normalize_local_service_url()` in `config.rs` handles translation transparently.

## Gotchas

### `--wait false` (default) = fire-and-forget
By default, `crawl`, `batch`, `extract`, and `embed` enqueue jobs and return immediately. Use `--wait true` to block until completion. Without workers running, enqueued jobs will pend forever.

### `render-mode auto-switch`
The default mode. Runs an HTTP crawl first; if >60% of pages are thin (<200 chars) or total coverage is too low, automatically retries with Chrome. Chrome requires a running Chrome instance — if none is available, the HTTP result is kept.

### `crawl_raw()` vs `crawl()`
When Chrome feature is compiled in, `crawl()` expects a Chrome instance. `crawl_raw()` is pure HTTP and always works. `engine.rs` calls `crawl_raw()` for `RenderMode::Http` and `crawl()` for Chrome/AutoSwitch.

### `ask` LLM call pattern
`ask` constructs the URL as: `{OPENAI_BASE_URL}/chat/completions`
- **Correct:** `OPENAI_BASE_URL=http://host/v1`
- **Wrong:** `OPENAI_BASE_URL=http://host/v1/chat/completions` — double path

### TEI batch size / 413 handling
`tei_embed()` in `vector/ops.rs` auto-splits batches on HTTP 413 (Payload Too Large). Set `TEI_MAX_CLIENT_BATCH_SIZE` env var to control default chunk size (default: 64, max: 128).

### Text chunking
`chunk_text()` splits at 2000 chars with 200-char overlap. Each chunk = one Qdrant point. Very long pages produce many points.

### Thin page filtering
Pages with fewer than `--min-markdown-chars` (default: 200) are flagged as thin. If `--drop-thin-markdown true` (default), thin pages are skipped — not saved to disk or embedded.

### Collection must exist before upsert
`ensure_collection()` issues a PUT to Qdrant to create or update the collection with the correct vector dimension. This is idempotent — safe to call on every embed.

### Sitemap backfill
After a crawl, `append_sitemap_backfill()` discovers URLs via sitemap.xml that the crawler missed and fetches them individually. Respects `--max-sitemaps` (default: 512) and `--include-subdomains`.

### Docker build context
The `Dockerfile` builds from this directory. The build command inside the container is:
```
cargo build --release --bin cortex
```
`docker-compose.yaml` sets `context: .` — run `docker compose build` from this directory, not from a parent workspace.

## Performance Profiles

Concurrency tuned relative to available CPU cores:

| Profile | Crawl concurrency | Sitemap concurrency | Timeout | Retries | Backoff |
|---------|------------------|---------------------|---------|---------|---------|
| `high-stable` (default) | CPUs×8 (64–192) | CPUs×12 (64–256) | 20s | 2 | 250ms |
| `balanced` | CPUs×4 (32–96) | CPUs×6 (32–128) | 30s | 2 | 300ms |
| `extreme` | CPUs×16 (128–384) | CPUs×20 (128–512) | 15s | 1 | 100ms |
| `max` | CPUs×24 (256–1024) | CPUs×32 (256–1536) | 12s | 1 | 50ms |

## Development

### Build

```bash
cargo build --bin cortex                        # debug
cargo build --release --bin cortex              # release
cargo check                                     # fast type check
```

### Lint

```bash
cargo clippy
cargo fmt --check
```

### Run directly

```bash
# Debug binary
./target/debug/cortex scrape https://example.com

# With env overrides
QDRANT_URL=http://localhost:53333 \
TEI_URL=http://myserver:52000 \
./target/release/cortex query "embedding pipeline" --collection my_col
```

### Diagnose service connectivity

```bash
cortex doctor
```

Checks: Postgres, Redis, RabbitMQ, Qdrant, TEI, LLM endpoint reachability.

## Code Style

- Rust standard style — run `cargo fmt` before committing
- `cargo clippy` clean before committing
- Errors bubble via `Box<dyn Error>` at command boundaries; internal helpers return typed errors
- Structured log output via `log_info` / `log_warn` (not `println!` in library code)
- `--json` flag enables machine-readable output on all commands that print results
