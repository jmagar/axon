# Code Duplication Audit

Generated: 2026-02-08T00:30:21.940Z

## Scope

- Scanner: `jscpd@4.0.5`
- Paths: `src`, `scripts`, `apps`, `patchright-app.py`
- Formats: `typescript`, `javascript`, `python`, `bash`
- Settings: `--min-lines 5 --min-tokens 40`

## Summary

- Sources scanned: **151**
- Total lines scanned: **33439**
- Clone groups found: **287**
- Duplicated lines: **3276**
- Duplication rate: **9.8%**

## Progress Update (2026-02-08)

### Completed In This Session

- Resolved all originally-listed **Critical** production cross-file pairs:
  - `src/utils/embedpipeline.ts <-> src/container/services/EmbedPipeline.ts`
  - `src/utils/embedpipeline.ts <-> src/container/utils/embed-helpers.ts`
  - `src/utils/embeddings.ts <-> src/container/services/TeiService.ts`
- Resolved originally-listed **High** pair:
  - `src/container/ContainerFactory.ts <-> src/container/DaemonContainerFactory.ts`
- Reduced repeated command-option/filter boilerplate across:
  - `history`, `sources`, `stats`, `domains`, `delete`, `retrieve`
  - Shared via `src/commands/shared.ts` helpers.

### Latest Scan Snapshot

From `.cache/jscpd-latest3/jscpd-report.json`:

- Sources scanned: **150**
- Total lines scanned: **32291**
- Clone groups: **266**
- Duplicated lines: **2943**
- Duplication rate: **9.11%** (down from **9.8%**)

### Legacy Removal (Current Priority)

Removed legacy embedding wrappers and legacy test surfaces:

- Deleted `src/utils/embedpipeline.ts` (deprecated path)
- Deleted `src/utils/embeddings.ts` (legacy helper wrapper)
- Deleted `src/utils/qdrant.ts` (legacy helper wrapper)
- Deleted legacy utility tests tied to removed wrappers:
  - `src/__tests__/utils/embedpipeline.test.ts`
  - `src/__tests__/utils/embeddings.test.ts`
  - `src/__tests__/utils/qdrant.test.ts`
- Updated command/background tests and test docs to use container-based embedding/Qdrant behavior directly.

Removed additional legacy global-state modules:

- Deleted `src/utils/config.ts` (global mutable config singleton)
- Deleted `src/utils/client.ts` (global-client wrapper)
- Reworked `src/utils/auth.ts` to be stateless (explicit key/env/stored credentials) with no global config coupling
- Updated `src/index.ts` auth gating to use container-resolved API key
- Updated webhook configuration to resolve from container config only (no global fallback)
- Deleted legacy config test surface:
  - `src/__tests__/utils/config.test.ts`

Removed remaining explicit legacy/deprecated paths:

- Deleted deprecated no-op test helpers from `src/__tests__/utils/mock-client.ts`
- Removed legacy array-format compatibility branch from `src/commands/search.ts`
- Removed legacy-only search unit case from `src/__tests__/commands/search.test.ts`
- Cleared backward-compatibility wording from utility comments where no compatibility shim remains
- Removed implicit `crawl <job-id>` status auto-routing in execution path; status now requires explicit `crawl status <job-id>` (manual `--embed` job-id flow remains supported)

### Current Top Production Cross-File Pairs (Next Targets)

- `src/commands/batch.ts <-> src/commands/extract.ts` (**37** lines)
- `src/commands/domains.ts <-> src/commands/stats.ts` (**16** lines)
- `src/commands/map.ts <-> src/commands/scrape.ts` (**15** lines)
- `src/commands/embed.ts <-> src/commands/query.ts` (**11** lines)
- `src/commands/history.ts <-> src/commands/sources.ts` (**10** lines)

### By Category

| Category | Clone Groups | Duplicated Lines |
|---|---:|---:|
| prod cross-file | 25 | 382 |
| prod intra-file | 36 | 416 |
| test<->test | 226 | 2765 |
| mixed | 0 | 0 |

## Severity List

Severity is based on maintenance and behavior-drift risk:

- **Critical**: production cross-file duplication of core logic that can diverge and change runtime behavior.
  - `src/utils/embedpipeline.ts <-> src/container/services/EmbedPipeline.ts` (46 lines)
  - `src/utils/embedpipeline.ts <-> src/container/utils/embed-helpers.ts` (41 lines)
  - `src/utils/embeddings.ts <-> src/container/services/TeiService.ts` (69 lines)
- **High**: production cross-file duplication in configuration/orchestration paths.
  - `src/container/ContainerFactory.ts <-> src/container/DaemonContainerFactory.ts` (42 lines)
  - `src/commands/history.ts <-> src/commands/sources.ts` (43 lines)
  - `src/commands/sources.ts <-> src/commands/stats.ts` (20 lines)
  - `src/commands/domains.ts <-> src/commands/stats.ts` (16 lines)
  - `src/commands/embed.ts <-> src/commands/query.ts` (11 lines)
  - `src/commands/info.ts <-> src/commands/stats.ts` (9 lines)
  - `src/commands/retrieve.ts <-> src/commands/stats.ts` (9 lines)
  - `src/commands/delete.ts <-> src/commands/stats.ts` (9 lines)
- **Medium**: production intra-file duplication (same file repeated logic).
  - `src/container/services/QdrantService.ts <-> src/container/services/QdrantService.ts` (189 lines)
  - `src/commands/batch.ts <-> src/commands/batch.ts` (58 lines)
  - `src/commands/crawl/command.ts <-> src/commands/crawl/command.ts` (43 lines)
  - `src/commands/completion.ts <-> src/commands/completion.ts` (37 lines)
  - plus remaining production intra-file clone entries in this report
- **Low**: test-only duplication.
  - `src/__tests__/commands/status-command.test.ts <-> src/__tests__/commands/status-command.test.ts` (319 lines)
  - `src/__tests__/utils/background-embedder.test.ts <-> src/__tests__/utils/background-embedder.test.ts` (162 lines)
  - `src/__tests__/utils/embed-queue.test.ts <-> src/__tests__/utils/embed-queue.test.ts` (135 lines)
  - `src/__tests__/commands/map.test.ts <-> src/__tests__/commands/map.test.ts` (129 lines)
  - plus all remaining `test<->test` entries

## Pair Summary (All File Pairs)

| # | Category | Pair | Clone Groups | Duplicated Lines |
|---:|---|---|---:|---:|
| 1 | test<->test | src/__tests__/commands/status-command.test.ts <-> src/__tests__/commands/status-command.test.ts | 29 | 319 |
| 2 | prod intra-file | src/container/services/QdrantService.ts <-> src/container/services/QdrantService.ts | 15 | 189 |
| 3 | test<->test | src/__tests__/utils/background-embedder.test.ts <-> src/__tests__/utils/background-embedder.test.ts | 9 | 162 |
| 4 | test<->test | src/__tests__/utils/embed-queue.test.ts <-> src/__tests__/utils/embed-queue.test.ts | 12 | 135 |
| 5 | test<->test | src/__tests__/commands/map.test.ts <-> src/__tests__/commands/map.test.ts | 11 | 129 |
| 6 | test<->test | src/__tests__/commands/search.test.ts <-> src/__tests__/commands/search.test.ts | 9 | 118 |
| 7 | test<->test | src/__tests__/utils/embedpipeline.test.ts <-> src/__tests__/utils/embedpipeline.test.ts | 8 | 109 |
| 8 | test<->test | src/__tests__/commands/crawl/embed.test.ts <-> src/__tests__/commands/crawl/embed.test.ts | 9 | 102 |
| 9 | test<->test | src/__tests__/container/services/TeiService.test.ts <-> src/__tests__/container/services/TeiService.test.ts | 8 | 75 |
| 10 | test<->test | src/__tests__/commands/extract.test.ts <-> src/__tests__/commands/extract.test.ts | 4 | 74 |
| 11 | prod cross-file | src/utils/embeddings.ts <-> src/container/services/TeiService.ts | 3 | 69 |
| 12 | test<->test | src/__tests__/commands/delete.test.ts <-> src/__tests__/commands/delete.test.ts | 6 | 66 |
| 13 | test<->test | src/__tests__/commands/batch.test.ts <-> src/__tests__/commands/batch.test.ts | 3 | 66 |
| 14 | test<->test | src/__tests__/commands/crawl/execute.test.ts <-> src/__tests__/commands/crawl/execute.test.ts | 6 | 65 |
| 15 | test<->test | src/__tests__/commands/crawl-embed-config.test.ts <-> src/__tests__/commands/crawl-embed-config.test.ts | 3 | 65 |
| 16 | test<->test | src/__tests__/e2e/vector.e2e.test.ts <-> src/__tests__/e2e/vector.e2e.test.ts | 6 | 64 |
| 17 | test<->test | src/__tests__/commands/crawl/polling.test.ts <-> src/__tests__/commands/crawl/polling.test.ts | 6 | 61 |
| 18 | prod intra-file | src/commands/batch.ts <-> src/commands/batch.ts | 6 | 58 |
| 19 | test<->test | src/__tests__/utils/output.test.ts <-> src/__tests__/utils/output.test.ts | 5 | 58 |
| 20 | test<->test | src/__tests__/e2e/map.e2e.test.ts <-> src/__tests__/e2e/scrape.e2e.test.ts | 4 | 58 |
| 21 | test<->test | src/__tests__/container/services/EmbedPipeline.test.ts <-> src/__tests__/container/services/EmbedPipeline.test.ts | 6 | 56 |
| 22 | test<->test | src/__tests__/commands/crawl/command.test.ts <-> src/__tests__/commands/crawl/command.test.ts | 5 | 52 |
| 23 | test<->test | src/__tests__/utils/qdrant.test.ts <-> src/__tests__/utils/qdrant.test.ts | 5 | 49 |
| 24 | test<->test | src/__tests__/services/qdrant-service.test.ts <-> src/__tests__/services/qdrant-service.test.ts | 5 | 48 |
| 25 | prod cross-file | src/utils/embedpipeline.ts <-> src/container/services/EmbedPipeline.ts | 2 | 46 |
| 26 | test<->test | src/__tests__/e2e/scrape.e2e.test.ts <-> src/__tests__/e2e/search.e2e.test.ts | 4 | 44 |
| 27 | test<->test | src/__tests__/commands/embed.test.ts <-> src/__tests__/commands/query.test.ts | 3 | 44 |
| 28 | test<->test | src/__tests__/commands/history.test.ts <-> src/__tests__/commands/history.test.ts | 4 | 43 |
| 29 | prod intra-file | src/commands/crawl/command.ts <-> src/commands/crawl/command.ts | 4 | 43 |
| 30 | prod cross-file | src/commands/history.ts <-> src/commands/sources.ts | 3 | 43 |
| 31 | prod cross-file | src/container/ContainerFactory.ts <-> src/container/DaemonContainerFactory.ts | 2 | 42 |
| 32 | test<->test | src/__tests__/e2e/crawl.e2e.test.ts <-> src/__tests__/e2e/crawl.e2e.test.ts | 3 | 41 |
| 33 | prod cross-file | src/utils/embedpipeline.ts <-> src/container/utils/embed-helpers.ts | 1 | 41 |
| 34 | test<->test | src/__tests__/commands/config.test.ts <-> src/__tests__/commands/config.test.ts | 3 | 40 |
| 35 | prod intra-file | src/commands/completion.ts <-> src/commands/completion.ts | 3 | 37 |
| 36 | test<->test | src/__tests__/e2e/extract.e2e.test.ts <-> src/__tests__/e2e/scrape.e2e.test.ts | 2 | 36 |
| 37 | test<->test | src/__tests__/commands/scrape.test.ts <-> src/__tests__/commands/scrape.test.ts | 3 | 35 |
| 38 | test<->test | src/__tests__/commands/sources.test.ts <-> src/__tests__/commands/stats.test.ts | 3 | 35 |
| 39 | test<->test | src/__tests__/e2e/map.e2e.test.ts <-> src/__tests__/e2e/search.e2e.test.ts | 3 | 34 |
| 40 | test<->test | src/__tests__/commands/query.test.ts <-> src/__tests__/commands/retrieve.test.ts | 2 | 34 |
| 41 | test<->test | src/__tests__/commands/domains.test.ts <-> src/__tests__/commands/stats.test.ts | 1 | 34 |
| 42 | test<->test | src/__tests__/utils/webhook-status.integration.test.ts <-> src/__tests__/utils/webhook-status.integration.test.ts | 3 | 29 |
| 43 | test<->test | src/__tests__/commands/list.test.ts <-> src/__tests__/commands/list.test.ts | 2 | 29 |
| 44 | test<->test | src/__tests__/e2e/crawl.e2e.test.ts <-> src/__tests__/e2e/scrape.e2e.test.ts | 2 | 28 |
| 45 | test<->test | src/__tests__/commands/info.test.ts <-> src/__tests__/commands/info.test.ts | 2 | 25 |
| 46 | test<->test | src/__tests__/commands/extract.test.ts <-> src/__tests__/commands/search.test.ts | 2 | 24 |
| 47 | test<->test | src/__tests__/e2e/extract.e2e.test.ts <-> src/__tests__/e2e/extract.e2e.test.ts | 2 | 23 |
| 48 | test<->test | src/__tests__/commands/retrieve.test.ts <-> src/__tests__/commands/scrape.test.ts | 1 | 23 |
| 49 | prod cross-file | src/container/types.ts <-> src/container/services/EmbedPipeline.ts | 2 | 22 |
| 50 | test<->test | src/__tests__/commands/scrape.test.ts <-> src/__tests__/commands/search.test.ts | 2 | 20 |
| 51 | test<->test | src/__tests__/e2e/extract.e2e.test.ts <-> src/__tests__/e2e/search.e2e.test.ts | 2 | 20 |
| 52 | prod cross-file | src/commands/sources.ts <-> src/commands/stats.ts | 2 | 20 |
| 53 | test<->test | src/__tests__/commands/crawl/status.test.ts <-> src/__tests__/commands/crawl/status.test.ts | 2 | 19 |
| 54 | test<->test | src/__tests__/commands/info.test.ts <-> src/__tests__/commands/sources.test.ts | 1 | 19 |
| 55 | test<->test | src/__tests__/utils/polling.test.ts <-> src/__tests__/utils/polling.test.ts | 2 | 18 |
| 56 | test<->test | src/__tests__/e2e/crawl.e2e.test.ts <-> src/__tests__/e2e/extract.e2e.test.ts | 1 | 17 |
| 57 | prod intra-file | src/types/search.ts <-> src/types/search.ts | 1 | 17 |
| 58 | prod cross-file | src/commands/domains.ts <-> src/commands/stats.ts | 2 | 16 |
| 59 | test<->test | src/__tests__/commands/info.test.ts <-> src/__tests__/commands/stats.test.ts | 1 | 16 |
| 60 | test<->test | src/__tests__/commands/scrape.test.ts <-> src/__tests__/commands/stats.test.ts | 1 | 15 |
| 61 | prod cross-file | src/commands/map.ts <-> src/commands/scrape.ts | 1 | 15 |
| 62 | test<->test | src/__tests__/utils/embed-queue.test.ts <-> src/__tests__/utils/webhook-status.integration.test.ts | 1 | 12 |
| 63 | prod intra-file | src/commands/search.ts <-> src/commands/search.ts | 1 | 12 |
| 64 | test<->test | src/__tests__/utils/background-embedder.test.ts <-> src/__tests__/utils/webhook-status.integration.test.ts | 1 | 11 |
| 65 | prod cross-file | src/commands/domains.ts <-> src/commands/sources.ts | 1 | 11 |
| 66 | prod cross-file | src/commands/embed.ts <-> src/commands/query.ts | 1 | 11 |
| 67 | prod intra-file | src/container/services/EmbedPipeline.ts <-> src/container/services/EmbedPipeline.ts | 1 | 11 |
| 68 | prod intra-file | src/utils/embed-queue.ts <-> src/utils/embed-queue.ts | 1 | 11 |
| 69 | test<->test | src/__tests__/utils/auth.test.ts <-> src/__tests__/utils/config.test.ts | 1 | 10 |
| 70 | prod intra-file | src/commands/config.ts <-> src/commands/config.ts | 1 | 10 |
| 71 | prod intra-file | src/commands/query.ts <-> src/commands/query.ts | 1 | 10 |
| 72 | prod cross-file | src/container/types.ts <-> src/container/services/HttpClient.ts | 1 | 10 |
| 73 | prod intra-file | src/utils/output.ts <-> src/utils/output.ts | 1 | 10 |
| 74 | test<->test | src/__tests__/commands/crawl/embed.test.ts <-> src/__tests__/commands/crawl/status.test.ts | 1 | 9 |
| 75 | test<->test | src/__tests__/commands/map.test.ts <-> src/__tests__/commands/status-command.test.ts | 1 | 9 |
| 76 | test<->test | src/__tests__/e2e/status.e2e.test.ts <-> src/__tests__/e2e/status.e2e.test.ts | 1 | 9 |
| 77 | prod cross-file | src/commands/delete.ts <-> src/commands/stats.ts | 1 | 9 |
| 78 | prod cross-file | src/commands/history.ts <-> src/commands/stats.ts | 1 | 9 |
| 79 | prod cross-file | src/commands/info.ts <-> src/commands/stats.ts | 1 | 9 |
| 80 | prod cross-file | src/commands/retrieve.ts <-> src/commands/stats.ts | 1 | 9 |
| 81 | test<->test | src/__tests__/commands/crawl-embed-config.test.ts <-> src/__tests__/utils/background-embedder.test.ts | 1 | 8 |
| 82 | test<->test | src/__tests__/utils/auth.test.ts <-> src/__tests__/utils/auth.test.ts | 1 | 8 |
| 83 | prod intra-file | src/utils/background-embedder.ts <-> src/utils/background-embedder.ts | 1 | 8 |
| 84 | test<->test | src/__tests__/commands/crawl/options.test.ts <-> src/__tests__/commands/crawl/options.test.ts | 1 | 7 |
| 85 | test<->test | src/__tests__/e2e/helpers.ts <-> src/__tests__/e2e/helpers.ts | 1 | 6 |

