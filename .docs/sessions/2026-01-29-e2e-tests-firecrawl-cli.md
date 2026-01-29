# Session: E2E Tests for Firecrawl CLI

**Date**: 2026-01-29
**Duration**: ~30 minutes
**Focus**: Creating comprehensive end-to-end tests for all CLI commands

---

## Session Overview

Created full end-to-end test suite for the Firecrawl CLI, covering all 13 commands. Set up the official Firecrawl test server from the upstream repository and created 186 E2E tests across 8 test files with proper separation from unit tests.

---

## Timeline

### 1. Test Server Setup (07:35)
- Cloned `mendableai/firecrawl` repository to `/tmp/firecrawl`
- Discovered `apps/test-site/` - an Astro-based test website
- Installed dependencies and built the static site
- Started preview server on `http://127.0.0.1:4321`

### 2. Test Infrastructure (07:38)
- Created `src/__tests__/e2e/helpers.ts` with test utilities:
  - `runCLI()` - Execute CLI as subprocess
  - `runCLISuccess()` / `runCLIFailure()` - Assert exit codes
  - `parseJSONOutput()` - Parse JSON from CLI output
  - `isTestServerRunning()` - Health check for test server
  - `hasApiCredentials()` - Check for API key availability
  - `createTempDir()` / `cleanupTempDir()` - Temporary directories

### 3. E2E Test Files Created (07:40-07:44)
- `version.e2e.test.ts` - Version and help commands (17 tests)
- `scrape.e2e.test.ts` - Scrape command (24 tests)
- `crawl.e2e.test.ts` - Crawl command (31 tests)
- `map.e2e.test.ts` - Map command (22 tests)
- `search.e2e.test.ts` - Search command (25 tests)
- `extract.e2e.test.ts` - Extract command (20 tests)
- `config.e2e.test.ts` - Config, login, logout (16 tests)
- `vector.e2e.test.ts` - Embed, query, retrieve (31 tests)

### 4. Configuration Updates (07:44)
- Created `vitest.e2e.config.mjs` with E2E-specific settings
- Updated `vitest.config.mjs` to exclude E2E tests
- Added npm scripts for E2E testing

---

## Key Findings

### Test Server Discovery
- **Location**: `apps/test-site/` in firecrawl repo
- **Framework**: Astro static site generator
- **Default Port**: 4321
- **Content**: 18 pages including blog posts, about page, code blocks
- **Assets**: PDFs, images, JSON files for testing

### Test Server Pages Available
```
/                                          # Homepage
/about/                                    # About page
/blog/                                     # Blog index
/blog/introducing-search-endpoint/         # Blog post
/blog/unicode-post/                        # Unicode test
/blog/category/deep/nested/path/           # Deep nesting test
/code-block/                               # Code syntax test
/sitemap-0.xml                             # Sitemap
```

### Test Categories Identified
1. **No dependencies**: Version, help, argument validation
2. **API key required**: Scrape, crawl, map, search, extract
3. **Test server required**: Integration tests against local pages
4. **Vector services required**: Embed, query, retrieve (TEI + Qdrant)

---

## Technical Decisions

### Separate Config for E2E Tests
**Decision**: Created `vitest.e2e.config.mjs` instead of using same config
**Reasoning**: E2E tests need:
- Longer timeouts (120s vs default)
- Sequential execution to avoid port conflicts
- Different include patterns

### Graceful Skipping
**Decision**: Tests skip with console.log when prerequisites missing
**Reasoning**: Allows partial test runs based on available services:
- No API key → Skip API-dependent tests but run validation tests
- No test server → Skip integration tests but run help tests
- No vector services → Skip embed/query/retrieve

### Subprocess Execution
**Decision**: Run CLI via `spawn('node', [CLI_PATH, ...args])`
**Reasoning**:
- True E2E testing (not mocking)
- Tests actual CLI entry point
- Validates exit codes, stdout, stderr

---

## Files Modified

### Created
| File | Purpose |
|------|---------|
| `src/__tests__/e2e/helpers.ts` | Test utilities and helper functions |
| `src/__tests__/e2e/version.e2e.test.ts` | Version and help command tests |
| `src/__tests__/e2e/scrape.e2e.test.ts` | Scrape command E2E tests |
| `src/__tests__/e2e/crawl.e2e.test.ts` | Crawl command E2E tests |
| `src/__tests__/e2e/map.e2e.test.ts` | Map command E2E tests |
| `src/__tests__/e2e/search.e2e.test.ts` | Search command E2E tests |
| `src/__tests__/e2e/extract.e2e.test.ts` | Extract command E2E tests |
| `src/__tests__/e2e/config.e2e.test.ts` | Config/login/logout E2E tests |
| `src/__tests__/e2e/vector.e2e.test.ts` | Embed/query/retrieve E2E tests |
| `vitest.e2e.config.mjs` | E2E test configuration |

### Modified
| File | Change |
|------|--------|
| `vitest.config.mjs:5` | Added exclude for E2E tests |
| `package.json:22-24` | Added test:e2e, test:e2e:watch, test:all scripts |

---

## Commands Executed

### Test Server Setup
```bash
git clone --depth 1 https://github.com/mendableai/firecrawl.git /tmp/firecrawl
cd /tmp/firecrawl/apps/test-site && pnpm install
pnpm build
nohup pnpm preview --port 4321 --host 127.0.0.1 &
```

### Test Execution
```bash
pnpm build                # Build CLI
pnpm test                 # Unit tests: 328 passed
pnpm test:e2e             # E2E tests: 186 passed
```

---

## Test Coverage Summary

| Command | Tests | Notes |
|---------|-------|-------|
| version | 5 | Version flags, auth status |
| help | 12 | All command help texts |
| scrape | 24 | Input validation, options, output, test server |
| crawl | 31 | Async jobs, sync wait, filters, progress |
| map | 22 | URL mapping, sitemap handling, search filter |
| search | 25 | Query, sources, categories, scrape option |
| extract | 20 | Prompt, schema, multiple URLs |
| config | 10 | Set, get, clear, view-config |
| login/logout | 6 | API key handling, idempotent logout |
| embed | 10 | File, stdin, URL input |
| query | 11 | Semantic search, filters, grouping |
| retrieve | 6 | Document retrieval by URL |

**Total: 186 E2E tests**

---

## Next Steps

1. **CI Integration**: Add E2E tests to GitHub Actions workflow
2. **Test Server Fixture**: Create script to auto-start test server
3. **Mock API Server**: Consider lightweight mock for API tests without real key
4. **Coverage Reporting**: Add E2E coverage to combined report
5. **Performance Benchmarks**: Add timing assertions for critical paths

---

## Running E2E Tests

```bash
# Unit tests only (fast, no dependencies)
pnpm test

# E2E tests only (requires built CLI)
pnpm test:e2e

# Full E2E with API key
TEST_FIRECRAWL_API_KEY=your-key pnpm test:e2e

# Full E2E with all services
TEST_FIRECRAWL_API_KEY=your-key \
  TEI_URL=http://localhost:8080 \
  QDRANT_URL=http://localhost:6333 \
  pnpm test:e2e

# All tests
pnpm test:all
```

---

## Test Server Reference

The Firecrawl test server at `/tmp/firecrawl/apps/test-site/` provides:
- Static Astro site with blog posts
- Sitemap generation
- PDF files for document testing
- Unicode content for encoding tests
- Deeply nested URLs for crawl depth testing
- Code block pages for syntax highlighting tests
