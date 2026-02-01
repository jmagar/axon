# Phase 2: Command Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all 14 CLI commands to use DI container instead of global singletons, enabling isolated configuration per command execution.

**Architecture:** Commands will receive `IContainer` as first parameter via dependency injection. Commander.js command handlers will call command functions with container instance. All global state access (`getClient()`, `getConfig()`) will be replaced with container methods (`container.getFirecrawlClient()`, `container.config`).

**Tech Stack:** TypeScript 5.0+, Commander.js v14, Container pattern, CommonJS

**Estimated Timeline:** 10-12 hours (1.5 work days with testing/debugging)

---

## Pre-Flight Checklist

**Before starting Task 1, verify:**

```bash
# All Phase 1 changes committed
git status --short
# Expected: ?? .docs/phase-1-completion-summary.md (or clean)

# All tests passing
pnpm test
# Expected: 382 tests passing

# TypeScript compiling cleanly
pnpm type-check
# Expected: no errors

# Container infrastructure exists
test -f src/container/Container.ts && echo "✅ Container exists"
test -f src/container/types.ts && echo "✅ Types exist"
test -f src/container/ContainerFactory.ts && echo "✅ Factory exists"
```

**All checks must pass before proceeding.**

---

## Rollback Procedure

**If a task fails midway:**

```bash
# 1. Undo uncommitted changes
git restore .

# 2. Undo last commit if needed (keeps changes staged)
git reset --soft HEAD~1

# 3. Return to clean state
git status

# 4. Review error messages and fix issues before retrying
```

**Never force-push or use `git reset --hard` unless certain.**

---

## Task Dependencies

```
Task 1 (Entry point) ──┬──► Task 2-5 (Simple commands) ──┐
                       ├──► Task 6-7 (Crawl command) ────┤
                       ├──► Task 8-9 (Batch/embed) ──────┤
                       ├──► Task 10-13 (Utility/auth) ───┤
                       └──► Task 14 (Config commands) ────┘
                                                          │
                       All tasks ──────────────► Task 15 (Verification)
```

**Note:** Tasks 2-14 can be executed independently after Task 1 completes.

---

## Migration Pattern

**Before (Global Singletons):**
```typescript
// src/commands/scrape.ts
export async function executeScrape(options: ScrapeOptions): Promise<ScrapeResult> {
  const app = getClient({ apiKey: options.apiKey });  // ❌ Global singleton
  const result = await app.scrape(url);

  if (options.embed) {
    await autoEmbed(result);  // ❌ Uses global TEI/Qdrant
  }
  return result;
}
```

**After (DI Container):**
```typescript
// src/commands/scrape.ts
export async function executeScrape(
  container: IContainer,  // ✅ Injected!
  options: ScrapeOptions
): Promise<ScrapeResult> {
  const app = container.getFirecrawlClient();  // ✅ From container
  const result = await app.scrape(url);

  if (options.embed) {
    const pipeline = container.getEmbedPipeline();  // ✅ Isolated instance
    await pipeline.embedAndStore(result);
  }
  return result;
}
```

---

## Commands to Migrate

Total: 14 commands across 22 files

**Simple Commands (4):**
1. `src/commands/scrape.ts` - Single URL scraping
2. `src/commands/map.ts` - URL discovery
3. `src/commands/search.ts` - Web search with scraping
4. `src/commands/extract.ts` - Structured data extraction

**Complex Commands (3):**
5. `src/commands/crawl/` - Multi-page crawling (8 files)
6. `src/commands/batch.ts` - Batch operations
7. `src/commands/embed.ts` - Manual embedding

**Utility Commands (4):**
8. `src/commands/query.ts` - Semantic search
9. `src/commands/retrieve.ts` - Document reconstruction
10. `src/commands/status.ts` - System status
11. `src/commands/list.ts` - List active crawls

**Auth/Config Commands (3):**
12. `src/commands/config.ts` - Configuration management
13. `src/commands/login.ts` - Authentication
14. `src/commands/logout.ts` - Credential removal

**⚠️ Special Case:** Config/login/logout commands DON'T receive container as parameter. Instead, they:
1. Modify credentials (save/clear)
2. Create fresh container to verify changes
3. Test the new configuration

This is different from other commands because they manage the credentials that containers use.

---

## Task 1: Update CLI Entry Point (src/index.ts)

**Files:**
- Modify: `src/index.ts` (around `initializeConfig()` call)
- No test changes needed (integration)

