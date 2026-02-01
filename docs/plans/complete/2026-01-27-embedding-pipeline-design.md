# Embedding Pipeline Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-embed all CLI output (scrape, crawl, search, extract) into Qdrant via HF TEI, and provide semantic search + full document retrieval.

**Architecture:** When `TEI_URL` and `QDRANT_URL` are set, every command that fetches content automatically chunks the text, generates embeddings via TEI, and upserts them into Qdrant. Standalone `embed`, `query`, and `retrieve` commands provide direct access to the pipeline. A new `extract` command wraps the Firecrawl SDK's extraction API.

**Tech Stack:** Node.js fetch for TEI and Qdrant REST APIs. No new dependencies beyond dotenv (already installed).

---

## Services

### TEI Client (`src/utils/embeddings.ts`)

- Calls `POST {TEI_URL}/embed` with `{ inputs: string[] }`
- **Auto-detect vector dimension**: On first call, `GET {TEI_URL}/info` to read `model_id` and infer dimension. Cache the result for the session. This avoids hardcoding 1024 and supports model swaps.
- **Batch size: 24 chunks per request** — TEI reports `max_client_batch_size: 192` and `max_batch_requests: 48`, but we use a conservative batch of 24 to avoid timeouts on long chunks and leave headroom for concurrent requests.
- **Concurrency limiter**: Max 4 concurrent TEI requests in-flight. Implemented as a simple semaphore (counter + queue) — no external dependency needed. Prevents overwhelming TEI when crawling hundreds of pages.
- Returns `number[][]` — one vector per input
- Auto-truncation enabled on TEI side (32768 token max)

### Qdrant Client (`src/utils/qdrant.ts`)

- **Collection auto-creation**: On first upsert, check if collection exists via `GET /collections/{name}`. If not, create it with the vector dimension from TEI `/info` and Cosine distance. This removes the manual setup step and handles model swaps automatically.
- **Payload indexes**: After collection creation, create keyword indexes on `url`, `domain`, and `source_command` fields via `PUT /collections/{name}/index`. These dramatically speed up filtered queries and delete-by-URL operations.
- **Upsert**: `PUT {QDRANT_URL}/collections/{collection}/points`
- **Delete by URL**: `POST {QDRANT_URL}/collections/{collection}/points/delete` with filter on `url` field
- **Query**: `POST {QDRANT_URL}/collections/{collection}/points/query` with vector + optional filters
- **Scroll with pagination**: `POST {QDRANT_URL}/collections/{collection}/points/scroll` filtered by `url`, ordered by `chunk_index`. Uses `offset` parameter to paginate through large documents (100 points per page), following Qdrant's scroll cursor pattern rather than assuming all results fit in one response.
- Collection name from `QDRANT_COLLECTION` env var, defaults to `firecrawl_collection`

### Chunker (`src/utils/chunker.ts`)

Markdown-aware hybrid chunking:

1. Split on markdown headers (`#`, `##`, `###`, etc.) — each section is a candidate chunk
2. Split remaining large blocks on double newlines (paragraph boundaries)
3. Subdivide any chunk exceeding ~1500 characters into ~1000 char pieces with ~100 char overlap
4. Merge chunks smaller than 50 characters into the previous chunk

**Edge cases handled:**

- **Empty/whitespace input**: Return empty array (no chunks), skip embedding silently
- **Single character or trivially small input** (< 50 chars): Embed as single chunk, no splitting
- **No markdown headers**: Falls through to paragraph splitting → fixed-size fallback
- **Giant single paragraph** (no headers, no newlines): Fixed-size splitting with overlap kicks in directly

Each chunk carries:

```typescript
interface Chunk {
  text: string; // chunk content
  index: number; // 0-based position in document
  header: string | null; // nearest markdown heading above
}
```

### Embed Pipeline (`src/utils/embed-pipeline.ts`)

Orchestrator function called by all commands:

```typescript
async function autoEmbed(
  content: string,
  metadata: {
    url: string;
    title?: string;
    sourceCommand: string;
    contentType?: string;
  }
): Promise<void>;
```

- No-op if `TEI_URL` or `QDRANT_URL` not set
- Chunks content via chunker
- Batch-embeds via TEI client (with concurrency limiter)
- Deletes existing vectors for this URL (overwrite dedup)
- Upserts new vectors with metadata to Qdrant
- Logs summary: `Embedded N chunks for {url}`
- Never throws — errors are logged but don't break the command

