# Embedding Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **📁 Organization Note:** When this plan is fully implemented and verified, move this file to `docs/plans/complete/` to keep the plans folder organized.

**Goal:** Auto-embed all CLI output into Qdrant via HF TEI for semantic search, with new `extract`, `embed`, `query`, and `retrieve` commands.

**Architecture:** A pipeline of utilities (chunker → TEI embeddings → Qdrant storage) is called by every content-producing command after its response. New commands wrap the pipeline directly. All HTTP is native `fetch` (Node 18+). No new npm dependencies.

**Tech Stack:** Node.js fetch API, Qdrant REST API, HF TEI REST API, Commander.js, vitest

**Design doc:** `docs/plans/2026-01-27-embedding-pipeline-design.md`

---

## Codebase Conventions (READ THIS FIRST)

Before implementing anything, understand these patterns:

### Two-Function Command Pattern

Every command in `src/commands/` exports two functions:

- `executeX(options: XOptions): Promise<XResult>` — Core logic. Returns `{ success: boolean; data?: unknown; error?: string }`. Never calls `process.exit()`.
- `handleXCommand(options: XOptions): Promise<void>` — Calls `executeX()`, formats output, writes via `writeOutput()`, calls `process.exit(1)` on error.

### Type Files

Every command has a corresponding `src/types/X.ts` with its `XOptions` interface and `XResult` interface.

### Test Pattern

Every test file follows this exact structure:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeX } from '../../commands/X';
import { getClient } from '../../utils/client';
import { initializeConfig } from '../../utils/config';
import { setupTest, teardownTest } from '../utils/mock-client';

vi.mock('../../utils/client', async () => {
  const actual = await vi.importActual('../../utils/client');
  return { ...actual, getClient: vi.fn() };
});

