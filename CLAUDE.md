# CLI Firecrawl - Claude Agent Context

## Purpose

A command-line interface for the Firecrawl web scraping API with integrated semantic search capabilities via TEI embeddings and Qdrant vector database.

## Quick Start

### First-Time Setup
```bash
cp .env.example .env          # Copy environment template
docker compose up -d          # Start infrastructure (first run: 5-10min for image pulls)
docker compose ps             # Verify all services show "Up" or "Up (healthy)"
pnpm install                  # Install dependencies
pnpm build                    # Compile TypeScript to dist/
pnpm local status             # Test installation
```

**Important**: Uncomment `TEI_URL=http://100.74.16.82:52000` in your `.env` file - embeddings are enabled by default.

### Daily Workflow
```bash
docker compose up -d          # Start infrastructure
pnpm dev                      # Auto-rebuild on file changes
pnpm local <command>          # Test CLI commands (uses dist/index.js)
pnpm test                     # Run unit tests
```

## Architecture Overview

```
src/
├── index.ts              # CLI entry point (Commander.js)
├── commands/             # Command implementations (21 user commands)
│   ├── scrape.ts        # Single URL scraping
│   ├── crawl/           # Multi-page crawling (8 supporting modules)
│   ├── map.ts           # URL discovery (sitemap-like)
│   ├── search.ts        # Web search with optional scraping
│   ├── extract.ts       # Structured data extraction
│   ├── embed.ts         # Manual vector embedding
│   ├── query.ts         # Semantic search in Qdrant
│   ├── retrieve.ts      # Document reconstruction
│   ├── config.ts        # Configuration management
│   ├── login.ts         # Authentication
│   ├── logout.ts        # Credential removal
│   ├── status.ts        # System status
│   ├── version.ts       # Version info
│   ├── batch.ts         # Batch operations
│   ├── delete.ts        # Delete crawl jobs
│   ├── domains.ts       # Domain management
│   ├── history.ts       # Job history
│   ├── info.ts          # Job info
│   ├── list.ts          # List jobs
│   ├── sources.ts       # Source management
│   └── stats.ts         # Statistics
├── utils/                # Shared utilities (25 modules)
│   ├── client.ts        # Firecrawl SDK client singleton
│   ├── config.ts        # Global configuration (env > credentials > defaults)
│   ├── credentials.ts   # OS credential storage (keychain/file fallback)
│   ├── auth.ts          # Authentication flow
│   ├── output.ts        # Output formatting with path traversal protection
│   ├── theme.ts         # CLI output theming (colors, icons, progress)
│   ├── http.ts          # HTTP utilities with timeout and retry
│   ├── embedpipeline.ts # Embedding orchestration (chunking → TEI → Qdrant)
│   ├── chunker.ts       # Markdown-aware text chunking
│   ├── embeddings.ts    # TEI integration (batched, concurrent)
│   ├── qdrant.ts        # Qdrant vector database client
│   ├── background-embedder.ts # Background embedding daemon
│   ├── embed-queue.ts   # Persistent job queue for embeddings
│   ├── embedder-webhook.ts # Webhook handler for async embeddings
│   ├── job-history.ts   # Job tracking and history
│   ├── url.ts           # URL validation
│   ├── options.ts       # CLI option parsing
│   ├── options-builder.ts # Fluent option builder
│   ├── job.ts           # Job ID detection
│   ├── polling.ts       # Long-running job polling
│   ├── settings.ts      # User settings persistence
│   ├── command.ts       # Command utilities
│   ├── display.ts       # Display formatting
│   ├── constants.ts     # Shared constants
│   └── extensions.ts    # Type extensions
└── types/                # TypeScript interfaces (15+ files)
```

## Key Technologies

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.0+ (strict mode, CommonJS)
- **CLI Framework**: Commander.js v14
- **Firecrawl**: `@mendable/firecrawl-js` SDK v4.10+
- **Testing**: Vitest v4
- **Package Manager**: pnpm

## Local Infrastructure

This project uses a **self-hosted Firecrawl stack**, NOT the cloud API.

**Important Files:**
- `patchright-app.py` - Patched version of the patchright container's app.py with the `page.timeout()` bug fixed
- `docker-compose.yaml` - Mounts patchright-app.py into the container at `/app/app.py`

### Docker Services

| Container | Image | Port | Purpose | Status |
|-----------|-------|------|---------|--------|
| `firecrawl` | ghcr.io/firecrawl/firecrawl | 53002 | Main Firecrawl API | Active |
| `firecrawl-embedder` | node:20-alpine | 53000 | Async embedding daemon | Active |
| `firecrawl-playwright` | loorisr/patchright-scrape-api | 53006 (internal) | Browser scraping backend | Active |
| `firecrawl-qdrant` | qdrant/qdrant | 53333 | Vector database | Active |
| `firecrawl-redis` | redis:alpine | 53379 (internal) | Job queue/cache | Active |
| `firecrawl-rabbitmq` | rabbitmq:3-management | (internal) | Message broker | Active |