**Graceful shutdown**: `autoEmbed()` returns a `Promise<void>`. The calling command's `handleXCommand()` function **must `await`** this promise before exiting. This ensures all embeddings complete before the process terminates. The pipeline is not fire-and-forget — it runs concurrently with output formatting but the process waits for it.

```typescript
// Pattern used in every command handler:
export async function handleScrapeCommand(
  options: ScrapeOptions
): Promise<void> {
  const result = await executeScrape(options);

  // Start embedding concurrently with output
  const embedPromise = autoEmbed(result.data?.markdown || '', {
    url: options.url,
    title: result.data?.metadata?.title,
    sourceCommand: 'scrape',
    contentType: detectContentType(result),
  });

  // Output results immediately
  handleScrapeOutput(
    result,
    formats,
    options.output,
    options.pretty,
    options.json
  );

  // Wait for embedding to finish before process exits
  await embedPromise;
}
```

## Metadata Per Vector Point

Each Qdrant point carries this payload:

| Field            | Type           | Description                                     |
| ---------------- | -------------- | ----------------------------------------------- |
| `url`            | string         | Source URL                                      |
| `title`          | string         | Page title from scrape metadata                 |
| `domain`         | string         | Extracted from URL (e.g. `example.com`)         |
| `chunk_index`    | number         | Position in document (0-based)                  |
| `chunk_text`     | string         | Raw text that was embedded                      |
| `chunk_header`   | string \| null | Nearest markdown heading above chunk            |
| `total_chunks`   | number         | Total chunks for this document                  |
| `source_command` | string         | `scrape`, `crawl`, `search`, `extract`, `embed` |
| `content_type`   | string         | `markdown`, `html`, `json`, etc.                |
| `scraped_at`     | string         | ISO timestamp                                   |

**Point IDs**: Random UUID v4 via `crypto.randomUUID()`. Not deterministic — deduplication is handled by deleting existing vectors for the URL before upserting. UUID v4 is simpler and avoids needing a UUID v5 library dependency.

## Deduplication

**Overwrite strategy**: before upserting new vectors for a URL, delete all existing points with matching `url` field. This keeps the index clean and ensures re-scraping a page replaces stale content. The Qdrant payload index on `url` makes this deletion fast.

## New Commands

### `extract` (`src/commands/extract.ts`)

Wraps the Firecrawl SDK `extract()` method.

**Follows the two-function pattern** used by all existing commands:

- `executeExtract(options)` → returns `{ success, data?, error? }`
- `handleExtractCommand(options)` → calls execute, formats output via `writeOutput()`, triggers autoEmbed

```bash
firecrawl extract https://example.com --prompt "Extract product pricing"
firecrawl extract https://example.com --schema '{"name": "string", "price": "number"}'

Options:
  --prompt <prompt>      Natural language extraction prompt
  --schema <json>        JSON schema for structured extraction
  --wait                 Wait for extraction to complete (default: true)
  -o, --output <path>    Save to file
  --json                 Output as JSON
  --pretty               Pretty print
  --no-embed             Skip auto-embedding
```

**What gets embedded**: A human-readable text representation of the extracted data, not raw JSON. The pipeline converts the extraction result into readable prose/key-value text before chunking and embedding. This produces better semantic vectors than JSON syntax.

```typescript
// Example: convert extracted JSON to embeddable text
function extractionToText(data: Record<string, unknown>): string {
  return Object.entries(data)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
}
```

### `embed` (`src/commands/embed.ts`)

Standalone embed command — auto-detects input type.

**Follows the two-function pattern:**

- `executeEmbed(options)` → returns `{ success, data?, error? }`
- `handleEmbedCommand(options)` → calls execute, formats output via `writeOutput()`, triggers autoEmbed

```bash
firecrawl embed https://example.com         # URL → scrape first, then embed
firecrawl embed .firecrawl/example.md        # file → read and embed
cat page.md | firecrawl embed --url https://example.com  # stdin

Options:
  --url <url>            Source URL for metadata (required for stdin/file)
  --collection <name>    Override collection (default: firecrawl_collection)
  --no-chunk             Embed as single vector, skip chunking
```

### `query` (`src/commands/query.ts`)

Semantic search over Qdrant.

**Follows the two-function pattern:**

- `executeQuery(options)` → returns `{ success, data?, error? }`
- `handleQueryCommand(options)` → calls execute, formats output via `writeOutput()`

**Does NOT require Firecrawl authentication** — this command talks only to TEI + Qdrant, not the Firecrawl API. Must NOT be added to `AUTH_REQUIRED_COMMANDS` in `index.ts`.