## Complete Clone List (All Entries)

| # | Category | Format | Lines | File A | File B | Fragment Preview |
|---:|---|---|---:|---|---|---|
| 1 | prod cross-file | typescript | 41 | src/utils/embedpipeline.ts:237-277 | src/container/utils/embed-helpers.ts:25-65 | ; } /** * Create embed items from an array of pages/documents. * * This is a helper for the common pattern of converting |
| 2 | prod cross-file | typescript | 36 | src/utils/embeddings.ts:82-117 | src/container/services/TeiService.ts:51-86 | ); } /** * Simple semaphore for concurrency control */ class Semaphore { private current = 0; private queue: (() => void |
| 3 | test<->test | typescript | 36 | src/__tests__/commands/extract.test.ts:236-271 | src/__tests__/commands/extract.test.ts:19-759 | , () => { let mockClient: { extract: ReturnType<typeof vi.fn> }; let mockContainer: IContainer; beforeEach(() => { mockC |
| 4 | test<->test | typescript | 34 | src/__tests__/commands/domains.test.ts:10-43 | src/__tests__/commands/stats.test.ts:10-49 | , () => { let container: IContainer; let mockQdrantService: IQdrantService; beforeEach(() => { mockQdrantService = { ens |
| 5 | test<->test | typescript | 31 | src/__tests__/commands/search.test.ts:721-751 | src/__tests__/commands/search.test.ts:22-51 | , () => { let mockClient: SearchMockClient; let mockContainer: IContainer; beforeEach(() => { // Create mock client mock |
| 6 | prod cross-file | typescript | 27 | src/container/ContainerFactory.ts:6-32 | src/container/DaemonContainerFactory.ts:13-39 | import { loadCredentials } from '../utils/credentials'; import { fmt } from '../utils/theme'; import { Container } from  |
| 7 | prod cross-file | typescript | 27 | src/utils/embedpipeline.ts:164-190 | src/container/services/EmbedPipeline.ts:143-169 | ); } catch (error) { console.error( fmt.error( `Embed failed for ${metadata.url}: ${error instanceof Error ? error.messa |
| 8 | test<->test | typescript | 26 | src/__tests__/commands/embed.test.ts:61-86 | src/__tests__/commands/query.test.ts:29-489 | ]]), }; // Create mock Qdrant service mockQdrantService = { ensureCollection: vi.fn().mockResolvedValue(undefined), dele |
| 9 | test<->test | typescript | 25 | src/__tests__/commands/status-command.test.ts:824-848 | src/__tests__/commands/status-command.test.ts:300-806 | , async () => { const { listEmbedJobs } = await import('../../utils/embed-queue'); vi.mocked(listEmbedJobs).mockResolved |
| 10 | test<->test | typescript | 25 | src/__tests__/commands/status-command.test.ts:866-890 | src/__tests__/commands/status-command.test.ts:300-806 | , async () => { const { listEmbedJobs } = await import('../../utils/embed-queue'); vi.mocked(listEmbedJobs).mockResolved |
| 11 | test<->test | typescript | 24 | src/__tests__/commands/query.test.ts:32-55 | src/__tests__/commands/retrieve.test.ts:16-490 | // Create mock Qdrant service mockQdrantService = { ensureCollection: vi.fn().mockResolvedValue(undefined), deleteByUrl: |
| 12 | test<->test | typescript | 24 | src/__tests__/utils/background-embedder.test.ts:293-316 | src/__tests__/utils/background-embedder.test.ts:197-219 | , async () => { const { getStalePendingJobs, markJobConfigError } = await import( '../../utils/embed-queue' ); const { c |
| 13 | prod intra-file | typescript | 23 | src/container/services/QdrantService.ts:482-504 | src/container/services/QdrantService.ts:291-313 | if (offset !== null) { body.offset = offset; } const response = await this.httpClient.fetchWithRetry( `${this.qdrantUrl} |
| 14 | test<->test | typescript | 23 | src/__tests__/commands/retrieve.test.ts:21-43 | src/__tests__/commands/scrape.test.ts:472-493 | ), upsertPoints: vi.fn().mockResolvedValue(undefined), queryPoints: vi.fn().mockResolvedValue([]), scrollByUrl: vi.fn(). |
| 15 | test<->test | typescript | 23 | src/__tests__/commands/status-command.test.ts:375-397 | src/__tests__/commands/status-command.test.ts:308-330 | , maxRetries: 3, createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:01:00.000Z', }, ]); mockClient.getActi |
| 16 | test<->test | typescript | 23 | src/__tests__/utils/background-embedder.test.ts:245-267 | src/__tests__/utils/background-embedder.test.ts:197-219 | , async () => { const { getStalePendingJobs, markJobConfigError } = await import( '../../utils/embed-queue' ); const { c |
| 17 | test<->test | typescript | 23 | src/__tests__/utils/embedpipeline.test.ts:266-288 | src/__tests__/utils/embedpipeline.test.ts:226-248 | ); vi.mocked(chunkText).mockReturnValue([ { text: 'chunk text', index: 0, header: null }, ]); const result = await batch |
| 18 | prod cross-file | typescript | 22 | src/commands/history.ts:40-61 | src/commands/sources.ts:36-57 | ), }; } const qdrantService = container.getQdrantService(); // Build filter const filter: Record<string, string \| number |
| 19 | prod intra-file | typescript | 22 | src/commands/crawl/command.ts:261-282 | src/commands/crawl/command.ts:203-255 | (container, jobId); if (!result.success) { console.error(fmt.error(result.error \|\| "Unknown error occurred")); process.e |
| 20 | test<->test | typescript | 22 | src/__tests__/commands/batch.test.ts:115-136 | src/__tests__/commands/batch.test.ts:22-43 | , () => { let mockClient: Partial<MockFirecrawlClient>; let container: IContainer; beforeEach(() => { mockClient = { sta |
| 21 | test<->test | typescript | 22 | src/__tests__/commands/batch.test.ts:174-195 | src/__tests__/commands/batch.test.ts:22-43 | , () => { let mockClient: Partial<MockFirecrawlClient>; let container: IContainer; beforeEach(() => { mockClient = { sta |
| 22 | test<->test | typescript | 22 | src/__tests__/commands/batch.test.ts:229-250 | src/__tests__/commands/batch.test.ts:22-43 | , () => { let mockClient: Partial<MockFirecrawlClient>; let container: IContainer; beforeEach(() => { mockClient = { sta |
| 23 | test<->test | typescript | 22 | src/__tests__/commands/crawl-embed-config.test.ts:183-204 | src/__tests__/commands/crawl-embed-config.test.ts:71-92 | , async () => { const mockCrawlJob = { id: 'test-job-id', status: 'completed', total: 1, completed: 1, data: [ { markdow |
| 24 | test<->test | typescript | 22 | src/__tests__/commands/crawl-embed-config.test.ts:227-248 | src/__tests__/commands/crawl-embed-config.test.ts:71-92 | , async () => { const mockCrawlJob = { id: 'test-job-id', status: 'completed', total: 1, completed: 1, data: [ { markdow |
| 25 | test<->test | typescript | 22 | src/__tests__/utils/background-embedder.test.ts:351-372 | src/__tests__/utils/background-embedder.test.ts:133-157 | } = await import('../../utils/embed-queue'); const { createDaemonContainer } = await import( '../../container/DaemonCont |
| 26 | prod intra-file | typescript | 21 | src/container/services/QdrantService.ts:565-585 | src/container/services/QdrantService.ts:383-404 | } }], }, exact: true, }), }, { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES } ); if (!response.ok) { thr |
| 27 | test<->test | typescript | 21 | src/__tests__/commands/crawl-embed-config.test.ts:142-162 | src/__tests__/commands/crawl-embed-config.test.ts:72-92 | const mockCrawlJob = { id: 'test-job-id', status: 'completed', total: 1, completed: 1, data: [ { markdown: '# Test Page' |
| 28 | test<->test | typescript | 21 | src/__tests__/utils/background-embedder.test.ts:198-218 | src/__tests__/utils/background-embedder.test.ts:133-152 | } = await import( '../../utils/embed-queue' ); const { createDaemonContainer } = await import( '../../container/DaemonCo |
| 29 | prod intra-file | typescript | 20 | src/container/services/QdrantService.ts:537-556 | src/container/services/QdrantService.ts:386-404 | }), }, { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES } ); if (!response.ok) { throw new Error(await thi |
| 30 | test<->test | typescript | 20 | src/__tests__/e2e/crawl.e2e.test.ts:24-43 | src/__tests__/e2e/scrape.e2e.test.ts:25-44 | , () => { let tempDir: string; let apiKey: string \| undefined; let testServerAvailable: boolean; beforeAll(async () => { |
| 31 | test<->test | typescript | 20 | src/__tests__/e2e/map.e2e.test.ts:25-44 | src/__tests__/e2e/scrape.e2e.test.ts:25-44 | , () => { let tempDir: string; let apiKey: string \| undefined; let testServerAvailable: boolean; beforeAll(async () => { |
| 32 | test<->test | typescript | 20 | src/__tests__/utils/embedpipeline.test.ts:323-342 | src/__tests__/utils/embedpipeline.test.ts:229-248 | ); const result = await batchEmbed([ { content: 'Content 1', metadata: { url: 'https://example.com/1', sourceCommand: 's |
| 33 | prod cross-file | typescript | 19 | src/utils/embedpipeline.ts:121-139 | src/container/services/EmbedPipeline.ts:80-98 | , metadata.url); // Build points with metadata const now = new Date().toISOString(); const domain = extractDomain(metada |
| 34 | test<->test | typescript | 19 | src/__tests__/commands/extract.test.ts:194-212 | src/__tests__/commands/extract.test.ts:158-176 | , async () => { const mockClient = { getExtractStatus: vi.fn() }; const mockContainer = { config: { apiKey: 'test-api-ke |
| 35 | test<->test | typescript | 19 | src/__tests__/commands/info.test.ts:25-43 | src/__tests__/commands/sources.test.ts:25-49 | ), getCollectionInfo: vi.fn(), countPoints: vi.fn(), deleteAll: vi.fn(), }; container = createTestContainer(undefined, { |
| 36 | test<->test | typescript | 19 | src/__tests__/e2e/extract.e2e.test.ts:25-43 | src/__tests__/e2e/scrape.e2e.test.ts:25-43 | , () => { let tempDir: string; let apiKey: string \| undefined; let testServerAvailable: boolean; beforeAll(async () => { |
| 37 | prod intra-file | typescript | 18 | src/container/services/QdrantService.ts:357-374 | src/container/services/QdrantService.ts:190-210 | } }], }, }), }, { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES } ); if (!response.ok) { throw new Error( |
| 38 | test<->test | typescript | 18 | src/__tests__/commands/crawl/embed.test.ts:363-380 | src/__tests__/commands/crawl/embed.test.ts:257-274 | }), }; const container = createContainer(mockClient); vi.doMock('../../../utils/background-embedder', () => ({ processEm |
| 39 | test<->test | typescript | 18 | src/__tests__/commands/list.test.ts:57-74 | src/__tests__/commands/list.test.ts:26-43 | , () => { type ListMock = MockFirecrawlClient & Required<Pick<MockFirecrawlClient, "getActiveCrawls">>; let mockClient:  |
| 40 | prod cross-file | typescript | 17 | src/utils/embeddings.ts:120-136 | src/container/services/TeiService.ts:230-245 | texts: string[] ): Promise<number[][]> { if (texts.length === 0) return []; // Split into batches const batches: string[ |
| 41 | prod intra-file | typescript | 17 | src/commands/completion.ts:216-232 | src/commands/completion.ts:185-201 | let script: string; switch (shell) { case 'bash': script = generateBashScript(); break; case 'zsh': script = generateZsh |
| 42 | prod intra-file | typescript | 17 | src/types/search.ts:84-100 | src/types/search.ts:53-69 | ; /** Included when scraping is enabled */ markdown?: string; html?: string; rawHtml?: string; links?: string[]; screens |
| 43 | test<->test | typescript | 17 | src/__tests__/commands/history.test.ts:140-156 | src/__tests__/commands/history.test.ts:111-127 | , async () => { // Mock returns only filtered results (as Qdrant would do) mockScrollAll.mockResolvedValue([ { id: '1',  |
| 44 | test<->test | typescript | 17 | src/__tests__/commands/sources.test.ts:27-43 | src/__tests__/commands/stats.test.ts:33-49 | ), deleteAll: vi.fn(), }; container = createTestContainer(undefined, { qdrantUrl: 'http://localhost:53333', qdrantCollec |
| 45 | test<->test | typescript | 17 | src/__tests__/e2e/crawl.e2e.test.ts:300-316 | src/__tests__/e2e/extract.e2e.test.ts:198-224 | , '--output', outputPath, ], { env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' }, timeout: 120000, } ); if (result.exitCo |
| 46 | test<->test | typescript | 17 | src/__tests__/e2e/extract.e2e.test.ts:9-25 | src/__tests__/e2e/scrape.e2e.test.ts:9-25 | import { existsSync } from 'node:fs'; import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; imp |
| 47 | test<->test | typescript | 17 | src/__tests__/e2e/map.e2e.test.ts:9-25 | src/__tests__/e2e/scrape.e2e.test.ts:9-25 | import { existsSync } from 'node:fs'; import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; imp |
| 48 | test<->test | typescript | 17 | src/__tests__/utils/background-embedder.test.ts:268-284 | src/__tests__/utils/background-embedder.test.ts:220-236 | }); vi.mocked(createDaemonContainer).mockReturnValue(mockContainer); const consoleErrorSpy = vi .spyOn(console, 'error') |
| 49 | test<->test | typescript | 17 | src/__tests__/utils/background-embedder.test.ts:319-335 | src/__tests__/utils/background-embedder.test.ts:220-236 | }); vi.mocked(createDaemonContainer).mockReturnValue(mockContainer); const consoleErrorSpy = vi .spyOn(console, 'error') |
| 50 | prod cross-file | typescript | 16 | src/utils/embeddings.ts:32-47 | src/container/services/TeiService.ts:108-127 | , maxRetries: TEI_MAX_RETRIES, }); if (!response.ok) { throw new Error( `TEI /info failed: ${response.status} ${response |
| 51 | test<->test | typescript | 16 | src/__tests__/commands/crawl/execute.test.ts:308-323 | src/__tests__/commands/crawl/execute.test.ts:106-301 | ), }; const container = createContainer(mockClient); vi.mocked(isJobId).mockReturnValue(false); vi.mocked(buildCrawlOpti |
| 52 | test<->test | typescript | 16 | src/__tests__/commands/extract.test.ts:34-49 | src/__tests__/commands/search.test.ts:40-55 | : 'firecrawl', }, getFirecrawlClient: vi.fn().mockReturnValue(mockClient), getEmbedPipeline: vi.fn().mockReturnValue({ a |
| 53 | test<->test | typescript | 16 | src/__tests__/commands/info.test.ts:10-25 | src/__tests__/commands/stats.test.ts:10-25 | , () => { let container: IContainer; let mockQdrantService: IQdrantService; beforeEach(() => { mockQdrantService = { ens |
| 54 | test<->test | typescript | 16 | src/__tests__/commands/map.test.ts:313-328 | src/__tests__/commands/map.test.ts:230-308 | ), fetchWithRetry: vi.fn(), }; const container = createTestContainer(undefined, { userAgent: DEFAULT_USER_AGENT, }); (co |
| 55 | test<->test | typescript | 16 | src/__tests__/utils/embed-queue.test.ts:79-94 | src/__tests__/utils/embed-queue.test.ts:10-25 | , () => { let queueDir: string; beforeEach(() => { queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-')); process.e |
| 56 | test<->test | typescript | 16 | src/__tests__/utils/embed-queue.test.ts:212-227 | src/__tests__/utils/embed-queue.test.ts:10-25 | , () => { let queueDir: string; beforeEach(() => { queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-')); process.e |
| 57 | test<->test | typescript | 16 | src/__tests__/utils/embed-queue.test.ts:259-274 | src/__tests__/utils/embed-queue.test.ts:10-25 | , () => { let queueDir: string; beforeEach(() => { queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-')); process.e |
| 58 | test<->test | typescript | 16 | src/__tests__/utils/embed-queue.test.ts:388-403 | src/__tests__/utils/embed-queue.test.ts:10-25 | , () => { let queueDir: string; beforeEach(() => { queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-')); process.e |
| 59 | test<->test | typescript | 16 | src/__tests__/utils/embed-queue.test.ts:429-444 | src/__tests__/utils/embed-queue.test.ts:10-25 | , () => { let queueDir: string; beforeEach(() => { queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-')); process.e |
| 60 | test<->test | typescript | 16 | src/__tests__/utils/output.test.ts:444-459 | src/__tests__/utils/output.test.ts:234-405 | , () => { vi.mocked(fs.existsSync).mockReturnValue(true); handleScrapeOutput( { success: true, data: { screenshot: 'http |
| 61 | prod cross-file | typescript | 15 | src/commands/map.ts:260-274 | src/commands/scrape.ts:302-316 | , options, command: Command) => { const container = requireContainer(command); // Use positional URL if provided, otherw |
| 62 | prod cross-file | typescript | 15 | src/container/ContainerFactory.ts:35-49 | src/container/DaemonContainerFactory.ts:44-58 | const storedCredentials = loadCredentials(); // Parse and validate embedder webhook port from environment variable let e |
| 63 | test<->test | typescript | 15 | src/__tests__/commands/crawl/embed.test.ts:297-311 | src/__tests__/commands/crawl/embed.test.ts:260-274 | ); vi.doMock('../../../utils/background-embedder', () => ({ processEmbedQueue: mockProcessEmbedQueue, })); vi.doMock('.. |
| 64 | test<->test | typescript | 15 | src/__tests__/commands/map.test.ts:293-307 | src/__tests__/commands/map.test.ts:230-281 | }), fetchWithRetry: vi.fn(), }; const container = createTestContainer(undefined, { userAgent: DEFAULT_USER_AGENT, }); (c |
| 65 | test<->test | typescript | 15 | src/__tests__/commands/map.test.ts:374-388 | src/__tests__/commands/map.test.ts:336-350 | , ]); const container = createContainer(mockClient); const result = await executeMap(container, { urlOrJobId: 'https://e |
| 66 | test<->test | typescript | 15 | src/__tests__/commands/scrape.test.ts:486-500 | src/__tests__/commands/stats.test.ts:34-49 | ), }; container = createTestContainer(undefined, { qdrantUrl: 'http://localhost:53333', qdrantCollection: 'test_col', }) |
| 67 | test<->test | typescript | 15 | src/__tests__/commands/search.test.ts:818-832 | src/__tests__/commands/search.test.ts:798-812 | , async () => { const mockResponse = { web: [ { url: 'https://example.com', title: 'Example', description: 'A snippet',  |
| 68 | test<->test | typescript | 15 | src/__tests__/commands/status-command.test.ts:481-495 | src/__tests__/commands/status-command.test.ts:453-467 | , async () => { const { getRecentJobIds } = await import('../../utils/job-history'); vi.mocked(getRecentJobIds).mockReso |
| 69 | test<->test | typescript | 15 | src/__tests__/commands/status-command.test.ts:729-743 | src/__tests__/commands/status-command.test.ts:696-639 | .mockImplementation((id: string) => Promise.resolve({ id, status: 'completed', total: 1, completed: 1, data: [], }) ); a |
| 70 | test<->test | typescript | 15 | src/__tests__/e2e/map.e2e.test.ts:172-186 | src/__tests__/e2e/search.e2e.test.ts:210-224 | ], { env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' }, timeout: 60000, } ); if (result.exitCode === 0) { expect(existsSy |
| 71 | test<->test | typescript | 15 | src/__tests__/utils/background-embedder.test.ts:389-403 | src/__tests__/utils/background-embedder.test.ts:318-234 | , }); vi.mocked(createDaemonContainer).mockReturnValue(mockContainer); const consoleErrorSpy = vi .spyOn(console, 'error |
| 72 | test<->test | typescript | 15 | src/__tests__/utils/qdrant.test.ts:252-266 | src/__tests__/utils/qdrant.test.ts:215-229 | { id: '2', payload: { chunk_index: 1, chunk_text: 'second' } }, ], next_page_offset: null, }, }), }); const points = awa |
| 73 | test<->test | typescript | 14 | src/__tests__/commands/config.test.ts:157-170 | src/__tests__/commands/config.test.ts:37-50 | , () => { beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console |
| 74 | test<->test | typescript | 14 | src/__tests__/commands/config.test.ts:338-351 | src/__tests__/commands/config.test.ts:37-50 | , () => { beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console |
| 75 | test<->test | typescript | 14 | src/__tests__/commands/info.test.ts:268-281 | src/__tests__/commands/info.test.ts:173-186 | vi.mocked(mockQdrantService.scrollByUrl).mockResolvedValue([ { id: 'p1', vector: [], payload: { url: 'https://example.co |
| 76 | test<->test | typescript | 14 | src/__tests__/e2e/crawl.e2e.test.ts:358-371 | src/__tests__/e2e/crawl.e2e.test.ts:332-345 | , ], { env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' }, timeout: 120000, } ); if (result.exitCode === 0) { expect(resul |
| 77 | test<->test | typescript | 14 | src/__tests__/e2e/crawl.e2e.test.ts:384-397 | src/__tests__/e2e/crawl.e2e.test.ts:332-345 | , ], { env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' }, timeout: 120000, } ); if (result.exitCode === 0) { expect(resul |
| 78 | test<->test | typescript | 14 | src/__tests__/e2e/vector.e2e.test.ts:460-473 | src/__tests__/e2e/vector.e2e.test.ts:337-386 | , ], { env: { TEI_URL: process.env.TEI_URL \|\| '', QDRANT_URL: process.env.QDRANT_URL \|\| '', }, } ); expect(result.exitCo |
| 79 | prod intra-file | typescript | 13 | src/commands/batch.ts:253-265 | src/commands/batch.ts:216-228 | ; writeCommandOutput(outputContent, options); } catch (error: unknown) { const message = error instanceof Error ? error. |
| 80 | prod intra-file | typescript | 13 | src/container/services/QdrantService.ts:503-515 | src/container/services/QdrantService.ts:313-325 | ; payload?: Record<string, unknown>; }>; next_page_offset?: string \| number \| null; }; }; const points = data.result?.po |
| 81 | test<->test | typescript | 13 | src/__tests__/commands/crawl/execute.test.ts:256-268 | src/__tests__/commands/crawl/execute.test.ts:104-116 | , url: 'https://example.com', }), }; const container = createContainer(mockClient); vi.mocked(isJobId).mockReturnValue(f |
| 82 | test<->test | typescript | 13 | src/__tests__/commands/crawl/polling.test.ts:188-200 | src/__tests__/commands/crawl/polling.test.ts:169-181 | , async () => { const mockClient = { getCrawlStatus: vi.fn(), }; const container = createContainer(mockClient); vi.mocke |
| 83 | test<->test | typescript | 13 | src/__tests__/commands/history.test.ts:170-182 | src/__tests__/commands/history.test.ts:113-125 | mockScrollAll.mockResolvedValue([ { id: '1', payload: { url: 'https://example.com/page1', domain: 'example.com', source_ |
| 84 | test<->test | typescript | 13 | src/__tests__/commands/map.test.ts:501-513 | src/__tests__/commands/map.test.ts:404-491 | , ]); const container = createContainer(mockClient); const result = await executeMap(container, { urlOrJobId: 'https://e |
| 85 | test<->test | typescript | 13 | src/__tests__/commands/scrape.test.ts:347-359 | src/__tests__/commands/scrape.test.ts:44-56 | , }), getTeiService: vi.fn(), getQdrantService: vi.fn(), getHttpClient: vi.fn(), } as unknown as IContainer; }); afterEa |
| 86 | test<->test | typescript | 13 | src/__tests__/commands/search.test.ts:895-907 | src/__tests__/commands/search.test.ts:772-876 | , }, ], }; mockClient.search.mockResolvedValue(mockResponse); await handleSearchCommand(mockContainer, { query: 'test qu |
| 87 | test<->test | typescript | 13 | src/__tests__/commands/status-command.test.ts:933-945 | src/__tests__/commands/status-command.test.ts:259-351 | , async () => { const { listEmbedJobs } = await import('../../utils/embed-queue'); vi.mocked(listEmbedJobs).mockResolved |
| 88 | test<->test | typescript | 13 | src/__tests__/container/services/EmbedPipeline.test.ts:193-205 | src/__tests__/container/services/EmbedPipeline.test.ts:179-191 | ) ); // Should not throw await expect( pipeline.autoEmbed('test', { url: 'https://example.com' }) ).resolves.toBeUndefin |
| 89 | test<->test | typescript | 13 | src/__tests__/e2e/crawl.e2e.test.ts:410-422 | src/__tests__/e2e/crawl.e2e.test.ts:332-345 | , ], { env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' }, timeout: 120000, } ); if (result.exitCode === 0) { expect(resul |
| 90 | test<->test | typescript | 13 | src/__tests__/e2e/extract.e2e.test.ts:289-301 | src/__tests__/e2e/extract.e2e.test.ts:174-187 | ], { env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' }, timeout: 120000, } ); if (result.exitCode === 0) { const json = p |
| 91 | test<->test | typescript | 13 | src/__tests__/e2e/vector.e2e.test.ts:356-368 | src/__tests__/e2e/vector.e2e.test.ts:338-350 | ], { env: { TEI_URL: process.env.TEI_URL \|\| '', QDRANT_URL: process.env.QDRANT_URL \|\| '', }, } ); expect(result.exitCode |
| 92 | test<->test | typescript | 13 | src/__tests__/utils/background-embedder.test.ts:220-232 | src/__tests__/utils/background-embedder.test.ts:104-116 | ); vi.mocked(createDaemonContainer).mockReturnValue(mockContainer); const consoleErrorSpy = vi .spyOn(console, 'error')  |
| 93 | test<->test | typescript | 13 | src/__tests__/utils/embedpipeline.test.ts:295-307 | src/__tests__/utils/embedpipeline.test.ts:79-266 | , async () => { initializeConfig({ teiUrl: 'http://localhost:52000', qdrantUrl: 'http://localhost:53333', }); vi.mocked( |
| 94 | test<->test | typescript | 13 | src/__tests__/utils/embedpipeline.test.ts:350-362 | src/__tests__/utils/embedpipeline.test.ts:79-266 | , async () => { initializeConfig({ teiUrl: 'http://localhost:52000', qdrantUrl: 'http://localhost:53333', }); vi.mocked( |
| 95 | prod cross-file | typescript | 12 | src/container/types.ts:295-306 | src/container/services/EmbedPipeline.ts:170-181 | batchEmbed( items: Array<{ content: string; metadata: { url: string; title?: string; sourceCommand?: string; contentType |
| 96 | prod intra-file | typescript | 12 | src/commands/search.ts:254-265 | src/commands/search.ts:204-215 | const indentedMarkdown = result.markdown .split("\n") .map((line) => ` ${line}`) .join("\n"); lines.push(` ${fmt.dim("Co |
| 97 | prod intra-file | typescript | 12 | src/container/services/QdrantService.ts:594-605 | src/container/services/QdrantService.ts:190-210 | } }], }, }), }, { timeoutMs: QDRANT_TIMEOUT_MS, maxRetries: QDRANT_MAX_RETRIES } ); if (!response.ok) { throw new Error( |
| 98 | test<->test | typescript | 12 | src/__tests__/commands/config.test.ts:377-388 | src/__tests__/commands/config.test.ts:144-155 | ); expect(console.error).toHaveBeenCalledWith( expect.stringContaining('Unknown setting "unknown-key"') ); expect(consol |
| 99 | test<->test | typescript | 12 | src/__tests__/commands/crawl/embed.test.ts:207-218 | src/__tests__/commands/crawl/embed.test.ts:191-202 | , status: 'completed', total: 0, completed: 0, data: [], }; const container = createTestContainer(); await handleSyncEmb |
| 100 | test<->test | typescript | 12 | src/__tests__/commands/delete.test.ts:77-88 | src/__tests__/commands/delete.test.ts:62-73 | yes: true, }; const result = await executeDelete(mockContainer, options); expect(result.success).toBe(false); expect(res |
| 101 | test<->test | typescript | 12 | src/__tests__/commands/delete.test.ts:179-190 | src/__tests__/commands/delete.test.ts:135-146 | , yes: true, }; const result = await executeDelete(mockContainer, options); expect(result.success).toBe(true); expect(re |
| 102 | test<->test | typescript | 12 | src/__tests__/commands/delete.test.ts:217-228 | src/__tests__/commands/delete.test.ts:192-203 | ); mockQdrantService.deleteAll.mockResolvedValue(undefined); const options: DeleteOptions = { all: true, yes: true, }; c |
| 103 | test<->test | typescript | 12 | src/__tests__/commands/delete.test.ts:221-232 | src/__tests__/commands/delete.test.ts:135-146 | , yes: true, }; const result = await executeDelete(mockContainer, options); expect(result.success).toBe(true); expect(re |
| 104 | test<->test | typescript | 12 | src/__tests__/commands/map.test.ts:498-509 | src/__tests__/commands/map.test.ts:333-344 | , async () => { const mockClient = createMockMapClient([ 'https://example.com/page1', 'https://example.com/page2', ]); c |
| 105 | test<->test | typescript | 12 | src/__tests__/commands/search.test.ts:864-875 | src/__tests__/commands/search.test.ts:772-783 | , }, ], }; mockClient.search.mockResolvedValue(mockResponse); await handleSearchCommand(mockContainer, { query: 'test qu |
| 106 | test<->test | typescript | 12 | src/__tests__/commands/sources.test.ts:10-21 | src/__tests__/commands/stats.test.ts:10-21 | , () => { let container: IContainer; let mockQdrantService: IQdrantService; beforeEach(() => { mockQdrantService = { ens |
| 107 | test<->test | typescript | 12 | src/__tests__/container/services/EmbedPipeline.test.ts:442-453 | src/__tests__/container/services/EmbedPipeline.test.ts:386-397 | ); await pipeline.batchEmbed([ { content: 'test1', metadata: { url: 'https://test1.com', sourceCommand: 'test' }, }, { c |
| 108 | test<->test | typescript | 12 | src/__tests__/container/services/TeiService.test.ts:244-255 | src/__tests__/container/services/TeiService.test.ts:217-228 | , ]); return Promise.resolve({ ok: true, json: () => Promise.resolve(embeddings), } as Response); } ); const result = aw |
| 109 | test<->test | typescript | 12 | src/__tests__/e2e/extract.e2e.test.ts:204-215 | src/__tests__/e2e/search.e2e.test.ts:213-224 | , } ); if (result.exitCode === 0) { expect(existsSync(outputPath)).toBe(true); const content = await readFile(outputPath |
| 110 | test<->test | typescript | 12 | src/__tests__/e2e/map.e2e.test.ts:44-55 | src/__tests__/e2e/scrape.e2e.test.ts:44-55 | ], { env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' }, }); expect(result.stderr).toContain('URL is required'); }); it('s |
| 111 | test<->test | typescript | 12 | src/__tests__/e2e/vector.e2e.test.ts:374-385 | src/__tests__/e2e/vector.e2e.test.ts:338-350 | ], { env: { TEI_URL: process.env.TEI_URL \|\| '', QDRANT_URL: process.env.QDRANT_URL \|\| '', }, } ); expect(result.exitCode |
| 112 | test<->test | typescript | 12 | src/__tests__/utils/embed-queue.test.ts:496-507 | src/__tests__/utils/webhook-status.integration.test.ts:110-121 | , }, ]; for (const job of jobs) { writeFileSync( join(queueDir, `${job.jobId}.json`), JSON.stringify(job, null, 2) ); }  |
| 113 | test<->test | typescript | 12 | src/__tests__/utils/embedpipeline.test.ts:191-202 | src/__tests__/utils/embedpipeline.test.ts:16-27 | , () => { beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(conso |
| 114 | test<->test | typescript | 12 | src/__tests__/utils/embedpipeline.test.ts:212-223 | src/__tests__/utils/embedpipeline.test.ts:79-90 | , async () => { initializeConfig({ teiUrl: 'http://localhost:52000', qdrantUrl: 'http://localhost:53333', }); vi.mocked( |
| 115 | test<->test | typescript | 12 | src/__tests__/utils/output.test.ts:390-401 | src/__tests__/utils/output.test.ts:234-245 | , () => { vi.mocked(fs.existsSync).mockReturnValue(true); handleScrapeOutput( { success: true, data: { screenshot: 'http |
| 116 | test<->test | typescript | 12 | src/__tests__/utils/webhook-status.integration.test.ts:171-182 | src/__tests__/utils/webhook-status.integration.test.ts:127-138 | embedderWebhookPort: port, embedderWebhookPath: '/webhooks/crawl', }, getFirecrawlClient: vi.fn(), getHttpClient: vi.fn( |
| 117 | prod cross-file | typescript | 11 | src/commands/domains.ts:174-184 | src/commands/sources.ts:181-191 | , parseInt) .option( "--collection <name>", "Qdrant collection name (default: firecrawl)", ) .option("-o, --output <path |
| 118 | prod cross-file | typescript | 11 | src/commands/embed.ts:33-43 | src/commands/query.ts:26-36 | > { try { const teiUrl = container.config.teiUrl; const qdrantUrl = container.config.qdrantUrl; const collection = resol |
| 119 | prod cross-file | typescript | 11 | src/commands/history.ts:221-231 | src/commands/sources.ts:181-191 | , parseInt) .option( "--collection <name>", "Qdrant collection name (default: firecrawl)", ) .option("-o, --output <path |
| 120 | prod cross-file | typescript | 11 | src/commands/sources.ts:181-191 | src/commands/stats.ts:181-191 | ) .option( "--collection <name>", "Qdrant collection name (default: firecrawl)", ) .option("-o, --output <path>", "Outpu |
| 121 | prod intra-file | typescript | 11 | src/commands/batch.ts:285-295 | src/commands/batch.ts:216-228 | ); writeCommandOutput(outputContent, options); } catch (error: unknown) { const message = error instanceof Error ? error |
| 122 | prod intra-file | typescript | 11 | src/commands/completion.ts:282-292 | src/commands/completion.ts:266-276 | ) .argument('[shell]', 'Shell type: bash, zsh, or fish') .action((shell?: string) => { const targetShell = shell \|\| dete |
| 123 | prod intra-file | typescript | 11 | src/container/services/EmbedPipeline.ts:132-142 | src/container/services/EmbedPipeline.ts:48-58 | ( content: string, metadata: { url: string; title?: string; sourceCommand?: string; contentType?: string; [key: string]: |
| 124 | prod intra-file | typescript | 11 | src/container/services/QdrantService.ts:296-306 | src/container/services/QdrantService.ts:234-244 | , { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), }, { timeoutMs: QDRANT_ |
| 125 | prod intra-file | typescript | 11 | src/utils/embed-queue.ts:266-276 | src/utils/embed-queue.ts:242-255 | new Date(job.updatedAt).getTime() <= cutoff ) .sort( (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).g |
| 126 | test<->test | typescript | 11 | src/__tests__/commands/crawl/command.test.ts:243-253 | src/__tests__/commands/crawl/command.test.ts:173-183 | , url: "https://example.com", status: "processing", }; vi.mocked(isJobId).mockReturnValue(false); vi.mocked(executeCrawl |
| 127 | test<->test | typescript | 11 | src/__tests__/commands/crawl/command.test.ts:269-279 | src/__tests__/commands/crawl/command.test.ts:173-183 | , url: "https://example.com", status: "processing", }; vi.mocked(isJobId).mockReturnValue(false); vi.mocked(executeCrawl |
| 128 | test<->test | typescript | 11 | src/__tests__/commands/crawl/command.test.ts:298-308 | src/__tests__/commands/crawl/command.test.ts:173-183 | , url: "https://example.com", status: "processing", }; vi.mocked(isJobId).mockReturnValue(false); vi.mocked(executeCrawl |
| 129 | test<->test | typescript | 11 | src/__tests__/commands/crawl/command.test.ts:351-361 | src/__tests__/commands/crawl/command.test.ts:173-183 | , url: "https://example.com", status: "processing", }; vi.mocked(isJobId).mockReturnValue(false); vi.mocked(executeCrawl |
| 130 | test<->test | typescript | 11 | src/__tests__/commands/crawl/embed.test.ts:326-336 | src/__tests__/commands/crawl/embed.test.ts:256-266 | ], }), }; const container = createContainer(mockClient); vi.doMock('../../../utils/background-embedder', () => ({ proces |
| 131 | test<->test | typescript | 11 | src/__tests__/commands/crawl/embed.test.ts:336-346 | src/__tests__/commands/crawl/embed.test.ts:303-313 | , getEmbedJob: mockGetEmbedJob, })); const consoleError = vi .spyOn(console, 'error') .mockImplementation(() => {}); awa |
| 132 | test<->test | typescript | 11 | src/__tests__/commands/crawl/execute.test.ts:285-295 | src/__tests__/commands/crawl/execute.test.ts:106-116 | ), }; const container = createContainer(mockClient); vi.mocked(isJobId).mockReturnValue(false); vi.mocked(buildCrawlOpti |
| 133 | test<->test | typescript | 11 | src/__tests__/commands/crawl/polling.test.ts:193-203 | src/__tests__/commands/crawl/polling.test.ts:57-67 | ); vi.mocked(pollWithProgress).mockResolvedValue({} as never); await pollCrawlProgress(container, 'job-123', { pollInter |
| 134 | test<->test | typescript | 11 | src/__tests__/commands/crawl/status.test.ts:250-260 | src/__tests__/commands/crawl/status.test.ts:207-217 | , async () => { const mockClient = { getCrawlErrors: vi.fn().mockResolvedValue([]), }; const container = createContainer |
| 135 | test<->test | typescript | 11 | src/__tests__/commands/info.test.ts:282-292 | src/__tests__/commands/info.test.ts:249-259 | , }, }, ]); const result = await executeInfo(container, { url: 'https://example.com/docs', }); expect(result.success).to |
| 136 | test<->test | typescript | 11 | src/__tests__/commands/list.test.ts:96-106 | src/__tests__/commands/list.test.ts:74-85 | , async () => { mockClient.getActiveCrawls.mockResolvedValue({ success: true, crawls: [], }); await handleListCommand(co |
| 137 | test<->test | typescript | 11 | src/__tests__/commands/map.test.ts:267-277 | src/__tests__/commands/map.test.ts:230-240 | ), fetchWithRetry: vi.fn(), }; const container = createTestContainer(undefined, { userAgent: DEFAULT_USER_AGENT, }); (co |
| 138 | test<->test | typescript | 11 | src/__tests__/commands/map.test.ts:479-489 | src/__tests__/commands/map.test.ts:404-414 | }, ]); const container = createContainer(mockClient); const result = await executeMap(container, { urlOrJobId: 'https:// |
| 139 | test<->test | typescript | 11 | src/__tests__/commands/scrape.test.ts:337-347 | src/__tests__/commands/scrape.test.ts:34-44 | mockContainer = { config: { apiKey: 'test-api-key', apiUrl: 'https://api.firecrawl.dev', teiUrl: 'http://localhost:8080' |
| 140 | test<->test | typescript | 11 | src/__tests__/commands/scrape.test.ts:380-390 | src/__tests__/commands/scrape.test.ts:359-369 | , async () => { const mockResponse = { markdown: '# Test Content', metadata: { title: 'Test Page' }, }; mockClient.scrap |
| 141 | test<->test | typescript | 11 | src/__tests__/commands/status-command.test.ts:147-157 | src/__tests__/commands/status-command.test.ts:93-101 | } = await import( '../../utils/job-history' ); vi.mocked(getRecentJobIds).mockImplementation(async (type: string) => { i |
| 142 | test<->test | typescript | 11 | src/__tests__/commands/status-command.test.ts:808-818 | src/__tests__/commands/status-command.test.ts:463-332 | , data: [{ metadata: { sourceURL: 'https://example.com' } }], }); const logSpy = vi.spyOn(console, 'log').mockImplementa |
| 143 | test<->test | typescript | 11 | src/__tests__/commands/status-command.test.ts:850-860 | src/__tests__/commands/status-command.test.ts:463-332 | , data: [{ metadata: { sourceURL: 'https://example.com' } }], }); const logSpy = vi.spyOn(console, 'log').mockImplementa |
| 144 | test<->test | typescript | 11 | src/__tests__/container/services/EmbedPipeline.test.ts:222-232 | src/__tests__/container/services/EmbedPipeline.test.ts:205-215 | , async () => { await pipeline.autoEmbed('test content', { url: 'https://example.com', }); expect(mockQdrantService.upse |
| 145 | test<->test | typescript | 11 | src/__tests__/container/services/TeiService.test.ts:450-460 | src/__tests__/container/services/TeiService.test.ts:305-171 | (['test']); // Advance through batch retries const advanceTimers = async () => { await vi.advanceTimersByTimeAsync(0); a |
| 146 | test<->test | typescript | 11 | src/__tests__/e2e/map.e2e.test.ts:151-161 | src/__tests__/e2e/search.e2e.test.ts:181-191 | , '--json'], { env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' }, timeout: 60000, } ); if (result.exitCode === 0) { const |
| 147 | test<->test | typescript | 11 | src/__tests__/e2e/scrape.e2e.test.ts:124-134 | src/__tests__/e2e/search.e2e.test.ts:214-224 | } ); if (result.exitCode === 0) { expect(existsSync(outputPath)).toBe(true); const content = await readFile(outputPath,  |
| 148 | test<->test | typescript | 11 | src/__tests__/e2e/scrape.e2e.test.ts:141-151 | src/__tests__/e2e/search.e2e.test.ts:185-195 | } ); if (result.exitCode === 0) { const json = parseJSONOutput(result.stdout); expect(json).toBeDefined(); expect(typeof |
| 149 | test<->test | typescript | 11 | src/__tests__/e2e/scrape.e2e.test.ts:229-239 | src/__tests__/e2e/search.e2e.test.ts:144-154 | ], { env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' }, timeout: 60000, }); if (result.exitCode === 0) { expect(result.st |
| 150 | test<->test | typescript | 11 | src/__tests__/e2e/scrape.e2e.test.ts:249-259 | src/__tests__/e2e/search.e2e.test.ts:181-191 | ], { env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' }, timeout: 60000, } ); if (result.exitCode === 0) { const json = pa |
| 151 | test<->test | typescript | 11 | src/__tests__/e2e/vector.e2e.test.ts:446-456 | src/__tests__/e2e/vector.e2e.test.ts:347-356 | expect(result.exitCode).toBeDefined(); }); it('should output JSON with --json flag', async () => { if (skipIfNoVectorSer |
| 152 | test<->test | typescript | 11 | src/__tests__/services/qdrant-service.test.ts:200-210 | src/__tests__/services/qdrant-service.test.ts:56-65 | ); }); it('should throw on non-ok response', async () => { vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({  |
| 153 | test<->test | typescript | 11 | src/__tests__/utils/background-embedder.test.ts:23-33 | src/__tests__/utils/webhook-status.integration.test.ts:10-20 | ; vi.mock('../../utils/config', () => ({ getConfig: vi.fn().mockReturnValue({ teiUrl: 'http://tei:8080', qdrantUrl: 'htt |
| 154 | test<->test | typescript | 11 | src/__tests__/utils/output.test.ts:416-426 | src/__tests__/utils/output.test.ts:234-244 | , () => { vi.mocked(fs.existsSync).mockReturnValue(true); handleScrapeOutput( { success: true, data: { screenshot: 'http |
| 155 | prod cross-file | typescript | 10 | src/commands/history.ts:233-242 | src/commands/sources.ts:192-201 | domain: options.domain, source: options.source, limit: options.limit, collection: options.collection, output: options.ou |
| 156 | prod cross-file | typescript | 10 | src/container/types.ts:121-130 | src/container/services/HttpClient.ts:31-40 | fetchWithRetry( url: string, init?: RequestInit, options?: { timeoutMs?: number; maxRetries?: number; baseDelayMs?: numb |
| 157 | prod cross-file | typescript | 10 | src/container/types.ts:276-285 | src/container/services/EmbedPipeline.ts:132-57 | autoEmbed( content: string, metadata: { url: string; title?: string; sourceCommand?: string; contentType?: string; [key: |
| 158 | prod intra-file | typescript | 10 | src/commands/config.ts:238-247 | src/commands/config.ts:101-110 | : string): void { if (key !== 'exclude-paths' && key !== 'exclude-extensions') { console.error(fmt.error(`Unknown settin |
| 159 | prod intra-file | typescript | 10 | src/commands/query.ts:122-131 | src/commands/query.ts:94-103 | (items: QueryResultItem[]): string { if (items.length === 0) return fmt.dim("No results found."); const lines: string[]  |
| 160 | prod intra-file | typescript | 10 | src/container/services/QdrantService.ts:473-482 | src/container/services/QdrantService.ts:224-233 | ) { body.filter = { must: Object.entries(filter).map(([key, value]) => ({ key, match: { value }, })), }; } if |
| 161 | prod intra-file | typescript | 10 | src/utils/output.ts:315-324 | src/utils/output.ts:263-271 | ); } catch (error) { jsonContent = JSON.stringify({ error: 'Failed to serialize response', message: error instanceof Err |
| 162 | test<->test | typescript | 10 | src/__tests__/commands/crawl/embed.test.ts:126-135 | src/__tests__/commands/crawl/embed.test.ts:95-104 | ); vi.doMock('../../../utils/embed-queue', () => ({ enqueueEmbedJob: mockEnqueueEmbedJob, })); const consoleError = vi . |
| 163 | test<->test | typescript | 10 | src/__tests__/commands/crawl/polling.test.ts:235-244 | src/__tests__/commands/crawl/polling.test.ts:221-230 | , async () => { const mockClient = { getCrawlStatus: vi.fn(), }; const container = createContainer(mockClient); await ex |
| 164 | test<->test | typescript | 10 | src/__tests__/commands/crawl/polling.test.ts:249-258 | src/__tests__/commands/crawl/polling.test.ts:221-230 | , async () => { const mockClient = { getCrawlStatus: vi.fn(), }; const container = createContainer(mockClient); await ex |
| 165 | test<->test | typescript | 10 | src/__tests__/commands/crawl/polling.test.ts:263-272 | src/__tests__/commands/crawl/polling.test.ts:221-230 | , async () => { const mockClient = { getCrawlStatus: vi.fn(), }; const container = createContainer(mockClient); await ex |
| 166 | test<->test | typescript | 10 | src/__tests__/commands/embed.test.ts:89-98 | src/__tests__/commands/query.test.ts:55-64 | teiUrl: 'http://localhost:52000', qdrantUrl: 'http://localhost:53333', qdrantCollection: 'test_col', }); // Override ser |
| 167 | test<->test | typescript | 10 | src/__tests__/commands/extract.test.ts:160-169 | src/__tests__/commands/extract.test.ts:28-37 | mockContainer = { config: { apiKey: 'test-api-key', apiUrl: 'https://api.firecrawl.dev', teiUrl: 'http://localhost:53001 |
| 168 | test<->test | typescript | 10 | src/__tests__/commands/map.test.ts:429-438 | src/__tests__/commands/map.test.ts:405-414 | ]); const container = createContainer(mockClient); const result = await executeMap(container, { urlOrJobId: 'https://exa |
| 169 | test<->test | typescript | 10 | src/__tests__/commands/map.test.ts:458-467 | src/__tests__/commands/map.test.ts:444-453 | ), }; const container = createContainer(mockClient); const result = await executeMap(container, { urlOrJobId: 'https://e |
| 170 | test<->test | typescript | 10 | src/__tests__/commands/query.test.ts:62-71 | src/__tests__/commands/retrieve.test.ts:44-53 | vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService); vi.clearAllMocks(); }); afterEach(() => { vi |
| 171 | test<->test | typescript | 10 | src/__tests__/commands/scrape.test.ts:48-57 | src/__tests__/commands/search.test.ts:49-58 | : vi.fn(), } as unknown as IContainer; }); afterEach(() => { vi.clearAllMocks(); }); describe('API call generation', ()  |
| 172 | test<->test | typescript | 10 | src/__tests__/commands/scrape.test.ts:269-278 | src/__tests__/commands/search.test.ts:698-707 | , async () => { const formatList: Array<'markdown' \| 'html' \| 'rawHtml' \| 'links'> = [ 'markdown', 'html', 'rawHtml', 'l |
| 173 | test<->test | typescript | 10 | src/__tests__/commands/search.test.ts:511-520 | src/__tests__/commands/search.test.ts:479-488 | , }; mockClient.search.mockResolvedValue(mockResponse); const result = await executeSearch(mockContainer, { query: 'test |
| 174 | test<->test | typescript | 10 | src/__tests__/commands/search.test.ts:526-535 | src/__tests__/commands/search.test.ts:479-488 | , }; mockClient.search.mockResolvedValue(mockResponse); const result = await executeSearch(mockContainer, { query: 'test |
| 175 | test<->test | typescript | 10 | src/__tests__/commands/search.test.ts:541-550 | src/__tests__/commands/search.test.ts:479-488 | , }; mockClient.search.mockResolvedValue(mockResponse); const result = await executeSearch(mockContainer, { query: 'test |
| 176 | test<->test | typescript | 10 | src/__tests__/commands/status-command.test.ts:587-596 | src/__tests__/commands/status-command.test.ts:351-330 | , }, ]); const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); await handleJobStatusCommand(container, { |
| 177 | test<->test | typescript | 10 | src/__tests__/commands/status-command.test.ts:764-773 | src/__tests__/commands/status-command.test.ts:701-639 | , data: [], }) ); await handleJobStatusCommand(container, { json: true }); const output = vi.mocked(writeOutput).mock.ca |
| 178 | test<->test | typescript | 10 | src/__tests__/commands/status-command.test.ts:893-902 | src/__tests__/commands/status-command.test.ts:322-332 | ], }); const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); await handleJobStatusCommand(container, {}) |
| 179 | test<->test | typescript | 10 | src/__tests__/commands/status-command.test.ts:918-927 | src/__tests__/commands/status-command.test.ts:351-330 | , }, ]); const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); await handleJobStatusCommand(container, { |
| 180 | test<->test | typescript | 10 | src/__tests__/commands/status-command.test.ts:946-955 | src/__tests__/commands/status-command.test.ts:352-361 | }, ]); const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); await handleJobStatusCommand(container, {}) |
| 181 | test<->test | typescript | 10 | src/__tests__/container/services/TeiService.test.ts:388-397 | src/__tests__/container/services/TeiService.test.ts:349-358 | ; return { ok: true, json: () => Promise.resolve(Array(24).fill([0.1])), } as Response; } ); const texts = Array.from({  |
| 182 | test<->test | typescript | 10 | src/__tests__/e2e/extract.e2e.test.ts:268-277 | src/__tests__/e2e/extract.e2e.test.ts:160-169 | , async () => { if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) { return; } const schema = JSON.stringify({ t |
| 183 | test<->test | typescript | 10 | src/__tests__/services/qdrant-service.test.ts:166-175 | src/__tests__/services/qdrant-service.test.ts:142-151 | ); }); it('should throw on non-ok response', async () => { vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({  |
| 184 | test<->test | typescript | 10 | src/__tests__/services/qdrant-service.test.ts:226-235 | src/__tests__/services/qdrant-service.test.ts:197-206 | , }), expect.any(Object) ); }); it('should throw on non-ok response', async () => { vi.mocked(mockHttpClient.fetchWithRe |
| 185 | test<->test | typescript | 10 | src/__tests__/services/qdrant-service.test.ts:229-238 | src/__tests__/services/qdrant-service.test.ts:142-151 | ); }); it('should throw on non-ok response', async () => { vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({  |
| 186 | test<->test | typescript | 10 | src/__tests__/utils/auth.test.ts:21-30 | src/__tests__/utils/config.test.ts:21-32 | vi.clearAllMocks(); // Clear env vars delete process.env.FIRECRAWL_API_KEY; delete process.env.FIRECRAWL_API_URL; // Moc |
| 187 | test<->test | typescript | 10 | src/__tests__/utils/background-embedder.test.ts:533-542 | src/__tests__/utils/background-embedder.test.ts:505-515 | , async () => { const consoleErrorSpy = vi .spyOn(console, 'error') .mockImplementation(() => {}); const { logEmbedderCo |
| 188 | test<->test | typescript | 10 | src/__tests__/utils/output.test.ts:371-380 | src/__tests__/utils/output.test.ts:300-309 | , () => { vi.mocked(fs.existsSync).mockReturnValue(true); handleScrapeOutput( { success: true, data: { markdown: '# Test |
| 189 | prod cross-file | typescript | 9 | src/commands/delete.ts:27-35 | src/commands/stats.ts:33-41 | > { try { const qdrantUrl = container.config.qdrantUrl; const collection = resolveCollectionName(container, options.coll |
| 190 | prod cross-file | typescript | 9 | src/commands/domains.ts:31-39 | src/commands/stats.ts:33-41 | > { try { const qdrantUrl = container.config.qdrantUrl; const collection = resolveCollectionName(container, options.coll |
| 191 | prod cross-file | typescript | 9 | src/commands/history.ts:32-40 | src/commands/stats.ts:33-41 | > { try { const qdrantUrl = container.config.qdrantUrl; const collection = resolveCollectionName(container, options.coll |
| 192 | prod cross-file | typescript | 9 | src/commands/info.ts:29-37 | src/commands/stats.ts:33-41 | > { try { const qdrantUrl = container.config.qdrantUrl; const collection = resolveCollectionName(container, options.coll |
| 193 | prod cross-file | typescript | 9 | src/commands/retrieve.ts:23-31 | src/commands/stats.ts:33-41 | > { try { const qdrantUrl = container.config.qdrantUrl; const collection = resolveCollectionName(container, options.coll |
| 194 | prod cross-file | typescript | 9 | src/commands/sources.ts:28-36 | src/commands/stats.ts:33-41 | > { try { const qdrantUrl = container.config.qdrantUrl; const collection = resolveCollectionName(container, options.coll |
| 195 | prod intra-file | typescript | 9 | src/commands/batch.ts:395-403 | src/commands/batch.ts:377-385 | ) .argument("<job-id>", "Batch job ID") .option("-o, --output <path>", "Output file path (default: stdout)") .option("-- |
| 196 | prod intra-file | typescript | 9 | src/commands/batch.ts:413-421 | src/commands/batch.ts:377-385 | ) .argument("<job-id>", "Batch job ID") .option("-o, --output <path>", "Output file path (default: stdout)") .option("-- |
| 197 | prod intra-file | typescript | 9 | src/commands/completion.ts:240-248 | src/commands/completion.ts:176-184 | (shell: string): void { const rcPath = getShellRcPath(shell); if (!rcPath) { console.error(fmt.error(`Unsupported shell: |
| 198 | prod intra-file | typescript | 9 | src/commands/crawl/command.ts:232-240 | src/commands/crawl/command.ts:203-212 | (container, jobId); if (!result.success) { console.error(fmt.error(result.error \|\| "Unknown error occurred")); process.e |
| 199 | prod intra-file | typescript | 9 | src/container/services/QdrantService.ts:349-357 | src/container/services/QdrantService.ts:182-190 | : string): Promise<void> { const response = await this.httpClient.fetchWithRetry( `${this.qdrantUrl}/collections/${colle |
| 200 | prod intra-file | typescript | 9 | src/container/services/QdrantService.ts:377-385 | src/container/services/QdrantService.ts:351-359 | , { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filter: { must: [{ key: 'dom |
| 201 | prod intra-file | typescript | 9 | src/container/services/QdrantService.ts:460-468 | src/container/services/QdrantService.ts:275-283 | [] = []; let offset: string \| number \| null = null; let isFirstPage = true; while (isFirstPage \|\| offset !== null) { isF |
| 202 | prod intra-file | typescript | 9 | src/container/services/QdrantService.ts:557-565 | src/container/services/QdrantService.ts:375-383 | : string): Promise<number> { const response = await this.httpClient.fetchWithRetry( `${this.qdrantUrl}/collections/${col |
| 203 | prod intra-file | typescript | 9 | src/container/services/QdrantService.ts:559-567 | src/container/services/QdrantService.ts:184-192 | , { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filter: { must: [{ key: 'url |
| 204 | prod intra-file | typescript | 9 | src/container/services/QdrantService.ts:586-594 | src/container/services/QdrantService.ts:182-190 | : string): Promise<void> { const response = await this.httpClient.fetchWithRetry( `${this.qdrantUrl}/collections/${colle |
| 205 | test<->test | typescript | 9 | src/__tests__/commands/crawl/embed.test.ts:8-16 | src/__tests__/commands/crawl/status.test.ts:6-14 | ; import { resetTeiCache } from '../../../utils/embeddings'; import { resetQdrantCache } from '../../../utils/qdrant'; i |
| 206 | test<->test | typescript | 9 | src/__tests__/commands/crawl/embed.test.ts:354-362 | src/__tests__/commands/crawl/embed.test.ts:248-256 | , async () => { const mockProcessEmbedQueue = vi.fn(); const mockEnqueueEmbedJob = vi.fn().mockResolvedValue(undefined); |
| 207 | test<->test | typescript | 9 | src/__tests__/commands/crawl/execute.test.ts:197-205 | src/__tests__/commands/crawl/execute.test.ts:104-111 | , url: 'https://example.com', }), }; const container = createContainer(mockClient); vi.mocked(isJobId).mockReturnValue(f |
| 208 | test<->test | typescript | 9 | src/__tests__/commands/delete.test.ts:152-160 | src/__tests__/commands/delete.test.ts:108-116 | , yes: true, }; const result = await executeDelete(mockContainer, options); expect(result.success).toBe(true); expect(re |
| 209 | test<->test | typescript | 9 | src/__tests__/commands/delete.test.ts:196-204 | src/__tests__/commands/delete.test.ts:108-116 | , yes: true, }; const result = await executeDelete(mockContainer, options); expect(result.success).toBe(true); expect(re |
| 210 | test<->test | typescript | 9 | src/__tests__/commands/extract.test.ts:110-118 | src/__tests__/commands/extract.test.ts:98-106 | ); const result = await executeExtract(mockContainer, { urls: ['https://example.com'], prompt: 'test', }); expect(result |
| 211 | test<->test | typescript | 9 | src/__tests__/commands/map.test.ts:13-21 | src/__tests__/commands/status-command.test.ts:13-21 | ; import { resetQdrantCache } from '../../utils/qdrant'; import type { MockFirecrawlClient } from '../utils/mock-client' |
| 212 | test<->test | typescript | 9 | src/__tests__/commands/map.test.ts:228-236 | src/__tests__/commands/map.test.ts:182-190 | , async () => { const mockHttpClient = { fetchWithTimeout: mockFetchResponse({ links: [] }), fetchWithRetry: vi.fn(), }; |
| 213 | test<->test | typescript | 9 | src/__tests__/commands/search.test.ts:497-505 | src/__tests__/commands/search.test.ts:480-488 | ; mockClient.search.mockResolvedValue(mockResponse); const result = await executeSearch(mockContainer, { query: 'test',  |
| 214 | test<->test | typescript | 9 | src/__tests__/commands/status-command.test.ts:464-472 | src/__tests__/commands/status-command.test.ts:322-330 | ], }); const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); await handleJobStatusCommand(container, {}) |
| 215 | test<->test | typescript | 9 | src/__tests__/commands/status-command.test.ts:631-639 | src/__tests__/commands/status-command.test.ts:280-288 | , }, ]); await handleJobStatusCommand(container, { json: true }); const output = vi.mocked(writeOutput).mock.calls[0]?.[ |
| 216 | test<->test | typescript | 9 | src/__tests__/commands/status-command.test.ts:669-677 | src/__tests__/commands/status-command.test.ts:280-639 | , }, ]); await handleJobStatusCommand(container, { json: true }); const output = vi.mocked(writeOutput).mock.calls[0]?.[ |
| 217 | test<->test | typescript | 9 | src/__tests__/commands/status-command.test.ts:782-790 | src/__tests__/commands/status-command.test.ts:300-308 | , async () => { const { listEmbedJobs } = await import('../../utils/embed-queue'); vi.mocked(listEmbedJobs).mockResolved |
| 218 | test<->test | typescript | 9 | src/__tests__/container/services/TeiService.test.ts:308-316 | src/__tests__/container/services/TeiService.test.ts:164-171 | const advanceTimers = async () => { await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(30000); // R |
| 219 | test<->test | typescript | 9 | src/__tests__/container/services/TeiService.test.ts:475-483 | src/__tests__/container/services/TeiService.test.ts:416-424 | )) .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([[0.1]]), } as Response); const promise = service.embe |
| 220 | test<->test | typescript | 9 | src/__tests__/e2e/map.e2e.test.ts:58-66 | src/__tests__/e2e/scrape.e2e.test.ts:59-67 | expect(result.stderr).not.toContain('URL is required'); }); it('should accept URL with --url flag', async () => { if (sk |
| 221 | test<->test | typescript | 9 | src/__tests__/e2e/status.e2e.test.ts:206-214 | src/__tests__/e2e/status.e2e.test.ts:156-164 | , async () => { const result = await runCLISuccess(['--status'], { env: { FIRECRAWL_API_KEY: '', }, }); expect(result.st |
| 222 | test<->test | typescript | 9 | src/__tests__/utils/embed-queue.test.ts:120-128 | src/__tests__/utils/embed-queue.test.ts:51-59 | , retries: 0, maxRetries: 3, createdAt: new Date(now - 20 * 60_000).toISOString(), updatedAt: new Date(now - 20 * 60_000 |
| 223 | test<->test | typescript | 9 | src/__tests__/utils/embed-queue.test.ts:326-334 | src/__tests__/utils/embed-queue.test.ts:302-310 | , retries: 0, maxRetries: 3, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), }; writeFil |
| 224 | test<->test | typescript | 9 | src/__tests__/utils/embedpipeline.test.ts:215-223 | src/__tests__/utils/embedpipeline.test.ts:111-120 | , }); vi.mocked(embeddings.getTeiInfo).mockResolvedValue({ modelId: 'test', dimension: 1024, maxInput: 32768, }); vi.moc |
| 225 | test<->test | typescript | 9 | src/__tests__/utils/output.test.ts:359-367 | src/__tests__/utils/output.test.ts:268-276 | }, }, }, ['markdown', 'links'] ); const output = stdoutWriteSpy.mock.calls[0][0]; const parsed = JSON.parse(output); exp |
| 226 | test<->test | typescript | 9 | src/__tests__/utils/polling.test.ts:219-227 | src/__tests__/utils/polling.test.ts:47-55 | , async () => { const statusFetcher = vi.fn(async () => ({ status: 'processing' })); await expect( pollWithProgress({ jo |
| 227 | test<->test | typescript | 9 | src/__tests__/utils/polling.test.ts:234-242 | src/__tests__/utils/polling.test.ts:47-55 | , async () => { const statusFetcher = vi.fn(async () => ({ status: 'processing' })); await expect( pollWithProgress({ jo |
| 228 | test<->test | typescript | 9 | src/__tests__/utils/qdrant.test.ts:233-241 | src/__tests__/utils/qdrant.test.ts:207-215 | , async () => { // First page mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: { points: [ { id: |
| 229 | test<->test | typescript | 9 | src/__tests__/utils/qdrant.test.ts:338-346 | src/__tests__/utils/qdrant.test.ts:140-150 | ); expect(mockFetch).toHaveBeenCalledWith( `${qdrantUrl}/collections/${collection}/points/delete`, expect.objectContaini |
| 230 | test<->test | typescript | 9 | src/__tests__/utils/webhook-status.integration.test.ts:95-103 | src/__tests__/utils/webhook-status.integration.test.ts:85-93 | , status: 'pending', retries: 0, maxRetries: 3, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOSt |
| 231 | prod intra-file | typescript | 8 | src/commands/batch.ts:229-236 | src/commands/batch.ts:185-192 | ( container: IContainer, jobId: string, options: { output?: string; json?: boolean; pretty?: boolean }, ): Promise<void> |
| 232 | prod intra-file | typescript | 8 | src/commands/batch.ts:266-273 | src/commands/batch.ts:185-192 | ( container: IContainer, jobId: string, options: { output?: string; json?: boolean; pretty?: boolean }, ): Promise<void> |
| 233 | prod intra-file | typescript | 8 | src/utils/background-embedder.ts:516-523 | src/utils/background-embedder.ts:507-515 | void processStaleJobsOnce(container, staleMs).catch((error) => { console.error( fmt.error( `[Embedder] Failed to process |
| 234 | test<->test | typescript | 8 | src/__tests__/commands/crawl-embed-config.test.ts:36-43 | src/__tests__/utils/background-embedder.test.ts:142-149 | , url: 'https://example.com', status: 'pending', retries: 0, maxRetries: 3, createdAt: new Date().toISOString(), updated |
| 235 | test<->test | typescript | 8 | src/__tests__/commands/crawl/command.test.ts:109-116 | src/__tests__/commands/crawl/command.test.ts:67-74 | , async () => { const container = createTestContainer(); const mockExit = vi .spyOn(process, "exit") .mockImplementation |
| 236 | test<->test | typescript | 8 | src/__tests__/commands/crawl/embed.test.ts:50-57 | src/__tests__/commands/crawl/embed.test.ts:38-45 | , () => { const webhookConfig = { url: 'https://webhook.example.com' }; vi.mocked(buildEmbedderWebhookConfig).mockReturn |
| 237 | test<->test | typescript | 8 | src/__tests__/commands/crawl/embed.test.ts:62-69 | src/__tests__/commands/crawl/embed.test.ts:38-45 | , () => { const webhookConfig = { url: 'https://webhook.example.com' }; vi.mocked(buildEmbedderWebhookConfig).mockReturn |
| 238 | test<->test | typescript | 8 | src/__tests__/commands/crawl/execute.test.ts:337-344 | src/__tests__/commands/crawl/execute.test.ts:109-116 | ); vi.mocked(isJobId).mockReturnValue(false); vi.mocked(buildCrawlOptions).mockReturnValue({ limit: 10 } as never); vi.m |
| 239 | test<->test | typescript | 8 | src/__tests__/commands/crawl/execute.test.ts:364-371 | src/__tests__/commands/crawl/execute.test.ts:104-111 | , url: 'https://example.com', }), }; const container = createContainer(mockClient); vi.mocked(isJobId).mockReturnValue(f |
| 240 | test<->test | typescript | 8 | src/__tests__/commands/crawl/status.test.ts:158-165 | src/__tests__/commands/crawl/status.test.ts:106-113 | , async () => { const mockClient = { cancelCrawl: vi.fn().mockResolvedValue(true), }; const container = createContainer( |
| 241 | test<->test | typescript | 8 | src/__tests__/commands/embed.test.ts:53-60 | src/__tests__/commands/query.test.ts:21-28 | // Create mock TEI service mockTeiService = { getTeiInfo: vi.fn().mockResolvedValue({ modelId: 'test', dimension: 1024,  |
| 242 | test<->test | typescript | 8 | src/__tests__/commands/extract.test.ts:169-176 | src/__tests__/commands/search.test.ts:45-51 | ), getHttpClient: vi.fn(), getTeiService: vi.fn(), getQdrantService: vi.fn(), dispose: vi.fn(), } as unknown as IContain |
| 243 | test<->test | typescript | 8 | src/__tests__/commands/search.test.ts:289-296 | src/__tests__/commands/search.test.ts:246-253 | , async () => { const mockResponse = { web: [{ url: 'https://example.com', markdown: '# Test' }], }; mockClient.search.m |
| 244 | test<->test | typescript | 8 | src/__tests__/commands/status-command.test.ts:339-346 | src/__tests__/commands/status-command.test.ts:259-266 | , async () => { const { listEmbedJobs } = await import('../../utils/embed-queue'); vi.mocked(listEmbedJobs).mockResolved |
| 245 | test<->test | typescript | 8 | src/__tests__/commands/status-command.test.ts:353-360 | src/__tests__/commands/status-command.test.ts:323-330 | ); const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); await handleJobStatusCommand(container, {}); co |
| 246 | test<->test | typescript | 8 | src/__tests__/commands/status-command.test.ts:367-374 | src/__tests__/commands/status-command.test.ts:300-307 | , async () => { const { listEmbedJobs } = await import('../../utils/embed-queue'); vi.mocked(listEmbedJobs).mockResolved |
| 247 | test<->test | typescript | 8 | src/__tests__/commands/status-command.test.ts:434-441 | src/__tests__/commands/status-command.test.ts:323-330 | }); const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); await handleJobStatusCommand(container, {}); c |
| 248 | test<->test | typescript | 8 | src/__tests__/commands/status-command.test.ts:502-509 | src/__tests__/commands/status-command.test.ts:92-139 | , async () => { const { getRecentJobIds } = await import('../../utils/job-history'); vi.mocked(getRecentJobIds).mockImpl |
| 249 | test<->test | typescript | 8 | src/__tests__/commands/status-command.test.ts:610-617 | src/__tests__/commands/status-command.test.ts:556-563 | , async () => { const { listEmbedJobs } = await import('../../utils/embed-queue'); vi.mocked(listEmbedJobs).mockResolved |
| 250 | test<->test | typescript | 8 | src/__tests__/commands/status-command.test.ts:646-653 | src/__tests__/commands/status-command.test.ts:556-563 | , async () => { const { listEmbedJobs } = await import('../../utils/embed-queue'); vi.mocked(listEmbedJobs).mockResolved |
| 251 | test<->test | typescript | 8 | src/__tests__/commands/status-command.test.ts:907-914 | src/__tests__/commands/status-command.test.ts:259-266 | , async () => { const { listEmbedJobs } = await import('../../utils/embed-queue'); vi.mocked(listEmbedJobs).mockResolved |
| 252 | test<->test | typescript | 8 | src/__tests__/container/services/EmbedPipeline.test.ts:328-335 | src/__tests__/container/services/EmbedPipeline.test.ts:306-313 | , async () => { let concurrentCalls = 0; let maxConcurrent = 0; vi.mocked(mockTeiService.embedChunks).mockImplementation |
| 253 | test<->test | typescript | 8 | src/__tests__/container/services/TeiService.test.ts:194-201 | src/__tests__/container/services/TeiService.test.ts:125-132 | 0.5, 0.6], ]; vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({ ok: true, json: () => Promise.resolve(mockEmb |
| 254 | test<->test | typescript | 8 | src/__tests__/container/services/TeiService.test.ts:345-352 | src/__tests__/container/services/TeiService.test.ts:326-333 | , async () => { let capturedTimeout: number \| undefined; vi.mocked(mockHttpClient.fetchWithRetry).mockImplementation( as |
| 255 | test<->test | typescript | 8 | src/__tests__/container/services/TeiService.test.ts:364-371 | src/__tests__/container/services/TeiService.test.ts:326-333 | , async () => { let capturedTimeout: number \| undefined; vi.mocked(mockHttpClient.fetchWithRetry).mockImplementation( as |
| 256 | test<->test | typescript | 8 | src/__tests__/e2e/crawl.e2e.test.ts:9-16 | src/__tests__/e2e/scrape.e2e.test.ts:9-16 | import { existsSync } from 'node:fs'; import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; imp |
| 257 | test<->test | typescript | 8 | src/__tests__/e2e/extract.e2e.test.ts:113-120 | src/__tests__/e2e/search.e2e.test.ts:121-128 | , '--help']); expect(result.stdout).toContain('--no-embed'); }); }); describe('output options', () => { it('should suppo |
| 258 | test<->test | typescript | 8 | src/__tests__/e2e/map.e2e.test.ts:133-140 | src/__tests__/e2e/search.e2e.test.ts:144-151 | ], { env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' }, timeout: 60000, }); if (result.exitCode === 0) { expect(result.st |
| 259 | test<->test | typescript | 8 | src/__tests__/utils/auth.test.ts:104-111 | src/__tests__/utils/auth.test.ts:95-103 | vi.mocked(credentials.loadCredentials).mockReturnValue({ apiKey: 'fc-stored-key', }); initializeConfig({}); expect(isAut |
| 260 | test<->test | typescript | 8 | src/__tests__/utils/embed-queue.test.ts:177-184 | src/__tests__/utils/embed-queue.test.ts:137-144 | , null, 2) ); const { getStuckProcessingJobs } = await import('../../utils/embed-queue'); const stuck = await getStuckPr |
| 261 | test<->test | typescript | 8 | src/__tests__/utils/embed-queue.test.ts:471-478 | src/__tests__/utils/embed-queue.test.ts:451-458 | as const, retries: 0, maxRetries: 3, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), },  |
| 262 | test<->test | typescript | 8 | src/__tests__/utils/qdrant.test.ts:93-100 | src/__tests__/utils/qdrant.test.ts:31-38 | , async () => { mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: { status: 'green' } }), }); awa |
| 263 | test<->test | typescript | 8 | src/__tests__/utils/qdrant.test.ts:383-390 | src/__tests__/utils/qdrant.test.ts:341-348 | , expect.objectContaining({ method: 'POST', body: JSON.stringify({ filter: { must: [{ key: 'domain', match: { value: 'do |
| 264 | test<->test | typescript | 8 | src/__tests__/utils/webhook-status.integration.test.ts:194-201 | src/__tests__/utils/webhook-status.integration.test.ts:146-153 | await new Promise((resolve) => setTimeout(resolve, 100)); // Make request to status endpoint const response = await fetc |
| 265 | prod cross-file | typescript | 7 | src/commands/domains.ts:51-57 | src/commands/stats.ts:54-59 | } >(); for (const point of points) { const domain = String(point.payload.domain \|\| "unknown"); const url = String(point. |
| 266 | prod intra-file | typescript | 7 | src/container/services/QdrantService.ts:531-537 | src/container/services/QdrantService.ts:375-382 | : string): Promise<number> { const response = await this.httpClient.fetchWithRetry( `${this.qdrantUrl}/collections/${col |
| 267 | test<->test | typescript | 7 | src/__tests__/commands/crawl/options.test.ts:489-495 | src/__tests__/commands/crawl/options.test.ts:93-99 | expect(result.excludePaths).toContain("/admin"); expect(result.excludePaths).toContain("/api"); expect(result.excludePat |
| 268 | test<->test | typescript | 7 | src/__tests__/commands/crawl/polling.test.ts:144-150 | src/__tests__/commands/crawl/polling.test.ts:104-110 | ) \| undefined; const mockClient = { getCrawlStatus: vi.fn() }; const container = createContainer(mockClient); vi.mocked( |
| 269 | test<->test | typescript | 7 | src/__tests__/commands/history.test.ts:272-278 | src/__tests__/commands/history.test.ts:206-212 | }; const result = await executeHistory(mockContainer, options); expect(result.success).toBe(true); expect(result.data?.e |
| 270 | test<->test | typescript | 7 | src/__tests__/commands/map.test.ts:208-214 | src/__tests__/commands/map.test.ts:182-188 | , async () => { const mockHttpClient = { fetchWithTimeout: mockFetchResponse({ links: [] }), fetchWithRetry: vi.fn(), }; |
| 271 | test<->test | typescript | 7 | src/__tests__/commands/status-command.test.ts:493-499 | src/__tests__/commands/status-command.test.ts:282-288 | ); await handleJobStatusCommand(container, { json: true }); const output = vi.mocked(writeOutput).mock.calls[0]?.[0]; co |
| 272 | test<->test | typescript | 7 | src/__tests__/commands/status-command.test.ts:704-710 | src/__tests__/commands/status-command.test.ts:282-639 | ); await handleJobStatusCommand(container, { json: true }); const output = vi.mocked(writeOutput).mock.calls[0]?.[0]; co |
| 273 | test<->test | typescript | 7 | src/__tests__/e2e/vector.e2e.test.ts:258-264 | src/__tests__/e2e/vector.e2e.test.ts:114-121 | ], { env: { TEI_URL: process.env.TEI_URL \|\| '', QDRANT_URL: process.env.QDRANT_URL \|\| '', }, }); expect(result.stderr).n |
| 274 | test<->test | typescript | 7 | src/__tests__/e2e/vector.e2e.test.ts:402-408 | src/__tests__/e2e/vector.e2e.test.ts:114-121 | ], { env: { TEI_URL: process.env.TEI_URL \|\| '', QDRANT_URL: process.env.QDRANT_URL \|\| '', }, }); expect(result.stderr).n |
| 275 | test<->test | typescript | 7 | src/__tests__/services/qdrant-service.test.ts:93-99 | src/__tests__/services/qdrant-service.test.ts:72-79 | , async () => { vi.mocked(mockHttpClient.fetchWithRetry).mockResolvedValue({ ok: true, json: () => Promise.resolve({ res |
| 276 | test<->test | typescript | 7 | src/__tests__/utils/embed-queue.test.ts:100-106 | src/__tests__/utils/embed-queue.test.ts:31-37 | , retries: 0, maxRetries: 3, createdAt: new Date(now - 10 * 60_000).toISOString(), updatedAt: new Date(now - 10 * 60_000 |
| 277 | test<->test | typescript | 7 | src/__tests__/utils/embed-queue.test.ts:110-116 | src/__tests__/utils/embed-queue.test.ts:41-47 | , retries: 0, maxRetries: 3, createdAt: new Date(now - 1 * 60_000).toISOString(), updatedAt: new Date(now - 1 * 60_000). |
| 278 | test<->test | typescript | 7 | src/__tests__/utils/embed-queue.test.ts:194-200 | src/__tests__/utils/embed-queue.test.ts:32-37 | , maxRetries: 3, createdAt: new Date(now - 10 * 60_000).toISOString(), updatedAt: new Date(now - 10 * 60_000).toISOStrin |
| 279 | test<->test | typescript | 7 | src/__tests__/utils/embedpipeline.test.ts:260-266 | src/__tests__/utils/embedpipeline.test.ts:85-92 | vi.mocked(embeddings.getTeiInfo).mockResolvedValue({ modelId: 'test', dimension: 1024, maxInput: 32768, }); vi.mocked(qd |
| 280 | prod intra-file | typescript | 6 | src/commands/crawl/command.ts:452-457 | src/commands/crawl/command.ts:439-444 | ) .option("-o, --output <path>", "Output file path (default: stdout)") .option("--pretty", "Pretty print JSON output", f |
| 281 | prod intra-file | typescript | 6 | src/commands/crawl/command.ts:465-470 | src/commands/crawl/command.ts:439-444 | ) .option("-o, --output <path>", "Output file path (default: stdout)") .option("--pretty", "Pretty print JSON output", f |
| 282 | test<->test | typescript | 6 | src/__tests__/commands/history.test.ts:156-161 | src/__tests__/commands/history.test.ts:127-132 | }; const result = await executeHistory(mockContainer, options); expect(result.success).toBe(true); expect(result.data?.e |
| 283 | test<->test | typescript | 6 | src/__tests__/commands/sources.test.ts:21-26 | src/__tests__/commands/stats.test.ts:21-26 | ), upsertPoints: vi.fn(), queryPoints: vi.fn(), scrollByUrl: vi.fn(), scrollAll: vi.fn().mockResolvedValue([]), getColle |
| 284 | test<->test | typescript | 6 | src/__tests__/commands/status-command.test.ts:684-689 | src/__tests__/commands/status-command.test.ts:92-95 | , async () => { const { getRecentJobIds } = await import('../../utils/job-history'); vi.mocked(getRecentJobIds).mockImpl |
| 285 | test<->test | typescript | 6 | src/__tests__/container/services/EmbedPipeline.test.ts:340-345 | src/__tests__/container/services/EmbedPipeline.test.ts:318-323 | }, (_, i) => ({ content: `content ${i}`, metadata: { url: `https://example${i}.com` }, })); await pipeline.batchEmbed(it |
| 286 | test<->test | typescript | 6 | src/__tests__/container/services/EmbedPipeline.test.ts:466-471 | src/__tests__/container/services/EmbedPipeline.test.ts:436-441 | , async () => { const consoleSpy = vi.spyOn(console, 'error'); vi.mocked(mockTeiService.embedChunks) .mockResolvedValueO |
| 287 | test<->test | typescript | 6 | src/__tests__/e2e/helpers.ts:102-107 | src/__tests__/e2e/helpers.ts:86-91 | ( args: string[], options: Parameters<typeof runCLI>[1] = {} ): Promise<CLIResult> { const result = await runCLI(args, o |
