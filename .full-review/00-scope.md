# Review Scope

## Target

Full codebase review of `axon_rust` — a Rust CLI (`axon_cli_rust`) for web crawling, scraping, embedding, and semantic search backed by a self-hosted RAG stack (Spider.rs + Qdrant + TEI + RabbitMQ + Redis + Postgres).

~19,000 lines of Rust across 34 source files.

## Files

### Source Code (Rust)
- `main.rs` — binary entry point
- `mod.rs` — top-level module re-export
- `crates/mod.rs` — crate module declarations
- `crates/cli/mod.rs` — CLI dispatch
- `crates/cli/commands/mod.rs` — command module
- `crates/cli/commands/batch.rs` — bulk URL scraping command
- `crates/cli/commands/common.rs` — shared embed/save helpers
- `crates/cli/commands/crawl.rs` — site crawl command + job subcommands
- `crates/cli/commands/doctor.rs` — service connectivity diagnostics
- `crates/cli/commands/embed.rs` — embed file/dir/URL into Qdrant
- `crates/cli/commands/extract.rs` — LLM-powered structured extraction
- `crates/cli/commands/map.rs` — URL discovery without scraping
- `crates/cli/commands/passthrough.rs` — pass-through to remote Spider API
- `crates/cli/commands/scrape.rs` — single-page scrape
- `crates/cli/commands/search.rs` — web search command
- `crates/cli/commands/status.rs` — job queue status display
- `crates/core/config.rs` — CLI parsing (clap), Config struct, perf profiles
- `crates/core/content.rs` — HTML→markdown, URL→filename, transform pipeline
- `crates/core/health.rs` — Redis connectivity check
- `crates/core/http.rs` — HTTP client builder + fetch
- `crates/core/logging.rs` — structured log helpers
- `crates/core/ui.rs` — ANSI color helpers
- `crates/crawl/engine.rs` — crawl engine, auto-switch logic
- `crates/crawl/mod.rs` — crawl module
- `crates/extract/mod.rs` — extract module
- `crates/extract/remote_extract.rs` — OpenAI-compatible LLM extraction
- `crates/jobs/batch_jobs.rs` — AMQP batch worker
- `crates/jobs/crawl_jobs.rs` — AMQP crawl worker
- `crates/jobs/embed_jobs.rs` — AMQP embed worker
- `crates/jobs/extract_jobs.rs` — AMQP extract worker
- `crates/jobs/mod.rs` — jobs module
- `crates/vector/mod.rs` — vector module
- `crates/vector/ops.rs` — TEI embed, Qdrant upsert/search, RAG query

### Configuration & Infrastructure
- `Cargo.toml` — workspace + crate dependencies
- `docker-compose.yaml` — full stack (postgres, redis, rabbitmq, qdrant, workers)
- `docker/Dockerfile` — multi-stage Rust build + s6-overlay service supervision
- `.env.example` — environment variable template

### Documentation
- `CLAUDE.md` — project instructions for AI assistants
- `README.md` — project overview
- `EXAMPLES-CAPABILITY-AUDIT.md` — capability audit doc
- `docs/reports/2026-02-18-code-review.md` — prior code review

## Flags

- Security Focus: no
- Performance Critical: no
- Strict Mode: **yes** (`--strict`)
- Framework: Rust (auto-detected)

## Review Phases

1. Code Quality & Architecture
2. Security & Performance
3. Testing & Documentation
4. Best Practices & Standards
5. Consolidated Report