```bash
firecrawl query "how to authenticate"

Options:
  --limit <n>            Max results (default: 5)
  --domain <domain>      Filter to specific domain
  --full                 Show complete chunk text (for RAG/LLM context)
  --group                Group results by source URL
  --collection <name>    Override collection
  -o, --output <path>    Save to file
  --json                 Output as JSON
```

Default output (compact):

```
[0.92] https://docs.firecrawl.dev/auth — ## Authentication
  Set environment variables for self-hosted instances...

[0.87] https://docs.firecrawl.dev/auth — ## Authentication Methods
  Or login interactively: firecrawl login...
```

`--full` output (RAG-ready):

```
[0.92] https://docs.firecrawl.dev/auth — ## Authentication

Set environment variables for self-hosted instances:
export FIRECRAWL_API_KEY="your-api-key"
export FIRECRAWL_API_URL="http://localhost:53002"

[0.87] https://docs.firecrawl.dev/auth — ## Authentication Methods

Or login interactively: firecrawl login
firecrawl login --api-key "your-key" --api-url "http://localhost:53002"
```

### `retrieve` (`src/commands/retrieve.ts`)

Full document reconstruction from Qdrant.

**Follows the two-function pattern:**

- `executeRetrieve(options)` → returns `{ success, data?, error? }`
- `handleRetrieveCommand(options)` → calls execute, formats output via `writeOutput()`

**Does NOT require Firecrawl authentication** — reads only from Qdrant.

```bash
firecrawl retrieve https://docs.firecrawl.dev/auth

Options:
  --collection <name>    Override collection
  -o, --output <path>    Save to file
  --json                 Output as JSON (includes metadata per chunk)
```

Fetches all chunks for the URL from Qdrant via paginated scroll, orders by `chunk_index`, and reassembles the full document. No re-scraping needed.

## Integration Into Existing Commands

Each command handler calls `autoEmbed()` after receiving the response:

| Command   | What gets embedded                                                                                                                                                              | Source            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `scrape`  | Response content (whatever format the user requested)                                                                                                                           | Response object   |
| `crawl`   | Content per page as results stream in                                                                                                                                           | Per-page callback |
| `search`  | **Only embeds if `--scrape` flag is set** — embeds the scraped content per result. Without `--scrape`, search returns snippets which are too small/noisy for useful embeddings. | Results array     |
| `extract` | Human-readable text representation of extracted data                                                                                                                            | Extract response  |

All commands gain `--no-embed` flag to skip auto-embedding. Commander.js `--no-embed` pattern: creates `options.embed` defaulting to `true`.

`autoEmbed()` runs concurrently with output but is **awaited before process exit** — see Embed Pipeline section above.

## Configuration

### GlobalConfig Extension

Extend the existing `GlobalConfig` interface in `src/utils/config.ts`:

```typescript
export interface GlobalConfig {
  apiKey?: string;
  apiUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffFactor?: number;
  // Embedding pipeline config
  teiUrl?: string;
  qdrantUrl?: string;
  qdrantCollection?: string;
}
```

Update `initializeConfig()` to load from env:

```typescript
globalConfig = {
  // ...existing fields...
  teiUrl: config.teiUrl || process.env.TEI_URL,
  qdrantUrl: config.qdrantUrl || process.env.QDRANT_URL,
  qdrantCollection:
    config.qdrantCollection ||
    process.env.QDRANT_COLLECTION ||
    'firecrawl_collection',
};
```

### `.env` Configuration

```bash
# Required for auto-embed
TEI_URL=http://100.74.16.82:52000
QDRANT_URL=http://localhost:53333

# Optional
QDRANT_COLLECTION=firecrawl_collection  # default
```

Auto-embed activates when both `TEI_URL` and `QDRANT_URL` are set. No other config needed.

### Authentication

**New commands that do NOT require Firecrawl auth:**

- `embed` (when given a file/stdin — uses TEI+Qdrant only)
- `query` (TEI+Qdrant only)
- `retrieve` (Qdrant only)

**Commands that DO require Firecrawl auth:**

- `embed` (when given a URL — needs to scrape first via Firecrawl API)
- `extract` (uses Firecrawl SDK)
- `scrape`, `crawl`, `search`, `map` (existing — unchanged)

Implementation: `embed` conditionally calls `ensureAuthenticated()` only when the input is a URL. `query` and `retrieve` are NOT added to `AUTH_REQUIRED_COMMANDS`. `extract` IS added to `AUTH_REQUIRED_COMMANDS`.