### Scraping Architecture

```text
CLI → Firecrawl API (53002) → Patchright container (53006) → Chrome
                            ↘ Fetch engine (fallback)
```

- **Firecrawl** tries `playwright` engine first, waterfalls to `fetch` on failure
- **Patchright** is a patched Playwright fork with anti-bot-detection
- Uses system Chrome via `channel="chrome"` (not bundled Chromium)
- Blocks images/stylesheets/media/fonts by default for performance

### Embedding Architecture

```text
CLI (scrape/crawl/extract) → Embedder Daemon (53000) → TEI @ steamy-wsl (100.74.16.82:52000)
                                     ↓                      [RTX 4070 GPU]
                              Qdrant (53333) ← stores vectors
```

- **Embedder Daemon** runs as a background service (`firecrawl-embedder` container)
- Processes embedding jobs asynchronously via queue system
- **TEI** runs on remote machine (steamy-wsl) with GPU acceleration
- **Embedding Model**: `Qwen/Qwen3-Embedding-0.6B` via Hugging Face TEI
- **TEI Endpoints**:
  - `/embed` - Native TEI endpoint
  - `/v1` - OpenAI-compatible endpoint
- Embeddings are automatically generated for all scrape/crawl/extract/search operations
- Vectors stored in local Qdrant for semantic search queries

### Environment Variables (.env)

```bash
FIRECRAWL_API_KEY=local-dev
FIRECRAWL_API_URL=http://localhost:53002
TEI_URL=http://100.74.16.82:52000  # Remote TEI on steamy-wsl with RTX 4070
QDRANT_URL=http://localhost:53333
```

### Debugging Scrape Failures

1. Check Firecrawl logs: `docker logs firecrawl --tail 100`
2. Check Patchright logs: `docker logs firecrawl-playwright --tail 100`
3. Check embedder daemon: `docker logs firecrawl-embedder --tail 100`
4. Verify Qdrant health: `curl http://localhost:53333/collections/firecrawl`
5. Check port availability: `ss -tuln | grep -E '(53002|53000|53333)'`
6. Verify Docker services: `docker compose ps` (all should be "Up" or "Up (healthy)")

**Common Issues:**
- Patchright `page.timeout()` bug - should be `page.wait_for_timeout()` (fixed via mounted patch)
- Client-side rendered sites may need `--wait-for` flag for JS hydration
- Bot detection on some sites (try Chrome DevTools MCP as workaround)
- Port conflicts: Ensure 53002, 53000, 53333 are free before `docker compose up`
- Qdrant connection errors: Check if `firecrawl-qdrant` container is healthy
- RabbitMQ startup: May take 30-60s to show "Up (healthy)" on first run
- Embedder queue not processing: Check `.cache/embed-queue/` permissions and disk space

## External Integrations

- **Qdrant**: Local vector database at port 53333
- **TEI (Text Embeddings Inference)**: Remote embedding service on steamy-wsl (100.74.16.82:52000) with RTX 4070 GPU
  - Model: `Qwen/Qwen3-Embedding-0.6B`
  - Endpoints: `/embed` (native), `/v1` (OpenAI-compatible)
- **Embedder Daemon**: Background service processing embedding jobs asynchronously (port 53000)

## Configuration Priority

1. Runtime flags (`--api-key`)
2. Environment variables (`FIRECRAWL_API_KEY`, `TEI_URL`, `QDRANT_URL`)
3. OS credential store / fallback file (`~/.config/firecrawl-cli/`)
4. Defaults

## Important Patterns

### HTTP with Timeout and Retry

All external HTTP calls use `utils/http.ts`:

- `fetchWithRetry()` - 30s timeout, 3 retries with exponential backoff
- `fetchWithTimeout()` - Single call with configurable timeout
- Retryable errors: 408, 429, 500, 502, 503, 504 + network errors

### Embedding Concurrency

Commands use `p-limit` to prevent resource exhaustion:

- `MAX_CONCURRENT_EMBEDS = 10` (crawl, search, extract)
- TEI batches: 24 texts, 4 concurrent requests

### Signal Handling

Graceful shutdown on SIGINT/SIGTERM with double-signal force exit.

### Path Traversal Protection

`output.ts:validateOutputPath()` ensures output files stay within cwd.

### CLI Output Theming

All command output uses `utils/theme.ts` for consistent styling:

- **TTY-safe colors**: Use `fmt.success()`, `fmt.error()`, `fmt.warning()`, `fmt.dim()`, `fmt.primary()` - these only apply ANSI codes when outputting to a terminal, preserving pipe compatibility
- **Terminal-safe icons**: Use `icons.*` (✓ ✗ ○ ◉ → •) - these Unicode characters render correctly in all terminals (avoid emojis)
- **Status helpers**: `getStatusIcon()` and `getStatusColor()` for job status display
- **Progress bars**: `formatProgress()` for visual progress with filled/empty blocks