**Objective:** Update Commander.js command handlers to pass container to command functions.

**Step 1: Import container types**

Add after `import { createContainer } from './container/ContainerFactory';` line:
```typescript
import type { IContainer } from './container/types';
import { createContainer } from './container/ContainerFactory';
```

**Step 2: Move baseContainer creation after initializeConfig**

Replace lines 44-50:
```typescript
// Initialize global configuration from environment variables
initializeConfig();

/**
 * Dependency Injection Container
 * Phase 2: Commands receive container as first parameter.
 * This enables isolated configuration per command execution.
 */
const baseContainer: IContainer = createContainer();
```

**Step 3: Update preAction hook to create per-command containers**

Replace lines 93-98:
```typescript
.hook('preAction', async (thisCommand, actionCommand) => {
  // Create container with optional API key override
  const globalOptions = thisCommand.opts();
  const commandContainer = globalOptions.apiKey
    ? createContainerWithOverride(baseContainer, { apiKey: globalOptions.apiKey })
    : baseContainer;

  // Store container on command for access in handlers
  actionCommand._container = commandContainer;

  // Check if this command requires authentication
```

**Step 4: Import createContainerWithOverride**

Update line 11:
```typescript
import { createContainer, createContainerWithOverride } from './container/ContainerFactory';
```

**Step 5: Add TypeScript declaration for _container**

Add after imports:
```typescript
declare module 'commander' {
  interface Command {
    _container?: IContainer;
  }
}
```

**Step 6: Verify TypeScript compiles**

Run: `pnpm type-check`
Expected: No errors

**Step 6a: Verify container is accessible in command handlers**

Create temporary test file `test-container-access.ts`:
```typescript
import { Command } from 'commander';

const testProgram = new Command();

const testCmd = new Command('test')
  .action((_options: any, command: Command) => {
    console.log('Container on command:', command._container);
  });

testProgram
  .hook('preAction', (thisCommand, actionCommand) => {
    actionCommand._container = { test: 'works' } as any;
  })
  .addCommand(testCmd);

testProgram.parse(['node', 'test', 'test']);
```

Run: `npx ts-node test-container-access.ts`
Expected output: `Container on command: { test: 'works' }`

Then delete test file: `rm test-container-access.ts`

**Step 7: Build and manual test**

Run: `pnpm build && node dist/index.js --help`
Expected: CLI loads without errors

**Step 8: Commit**

```bash
git add src/index.ts
git commit -m "refactor(di): update CLI entry point to inject container per command

- Add container type imports
- Move baseContainer after initializeConfig
- Update preAction hook to create per-command containers
- Add TypeScript declaration for Command._container
- Phase 2 Task 1/14

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Migrate scrape command

**Files:**
- Modify: `src/commands/scrape.ts` (executeScrape function)
- Modify: `src/commands/scrape.ts` (createScrapeCommand handler)
- Test: `src/__tests__/commands/scrape.test.ts`

**Step 1: Update executeScrape signature**

Find the `executeScrape` function and update signature:
```typescript
export async function executeScrape(
  container: IContainer,
  options: ScrapeOptions
): Promise<ScrapeResult> {
```

**Step 2: Replace getClient with container method**

Replace line 57:
```typescript
  // Get client instance from container
  const app = container.getFirecrawlClient();
```

Remove import on line 12:
```typescript
import { getClient } from '../utils/client';  // ❌ DELETE THIS LINE
```

Add import on line 6:
```typescript
import type { IContainer } from '../container/types';
```

**Step 3: Replace autoEmbed with container method**

Replace lines 129-137:
```typescript
  // Auto-embed if enabled
  if (result.success && options.embed && result.data?.markdown) {
    const pipeline = container.getEmbedPipeline();
    await pipeline.embedAndStore({
      url: normalizedUrl,
      content: result.data.markdown,
      collection: options.collection,
    });
  }
```

Remove import on line 13:
```typescript
import { autoEmbed } from '../utils/embedpipeline';  // ❌ DELETE THIS LINE
```

**Step 4: Update command handler to pass container**

Replace line 146:
```typescript
export function createScrapeCommand(): Command {
  return new Command('scrape')
    .description('Scrape a single URL')
    .argument('<url>', 'URL to scrape')
    // ... options ...
    .action(async (url: string, cmdOptions: Record<string, unknown>, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      const options = parseScrapeOptions(url, cmdOptions);
      const result = await executeScrape(container, options);  // ✅ Pass container
      await handleScrapeOutput(result, options);
    });
}
```

**Step 4a: Verify import cleanup**

Verify no other code in the file uses the deleted imports:

```bash
# Should show NO results (imports were deleted)
grep -n "getClient" src/commands/scrape.ts
grep -n "autoEmbed" src/commands/scrape.ts
```

If grep shows results, review them to ensure they're not function calls.

**Step 4b: Verify embedAndStore signature**

Check `EmbedPipeline.embedAndStore()` signature matches our usage:

```bash
grep -A 10 "embedAndStore" src/container/services/EmbedPipeline.ts
```

Expected: Method accepts object with `url`, `content`, `collection` properties.

**Step 5: Write failing test**

Update `src/__tests__/commands/scrape.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeScrape } from '../../commands/scrape';
import type { IContainer } from '../../container/types';
import type Firecrawl from '@mendable/firecrawl-js';