## File Structure

**New files:**

| File                          | Purpose                                       |
| ----------------------------- | --------------------------------------------- |
| `src/utils/chunker.ts`        | Markdown-aware hybrid text chunking           |
| `src/utils/embeddings.ts`     | TEI client — batch embed with concurrency     |
| `src/utils/qdrant.ts`         | Qdrant client — upsert, delete, query, scroll |
| `src/utils/embed-pipeline.ts` | `autoEmbed()` orchestrator                    |
| `src/commands/embed.ts`       | Standalone embed command                      |
| `src/commands/query.ts`       | Semantic search command                       |
| `src/commands/retrieve.ts`    | Full document retrieval command               |
| `src/commands/extract.ts`     | Structured extraction command                 |
| `src/types/embed.ts`          | Types for embed command                       |
| `src/types/query.ts`          | Types for query command                       |
| `src/types/retrieve.ts`       | Types for retrieve command                    |
| `src/types/extract.ts`        | Types for extract command                     |

**Modified files:**

| File                     | Change                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `src/commands/scrape.ts` | Add `autoEmbed()` call in `handleScrapeCommand()`                                                    |
| `src/commands/crawl.ts`  | Add `autoEmbed()` call per page in handler                                                           |
| `src/commands/search.ts` | Add `autoEmbed()` call per result (only with `--scrape`)                                             |
| `src/utils/config.ts`    | Extend `GlobalConfig` with `teiUrl`, `qdrantUrl`, `qdrantCollection`                                 |
| `src/utils/output.ts`    | New commands use existing `writeOutput()` for consistency                                            |
| `src/index.ts`           | Register `embed`, `query`, `retrieve`, `extract` commands; add `extract` to `AUTH_REQUIRED_COMMANDS` |
| `.env.example`           | Add `TEI_URL`, `QDRANT_URL`, `QDRANT_COLLECTION`                                                     |

**No new npm dependencies** — fetch API for HTTP calls (Node 18+), `crypto.randomUUID()` for point IDs.

## RAG Workflow

Typical usage pattern:

```bash
# 1. Scrape docs (auto-embeds if TEI+Qdrant configured)
firecrawl crawl https://docs.example.com --wait --limit 50

# 2. Find relevant chunks
firecrawl query "authentication setup"

# 3. Get full document for the best match
firecrawl retrieve https://docs.example.com/auth

# 4. Or get full chunk text for LLM context
firecrawl query "authentication setup" --full

# 5. Skip embedding for a one-off scrape
firecrawl scrape https://example.com --no-embed
```

## Review Findings Addressed

This design addresses all 16 review findings:

1. **Collection auto-creation** — Qdrant client checks/creates collection on first upsert using TEI-detected dimension
2. **UUID v4 instead of v5** — Uses `crypto.randomUUID()`, no UUID library needed; dedup via delete-before-upsert
3. **Concurrency limiter** — Semaphore limiting 4 concurrent TEI requests, prevents overwhelming TEI during crawls
4. **Await pending embeds before exit** — `autoEmbed()` is awaited in every command handler before process exits
5. **Qdrant payload indexes** — Creates keyword indexes on `url`, `domain`, `source_command` after collection creation
6. **Search only embeds with --scrape** — Without `--scrape`, snippets are too small/noisy; only scraped content is embedded
7. **No context expansion for query** — Keeping it simple per design; `retrieve` handles full-document needs
8. **Extract embeds human-readable text** — Converts extracted JSON to readable key-value text before embedding
9. **Chunker edge cases** — Handles empty input, trivially small input, no-header content, giant single paragraphs
10. **Scroll pagination for retrieve** — Uses Qdrant's offset-based scroll cursor, 100 points per page
11. **Two-function pattern** — All new commands use `executeX()` + `handleXCommand()` matching scrape/crawl/search/map
12. **writeOutput() usage** — All new commands use existing `writeOutput()` from `src/utils/output.ts`
13. **No Firecrawl auth for query/retrieve** — Not added to `AUTH_REQUIRED_COMMANDS`; embed conditionally authenticates
14. **Extend GlobalConfig** — Adds `teiUrl`, `qdrantUrl`, `qdrantCollection` to existing config interface
15. **TEI batch size 24** — Conservative batch size with headroom, not the raw max of 192
16. **Auto-detect vector dimension** — Reads from `TEI /info` endpoint, no hardcoded 1024