## Development Commands

```bash
# Building
pnpm build          # Compile TypeScript to dist/
pnpm dev            # Watch mode (auto-rebuild on changes)
pnpm clean          # Remove dist/ directory

# Running
pnpm start          # Run built CLI from dist/index.js
pnpm local          # Alias for pnpm start

# Testing
pnpm test           # Run unit tests (326 tests, ~800ms)
pnpm test:unit      # Unit tests only (excludes integration)
pnpm test:e2e       # E2E tests only (requires infrastructure)
pnpm test:all       # Full test suite (unit + e2e)
pnpm test:watch     # Watch mode for TDD

# Code Quality
pnpm format         # Biome formatting
pnpm lint           # Biome linting
pnpm check          # Biome check (format + lint)
pnpm type-check     # TypeScript type checking (no emit)
```

## Testing

- **Framework**: Vitest v4
- **Coverage**: 20 test files, 326 tests
- **Patterns**:
  - Mock Firecrawl SDK client
  - Mock fetch for TEI/Qdrant calls
  - Reset caches between tests (`resetTeiCache`, `resetQdrantCache`)

## Security Considerations

- API keys stored with 0600 file permissions
- Path traversal protection on file output
- No hardcoded secrets in codebase
- HTTP timeout prevents hanging connections

## Known Issues

### Patchright `wait_after_load` Bug (FIXED)

The upstream `loorisr/patchright-scrape-api` image has a bug where `page.timeout()` should be `page.wait_for_timeout()`.

**Our Fix**: We mount a patched `patchright-app.py` from the project root into the container via docker-compose volume. The fix changes line 374 from:
```python
await page.timeout(request_model.wait_after_load)
```
to:
```python
await page.wait_for_timeout(request_model.wait_after_load)
```

This fix persists across container restarts.

### Client-Side Rendered Sites

Sites using heavy JS frameworks (TanStack Router, Next.js client-only, etc.) may fail to scrape if content isn't in initial HTML. The `fetch` engine will see empty content, and `playwright` engine may timeout before JS hydrates.

### Environment Configuration Gotchas

**TEI URL is Commented Out in `.env.example`**

Embeddings are **enabled by default**, but the `.env.example` file comments out `TEI_URL`. You must uncomment this line in your `.env`:

```bash
# .env.example (commented)
# TEI_URL=http://100.74.16.82:52000

# Your .env (uncommented - required!)
TEI_URL=http://100.74.16.82:52000
```

Without this, the embedding pipeline will fail with connection errors.

**First-Time Docker Setup**

When running `docker compose up` for the first time:
- Image pulls may take 5-10 minutes (Firecrawl, Patchright, Qdrant, Redis, RabbitMQ)
- Qdrant creates `qdrant_storage/` directory in project root (gitignored)
- RabbitMQ may take 30-60s to become healthy - this is normal
- Check status with: `docker compose ps` (all services should show "Up" or "Up (healthy)")
- If any service fails to start, check logs: `docker logs <container-name>`

**Port Conflicts**

This project uses high ports (53000+) to avoid conflicts, but you should verify availability before starting:

```bash
ss -tuln | grep -E '(53002|53000|53333)'  # Should return empty
```

If ports are in use:
1. Stop conflicting services: `docker ps` to identify containers
2. Or modify `docker-compose.yaml` to use different ports
3. Update `.env` to match new port assignments

## Shell Completion

This project includes shell completion support for bash, zsh, and fish shells.

**Architecture:**
- **Static completion**: Command names, option flags, common values
- **Manual script generation**: Simple, dependency-free approach
- **Supported shells**: bash, zsh, fish

**Key files:**
- `src/commands/completion.ts` - Completion command implementation
- `src/utils/completion-helpers.ts` - Shell detection and RC file helpers
- `src/utils/completion-tree.ts` - Completion definitions (kept for reference, not actively used)

**Installation:**
```bash
firecrawl completion install [shell]
```

**Testing:**
```bash
pnpm build
pnpm local completion install
# Follow instructions to add to RC file
source ~/.zshrc  # or ~/.bashrc, ~/.config/fish/config.fish
firecrawl <TAB>
```

**How it works:**
1. `firecrawl completion install` auto-detects your shell
2. Generates a native completion script for that shell
3. Provides instructions to add it to your shell RC file
4. Once installed, tab completion works for all commands and common options

**What's completed:**
- All 19 top-level commands (scrape, crawl, map, search, extract, batch, embed, query, retrieve, list, status, config, view-config, login, logout, version, sources, stats, domains, delete, history, info, completion, help)
- Common option flags (--help, --api-key, --output, --pretty, --json, -o, -k, -h)
- Subcommands (batch status/cancel/errors, crawl status/cancel/errors, extract status)
- File paths for --output option (via shell's native file completion)
