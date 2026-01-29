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
├── utils/                # Shared utilities (15 modules)
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
│   ├── notebooklm.ts    # NotebookLM Python integration
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

## External Integrations (Optional)

- **TEI (Text Embeddings Inference)**: Vector embedding service
- **Qdrant**: Vector database for semantic search
- **NotebookLM**: Google's AI notebook (via Python subprocess)

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

### Python Subprocess Security

`notebooklm.ts:isValidPythonInterpreter()` validates interpreter paths.

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

## Known Issues / Technical Debt

1. **Entry point bloat**: `index.ts` is ~850 lines; consider extracting command factories
2. **22 `any` types**: Should be replaced with proper interfaces
3. **Biome**: Replaced Prettier/ESLint with Biome
4. **CommonJS**: Not yet migrated to ESM modules
5. **Global config state**: `config.ts` uses mutable global; consider DI

## Security Considerations

- API keys stored with 0600 file permissions
- Path traversal protection on file output
- Python interpreter path validation
- No hardcoded secrets in codebase
- HTTP timeout prevents hanging connections

## Recent Changes (feat/custom-user-agent branch)

- Configurable User-Agent via `FIRECRAWL_USER_AGENT` env var
- Map command sends User-Agent as HTTP header
- Default exclude paths for crawl command
- NotebookLM integration for map command
- Signal handlers for graceful shutdown
- HTTP timeout and retry logic for TEI/Qdrant
- Concurrency limits for embedding operations
