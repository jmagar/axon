# CLI Firecrawl - Claude Agent Context

## Purpose

A command-line interface for the Firecrawl web scraping API with integrated semantic search capabilities via TEI embeddings and Qdrant vector database.

## Architecture Overview

```
src/
├── index.ts              # CLI entry point (Commander.js, ~850 lines)
├── commands/             # Command implementations (13 commands)
│   ├── scrape.ts        # Single URL scraping
│   ├── crawl.ts         # Multi-page crawling with progress
│   ├── map.ts           # URL discovery (sitemap-like)
│   ├── search.ts        # Web search with optional scraping
│   ├── extract.ts       # Structured data extraction
│   ├── embed.ts         # Manual vector embedding
│   ├── query.ts         # Semantic search
│   ├── retrieve.ts      # Document reconstruction
│   ├── config.ts        # Configuration management
│   ├── login.ts         # Authentication
│   ├── logout.ts        # Credential removal
│   ├── status.ts        # System status
│   └── version.ts       # Version info
├── utils/                # Shared utilities (14 modules)
│   ├── client.ts        # Firecrawl SDK client singleton
│   ├── config.ts        # Global configuration (env > credentials > defaults)
│   ├── credentials.ts   # OS credential storage (keychain/file fallback)
│   ├── auth.ts          # Authentication flow
│   ├── output.ts        # Output formatting with path traversal protection
│   ├── http.ts          # HTTP utilities with timeout and retry
│   ├── embedpipeline.ts # Embedding orchestration (chunking → TEI → Qdrant)
│   ├── chunker.ts       # Markdown-aware text chunking
│   ├── embeddings.ts    # TEI integration (batched, concurrent)
│   ├── qdrant.ts        # Qdrant vector database client
│   ├── url.ts           # URL validation
│   ├── options.ts       # CLI option parsing
│   ├── job.ts           # Job ID detection
│   └── settings.ts      # User settings persistence
└── types/                # TypeScript interfaces (8 files)
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

### Docker Services

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `firecrawl` | mendableai/firecrawl | 53002 | Main Firecrawl API |
| `playwright` | loorisr/patchright-scrape-api | 53006 (internal) | Browser scraping backend |
| `tei` | ghcr.io/huggingface/tei | 53010 | Text embeddings |
| `qdrant` | qdrant/qdrant | 53333 | Vector database |

### Scraping Architecture

```
CLI → Firecrawl API (53002) → Patchright container (53006) → Chrome
                            ↘ Fetch engine (fallback)
```

- **Firecrawl** tries `playwright` engine first, waterfalls to `fetch` on failure
- **Patchright** is a patched Playwright fork with anti-bot-detection
- Uses system Chrome via `channel="chrome"` (not bundled Chromium)
- Blocks images/stylesheets/media/fonts by default for performance

### Environment Variables (.env)

```bash
FIRECRAWL_API_KEY=local-dev
FIRECRAWL_API_URL=http://localhost:53002
TEI_URL=http://localhost:53010
QDRANT_URL=http://localhost:53333
```

### Debugging Scrape Failures

1. Check Firecrawl logs: `docker logs firecrawl --tail 100`
2. Check Patchright logs: `docker logs playwright --tail 100`
3. Common issues:
   - Patchright `page.timeout()` bug - should be `page.wait_for_timeout()`
   - Client-side rendered sites may need `--wait-for` flag
   - Bot detection on some sites (try Chrome DevTools MCP as workaround)

## External Integrations

- **TEI (Text Embeddings Inference)**: Local vector embedding service at port 53010
- **Qdrant**: Local vector database at port 53333

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

## Development Commands

```bash
pnpm build          # Compile TypeScript
pnpm dev            # Watch mode
pnpm test           # Run tests (326 tests, ~800ms)
pnpm format         # Biome formatting
pnpm lint           # Biome linting
pnpm check          # Biome check (format + lint)
pnpm type-check     # TypeScript check
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

### Patchright `wait_after_load` Bug

The patchright container (`/app/app.py`) has a bug where `page.timeout()` should be `page.wait_for_timeout()`. This causes 500 errors when using `--wait-for` flag:

```
Error: 'Page' object has no attribute 'timeout'
```

**Workaround**: Don't use `--wait-for` flag, or fix the container's app.py.

### Client-Side Rendered Sites

Sites using heavy JS frameworks (TanStack Router, Next.js client-only, etc.) may fail to scrape if content isn't in initial HTML. The `fetch` engine will see empty content, and `playwright` engine may timeout before JS hydrates.