describe('executeX', () => {
  let mockClient: Record<string, unknown>;

  beforeEach(() => {
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });
    mockClient = {
      /* mock methods */
    };
    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );
  });

  afterEach(() => {
    teardownTest();
    vi.restoreAllMocks();
  });

  it('should ...', async () => {
    /* ... */
  });
});
```

### Command Registration in index.ts

Commands use `createXCommand()` factory functions returning a `Command` object, added via `program.addCommand()`. The `preAction` hook checks `AUTH_REQUIRED_COMMANDS` for auth.

### Output

All commands use `writeOutput(content, outputPath?, silent?)` from `src/utils/output.ts`. When `outputPath` is set, writes to file and logs confirmation to stderr. Otherwise writes to stdout.

### Config

`src/utils/config.ts` exports `GlobalConfig` interface, `initializeConfig()`, `getConfig()`, `updateConfig()`, `resetConfig()`. Config is loaded from: provided options → env vars → stored credentials.

### Running Tests

```bash
pnpm test          # Run all tests
pnpm run build     # TypeScript build
```

---

## Task 1: Extend GlobalConfig with Embedding Settings

**Files:**

- Modify: `src/utils/config.ts`
- Modify: `src/__tests__/utils/config.test.ts`

**Step 1: Write the failing test**

Add to `src/__tests__/utils/config.test.ts`:

```typescript
describe('Embedding config', () => {
  it('should load TEI and Qdrant config from env vars', () => {
    process.env.TEI_URL = 'http://localhost:52000';
    process.env.QDRANT_URL = 'http://localhost:53333';
    process.env.QDRANT_COLLECTION = 'test_collection';

    initializeConfig({});

    const config = getConfig();
    expect(config.teiUrl).toBe('http://localhost:52000');
    expect(config.qdrantUrl).toBe('http://localhost:53333');
    expect(config.qdrantCollection).toBe('test_collection');
  });

  it('should default qdrantCollection to firecrawl_collection', () => {
    process.env.TEI_URL = 'http://localhost:52000';
    process.env.QDRANT_URL = 'http://localhost:53333';
    delete process.env.QDRANT_COLLECTION;

    initializeConfig({});

    const config = getConfig();
    expect(config.qdrantCollection).toBe('firecrawl_collection');
  });

  it('should have undefined teiUrl and qdrantUrl when not set', () => {
    delete process.env.TEI_URL;
    delete process.env.QDRANT_URL;

    initializeConfig({});

    const config = getConfig();
    expect(config.teiUrl).toBeUndefined();
    expect(config.qdrantUrl).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/utils/config.test.ts`
Expected: FAIL — `config.teiUrl` is `undefined` because `initializeConfig` doesn't read `TEI_URL`

**Step 3: Write minimal implementation**

In `src/utils/config.ts`, update the `GlobalConfig` interface:

```typescript
export interface GlobalConfig {
  apiKey?: string;
  apiUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffFactor?: number;
  teiUrl?: string;
  qdrantUrl?: string;
  qdrantCollection?: string;
}
```

In `initializeConfig()`, add after the existing fields:

```typescript
teiUrl: config.teiUrl || process.env.TEI_URL,
qdrantUrl: config.qdrantUrl || process.env.QDRANT_URL,
qdrantCollection:
  config.qdrantCollection ||
  process.env.QDRANT_COLLECTION ||
  'firecrawl_collection',
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/utils/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/config.ts src/__tests__/utils/config.test.ts
git commit -m "feat: extend GlobalConfig with TEI and Qdrant settings"
```

---

## Task 2: Update .env.example

**Files:**

- Modify: `.env.example`

**Step 1: Update .env.example**

```bash
# Firecrawl CLI Configuration
# Copy this file to .env and fill in your values

# API key for your Firecrawl instance
FIRECRAWL_API_KEY=local-dev

# API URL for your self-hosted Firecrawl instance
FIRECRAWL_API_URL=http://localhost:53002

# Embedding pipeline (optional - enables auto-embed)
# NOTE: TEI runs on 52000 in this environment; keep as-is even though it's < 53000
# TEI_URL=http://localhost:52000
# QDRANT_URL=http://localhost:53333
# QDRANT_COLLECTION=firecrawl_collection
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add TEI and Qdrant env vars to .env.example"
```

---

## Task 3: Chunker Utility

**Files:**

- Create: `src/utils/chunker.ts`
- Create: `src/__tests__/utils/chunker.test.ts`

**Step 1: Write the failing tests**

Create `src/__tests__/utils/chunker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { chunkText } from '../../utils/chunker';
import type { Chunk } from '../../utils/chunker';

describe('chunkText', () => {
  describe('edge cases', () => {
    it('should return empty array for empty string', () => {
      expect(chunkText('')).toEqual([]);
    });

    it('should return empty array for whitespace-only string', () => {
      expect(chunkText('   \n\n  ')).toEqual([]);
    });

    it('should return single chunk for short text', () => {
      const chunks = chunkText('Hello world');
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe('Hello world');
      expect(chunks[0].index).toBe(0);
      expect(chunks[0].header).toBeNull();
    });
  });

  describe('markdown header splitting', () => {
    it('should split on markdown headers', () => {
      const input =
        '# Title\n\nIntro text.\n\n## Section 1\n\nContent one.\n\n## Section 2\n\nContent two.';
      const chunks = chunkText(input);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks[0].header).toBe('Title');
      expect(chunks[1].header).toBe('Section 1');
      expect(chunks[2].header).toBe('Section 2');
    });

    it('should handle nested headers', () => {
      const input =
        '# Main\n\nIntro.\n\n## Sub\n\nDetails.\n\n### Deep\n\nMore.';
      const chunks = chunkText(input);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('paragraph splitting', () => {
    it('should split on double newlines when no headers', () => {
      const input =
        'Paragraph one content here.\n\nParagraph two content here.\n\nParagraph three content here.';
      const chunks = chunkText(input);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // All should have null header
      for (const chunk of chunks) {
        expect(chunk.header).toBeNull();
      }
    });
  });

  describe('fixed-size splitting', () => {
    it('should split large text without headers or paragraphs into fixed-size chunks', () => {
      // Generate a long single paragraph (3000 chars, no double newlines)
      const longText = 'A'.repeat(3000);
      const chunks = chunkText(longText);

      expect(chunks.length).toBeGreaterThan(1);
      // Each chunk should be <= 1500 chars
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeLessThanOrEqual(1500);
      }
    });

    it('should include overlap between fixed-size chunks', () => {
      const longText = Array.from({ length: 300 }, (_, i) => `word${i}`).join(
        ' '
      );
      const chunks = chunkText(longText);

      if (chunks.length > 1) {
        // Last part of chunk N should appear in chunk N+1 (overlap)
        const overlap = chunks[0].text.slice(-50);
        expect(chunks[1].text.includes(overlap)).toBe(true);
      }
    });
  });

  describe('small chunk merging', () => {
    it('should merge chunks smaller than 50 characters into previous', () => {
      // Section with a very short chunk
      const input =
        '# Title\n\nOk.\n\n## Section\n\nThis is a normal length paragraph with real content.';
      const chunks = chunkText(input);

      // No chunk should be less than 50 chars unless it's the only one
      for (const chunk of chunks) {
        if (chunks.length > 1) {
          // Allow the last chunk to be short
          if (chunk.index < chunks.length - 1) {
            expect(chunk.text.length).toBeGreaterThanOrEqual(50);
          }
        }
      }
    });
  });

  describe('chunk indexing', () => {
    it('should assign sequential indices starting from 0', () => {
      const input = '# A\n\nFirst.\n\n## B\n\nSecond.\n\n## C\n\nThird.';
      const chunks = chunkText(input);

      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].index).toBe(i);
      }
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/utils/chunker.test.ts`
Expected: FAIL — module `../../utils/chunker` not found

**Step 3: Write minimal implementation**

Create `src/utils/chunker.ts`:

```typescript
/**
 * Markdown-aware hybrid text chunker
 */

export interface Chunk {
  text: string;
  index: number;
  header: string | null;
}

const MAX_CHUNK_SIZE = 1500;
const TARGET_CHUNK_SIZE = 1000;
const OVERLAP_SIZE = 100;
const MIN_CHUNK_SIZE = 50;

/**
 * Split text into chunks using markdown-aware hybrid strategy:
 * 1. Split on markdown headers
 * 2. Split large blocks on double newlines (paragraphs)
 * 3. Fixed-size split with overlap for remaining large blocks
 * 4. Merge tiny chunks into previous
 */
export function chunkText(text: string): Chunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Step 1: Split on markdown headers
  const sections = splitOnHeaders(trimmed);

  // Step 2: Split large sections on paragraphs
  const paragraphed: { text: string; header: string | null }[] = [];
  for (const section of sections) {
    if (section.text.length <= MAX_CHUNK_SIZE) {
      paragraphed.push(section);
    } else {
      const paragraphs = splitOnParagraphs(section.text);
      for (const p of paragraphs) {
        paragraphed.push({ text: p, header: section.header });
      }
    }
  }

  // Step 3: Fixed-size split for remaining large blocks
  const sized: { text: string; header: string | null }[] = [];
  for (const block of paragraphed) {
    if (block.text.length <= MAX_CHUNK_SIZE) {
      sized.push(block);
    } else {
      const pieces = fixedSizeSplit(block.text);
      for (const piece of pieces) {
        sized.push({ text: piece, header: block.header });
      }
    }
  }

  // Step 4: Merge tiny chunks into previous
  const merged: { text: string; header: string | null }[] = [];
  for (const chunk of sized) {
    if (chunk.text.length < MIN_CHUNK_SIZE && merged.length > 0) {
      merged[merged.length - 1].text += '\n\n' + chunk.text;
    } else {
      merged.push({ ...chunk });
    }
  }

  // Assign indices
  return merged.map((chunk, index) => ({
    text: chunk.text,
    index,
    header: chunk.header,
  }));
}

/**
 * Split text on markdown headers (# through ######)
 */
function splitOnHeaders(
  text: string
): { text: string; header: string | null }[] {
  const headerRegex = /^(#{1,6})\s+(.+)$/gm;
  const sections: { text: string; header: string | null }[] = [];

  let lastIndex = 0;
  let currentHeader: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = headerRegex.exec(text)) !== null) {
    // Capture text before this header
    const beforeText = text.slice(lastIndex, match.index).trim();
    if (beforeText) {
      sections.push({ text: beforeText, header: currentHeader });
    }

    currentHeader = match[2].trim();
    lastIndex = match.index + match[0].length;
  }

  // Capture remaining text after last header
  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    sections.push({ text: remaining, header: currentHeader });
  }

  // If no headers found, return entire text as single section
  if (sections.length === 0) {
    sections.push({ text: text.trim(), header: null });
  }

  return sections;
}

/**
 * Split text on double newlines (paragraph boundaries)
 */
function splitOnParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Split text into fixed-size pieces with overlap
 */
function fixedSizeSplit(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + TARGET_CHUNK_SIZE, text.length);
    pieces.push(text.slice(start, end));

    if (end >= text.length) break;
    start = end - OVERLAP_SIZE;
  }

  return pieces;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/utils/chunker.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/chunker.ts src/__tests__/utils/chunker.test.ts
git commit -m "feat: add markdown-aware hybrid text chunker"
```

---

## Task 4: TEI Embeddings Client

**Files:**

- Create: `src/utils/embeddings.ts`
- Create: `src/__tests__/utils/embeddings.test.ts`

**Step 1: Write the failing tests**

Create `src/__tests__/utils/embeddings.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getTeiInfo,
  embedBatch,
  embedChunks,
  resetTeiCache,
} from '../../utils/embeddings';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TEI embeddings client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTeiCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetTeiCache();
  });

  describe('getTeiInfo', () => {
    it('should fetch and return TEI info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model_id: 'Qwen/Qwen3-Embedding-0.6B',
          model_sha: 'abc123',
          model_dtype: 'float16',
          model_type: { embedding: { dim: 1024 } },
          max_concurrent_requests: 192,
          max_input_length: 32768,
          max_batch_tokens: 16384,
          max_batch_requests: 48,
          max_client_batch_size: 192,
        }),
      });

      const info = await getTeiInfo('http://localhost:52000');
      expect(info.dimension).toBe(1024);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:52000/info');
    });

    it('should cache TEI info after first call', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          model_id: 'test-model',
          model_type: { embedding: { dim: 768 } },
        }),
      });

      await getTeiInfo('http://localhost:52000');
      await getTeiInfo('http://localhost:52000');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(getTeiInfo('http://localhost:52000')).rejects.toThrow();
    });
  });

  describe('embedBatch', () => {
    it('should call TEI /embed endpoint with inputs', async () => {
      const vectors = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => vectors,
      });

      const result = await embedBatch('http://localhost:52000', [
        'hello',
        'world',
      ]);
      expect(result).toEqual(vectors);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:52000/embed',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs: ['hello', 'world'] }),
        })
      );
    });

    it('should throw on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 413,
        statusText: 'Payload Too Large',
      });

      await expect(
        embedBatch('http://localhost:52000', ['text'])
      ).rejects.toThrow();
    });
  });

  describe('embedChunks', () => {
    it('should batch chunks into groups of 24 and return all vectors', async () => {
      // 30 chunks should result in 2 batches (24 + 6)
      const chunks = Array.from({ length: 30 }, (_, i) => `chunk ${i}`);
      const makeMockVectors = (n: number) =>
        Array.from({ length: n }, () => [0.1, 0.2]);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => makeMockVectors(24),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => makeMockVectors(6),
        });

      const result = await embedChunks('http://localhost:52000', chunks);
      expect(result).toHaveLength(30);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return empty array for empty input', async () => {
      const result = await embedChunks('http://localhost:52000', []);
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should respect concurrency limit', async () => {
      // 100 chunks = 5 batches of 24,24,24,24,4
      // With concurrency 4, first 4 go in parallel, then 1 more
      const chunks = Array.from({ length: 100 }, (_, i) => `chunk ${i}`);
      let concurrent = 0;
      let maxConcurrent = 0;

      mockFetch.mockImplementation(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        const batchSize = 24; // approximate
        return {
          ok: true,
          json: async () => Array.from({ length: batchSize }, () => [0.1]),
        };
      });

      await embedChunks('http://localhost:52000', chunks);
      expect(maxConcurrent).toBeLessThanOrEqual(4);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/utils/embeddings.test.ts`
Expected: FAIL — module `../../utils/embeddings` not found

**Step 3: Write minimal implementation**

Create `src/utils/embeddings.ts`:

```typescript
/**
 * TEI (Text Embeddings Inference) client
 * Handles batched embedding generation with concurrency control
 */

const BATCH_SIZE = 24;
const MAX_CONCURRENT = 4;

interface TeiInfo {
  modelId: string;
  dimension: number;
  maxInput: number;
}

let cachedTeiInfo: TeiInfo | null = null;

/**
 * Reset cached TEI info (for testing)
 */
export function resetTeiCache(): void {
  cachedTeiInfo = null;
}

/**
 * Fetch TEI server info and extract vector dimension
 */
export async function getTeiInfo(teiUrl: string): Promise<TeiInfo> {
  if (cachedTeiInfo) return cachedTeiInfo;

  const response = await fetch(`${teiUrl}/info`);
  if (!response.ok) {
    throw new Error(
      `TEI /info failed: ${response.status} ${response.statusText}`
    );
  }

  const info = await response.json();

  // Extract dimension from model_type.embedding.dim
  const dimension =
    info.model_type?.embedding?.dim ?? info.model_type?.Embedding?.dim ?? 1024;

  cachedTeiInfo = {
    modelId: info.model_id || 'unknown',
    dimension,
    maxInput: info.max_input_length || 32768,
  };

  return cachedTeiInfo;
}

/**
 * Embed a single batch of texts via TEI
 */
export async function embedBatch(
  teiUrl: string,
  inputs: string[]
): Promise<number[][]> {
  const response = await fetch(`${teiUrl}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs }),
  });

  if (!response.ok) {
    throw new Error(
      `TEI /embed failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }
}

/**
 * Embed all chunks with batching and concurrency control
 * Splits into batches of BATCH_SIZE, runs up to MAX_CONCURRENT in parallel
 */
export async function embedChunks(
  teiUrl: string,
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Split into batches
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    batches.push(texts.slice(i, i + BATCH_SIZE));
  }

  const semaphore = new Semaphore(MAX_CONCURRENT);
  const results: number[][][] = new Array(batches.length);

  const promises = batches.map(async (batch, i) => {
    await semaphore.acquire();
    try {
      results[i] = await embedBatch(teiUrl, batch);
    } finally {
      semaphore.release();
    }
  });

  await Promise.all(promises);

  // Flatten batched results in order
  return results.flat();
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/utils/embeddings.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/embeddings.ts src/__tests__/utils/embeddings.test.ts
git commit -m "feat: add TEI embeddings client with batching and concurrency"
```

---

## Task 5: Qdrant Client

**Files:**

- Create: `src/utils/qdrant.ts`
- Create: `src/__tests__/utils/qdrant.test.ts`

**Step 1: Write the failing tests**

Create `src/__tests__/utils/qdrant.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ensureCollection,
  upsertPoints,
  deleteByUrl,
  queryPoints,
  scrollByUrl,
  resetQdrantCache,
} from '../../utils/qdrant';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Qdrant client', () => {
  const qdrantUrl = 'http://localhost:53333';
  const collection = 'test_collection';

  beforeEach(() => {
    vi.clearAllMocks();
    resetQdrantCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetQdrantCache();
  });

  describe('ensureCollection', () => {
    it('should not create collection if it already exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { status: 'green' } }),
      });

      await ensureCollection(qdrantUrl, collection, 1024);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        `${qdrantUrl}/collections/${collection}`
      );
    });

    it('should create collection and indexes if it does not exist', async () => {
      // GET collection returns 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });
      // PUT create collection
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });
      // PUT index on url
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });
      // PUT index on domain
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });
      // PUT index on source_command
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });

      await ensureCollection(qdrantUrl, collection, 1024);

      // 1 GET + 1 PUT create + 3 PUT indexes = 5 calls
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('should throw on non-404 errors when checking collection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        ensureCollection(qdrantUrl, collection, 1024)
      ).rejects.toThrow('Failed to check Qdrant collection');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should cache collection existence after first check', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { status: 'green' } }),
      });

      await ensureCollection(qdrantUrl, collection, 1024);
      await ensureCollection(qdrantUrl, collection, 1024);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertPoints', () => {
    it('should PUT points to the collection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { status: 'completed' } }),
      });

      const points = [
        {
          id: 'test-uuid',
          vector: [0.1, 0.2, 0.3],
          payload: { url: 'https://example.com', chunk_text: 'hello' },
        },
      ];

      await upsertPoints(qdrantUrl, collection, points);

      expect(mockFetch).toHaveBeenCalledWith(
        `${qdrantUrl}/collections/${collection}/points`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ points }),
        })
      );
    });
  });

  describe('deleteByUrl', () => {
    it('should POST delete with url filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { status: 'completed' } }),
      });

      await deleteByUrl(qdrantUrl, collection, 'https://example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        `${qdrantUrl}/collections/${collection}/points/delete`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            filter: {
              must: [
                {
                  key: 'url',
                  match: { value: 'https://example.com' },
                },
              ],
            },
          }),
        })
      );
    });
  });

  describe('queryPoints', () => {
    it('should POST query with vector and return results', async () => {
      const mockResults = {
        result: {
          points: [
            {
              id: 'uuid-1',
              score: 0.92,
              payload: { url: 'https://example.com', chunk_text: 'hello' },
            },
          ],
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResults,
      });

      const results = await queryPoints(qdrantUrl, collection, [0.1, 0.2], {
        limit: 5,
      });

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.92);
    });

    it('should include domain filter when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { points: [] } }),
      });

      await queryPoints(qdrantUrl, collection, [0.1], {
        limit: 5,
        domain: 'example.com',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.filter.must).toContainEqual({
        key: 'domain',
        match: { value: 'example.com' },
      });
    });
  });

  describe('scrollByUrl', () => {
    it('should scroll all chunks for a URL ordered by chunk_index', async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            points: [
              { id: '1', payload: { chunk_index: 0, chunk_text: 'first' } },
              { id: '2', payload: { chunk_index: 1, chunk_text: 'second' } },
            ],
            next_page_offset: null,
          },
        }),
      });

      const points = await scrollByUrl(
        qdrantUrl,
        collection,
        'https://example.com'
      );

      expect(points).toHaveLength(2);
      expect(points[0].payload.chunk_index).toBe(0);
      expect(points[1].payload.chunk_index).toBe(1);
    });

    it('should paginate through multiple pages', async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            points: [
              { id: '1', payload: { chunk_index: 0, chunk_text: 'first' } },
            ],
            next_page_offset: 'offset-abc',
          },
        }),
      });
      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            points: [
              { id: '2', payload: { chunk_index: 1, chunk_text: 'second' } },
            ],
            next_page_offset: null,
          },
        }),
      });

      const points = await scrollByUrl(
        qdrantUrl,
        collection,
        'https://example.com'
      );

      expect(points).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/utils/qdrant.test.ts`
Expected: FAIL — module `../../utils/qdrant` not found

**Step 3: Write minimal implementation**

Create `src/utils/qdrant.ts`:

```typescript
/**
 * Qdrant vector database client
 * Handles collection management, upsert, delete, query, and scroll operations
 */

