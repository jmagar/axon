# Testing Guide

This directory contains tests for the Firecrawl CLI commands. Tests use Vitest and mock the Firecrawl client to avoid making real API calls.

## Running Tests

```bash
# Run tests once
pnpm test:run

# Run tests in watch mode
pnpm test:watch

# Run tests with UI
pnpm test:ui
```

## Test Structure

- `commands/` - Tests for command implementations (scrape, crawl, search, extract, embed, query, retrieve)
- `utils/` - Test utilities, helpers, and utility module tests (chunker, auth, embed queue)

## Writing Tests

### Key Principles

1. **No Real API Calls**: All tests mock the Firecrawl client or fetch API
2. **Verify API Call Generation**: Tests ensure commands generate correct API call parameters
3. **Verify Response Handling**: Tests ensure commands properly handle success and error responses
4. **Type Safety**: TypeScript ensures type correctness

### Example Test Pattern

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeScrape } from '../../commands/scrape';

describe('executeScrape', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = { scrape: vi.fn() };
  });

  it('should call scrape with correct parameters', async () => {
    mockClient.scrape.mockResolvedValue({ markdown: '# Test' });

    await executeScrape({ url: 'https://example.com' });

    expect(mockClient.scrape).toHaveBeenCalledWith('https://example.com', {
      formats: ['markdown'],
    });
  });
});
```

## Test Utilities

### Mocking Patterns

- **Client methods**: Mock container services (`getFirecrawlClient`, `getHttpClient`) per command
- **Fetch API**: Mock `global.fetch` for utilities that call TEI/Qdrant directly (embeddings, qdrant)
- **Pipeline modules**: Mock container services (`getEmbedPipeline`, `getTeiService`, `getQdrantService`) in command tests
- **Cache resets**: Not needed for container-based embedding/Qdrant services.

## What to Test

1. **API Call Parameters**: Verify commands pass correct parameters to the client
2. **Response Handling**: Test success and error response handling
3. **Option Parsing**: Ensure CLI options are correctly converted to API parameters
4. **Edge Cases**: Test with missing/optional parameters, null values, etc.
5. **Embedding Pipeline**: Test chunker, embeddings client, Qdrant client, and pipeline orchestrator

## Embedding Pipeline Tests

The embedding pipeline introduces utility modules that use `global.fetch` directly (not the Firecrawl client). These require a different mocking pattern.

### Mocking `global.fetch` (for TEI/Qdrant utilities)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('utility module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call the correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: 'data' }),
    });

    // Call the utility function...
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:52000/embed',
      expect.any(Object)
    );
  });
});
```

### Mocking Utility Modules (for command tests)

Commands that use `autoEmbed` should mock the pipeline module:

```typescript
const container = createTestContainer(undefined, {
  mockAutoEmbed: vi.fn(),
});

// In test: verify autoEmbed was called with correct args
expect(autoEmbed).toHaveBeenCalledWith(
  expect.any(String), // content
  expect.objectContaining({
    // metadata
    url: 'https://example.com',
    sourceCommand: 'scrape',
  })
);
```

### Pure Utility Tests (no mocking needed)

The chunker module (`src/utils/chunker.ts`) is pure logic with no external dependencies. Test it directly:

```typescript
import { chunkText } from '../../utils/chunker';

it('should split on markdown headers', () => {
  const chunks = chunkText('# Title\n\nIntro.\n\n## Section\n\nContent.');
  expect(chunks.length).toBeGreaterThanOrEqual(2);
  expect(chunks[0].header).toBe('Title');
});
```

### Config Tests

Embedding config fields (`teiUrl`, `qdrantUrl`, `qdrantCollection`) are read from environment variables. Clean up env vars in `afterEach`:

```typescript
afterEach(() => {
  delete process.env.TEI_URL;
  delete process.env.QDRANT_URL;
  delete process.env.QDRANT_COLLECTION;
});
```