describe('executeScrape with DI container', () => {
  let mockContainer: IContainer;
  let mockFirecrawlClient: Firecrawl;

  beforeEach(() => {
    mockFirecrawlClient = {
      scrape: vi.fn().mockResolvedValue({
        success: true,
        data: { markdown: '# Test' }
      }),
    } as unknown as Firecrawl;

    mockContainer = {
      getFirecrawlClient: vi.fn().mockReturnValue(mockFirecrawlClient),
      getEmbedPipeline: vi.fn().mockReturnValue({
        embedAndStore: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as IContainer;
  });

  it('should use container to get Firecrawl client', async () => {
    const result = await executeScrape(mockContainer, {
      url: 'https://example.com',
    });

    expect(mockContainer.getFirecrawlClient).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
```

**Step 6: Run test to verify it fails**

Run: `pnpm test src/__tests__/commands/scrape.test.ts`
Expected: FAIL - executeScrape expects 2 parameters but receives 1

**Step 7: Run test to verify it passes**

Run: `pnpm test src/__tests__/commands/scrape.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add src/commands/scrape.ts src/__tests__/commands/scrape.test.ts
git commit -m "refactor(di): migrate scrape command to use container

- Update executeScrape to accept IContainer as first param
- Replace getClient() with container.getFirecrawlClient()
- Replace autoEmbed() with container.getEmbedPipeline()
- Update command handler to pass container from command
- Update tests to use mock container
- Phase 2 Task 2/14

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Migrate map command

**Files:**
- Modify: `src/commands/map.ts:37-80`
- Modify: `src/commands/map.ts:86-120` (command handler)
- Test: `src/__tests__/commands/map.test.ts`

**Step 1: Update executeMap signature**

Replace line 37:
```typescript
export async function executeMap(
  container: IContainer,
  options: MapOptions
): Promise<MapResult> {
```

Add import:
```typescript
import type { IContainer } from '../container/types';
```

**Step 2: Replace getClient with container method**

Replace line 38:
```typescript
  const app = container.getFirecrawlClient();
```

Remove import:
```typescript
import { getClient } from '../utils/client';  // ❌ DELETE
```

**Step 3: Update command handler**

Replace line 86:
```typescript
export function createMapCommand(): Command {
  return new Command('map')
    .description('Get all URLs from a website (sitemap-like)')
    .argument('<url>', 'Website URL to map')
    // ... options ...
    .action(async (url: string, cmdOptions: Record<string, unknown>, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      const options = parseMapOptions(url, cmdOptions);
      const result = await executeMap(container, options);  // ✅ Pass container
      await handleMapOutput(result, options);
    });
}
```

**Step 4: Update tests**

Update `src/__tests__/commands/map.test.ts` to use mock container (similar to scrape test pattern).

**Step 5: Run tests**

Run: `pnpm test src/__tests__/commands/map.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/commands/map.ts src/__tests__/commands/map.test.ts
git commit -m "refactor(di): migrate map command to use container

- Update executeMap to accept IContainer as first param
- Replace getClient() with container.getFirecrawlClient()
- Update command handler to pass container
- Update tests to use mock container
- Phase 2 Task 3/14

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Migrate search command

**Files:**
- Modify: `src/commands/search.ts:45-120`
- Modify: `src/commands/search.ts:125-165` (command handler)
- Test: `src/__tests__/commands/search.test.ts`

**Pattern:** Same as Task 2-3, but also update autoEmbed call.

**Step 1: Update executeSearch signature**

```typescript
export async function executeSearch(
  container: IContainer,
  options: SearchOptions
): Promise<SearchResult> {
```

**Step 2: Replace getClient**

```typescript
  const app = container.getFirecrawlClient();
```

**Step 3: Replace autoEmbed**

```typescript
  if (result.success && options.embed && result.data?.length > 0) {
    const pipeline = container.getEmbedPipeline();
    // ... embed logic
  }
```

**Step 4: Update command handler to pass container**

**Step 5: Update tests**

**Step 6: Run tests**

Run: `pnpm test src/__tests__/commands/search.test.ts`

**Step 7: Commit**

```bash
git add src/commands/search.ts src/__tests__/commands/search.test.ts
git commit -m "refactor(di): migrate search command to use container

- Update executeSearch to accept IContainer
- Replace getClient() and autoEmbed() with container methods
- Update command handler and tests
- Phase 2 Task 4/14

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Migrate extract command

**Files:**
- Modify: `src/commands/extract.ts:50-140`
- Modify: `src/commands/extract.ts:145-185` (command handler)
- Test: `src/__tests__/commands/extract.test.ts`

**Pattern:** Same as Task 2-4.

**Step 1-7:** Follow same pattern as previous tasks.

**Commit:**

```bash
git add src/commands/extract.ts src/__tests__/commands/extract.test.ts
git commit -m "refactor(di): migrate extract command to use container

- Update executeExtract to accept IContainer
- Replace getClient() with container methods
- Update command handler and tests
- Phase 2 Task 5/14

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Migrate crawl command (Part 1: Core execution)

**Files:**
- Modify: `src/commands/crawl/execute.ts:28-100`
- Modify: `src/commands/crawl/status.ts:15-60`
- Modify: `src/commands/crawl/polling.ts:20-90`

**Objective:** Update crawl execution pipeline to accept and pass container.

**Step 1: Update executeCrawl signature**

`src/commands/crawl/execute.ts:28`:
```typescript
export async function executeCrawl(
  container: IContainer,
  options: CrawlOptions
): Promise<CrawlResult | CrawlStatusResult> {
```

Add import:
```typescript
import type { IContainer } from '../../container/types';
```

**Step 2: Replace getClient**

Line 32:
```typescript
  const app = container.getFirecrawlClient();
```

Remove import:
```typescript
import { getClient } from '../../utils/client';  // ❌ DELETE
```

**Step 3: Update checkCrawlStatus to accept container**

`src/commands/crawl/status.ts:15`:
```typescript
export async function checkCrawlStatus(
  container: IContainer,
  jobId: string,
  options: CrawlOptions
): Promise<CrawlStatusResult> {
```

Replace line 16:
```typescript
  const app = container.getFirecrawlClient();
```

**Step 4: Update pollCrawlProgress to accept container**

`src/commands/crawl/polling.ts:20`:
```typescript
export async function pollCrawlProgress(
  container: IContainer,
  jobId: string,
  options: CrawlOptions
): Promise<CrawlResult> {
```

**Step 5: Update all function calls to pass container**

In `src/commands/crawl/execute.ts`, update:
```typescript
return await checkCrawlStatus(container, urlOrJobId, options);  // Line 47

// And for polling:
return await pollCrawlProgress(container, urlOrJobId, options);  // Line ~68
```

**Step 6: Run tests**

Run: `pnpm test src/__tests__/commands/crawl/`
Expected: FAIL initially, then fix and PASS

**Step 7: Commit**

```bash
git add src/commands/crawl/execute.ts src/commands/crawl/status.ts src/commands/crawl/polling.ts
git commit -m "refactor(di): migrate crawl execution to use container (part 1)

- Update executeCrawl, checkCrawlStatus, pollCrawlProgress signatures
- Replace getClient() with container.getFirecrawlClient()
- Pass container through function call chain
- Phase 2 Task 6/14 (Part 1 of 2)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Migrate crawl command (Part 2: Command handler & embed)

**Files:**
- Modify: `src/commands/crawl/command.ts:20-80`
- Modify: `src/commands/crawl/embed.ts:10-50`
- Test: `src/__tests__/commands/crawl/`

**Step 1: Update crawl command handler**

`src/commands/crawl/command.ts:20`:
```typescript
export function createCrawlCommand(): Command {
  return new Command('crawl')
    .description('Crawl multiple pages from a website')
    .argument('<url-or-job-id>', 'URL to crawl or job ID to check status')
    // ... options ...
    .action(async (urlOrJobId: string, cmdOptions: Record<string, unknown>, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      const options = parseCrawlOptions(urlOrJobId, cmdOptions);
      const result = await executeCrawl(container, options);  // ✅ Pass container
      await handleCrawlOutput(result, options);
    });
}
```

**Step 2: Update handleManualEmbedding**

`src/commands/crawl/embed.ts:10`:
```typescript
export async function handleManualEmbedding(
  container: IContainer,
  jobId: string,
  options: { collection?: string }
): Promise<void> {
  const pipeline = container.getEmbedPipeline();
  // ... embed logic using pipeline
}
```

**Step 3: Update tests to use mock container**

All tests in `src/__tests__/commands/crawl/` need mock container.

**Step 4: Run tests**

Run: `pnpm test src/__tests__/commands/crawl/`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/crawl/command.ts src/commands/crawl/embed.ts src/__tests__/commands/crawl/
git commit -m "refactor(di): migrate crawl command handler and embed (part 2)

- Update createCrawlCommand to pass container
- Update handleManualEmbedding to use container
- Update all crawl tests to use mock container
- Phase 2 Task 7/14 (Part 2 of 2)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Migrate batch command

**Files:**
- Modify: `src/commands/batch.ts:40-160`
- Test: `src/__tests__/commands/batch.test.ts`

**Pattern:** Same as scrape/map/search.

**Step 1: Update executeBatch signature**

```typescript
export async function executeBatch(
  container: IContainer,
  options: BatchOptions
): Promise<BatchResult> {
```

**Step 2: Replace getClient**

```typescript
  const app = container.getFirecrawlClient();
```

**Step 3: Update command handler**

**Step 4: Update tests**

**Step 5: Run tests and commit**

```bash
git add src/commands/batch.ts src/__tests__/commands/batch.test.ts
git commit -m "refactor(di): migrate batch command to use container

- Update executeBatch to accept IContainer
- Replace getClient() with container methods
- Update command handler and tests
- Phase 2 Task 8/14

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Migrate embed command

**Files:**
- Modify: `src/commands/embed.ts:30-120`
- Test: `src/__tests__/commands/embed.test.ts`

**Step 1: Update executeEmbed signature**

```typescript
export async function executeEmbed(
  container: IContainer,
  options: EmbedOptions
): Promise<EmbedResult> {
```

**Step 2: Replace embedpipeline usage**

```typescript
  const pipeline = container.getEmbedPipeline();
  await pipeline.embedAndStore({
    url: options.url,
    content: options.content,
    collection: options.collection,
  });
```

Remove imports:
```typescript
import { embedText, getTeiInfo } from '../utils/embeddings';  // ❌ DELETE
import { upsertPoints } from '../utils/qdrant';  // ❌ DELETE
```

**Step 3: Update command handler and tests**

**Step 4: Commit**

```bash
git add src/commands/embed.ts src/__tests__/commands/embed.test.ts
git commit -m "refactor(di): migrate embed command to use container

- Update executeEmbed to accept IContainer
- Replace embeddings/qdrant utils with container.getEmbedPipeline()
- Update command handler and tests
- Phase 2 Task 9/14

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Migrate query command

**Files:**
- Modify: `src/commands/query.ts:25-80`
- Test: `src/__tests__/commands/query.test.ts`

**Step 1: Update executeQuery signature**

```typescript
export async function executeQuery(
  container: IContainer,
  options: QueryOptions
): Promise<QueryResult> {
```

**Step 2: Use container for Qdrant service**

```typescript
  const qdrantService = container.getQdrantService();
  const teiService = container.getTeiService();

  const embedding = await teiService.embed([options.query]);
  const results = await qdrantService.search({
    collection: options.collection || 'firecrawl_collection',
    vector: embedding[0],
    limit: options.limit || 10,
  });
```

Remove imports:
```typescript
import { embedText } from '../utils/embeddings';  // ❌ DELETE
import { searchPoints } from '../utils/qdrant';  // ❌ DELETE
```

**Step 3: Update command handler and tests**

**Step 4: Commit**

```bash
git add src/commands/query.ts src/__tests__/commands/query.test.ts
git commit -m "refactor(di): migrate query command to use container

- Update executeQuery to accept IContainer
- Use container.getTeiService() and getQdrantService()
- Update command handler and tests
- Phase 2 Task 10/14

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Migrate retrieve command

**Files:**
- Modify: `src/commands/retrieve.ts:20-60`
- Test: `src/__tests__/commands/retrieve.test.ts`

**Pattern:** Same as query command (uses Qdrant).

**Step 1-4:** Follow query command pattern.

**Commit:**

```bash
git add src/commands/retrieve.ts src/__tests__/commands/retrieve.test.ts
git commit -m "refactor(di): migrate retrieve command to use container

- Update executeRetrieve to accept IContainer
- Use container.getQdrantService()
- Update command handler and tests
- Phase 2 Task 11/14

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Migrate status command

**Files:**
- Modify: `src/commands/status.ts:20-90`
- Test: `src/__tests__/commands/status-command.test.ts`

**Step 1: Update handleStatusCommand signature**

```typescript
export async function handleStatusCommand(
  container: IContainer
): Promise<void> {
```

**Step 2: Use container for config and client**

```typescript
  const config = container.config;
  console.log('API Key:', config.apiKey ? '✓ Set' : '✗ Not set');
  console.log('TEI URL:', config.teiUrl || 'Not configured');
  console.log('Qdrant URL:', config.qdrantUrl || 'Not configured');

  if (config.apiKey) {
    const app = container.getFirecrawlClient();
    // ... status checks
  }
```

Remove imports:
```typescript
import { getClient } from '../utils/client';  // ❌ DELETE
import { getConfig } from '../utils/config';  // ❌ DELETE
```

**Step 3: Update command handler**

**Step 4: Update tests**

**Step 5: Commit**

```bash
git add src/commands/status.ts src/__tests__/commands/status-command.test.ts
git commit -m "refactor(di): migrate status command to use container

- Update handleStatusCommand to accept IContainer
- Use container.config instead of getConfig()
- Use container.getFirecrawlClient()
- Update command handler and tests
- Phase 2 Task 12/14

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 13: Migrate list command

**Files:**
- Modify: `src/commands/list.ts:15-50`
- Test: `src/__tests__/commands/list.test.ts`

**Pattern:** Simple - just getClient replacement.

**Step 1: Update executeList signature**

```typescript
export async function executeList(
  container: IContainer
): Promise<ListResult> {
```

**Step 2: Replace getClient**

```typescript
  const app = container.getFirecrawlClient();
```

**Step 3: Update command handler and tests**

**Step 4: Commit**

```bash
git add src/commands/list.ts src/__tests__/commands/list.test.ts
git commit -m "refactor(di): migrate list command to use container

- Update executeList to accept IContainer
- Replace getClient() with container method
- Update command handler and tests
- Phase 2 Task 13/14

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 14: Migrate config/login/logout commands

**Files:**
- Modify: `src/commands/config.ts:30-100`
- Modify: `src/commands/login.ts:20-60`
- Modify: `src/commands/logout.ts:15-40`
- Test: No test changes (these commands manage credentials)

**Step 1: Update config command**

These commands are special - they manage credentials and config, so they need container factory access:

```typescript
export async function handleConfigCommand(
  apiKey?: string
): Promise<void> {
  // Config commands update credentials, then create new container
  if (apiKey) {
    saveCredentials({ apiKey });
  }

  // Verify by creating container
  const container = createContainer();
  const hasKey = !!container.config.apiKey;
  console.log('API Key:', hasKey ? '✓ Set' : '✗ Not set');
}
```

**Step 2: Update login command**

```typescript
export async function handleLoginCommand(
  apiKey?: string
): Promise<void> {
  // Save credentials
  saveCredentials({ apiKey });

  // Verify by creating container and testing
  const container = createContainer();
  const app = container.getFirecrawlClient();
  // ... verify API key works
}
```

**Step 3: Update logout command**

```typescript
export async function handleLogoutCommand(): Promise<void> {
  // Clear credentials
  clearCredentials();

  // Verify by creating container
  const container = createContainer();
  const hasKey = !!container.config.apiKey;
  console.log('Logged out:', hasKey ? '✗ Failed' : '✓ Success');
}
```

**Step 4: Import container factory**

Add to all three files:
```typescript
import { createContainer } from '../container/ContainerFactory';
```

**Step 5: Verify and commit**

Run: `pnpm type-check && pnpm test`
Expected: PASS

```bash
git add src/commands/config.ts src/commands/login.ts src/commands/logout.ts
git commit -m "refactor(di): migrate config/login/logout to use container

- Update config/login/logout to verify via container creation
- Replace getClient() with container.getFirecrawlClient()
- Use container.config to check credentials
- Phase 2 Task 14/14

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 15: Final verification and cleanup

**Objective:** Verify all commands work, tests pass, no deprecated function usage.

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests passing

**Step 2: Search for deprecated function usage**

Run: `grep -r "getClient()" src/commands/`
Expected: No results

Run: `grep -r "getConfig()" src/commands/`
Expected: No results

Run: `grep -r "autoEmbed()" src/commands/`
Expected: No results

**Step 3: Build and manual CLI test**

Run: `pnpm build && node dist/index.js --help`
Expected: CLI loads successfully

Run: `node dist/index.js status`
Expected: Status displays correctly

**Step 4: Update PR description**

Add to PR #10 description:
```markdown
## Phase 2 Complete: Command Migration (14/14 tasks)

All CLI commands migrated to use DI container:
- ✅ scrape, map, search, extract (simple commands)
- ✅ crawl (8 files, complex pipeline)
- ✅ batch, embed (batch operations)
- ✅ query, retrieve (semantic search)
- ✅ status, list (utility commands)
- ✅ config, login, logout (auth/config)

Benefits achieved:
- Isolated configuration per command execution
- No global singleton state
- Commands are pure functions (testable)
- Container injected via Commander.js hooks
```

**Step 5: Commit**

```bash
git add docs/plans/2026-02-01-phase-2-command-migration.md
git commit -m "docs: mark Phase 2 complete in implementation plan

All 14 commands migrated to use DI container.
Zero deprecated function usage in commands.
All 554+ tests passing.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

**Step 6: Push to remote**

Run: `git push origin feat/di-container`

**Step 7: Announce completion**

"Phase 2 complete! All 14 commands migrated to DI container. Ready to proceed to Phase 3 (test migration) or merge PR #10."

---

## Success Criteria

✅ All 14 commands accept `IContainer` as first parameter
✅ No `getClient()` calls in command files
✅ No `getConfig()` calls in command files
✅ No `autoEmbed()` calls in command files
✅ All tests updated to use mock containers
✅ All 554+ tests passing
✅ TypeScript compilation clean
✅ CLI manual testing successful
✅ Git history shows frequent, atomic commits

---

## Notes for Future Phases

**Phase 3 (Test Migration):**
- Update test utilities to create test containers
- Remove manual cache resets (`resetTeiCache()`, `resetQdrantCache()`)
- Each test suite creates isolated container
- Test isolation fully achieved

**Phase 4 (Cleanup):**
- Remove deprecated functions from `src/utils/`
- Remove `@deprecated` tags
- Update documentation
- Final PR review and merge

---

## Troubleshooting

**Issue:** TypeScript error "Property '_container' does not exist on Command"
**Fix:** Add TypeScript declaration (Task 1, Step 5)

**Issue:** Tests fail with "container is undefined"
**Fix:** Ensure mock container is passed to command functions

**Issue:** Commands receive wrong config
**Fix:** Verify `createContainerWithOverride` is used for API key flag

**Issue:** Auto-embed not working
**Fix:** Ensure `container.getEmbedPipeline()` is called instead of `autoEmbed()`

---

## Estimated Timeline

**Optimistic Estimate (Everything works first try):**
- Task 1 (Entry point): 30-45 min
- Tasks 2-5 (Simple commands): 2-3 hours (45 min each with testing)
- Tasks 6-7 (Crawl command): 3-4 hours (complex, 8 files, dependencies)
- Tasks 8-9 (Batch/embed): 1-1.5 hours
- Tasks 10-11 (Query/retrieve): 1 hour
- Tasks 12-14 (Status/list/config): 1 hour
- Task 15 (Verification): 1-1.5 hours (includes debugging)

**Realistic Estimate (With debugging and fixes):**
- **Total: 10-12 hours** (1.5 work days with breaks)

**Buffer Time:**
- Add 2-3 hours for unexpected issues, test fixes, or refactoring
- **Comfortable Total: 12-15 hours** (2 work days)

**Note:** This is Phase 2 only. Phase 3 (test migration) and Phase 4 (cleanup) will follow.

---

**End of Phase 2 Implementation Plan**