const SCROLL_PAGE_SIZE = 100;

const collectionCache = new Set<string>();

/**
 * Reset collection cache (for testing)
 */
export function resetQdrantCache(): void {
  collectionCache.clear();
}

/**
 * Ensure collection exists, create if not
 * Creates payload indexes on url, domain, source_command after creation
 */
export async function ensureCollection(
  qdrantUrl: string,
  collection: string,
  dimension: number
): Promise<void> {
  if (collectionCache.has(collection)) return;

  const checkResponse = await fetch(`${qdrantUrl}/collections/${collection}`);

  if (checkResponse.ok) {
    collectionCache.add(collection);
    return;
  }

  if (checkResponse.status !== 404) {
    throw new Error(
      `Failed to check Qdrant collection: ${checkResponse.status} ${checkResponse.statusText}`
    );
  }

  // Create collection
  const createResponse = await fetch(`${qdrantUrl}/collections/${collection}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vectors: {
        size: dimension,
        distance: 'Cosine',
      },
    }),
  });

  if (!createResponse.ok) {
    throw new Error(
      `Failed to create Qdrant collection: ${createResponse.status}`
    );
  }

  // Create payload indexes for fast filtering
  const indexFields = ['url', 'domain', 'source_command'];
  for (const field of indexFields) {
    await fetch(`${qdrantUrl}/collections/${collection}/index`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        field_name: field,
        field_schema: 'keyword',
      }),
    });
  }

  collectionCache.add(collection);
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

/**
 * Upsert points into collection
 */
export async function upsertPoints(
  qdrantUrl: string,
  collection: string,
  points: QdrantPoint[]
): Promise<void> {
  const response = await fetch(
    `${qdrantUrl}/collections/${collection}/points`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
    }
  );

  if (!response.ok) {
    throw new Error(`Qdrant upsert failed: ${response.status}`);
  }
}

/**
 * Delete all points matching a URL
 */
export async function deleteByUrl(
  qdrantUrl: string,
  collection: string,
  url: string
): Promise<void> {
  const response = await fetch(
    `${qdrantUrl}/collections/${collection}/points/delete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: {
          must: [{ key: 'url', match: { value: url } }],
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Qdrant delete failed: ${response.status}`);
  }
}

export interface QueryOptions {
  limit: number;
  domain?: string;
}

export interface QueryResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

/**
 * Query collection with vector similarity
 */
export async function queryPoints(
  qdrantUrl: string,
  collection: string,
  vector: number[],
  options: QueryOptions
): Promise<QueryResult[]> {
  // Target Qdrant is latest; /points/query is supported (no fallback needed).
  const body: Record<string, unknown> = {
    query: vector,
    limit: options.limit,
    with_payload: true,
  };

  if (options.domain) {
    body.filter = {
      must: [{ key: 'domain', match: { value: options.domain } }],
    };
  }

  const response = await fetch(
    `${qdrantUrl}/collections/${collection}/points/query`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(`Qdrant query failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    result?: {
      points?: Array<{
        id: string;
        score?: number;
        payload?: Record<string, unknown>;
      }>;
    };
  };
  return (data.result?.points || []).map((p) => ({
    id: p.id,
    score: p.score ?? 0,
    payload: p.payload ?? {},
  }));
}

export interface ScrollResult {
  id: string;
  payload: Record<string, unknown>;
}

/**
 * Scroll all points for a URL, paginating through results
 * Returns points sorted by chunk_index
 */
export async function scrollByUrl(
  qdrantUrl: string,
  collection: string,
  url: string
): Promise<ScrollResult[]> {
  const allPoints: ScrollResult[] = [];
  let offset: string | number | null = null;
  let isFirstPage = true;

  while (isFirstPage || offset !== null) {
    isFirstPage = false;

    const body: Record<string, unknown> = {
      filter: {
        must: [{ key: 'url', match: { value: url } }],
      },
      limit: SCROLL_PAGE_SIZE,
      with_payload: true,
    };

    if (offset !== null) {
      body.offset = offset;
    }

    const response = await fetch(
      `${qdrantUrl}/collections/${collection}/points/scroll`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      throw new Error(`Qdrant scroll failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      result?: {
        points?: Array<{ id: string; payload?: Record<string, unknown> }>;
        next_page_offset?: string | number | null;
      };
    };
    const points = data.result?.points || [];

    for (const p of points) {
      allPoints.push({ id: p.id, payload: p.payload ?? {} });
    }

    offset = data.result?.next_page_offset ?? null;
  }

  // Sort by chunk_index
  allPoints.sort(
    (a, b) => (a.payload.chunk_index ?? 0) - (b.payload.chunk_index ?? 0)
  );

  return allPoints;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/utils/qdrant.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/qdrant.ts src/__tests__/utils/qdrant.test.ts
git commit -m "feat: add Qdrant client with collection auto-creation and indexes"
```

---

## Task 6: Embed Pipeline Orchestrator

**Files:**

- Create: `src/utils/embedpipeline.ts`
- Create: `src/__tests__/utils/embedpipeline.test.ts`

**Step 1: Write the failing tests**

Create `src/__tests__/utils/embedpipeline.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { autoEmbed } from '../../utils/embedpipeline';
import { initializeConfig, resetConfig } from '../../utils/config';
import * as embeddings from '../../utils/embeddings';
import * as qdrant from '../../utils/qdrant';
import * as chunker from '../../utils/chunker';

vi.mock('../../utils/embeddings');
vi.mock('../../utils/qdrant');

describe('autoEmbed', () => {
  beforeEach(() => {
    resetConfig();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    resetConfig();
    vi.restoreAllMocks();
  });

  it('should no-op when TEI_URL is not set', async () => {
    initializeConfig({ qdrantUrl: 'http://localhost:53333' });

    await autoEmbed('some content', {
      url: 'https://example.com',
      sourceCommand: 'scrape',
    });

    expect(embeddings.embedChunks).not.toHaveBeenCalled();
  });

  it('should no-op when QDRANT_URL is not set', async () => {
    initializeConfig({ teiUrl: 'http://localhost:52000' });

    await autoEmbed('some content', {
      url: 'https://example.com',
      sourceCommand: 'scrape',
    });

    expect(embeddings.embedChunks).not.toHaveBeenCalled();
  });

  it('should no-op for empty content', async () => {
    initializeConfig({
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
    });

    await autoEmbed('', {
      url: 'https://example.com',
      sourceCommand: 'scrape',
    });

    expect(embeddings.embedChunks).not.toHaveBeenCalled();
  });

  it('should chunk, embed, delete old, and upsert when configured', async () => {
    initializeConfig({
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });

    vi.mocked(embeddings.getTeiInfo).mockResolvedValue({
      modelId: 'test',
      dimension: 1024,
      maxInput: 32768,
    });
    vi.mocked(embeddings.embedChunks).mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    vi.mocked(qdrant.ensureCollection).mockResolvedValue();
    vi.mocked(qdrant.deleteByUrl).mockResolvedValue();
    vi.mocked(qdrant.upsertPoints).mockResolvedValue();

    await autoEmbed('# Title\n\nSome content.\n\n## Section\n\nMore content.', {
      url: 'https://example.com/page',
      title: 'Test Page',
      sourceCommand: 'scrape',
      contentType: 'markdown',
    });

    expect(embeddings.getTeiInfo).toHaveBeenCalledWith(
      'http://localhost:52000'
    );
    expect(qdrant.ensureCollection).toHaveBeenCalledWith(
      'http://localhost:53333',
      'test_col',
      1024
    );
    expect(qdrant.deleteByUrl).toHaveBeenCalledWith(
      'http://localhost:53333',
      'test_col',
      'https://example.com/page'
    );
    expect(embeddings.embedChunks).toHaveBeenCalled();
    expect(qdrant.upsertPoints).toHaveBeenCalled();

    // Check upserted points have correct metadata
    const points = vi.mocked(qdrant.upsertPoints).mock.calls[0][2];
    expect(points.length).toBeGreaterThan(0);
    expect(points[0].payload).toMatchObject({
      url: 'https://example.com/page',
      title: 'Test Page',
      source_command: 'scrape',
      content_type: 'markdown',
      domain: 'example.com',
    });
    expect(points[0].payload.scraped_at).toBeDefined();
    expect(points[0].payload.chunk_index).toBe(0);
    expect(points[0].payload.chunk_text).toBeDefined();
    expect(points[0].payload.total_chunks).toBeGreaterThan(0);
  });

  it('should never throw — errors are caught and logged', async () => {
    initializeConfig({
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
    });

    vi.mocked(embeddings.getTeiInfo).mockRejectedValue(new Error('TEI down'));

    // Should not throw
    await expect(
      autoEmbed('content', {
        url: 'https://example.com',
        sourceCommand: 'scrape',
      })
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/utils/embedpipeline.test.ts`
Expected: FAIL — module `../../utils/embedpipeline` not found

**Step 3: Write minimal implementation**

Create `src/utils/embedpipeline.ts`:

```typescript
/**
 * Embed pipeline orchestrator
 * Coordinates chunking, embedding, and vector storage
 */

import { randomUUID } from 'crypto';
import { getConfig } from './config';
import { chunkText } from './chunker';
import { getTeiInfo, embedChunks } from './embeddings';
import { ensureCollection, deleteByUrl, upsertPoints } from './qdrant';

interface EmbedMetadata {
  url: string;
  title?: string;
  sourceCommand: string;
  contentType?: string;
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * Auto-embed content into Qdrant via TEI
 * No-op if TEI_URL or QDRANT_URL not configured
 * Never throws — errors are logged but don't break the calling command
 */
export async function autoEmbed(
  content: string,
  metadata: EmbedMetadata
): Promise<void> {
  try {
    const config = getConfig();
    const { teiUrl, qdrantUrl, qdrantCollection } = config;

    // No-op if not configured
    if (!teiUrl || !qdrantUrl) return;

    const collection = qdrantCollection || 'firecrawl_collection';

    // No-op for empty content
    const trimmed = content.trim();
    if (!trimmed) return;

    // Get TEI info (dimension) — cached after first call
    const teiInfo = await getTeiInfo(teiUrl);

    // Ensure collection exists
    await ensureCollection(qdrantUrl, collection, teiInfo.dimension);

    // Chunk content
    const chunks = chunkText(trimmed);
    if (chunks.length === 0) return;

    // Generate embeddings
    const texts = chunks.map((c) => c.text);
    const vectors = await embedChunks(teiUrl, texts);

    // Delete existing vectors for this URL (overwrite dedup)
    await deleteByUrl(qdrantUrl, collection, metadata.url);

    // Build points with metadata
    const now = new Date().toISOString();
    const domain = extractDomain(metadata.url);
    const totalChunks = chunks.length;

    const points = chunks.map((chunk, i) => ({
      id: randomUUID(),
      vector: vectors[i],
      payload: {
        url: metadata.url,
        title: metadata.title || '',
        domain,
        chunk_index: chunk.index,
        chunk_text: chunk.text,
        chunk_header: chunk.header,
        total_chunks: totalChunks,
        source_command: metadata.sourceCommand,
        content_type: metadata.contentType || 'text',
        scraped_at: now,
      },
    }));

    // Upsert to Qdrant
    await upsertPoints(qdrantUrl, collection, points);

    console.error(`Embedded ${chunks.length} chunks for ${metadata.url}`);
  } catch (error) {
    console.error(
      `Embed failed for ${metadata.url}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/utils/embedpipeline.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/embedpipeline.ts src/__tests__/utils/embedpipeline.test.ts
git commit -m "feat: add embed pipeline orchestrator (autoEmbed)"
```

---

## Task 7: Extract Command Types

**Files:**

- Create: `src/types/extract.ts`

**Step 1: Create types**

Create `src/types/extract.ts`:

```typescript
export interface ExtractOptions {
  urls: string[];
  prompt?: string;
  schema?: string;
  systemPrompt?: string;
  allowExternalLinks?: boolean;
  enableWebSearch?: boolean;
  includeSubdomains?: boolean;
  showSources?: boolean;
  apiKey?: string;
  output?: string;
  json?: boolean;
  pretty?: boolean;
  embed?: boolean;
}

export interface ExtractResult {
  success: boolean;
  data?: {
    extracted: unknown;
    sources?: string[];
    warning?: string;
  };
  error?: string;
}
```

**Step 2: Commit**

```bash
git add src/types/extract.ts
git commit -m "feat: add extract command types"
```

---

## Task 8: Extract Command Implementation

**Files:**

- Create: `src/commands/extract.ts`
- Create: `src/__tests__/commands/extract.test.ts`

**Step 1: Write the failing tests**

Create `src/__tests__/commands/extract.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeExtract, handleExtractCommand } from '../../commands/extract';
import { getClient } from '../../utils/client';
import { initializeConfig } from '../../utils/config';
import { setupTest, teardownTest } from '../utils/mock-client';
import { autoEmbed } from '../../utils/embedpipeline';
import { writeOutput } from '../../utils/output';

vi.mock('../../utils/client', async () => {
  const actual = await vi.importActual('../../utils/client');
  return { ...actual, getClient: vi.fn() };
});

vi.mock('../../utils/embedpipeline', () => ({
  autoEmbed: vi.fn(),
}));

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeExtract', () => {
  let mockClient: { extract: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    mockClient = {
      extract: vi.fn(),
    };

    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  it('should call extract with URLs and prompt', async () => {
    mockClient.extract.mockResolvedValue({
      success: true,
      data: { name: 'Example', price: 9.99 },
    });

    const result = await executeExtract({
      urls: ['https://example.com'],
      prompt: 'Extract product pricing',
    });

    expect(mockClient.extract).toHaveBeenCalledTimes(1);
    expect(mockClient.extract).toHaveBeenCalledWith(
      ['https://example.com'],
      expect.objectContaining({ prompt: 'Extract product pricing' })
    );
    expect(result.success).toBe(true);
    expect(result.data?.extracted).toEqual({ name: 'Example', price: 9.99 });
  });

  it('should pass schema as parsed JSON object', async () => {
    mockClient.extract.mockResolvedValue({
      success: true,
      data: { name: 'Test' },
    });

    await executeExtract({
      urls: ['https://example.com'],
      schema: '{"name": "string", "price": "number"}',
    });

    expect(mockClient.extract).toHaveBeenCalledWith(
      ['https://example.com'],
      expect.objectContaining({
        schema: { name: 'string', price: 'number' },
      })
    );
  });

  it('should handle SDK error response', async () => {
    mockClient.extract.mockResolvedValue({
      success: false,
      error: 'Extraction failed',
    });

    const result = await executeExtract({
      urls: ['https://example.com'],
      prompt: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Extraction failed');
  });

  it('should handle thrown errors', async () => {
    mockClient.extract.mockRejectedValue(new Error('Network error'));

    const result = await executeExtract({
      urls: ['https://example.com'],
      prompt: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
  });

  it('should include sources in result when showSources is true', async () => {
    mockClient.extract.mockResolvedValue({
      success: true,
      data: { name: 'Test' },
      sources: ['https://example.com/page1'],
    });

    const result = await executeExtract({
      urls: ['https://example.com'],
      prompt: 'test',
      showSources: true,
    });

    expect(result.data?.sources).toEqual(['https://example.com/page1']);
  });
});

describe('handleExtractCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should auto-embed once per source URL when available', async () => {
    mockClient.extract.mockResolvedValue({
      success: true,
      data: { name: 'Test' },
      sources: ['https://example.com/page1', 'https://example.com/page2'],
    });

    await handleExtractCommand({
      urls: ['https://example.com'],
      prompt: 'test',
    });

    expect(autoEmbed).toHaveBeenCalledTimes(2);
    expect(autoEmbed).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ url: 'https://example.com/page1' })
    );
    expect(writeOutput).toHaveBeenCalled();
  });

  it('should skip auto-embed when embed is false', async () => {
    mockClient.extract.mockResolvedValue({
      success: true,
      data: { name: 'Test' },
    });

    await handleExtractCommand({
      urls: ['https://example.com'],
      prompt: 'test',
      embed: false,
    });

    expect(autoEmbed).not.toHaveBeenCalled();
    expect(writeOutput).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/commands/extract.test.ts`
Expected: FAIL — module `../../commands/extract` not found

**Step 3: Write minimal implementation**

Create `src/commands/extract.ts`:

```typescript
/**
 * Extract command implementation
 */

import type { ExtractOptions, ExtractResult } from '../types/extract';
import { getClient } from '../utils/client';
import { writeOutput } from '../utils/output';
import { autoEmbed } from '../utils/embedpipeline';

/**
 * Convert extracted data to human-readable text for embedding
 */
function extractionToText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === null || data === undefined) return '';

  if (typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n');
  }

  return String(data);
}

type ExtractResponse = {
  success: boolean;
  data?: unknown;
  error?: string;
  sources?: string[];
  warning?: string;
};

/**
 * Execute extract command
 */
export async function executeExtract(
  options: ExtractOptions
): Promise<ExtractResult> {
  try {
    const app = getClient({ apiKey: options.apiKey });

    const extractParams: Record<string, unknown> = {};

    if (options.prompt) {
      extractParams.prompt = options.prompt;
    }

    if (options.schema) {
      try {
        extractParams.schema = JSON.parse(options.schema);
      } catch {
        return {
          success: false,
          error: 'Invalid JSON schema. Provide valid JSON string.',
        };
      }
    }

    if (options.systemPrompt) {
      extractParams.systemPrompt = options.systemPrompt;
    }
    if (options.allowExternalLinks !== undefined) {
      extractParams.allowExternalLinks = options.allowExternalLinks;
    }
    if (options.enableWebSearch !== undefined) {
      extractParams.enableWebSearch = options.enableWebSearch;
    }
    if (options.includeSubdomains !== undefined) {
      extractParams.includeSubdomains = options.includeSubdomains;
    }
    if (options.showSources !== undefined) {
      extractParams.showSources = options.showSources;
    }

    const result = (await app.extract(
      options.urls,
      extractParams
    )) as ExtractResponse;

    if ('error' in result && !result.success) {
      return {
        success: false,
        error: result.error || 'Extraction failed',
      };
    }

    return {
      success: true,
      data: {
        extracted: result.data,
        sources: result.sources,
        warning: result.warning,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Handle extract command output
 */
export async function handleExtractCommand(
  options: ExtractOptions
): Promise<void> {
  const result = await executeExtract(options);

  if (!result.success) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  if (!result.data) return;

  // Start embedding concurrently (human-readable text, not raw JSON)
  // Prefer actual source URLs when available for higher-quality retrieval
  const embedTargets =
    result.data.sources && result.data.sources.length > 0
      ? result.data.sources
      : options.urls;
  const embedPromises =
    options.embed !== false
      ? embedTargets.map((targetUrl) =>
          autoEmbed(extractionToText(result.data.extracted), {
            url: targetUrl,
            sourceCommand: 'extract',
            contentType: 'extracted',
          })
        )
      : [];

  // Format output
  let outputContent: string;

  const outputData: Record<string, unknown> = {
    success: true,
    data: result.data.extracted,
  };
  if (result.data.sources) {
    outputData.sources = result.data.sources;
  }
  if (result.data.warning) {
    outputData.warning = result.data.warning;
  }

  outputContent = options.pretty
    ? JSON.stringify(outputData, null, 2)
    : JSON.stringify(outputData);

  writeOutput(outputContent, options.output, !!options.output);

  // Wait for embedding to finish
  if (embedPromises.length > 0) {
    await Promise.all(embedPromises);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/commands/extract.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/extract.ts src/__tests__/commands/extract.test.ts src/types/extract.ts
git commit -m "feat: add extract command with auto-embed support"
```

---

## Task 9: Embed Command Types and Implementation

**Files:**

- Create: `src/types/embed.ts`
- Create: `src/commands/embed.ts`
- Create: `src/__tests__/commands/embed.test.ts`

**Step 1: Create types**

Create `src/types/embed.ts`:

```typescript
export interface EmbedOptions {
  input: string; // URL, file path, or '-' for stdin
  url?: string; // explicit URL for metadata (required for file/stdin)
  collection?: string;
  noChunk?: boolean;
  apiKey?: string;
  output?: string;
  json?: boolean;
}

export interface EmbedResult {
  success: boolean;
  data?: {
    url: string;
    chunksEmbedded: number;
    collection: string;
  };
  error?: string;
}
```

**Step 2: Write the failing tests**

Create `src/__tests__/commands/embed.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeEmbed } from '../../commands/embed';
import { getClient } from '../../utils/client';
import { initializeConfig, resetConfig } from '../../utils/config';
import { setupTest, teardownTest } from '../utils/mock-client';
import * as embeddings from '../../utils/embeddings';
import * as qdrant from '../../utils/qdrant';
import * as fs from 'fs';
import { randomUUID } from 'crypto';

vi.mock('../../utils/client', async () => {
  const actual = await vi.importActual('../../utils/client');
  return { ...actual, getClient: vi.fn() };
});

vi.mock('../../utils/embeddings');
vi.mock('../../utils/qdrant');

describe('executeEmbed', () => {
  let mockClient: { scrape: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });

    mockClient = {
      scrape: vi.fn(),
    };

    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );
    vi.mocked(embeddings.getTeiInfo).mockResolvedValue({
      modelId: 'test',
      dimension: 1024,
      maxInput: 32768,
    });
    vi.mocked(embeddings.embedChunks).mockResolvedValue([[0.1, 0.2]]);
    vi.mocked(qdrant.ensureCollection).mockResolvedValue();
    vi.mocked(qdrant.deleteByUrl).mockResolvedValue();
    vi.mocked(qdrant.upsertPoints).mockResolvedValue();
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  it('should scrape URL then embed when input is a URL', async () => {
    mockClient.scrape.mockResolvedValue({
      markdown: '# Test Page\n\nContent here.',
      metadata: { title: 'Test Page' },
    });

    const result = await executeEmbed({
      input: 'https://example.com',
    });

    expect(mockClient.scrape).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ formats: ['markdown'] })
    );
    expect(result.success).toBe(true);
    expect(result.data?.url).toBe('https://example.com');
    expect(result.data?.chunksEmbedded).toBeGreaterThan(0);

    const points = vi.mocked(qdrant.upsertPoints).mock.calls[0][2];
    const payload = points[0].payload as Record<string, unknown>;
    expect(payload.title).toBe('Test Page');
  });

  it('should read file and embed when input is a file path', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      '# File content\n\nParagraph.'
    );

    const result = await executeEmbed({
      input: '/tmp/test.md',
      url: 'https://example.com/test',
    });

    expect(mockClient.scrape).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data?.url).toBe('https://example.com/test');
  });

  it('should fail if TEI_URL not configured', async () => {
    resetConfig();
    initializeConfig({
      apiKey: 'test-api-key',
    });

    const result = await executeEmbed({
      input: '/tmp/test.md',
      url: 'https://example.com',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('TEI_URL');
  });

  it('should require --url for file input', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const result = await executeEmbed({
      input: '/tmp/test.md',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('--url');
  });
});
```

**Step 3: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/commands/embed.test.ts`
Expected: FAIL — module `../../commands/embed` not found

**Step 4: Write minimal implementation**

Create `src/commands/embed.ts`:

```typescript
/**
 * Embed command implementation
 * Embeds content from URL, file, or stdin into Qdrant via TEI
 */

import * as fs from 'fs';
import type { EmbedOptions, EmbedResult } from '../types/embed';
import { getClient } from '../utils/client';
import { getConfig } from '../utils/config';
import { isUrl } from '../utils/url';
import { chunkText } from '../utils/chunker';
import { getTeiInfo, embedChunks } from '../utils/embeddings';
import { ensureCollection, deleteByUrl, upsertPoints } from '../utils/qdrant';
import { writeOutput } from '../utils/output';

/**
 * Read stdin as a string
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Execute embed command
 */
export async function executeEmbed(
  options: EmbedOptions
): Promise<EmbedResult> {
  try {
    const config = getConfig();
    const teiUrl = config.teiUrl;
    const qdrantUrl = config.qdrantUrl;
    const collection =
      options.collection || config.qdrantCollection || 'firecrawl_collection';

    if (!teiUrl || !qdrantUrl) {
      return {
        success: false,
        error:
          'TEI_URL and QDRANT_URL must be set in .env for the embed command.',
      };
    }

    let content: string;
    let url: string;
    let title: string | undefined;

    if (options.input === '-') {
      // Stdin mode
      if (!options.url) {
        return {
          success: false,
          error: '--url is required when reading from stdin.',
        };
      }
      content = await readStdin();
      url = options.url;
    } else if (isUrl(options.input)) {
      // URL mode — scrape first
      const app = getClient({ apiKey: options.apiKey });
      const result = await app.scrape(options.input, {
        formats: ['markdown'],
      });
      content = result.markdown || '';
      url = options.input;
      title = result.metadata?.title;
    } else if (fs.existsSync(options.input)) {
      // File mode
      if (!options.url) {
        return {
          success: false,
          error: '--url is required when embedding a file.',
        };
      }
      content = fs.readFileSync(options.input, 'utf-8');
      url = options.url;
    } else {
      return {
        success: false,
        error: `Input "${options.input}" is not a valid URL, file, or "-" for stdin.`,
      };
    }

    const trimmed = content.trim();
    if (!trimmed) {
      return {
        success: false,
        error: 'No content to embed.',
      };
    }

    // Get TEI dimension
    const teiInfo = await getTeiInfo(teiUrl);

    // Ensure collection
    await ensureCollection(qdrantUrl, collection, teiInfo.dimension);

    // Chunk
    const chunks = options.noChunk
      ? [{ text: trimmed, index: 0, header: null }]
      : chunkText(trimmed);

    if (chunks.length === 0) {
      return {
        success: false,
        error: 'Content produced no chunks after processing.',
      };
    }

    // Embed
    const texts = chunks.map((c) => c.text);
    const vectors = await embedChunks(teiUrl, texts);

    // Delete old + upsert new
    await deleteByUrl(qdrantUrl, collection, url);

    const now = new Date().toISOString();
    let domain: string;
    try {
      domain = new URL(url).hostname;
    } catch {
      domain = 'unknown';
    }

    const points = chunks.map((chunk, i) => ({
      id: randomUUID(),
      vector: vectors[i],
      payload: {
        url,
        title: title || '',
        domain,
        chunk_index: chunk.index,
        chunk_text: chunk.text,
        chunk_header: chunk.header,
        total_chunks: chunks.length,
        source_command: 'embed',
        content_type: 'text',
        scraped_at: now,
      },
    }));

    await upsertPoints(qdrantUrl, collection, points);

    return {
      success: true,
      data: {
        url,
        chunksEmbedded: chunks.length,
        collection,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Handle embed command output
 */
export async function handleEmbedCommand(options: EmbedOptions): Promise<void> {
  const result = await executeEmbed(options);

  if (!result.success) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  if (!result.data) return;

  let outputContent: string;

  if (options.json) {
    outputContent = JSON.stringify({
      success: true,
      data: result.data,
    });
  } else {
    outputContent = `Embedded ${result.data.chunksEmbedded} chunks for ${result.data.url} into ${result.data.collection}`;
  }

  writeOutput(outputContent, options.output, !!options.output);
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/commands/embed.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/types/embed.ts src/commands/embed.ts src/__tests__/commands/embed.test.ts
git commit -m "feat: add standalone embed command"
```

---

## Task 10: Query Command Types and Implementation

**Files:**

- Create: `src/types/query.ts`
- Create: `src/commands/query.ts`
- Create: `src/__tests__/commands/query.test.ts`

**Step 1: Create types**

Create `src/types/query.ts`:

```typescript
export interface QueryOptions {
  query: string;
  limit?: number;
  domain?: string;
  full?: boolean;
  group?: boolean;
  collection?: string;
  output?: string;
  json?: boolean;
}

export interface QueryResultItem {
  score: number;
  url: string;
  title: string;
  chunkHeader: string | null;
  chunkText: string;
  chunkIndex: number;
  totalChunks: number;
  domain: string;
  sourceCommand: string;
}

export interface QueryResult {
  success: boolean;
  data?: QueryResultItem[];
  error?: string;
}
```

**Step 2: Write the failing tests**

Create `src/__tests__/commands/query.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeQuery } from '../../commands/query';
import { initializeConfig, resetConfig } from '../../utils/config';
import * as embeddings from '../../utils/embeddings';
import * as qdrant from '../../utils/qdrant';

vi.mock('../../utils/embeddings');
vi.mock('../../utils/qdrant');

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('executeQuery', () => {
  beforeEach(() => {
    resetConfig();
    initializeConfig({
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetConfig();
    vi.clearAllMocks();
  });

  it('should embed query and search Qdrant', async () => {
    vi.mocked(embeddings.embedBatch).mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.mocked(qdrant.queryPoints).mockResolvedValue([
      {
        id: 'uuid-1',
        score: 0.92,
        payload: {
          url: 'https://example.com/auth',
          title: 'Auth Docs',
          chunk_header: '## Authentication',
          chunk_text: 'Set environment variables...',
          chunk_index: 0,
          total_chunks: 3,
          domain: 'example.com',
          source_command: 'scrape',
        },
      },
    ]);

    const result = await executeQuery({ query: 'how to authenticate' });

    expect(embeddings.embedBatch).toHaveBeenCalledWith(
      'http://localhost:52000',
      ['how to authenticate']
    );
    expect(qdrant.queryPoints).toHaveBeenCalledWith(
      'http://localhost:53333',
      'test_col',
      [0.1, 0.2, 0.3],
      expect.objectContaining({ limit: 5 })
    );
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].score).toBe(0.92);
    expect(result.data![0].url).toBe('https://example.com/auth');
  });

  it('should pass domain filter to Qdrant', async () => {
    vi.mocked(embeddings.embedBatch).mockResolvedValue([[0.1]]);
    vi.mocked(qdrant.queryPoints).mockResolvedValue([]);

    await executeQuery({
      query: 'test',
      domain: 'example.com',
      limit: 10,
    });

    expect(qdrant.queryPoints).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ limit: 10, domain: 'example.com' })
    );
  });

  it('should fail when TEI_URL not configured', async () => {
    resetConfig();
    initializeConfig({});

    const result = await executeQuery({ query: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('TEI_URL');
  });

  it('should handle empty results', async () => {
    vi.mocked(embeddings.embedBatch).mockResolvedValue([[0.1]]);
    vi.mocked(qdrant.queryPoints).mockResolvedValue([]);

    const result = await executeQuery({ query: 'nonexistent' });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/commands/query.test.ts`
Expected: FAIL — module `../../commands/query` not found

**Step 4: Write minimal implementation**

Create `src/commands/query.ts`:

```typescript
/**
 * Query command implementation
 * Semantic search over Qdrant vectors
 */

import type {
  QueryOptions,
  QueryResult,
  QueryResultItem,
} from '../types/query';
import { getConfig } from '../utils/config';
import { embedBatch } from '../utils/embeddings';
import { queryPoints } from '../utils/qdrant';
import { writeOutput } from '../utils/output';

/**
 * Execute query command
 */
export async function executeQuery(
  options: QueryOptions
): Promise<QueryResult> {
  try {
    const config = getConfig();
    const { teiUrl, qdrantUrl } = config;
    const collection =
      options.collection || config.qdrantCollection || 'firecrawl_collection';

    if (!teiUrl || !qdrantUrl) {
      return {
        success: false,
        error:
          'TEI_URL and QDRANT_URL must be set in .env for the query command.',
      };
    }

    // Embed the query text
    const [queryVector] = await embedBatch(teiUrl, [options.query]);

    // Search Qdrant
    const results = await queryPoints(qdrantUrl, collection, queryVector, {
      limit: options.limit || 5,
      domain: options.domain,
    });

    const getString = (value: unknown): string =>
      typeof value === 'string' ? value : '';
    const getNumber = (value: unknown, fallback: number): number =>
      typeof value === 'number' ? value : fallback;

    // Map to result items
    const items: QueryResultItem[] = results.map((r) => ({
      score: r.score,
      url: getString(r.payload.url),
      title: getString(r.payload.title),
      chunkHeader:
        typeof r.payload.chunk_header === 'string'
          ? r.payload.chunk_header
          : null,
      chunkText: getString(r.payload.chunk_text),
      chunkIndex: getNumber(r.payload.chunk_index, 0),
      totalChunks: getNumber(r.payload.total_chunks, 1),
      domain: getString(r.payload.domain),
      sourceCommand: getString(r.payload.source_command),
    }));

    return { success: true, data: items };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Format compact output (default)
 */
function formatCompact(items: QueryResultItem[]): string {
  if (items.length === 0) return 'No results found.';

  return items
    .map((item) => {
      const header = item.chunkHeader ? ` — ${item.chunkHeader}` : '';
      const score = item.score.toFixed(2);
      const truncated =
        item.chunkText.length > 120
          ? item.chunkText.slice(0, 120) + '...'
          : item.chunkText;
      return `[${score}] ${item.url}${header}\n  ${truncated}`;
    })
    .join('\n\n');
}

/**
 * Format full output (--full flag)
 */
function formatFull(items: QueryResultItem[]): string {
  if (items.length === 0) return 'No results found.';

  return items
    .map((item) => {
      const header = item.chunkHeader ? ` — ${item.chunkHeader}` : '';
      const score = item.score.toFixed(2);
      return `[${score}] ${item.url}${header}\n\n${item.chunkText}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Format grouped output (--group flag)
 */
function formatGrouped(items: QueryResultItem[], full: boolean): string {
  if (items.length === 0) return 'No results found.';

  const groups = new Map<string, QueryResultItem[]>();
  for (const item of items) {
    const existing = groups.get(item.url) || [];
    existing.push(item);
    groups.set(item.url, existing);
  }

  const parts: string[] = [];
  for (const [url, groupItems] of groups) {
    parts.push(`== ${url} ==`);
    for (const item of groupItems) {
      const header = item.chunkHeader ? ` — ${item.chunkHeader}` : '';
      const score = item.score.toFixed(2);
      if (full) {
        parts.push(`  [${score}]${header}\n${item.chunkText}`);
      } else {
        const truncated =
          item.chunkText.length > 120
            ? item.chunkText.slice(0, 120) + '...'
            : item.chunkText;
        parts.push(`  [${score}]${header}\n  ${truncated}`);
      }
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Handle query command output
 */
export async function handleQueryCommand(options: QueryOptions): Promise<void> {
  const result = await executeQuery(options);

  if (!result.success) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  if (!result.data) return;

  let outputContent: string;

  if (options.json) {
    outputContent = JSON.stringify({ success: true, data: result.data });
  } else if (options.group) {
    outputContent = formatGrouped(result.data, !!options.full);
  } else if (options.full) {
    outputContent = formatFull(result.data);
  } else {
    outputContent = formatCompact(result.data);
  }

  writeOutput(outputContent, options.output, !!options.output);
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/commands/query.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/types/query.ts src/commands/query.ts src/__tests__/commands/query.test.ts
git commit -m "feat: add semantic query command"
```

---

## Task 11: Retrieve Command Types and Implementation

**Files:**

- Create: `src/types/retrieve.ts`
- Create: `src/commands/retrieve.ts`
- Create: `src/__tests__/commands/retrieve.test.ts`

**Step 1: Create types**

Create `src/types/retrieve.ts`:

```typescript
export interface RetrieveOptions {
  url: string;
  collection?: string;
  output?: string;
  json?: boolean;
}

export interface RetrieveResult {
  success: boolean;
  data?: {
    url: string;
    totalChunks: number;
    content: string;
    chunks?: Array<{
      index: number;
      header: string | null;
      text: string;
    }>;
  };
  error?: string;
}
```

**Step 2: Write the failing tests**

Create `src/__tests__/commands/retrieve.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeRetrieve } from '../../commands/retrieve';
import { initializeConfig, resetConfig } from '../../utils/config';
import * as qdrant from '../../utils/qdrant';

vi.mock('../../utils/qdrant');

describe('executeRetrieve', () => {
  beforeEach(() => {
    resetConfig();
    initializeConfig({
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetConfig();
    vi.clearAllMocks();
  });

  it('should retrieve and reassemble document from Qdrant', async () => {
    vi.mocked(qdrant.scrollByUrl).mockResolvedValue([
      {
        id: '1',
        payload: {
          chunk_index: 0,
          chunk_text: 'Intro.',
          chunk_header: 'Title',
        },
      },
      {
        id: '2',
        payload: {
          chunk_index: 1,
          chunk_text: 'Content.',
          chunk_header: 'Section',
        },
      },
    ]);

    const result = await executeRetrieve({ url: 'https://example.com' });

    expect(qdrant.scrollByUrl).toHaveBeenCalledWith(
      'http://localhost:53333',
      'test_col',
      'https://example.com'
    );
    expect(result.success).toBe(true);
    expect(result.data?.totalChunks).toBe(2);
    expect(result.data?.content).toContain('# Title');
    expect(result.data?.content).toContain('# Section');
  });

  it('should return error when no chunks found', async () => {
    vi.mocked(qdrant.scrollByUrl).mockResolvedValue([]);

    const result = await executeRetrieve({ url: 'https://notfound.com' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No content found');
  });

  it('should fail when QDRANT_URL not configured', async () => {
    resetConfig();
    initializeConfig({});

    const result = await executeRetrieve({ url: 'https://example.com' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('QDRANT_URL');
  });
});
```

**Step 3: Run test to verify it fails**

Run: `pnpm test -- src/__tests__/commands/retrieve.test.ts`
Expected: FAIL — module `../../commands/retrieve` not found

**Step 4: Write minimal implementation**

Create `src/commands/retrieve.ts`:

```typescript
/**
 * Retrieve command implementation
 * Reconstructs full documents from Qdrant chunks
 */

import type { RetrieveOptions, RetrieveResult } from '../types/retrieve';
import { getConfig } from '../utils/config';
import { scrollByUrl } from '../utils/qdrant';
import { writeOutput } from '../utils/output';

/**
 * Execute retrieve command
 */
export async function executeRetrieve(
  options: RetrieveOptions
): Promise<RetrieveResult> {
  try {
    const config = getConfig();
    const { qdrantUrl } = config;
    const collection =
      options.collection || config.qdrantCollection || 'firecrawl_collection';

    if (!qdrantUrl) {
      return {
        success: false,
        error: 'QDRANT_URL must be set in .env for the retrieve command.',
      };
    }

    const points = await scrollByUrl(qdrantUrl, collection, options.url);

    if (points.length === 0) {
      return {
        success: false,
        error: `No content found for URL: ${options.url}`,
      };
    }

    // Reassemble document from ordered chunks (restore headers)
    let lastHeader: string | null = null;
    const content = points
      .map((p) => {
        const header =
          typeof p.payload.chunk_header === 'string'
            ? p.payload.chunk_header
            : null;
        const text =
          typeof p.payload.chunk_text === 'string' ? p.payload.chunk_text : '';
        const headerLine =
          header && header !== lastHeader ? `# ${header}\\n\\n` : '';
        lastHeader = header;
        return `${headerLine}${text}`;
      })
      .join('\\n\\n');

    const chunks = points.map((p) => ({
      index:
        typeof p.payload.chunk_index === 'number' ? p.payload.chunk_index : 0,
      header:
        typeof p.payload.chunk_header === 'string'
          ? p.payload.chunk_header
          : null,
      text:
        typeof p.payload.chunk_text === 'string' ? p.payload.chunk_text : '',
    }));

    return {
      success: true,
      data: {
        url: options.url,
        totalChunks: points.length,
        content,
        chunks,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Handle retrieve command output
 */
export async function handleRetrieveCommand(
  options: RetrieveOptions
): Promise<void> {
  const result = await executeRetrieve(options);

  if (!result.success) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  if (!result.data) return;

  let outputContent: string;

  if (options.json) {
    outputContent = JSON.stringify({
      success: true,
      data: {
        url: result.data.url,
        totalChunks: result.data.totalChunks,
        chunks: result.data.chunks,
      },
    });
  } else {
    // Default: raw document content
    outputContent = result.data.content;
  }

  writeOutput(outputContent, options.output, !!options.output);
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm test -- src/__tests__/commands/retrieve.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/types/retrieve.ts src/commands/retrieve.ts src/__tests__/commands/retrieve.test.ts
git commit -m "feat: add retrieve command for full document reconstruction"
```

---

## Task 12: Register New Commands in index.ts

**Files:**

- Modify: `src/index.ts`

**Step 1: Add imports**

At the top of `src/index.ts`, after the existing command imports, add:

```typescript
import { handleExtractCommand } from './commands/extract';
import { handleEmbedCommand } from './commands/embed';
import { handleQueryCommand } from './commands/query';
import { handleRetrieveCommand } from './commands/retrieve';
```

**Step 2: Add extract to AUTH_REQUIRED_COMMANDS**

Change:

```typescript
const AUTH_REQUIRED_COMMANDS = ['scrape', 'crawl', 'map', 'search'];
```

To:

```typescript
const AUTH_REQUIRED_COMMANDS = ['scrape', 'crawl', 'map', 'search', 'extract'];
```

**Step 3: Create command factory functions**

Add these after the existing `createSearchCommand()` function (before the `program.addCommand(createCrawlCommand())` lines):

```typescript
function createExtractCommand(): Command {
  const extractCmd = new Command('extract')
    .description('Extract structured data from URLs using Firecrawl')
    .argument('<urls...>', 'URL(s) to extract from')
    .option('--prompt <prompt>', 'Natural language extraction prompt')
    .option('--schema <json>', 'JSON schema for structured extraction')
    .option('--system-prompt <prompt>', 'System prompt for extraction')
    .option('--allow-external-links', 'Allow following external links', false)
    .option('--enable-web-search', 'Enable web search during extraction', false)
    .option('--include-subdomains', 'Include subdomains', false)
    .option('--show-sources', 'Show source URLs in output', false)
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .option('--no-embed', 'Skip auto-embedding')
    .action(async (urls, options) => {
      await handleExtractCommand({
        urls,
        prompt: options.prompt,
        schema: options.schema,
        systemPrompt: options.systemPrompt,
        allowExternalLinks: options.allowExternalLinks,
        enableWebSearch: options.enableWebSearch,
        includeSubdomains: options.includeSubdomains,
        showSources: options.showSources,
        apiKey: options.apiKey,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
        embed: options.embed,
      });
    });

  return extractCmd;
}

function createEmbedCommand(): Command {
  const embedCmd = new Command('embed')
    .description('Embed content into Qdrant vector database')
    .argument('<input>', 'URL to scrape and embed, file path, or "-" for stdin')
    .option('--url <url>', 'Source URL for metadata (required for file/stdin)')
    .option('--collection <name>', 'Override Qdrant collection name')
    .option('--no-chunk', 'Embed as single vector, skip chunking')
    .option('-k, --api-key <key>', 'Firecrawl API key (for URL input only)')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .action(async (input, options) => {
      // Conditionally require auth only for URL input
      if (input.startsWith('http://') || input.startsWith('https://')) {
        const { ensureAuthenticated } = await import('./utils/auth');
        await ensureAuthenticated();
      }

      await handleEmbedCommand({
        input,
        url: options.url,
        collection: options.collection,
        noChunk: !options.chunk, // Commander --no-chunk sets options.chunk = false
        apiKey: options.apiKey,
        output: options.output,
        json: options.json,
      });
    });

  return embedCmd;
}

function createQueryCommand(): Command {
  const queryCmd = new Command('query')
    .description('Semantic search over embedded content in Qdrant')
    .argument('<query>', 'Search query text')
    .option('--limit <n>', 'Maximum results (default: 5)', parseInt)
    .option('--domain <domain>', 'Filter to specific domain')
    .option('--full', 'Show complete chunk text (for RAG/LLM context)', false)
    .option('--group', 'Group results by source URL', false)
    .option('--collection <name>', 'Override Qdrant collection name')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .action(async (query, options) => {
      await handleQueryCommand({
        query,
        limit: options.limit,
        domain: options.domain,
        full: options.full,
        group: options.group,
        collection: options.collection,
        output: options.output,
        json: options.json,
      });
    });

  return queryCmd;
}

function createRetrieveCommand(): Command {
  const retrieveCmd = new Command('retrieve')
    .description('Retrieve full document from Qdrant by URL')
    .argument('<url>', 'URL of the document to retrieve')
    .option('--collection <name>', 'Override Qdrant collection name')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option(
      '--json',
      'Output as JSON format (includes metadata per chunk)',
      false
    )
    .action(async (url, options) => {
      await handleRetrieveCommand({
        url,
        collection: options.collection,
        output: options.output,
        json: options.json,
      });
    });

  return retrieveCmd;
}
```

**Step 4: Register the commands**

After the existing `program.addCommand(createSearchCommand())` line, add:

```typescript
program.addCommand(createExtractCommand());
program.addCommand(createEmbedCommand());
program.addCommand(createQueryCommand());
program.addCommand(createRetrieveCommand());
```

**Step 5: Run tests to verify nothing is broken**

Run: `pnpm test`
Expected: ALL PASS

**Step 6: Run build to verify TypeScript compiles**

Run: `pnpm run build`
Expected: No errors

**Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: register extract, embed, query, retrieve commands"
```

---

## Task 13: Integrate autoEmbed into Scrape Command

**Files:**

- Modify: `src/commands/scrape.ts`
- Modify: `src/types/scrape.ts`
- Modify: `src/index.ts`
- Modify: `src/utils/options.ts`
- Modify: `src/__tests__/commands/scrape.test.ts`
- Modify: `src/__tests__/utils/options.test.ts`

**Step 1: Write the failing tests**

Add to `src/__tests__/utils/options.test.ts`:

```typescript
it('should pass embed flag through parseScrapeOptions', () => {
  const result = parseScrapeOptions({
    url: 'https://example.com',
    embed: false,
  });

  expect(result.embed).toBe(false);
});
```

Add to `src/__tests__/commands/scrape.test.ts`:

```typescript
import { handleScrapeCommand } from '../../commands/scrape';
import { autoEmbed } from '../../utils/embedpipeline';
import { handleScrapeOutput } from '../../utils/output';

vi.mock('../../utils/embedpipeline', () => ({
  autoEmbed: vi.fn(),
}));

vi.mock('../../utils/output', async () => {
  const actual = await vi.importActual('../../utils/output');
  return { ...actual, handleScrapeOutput: vi.fn() };
});

describe('handleScrapeCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should auto-embed when embed is not false', async () => {
    mockClient.scrape.mockResolvedValue({
      markdown: '# Test',
      metadata: { title: 'Test' },
    });

    await handleScrapeCommand({
      url: 'https://example.com',
      formats: ['markdown'],
      embed: true,
    });

    expect(autoEmbed).toHaveBeenCalled();
    expect(handleScrapeOutput).toHaveBeenCalled();
  });

  it('should skip auto-embed when embed is false', async () => {
    mockClient.scrape.mockResolvedValue({
      markdown: '# Test',
    });

    await handleScrapeCommand({
      url: 'https://example.com',
      formats: ['markdown'],
      embed: false,
    });

    expect(autoEmbed).not.toHaveBeenCalled();
    expect(handleScrapeOutput).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/__tests__/utils/options.test.ts src/__tests__/commands/scrape.test.ts`
Expected: FAIL — embed flag not passed + autoEmbed not integrated

**Step 3: Add --no-embed option to createScrapeCommand in index.ts**

In `src/index.ts`, inside `createScrapeCommand()`, add this option:

```typescript
.option('--no-embed', 'Skip auto-embedding')
```

And pass `embed: options.embed` through to `scrapeOptions`.

**Step 4: Update ScrapeOptions type + parseScrapeOptions**

In `src/types/scrape.ts`, add to `ScrapeOptions`:

```typescript
embed?: boolean;
```

In `src/utils/options.ts`, pass through the flag:

```typescript
embed: options.embed,
```

**Step 5: Modify handleScrapeCommand**

In `src/commands/scrape.ts`, add import:

```typescript
import { autoEmbed } from '../utils/embedpipeline';
```

Replace `handleScrapeCommand` with:

```typescript
export async function handleScrapeCommand(
  options: ScrapeOptions
): Promise<void> {
  const result = await executeScrape(options);

  // Start embedding concurrently with output
  const embedPromise =
    options.embed !== false && result.success && result.data
      ? autoEmbed(
          result.data.markdown || result.data.html || result.data.rawHtml || '',
          {
            url: options.url,
            title: result.data.metadata?.title,
            sourceCommand: 'scrape',
            contentType: options.formats?.[0] || 'markdown',
          }
        )
      : Promise.resolve();

  // Determine effective formats for output handling
  const effectiveFormats: ScrapeFormat[] =
    options.formats && options.formats.length > 0
      ? [...options.formats]
      : ['markdown'];

  if (options.screenshot && !effectiveFormats.includes('screenshot')) {
    effectiveFormats.push('screenshot');
  }

  handleScrapeOutput(
    result,
    effectiveFormats,
    options.output,
    options.pretty,
    options.json
  );

  // Wait for embedding before exit
  await embedPromise;
}
```

**Step 6: Run tests**

Run: `pnpm test`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/commands/scrape.ts src/types/scrape.ts src/index.ts src/utils/options.ts src/__tests__/commands/scrape.test.ts src/__tests__/utils/options.test.ts
git commit -m "feat: integrate autoEmbed into scrape command"
```

---

## Task 14: Integrate autoEmbed into Crawl Command

**Files:**

- Modify: `src/commands/crawl.ts`
- Modify: `src/types/crawl.ts`
- Modify: `src/index.ts`
- Modify: `src/__tests__/commands/crawl.test.ts`

**Step 1: Write the failing tests**

Add to `src/__tests__/commands/crawl.test.ts`:

```typescript
import * as crawlCommand from '../../commands/crawl';
import { autoEmbed } from '../../utils/embedpipeline';
import { writeOutput } from '../../utils/output';

vi.mock('../../utils/embedpipeline', () => ({
  autoEmbed: vi.fn(),
}));

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('handleCrawlCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should auto-embed completed crawl pages', async () => {
    vi.spyOn(crawlCommand, 'executeCrawl').mockResolvedValue({
      success: true,
      data: {
        data: [
          {
            markdown: '# Page',
            metadata: { url: 'https://example.com', title: 'Example' },
          },
        ],
      },
    });

    await crawlCommand.handleCrawlCommand({
      urlOrJobId: 'https://example.com',
      embed: true,
    });

    expect(autoEmbed).toHaveBeenCalledTimes(1);
    expect(writeOutput).toHaveBeenCalled();
  });

  it('should skip auto-embed when embed is false', async () => {
    vi.spyOn(crawlCommand, 'executeCrawl').mockResolvedValue({
      success: true,
      data: { data: [] },
    });

    await crawlCommand.handleCrawlCommand({
      urlOrJobId: 'https://example.com',
      embed: false,
    });

    expect(autoEmbed).not.toHaveBeenCalled();
    expect(writeOutput).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/__tests__/commands/crawl.test.ts`
Expected: FAIL — autoEmbed not integrated

**Step 3: Update CrawlOptions type**

In `src/types/crawl.ts`, add to `CrawlOptions`:

```typescript
embed?: boolean;
```

**Step 4: Add --no-embed to createCrawlCommand in index.ts**

In `src/index.ts`, inside `createCrawlCommand()`, add this option:

```typescript
.option('--no-embed', 'Skip auto-embedding')
```

And pass `embed: options.embed` in the crawlOptions object.

**Step 5: Modify handleCrawlCommand**

In `src/commands/crawl.ts`, add import:

```typescript
import { autoEmbed } from '../utils/embedpipeline';
```

At the end of `handleCrawlCommand`, add embedding for completed crawl results. The crawl response data may have a `data` array of pages. Add this block **before** the final `writeOutput`:

```typescript
// Auto-embed crawl results
const embedPromises: Promise<void>[] = [];
if (options.embed !== false && crawlResult.data) {
  // Completed crawl may have pages in .data array
  const pages = Array.isArray(crawlResult.data)
    ? crawlResult.data
    : crawlResult.data.data || [];

  for (const page of pages) {
    if (page.markdown || page.html) {
      embedPromises.push(
        autoEmbed(page.markdown || page.html || '', {
          url: page.metadata?.sourceURL || page.metadata?.url || '',
          title: page.metadata?.title,
          sourceCommand: 'crawl',
          contentType: page.markdown ? 'markdown' : 'html',
        })
      );
    }
  }
}
```

After `writeOutput`, add:

```typescript
// Wait for all embeddings to finish
if (embedPromises.length > 0) {
  await Promise.all(embedPromises);
}
```

**Step 6: Run tests**

Run: `pnpm test`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/commands/crawl.ts src/types/crawl.ts src/index.ts src/__tests__/commands/crawl.test.ts
git commit -m "feat: integrate autoEmbed into crawl command"
```

---

## Task 15: Integrate autoEmbed into Search Command (with --scrape only)

**Files:**

- Modify: `src/commands/search.ts`
- Modify: `src/types/search.ts`
- Modify: `src/index.ts`
- Modify: `src/__tests__/commands/search.test.ts`

**Step 1: Write the failing tests**

Add to `src/__tests__/commands/search.test.ts`:

```typescript
import * as searchCommand from '../../commands/search';
import { autoEmbed } from '../../utils/embedpipeline';
import { writeOutput } from '../../utils/output';

vi.mock('../../utils/embedpipeline', () => ({
  autoEmbed: vi.fn(),
}));

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('handleSearchCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should auto-embed only when scrape is enabled', async () => {
    vi.spyOn(searchCommand, 'executeSearch').mockResolvedValue({
      success: true,
      data: {
        web: [
          {
            url: 'https://example.com',
            title: 'Example',
            markdown: '# Example',
          },
        ],
      },
    });

    await searchCommand.handleSearchCommand({
      query: 'test',
      scrape: true,
      embed: true,
    });

    expect(autoEmbed).toHaveBeenCalledTimes(1);
    expect(writeOutput).toHaveBeenCalled();
  });

  it('should skip auto-embed when scrape is false or embed is false', async () => {
    vi.spyOn(searchCommand, 'executeSearch').mockResolvedValue({
      success: true,
      data: { web: [] },
    });

    await searchCommand.handleSearchCommand({
      query: 'test',
      scrape: false,
      embed: true,
    });

    await searchCommand.handleSearchCommand({
      query: 'test',
      scrape: true,
      embed: false,
    });

    expect(autoEmbed).not.toHaveBeenCalled();
    expect(writeOutput).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/__tests__/commands/search.test.ts`
Expected: FAIL — autoEmbed not integrated

**Step 3: Update SearchOptions type**

In `src/types/search.ts`, add to `SearchOptions`:

```typescript
embed?: boolean;
```

**Step 4: Add --no-embed to createSearchCommand in index.ts**

In `src/index.ts`, inside `createSearchCommand()`, add:

```typescript
.option('--no-embed', 'Skip auto-embedding')
```

And pass `embed: options.embed` to searchOptions.

**Step 5: Modify handleSearchCommand**

In `src/commands/search.ts`, add import:

```typescript
import { autoEmbed } from '../utils/embedpipeline';
```

After the `writeOutput` call, add:

```typescript
// Auto-embed only when --scrape was used (snippets are too noisy)
const embedPromises: Promise<void>[] = [];
if (options.embed !== false && options.scrape && result.data?.web) {
  for (const item of result.data.web) {
    if (item.markdown || item.html) {
      embedPromises.push(
        autoEmbed(item.markdown || item.html || '', {
          url: item.url,
          title: item.title,
          sourceCommand: 'search',
          contentType: item.markdown ? 'markdown' : 'html',
        })
      );
    }
  }
}

if (embedPromises.length > 0) {
  await Promise.all(embedPromises);
}
```

**Step 6: Run tests**

Run: `pnpm test`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/commands/search.ts src/types/search.ts src/index.ts src/__tests__/commands/search.test.ts
git commit -m "feat: integrate autoEmbed into search command (--scrape only)"
```

---

## Task 16: Build, Full Test Suite, and Final Verification

**Files:**

- All files

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS (should be 220+ existing tests + new tests)

**Step 2: Run TypeScript build**

Run: `pnpm run build`
Expected: No errors

**Step 3: Verify CLI help shows new commands**

Run: `node dist/index.js --help`
Expected: Output shows `extract`, `embed`, `query`, `retrieve` commands alongside existing ones

**Step 4: Verify individual command help**

Run:

```bash
node dist/index.js extract --help
node dist/index.js embed --help
node dist/index.js query --help
node dist/index.js retrieve --help
```

Expected: Each shows correct options and descriptions

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: final build verification for embedding pipeline"
```

---

## Task 17: Integration Test (Manual)

These tests require live TEI and Qdrant instances. Run manually.

**Step 1: Verify TEI is reachable**

Run: `curl -s http://100.74.16.82:52000/info | jq .model_id`
Note: TEI is intentionally on port 52000 in this environment.
Expected: `"Qwen/Qwen3-Embedding-0.6B"`

**Step 2: Verify Qdrant is reachable**

Run: `curl -s http://localhost:53333/collections | jq .`
Expected: JSON with collections list

**Step 3: Scrape with auto-embed**

Run: `node dist/index.js scrape https://example.com`
Expected: Markdown output + stderr message `Embedded N chunks for https://example.com`

**Step 4: Query**

Run: `node dist/index.js query "example domain"`
Expected: Results showing chunks from example.com with scores

**Step 5: Retrieve**

Run: `node dist/index.js retrieve https://example.com`
Expected: Full reconstructed document content

**Step 6: Query with --full**

Run: `node dist/index.js query "example domain" --full`
Expected: Full chunk text for each result

**Step 7: Embed a file**

Run:

```bash
echo "# Test\n\nThis is a test document." > /tmp/test.md
node dist/index.js embed /tmp/test.md --url https://test.local/doc
```

Expected: `Embedded N chunks for https://test.local/doc into firecrawl_collection`

**Step 8: Skip embedding**

Run: `node dist/index.js scrape https://example.com --no-embed`
Expected: Markdown output, NO `Embedded` message on stderr

**Step 9: Commit final state**

```bash
git add -A
git commit -m "feat: embedding pipeline complete — scrape, crawl, search, extract, embed, query, retrieve"
```
