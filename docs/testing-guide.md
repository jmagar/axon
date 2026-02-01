# Firecrawl CLI Testing Guide

**Last Updated**: 2026-01-29
**Version**: 1.1.1

## Table of Contents

- [Overview](#overview)
- [Test Infrastructure](#test-infrastructure)
- [Test Types](#test-types)
- [Running Tests](#running-tests)
- [Test Coverage](#test-coverage)
- [Environment Setup](#environment-setup)
- [Test Architecture](#test-architecture)
- [Writing Tests](#writing-tests)
- [Troubleshooting](#troubleshooting)

---

## Overview

The Firecrawl CLI has a comprehensive test suite with **346 total tests** across unit and end-to-end (e2e) test suites. Tests are designed to run in both isolated (unit) and integrated (e2e) environments.

### Test Statistics

- **Total Tests**: 346
- **Unit Tests**: 140 tests (20 files)
- **E2E Tests**: 206 tests (9 files)
- **Test Coverage**: 85% of CLI commands have e2e tests
- **Average Runtime**: Unit ~800ms, E2E ~22s

---

## Test Infrastructure

### Local Test Server

The e2e tests use a **local Astro test website** instead of live URLs for predictable, reliable testing.

**Server Details**:
- **URL**: `http://127.0.0.1:4321`
- **Location**: `/tmp/firecrawl/apps/test-site`
- **Framework**: Astro v5.16.0
- **Purpose**: Stable, deterministic content for testing

**Test Server Content**:
- Homepage with sample content
- `/about` - About page
- `/blog` - Blog index with multiple posts
- `/blog/*` - Individual blog posts
- Sitemap (`/sitemap-index.xml`)
- RSS feed (`/rss.xml`)

**Starting the Test Server**:
```bash
cd /tmp/firecrawl/apps/test-site
pnpm preview --port 4321 --host 127.0.0.1
```

### Required Services

For full e2e test execution, the following services must be running:

| Service | URL | Purpose | Required For |
|---------|-----|---------|--------------|
| **Firecrawl API** | `http://localhost:53002` | Web scraping API | scrape, crawl, map, search, extract |
| **TEI** | `http://100.74.16.82:52000` | Text embeddings | embed, query, retrieve |
| **Qdrant** | `http://localhost:53333` | Vector database | embed, query, retrieve |
| **Test Server** | `http://127.0.0.1:4321` | Test content | All integration tests |

---

## Test Types

### Unit Tests

**Location**: `src/**/*.test.ts`
**Config**: `vitest.config.mjs`
**Count**: 140 tests in 20 files

**Scope**:
- Individual command logic
- Utility functions (auth, config, credentials, output, etc.)
- Input validation
- Error handling
- Mock external dependencies (Firecrawl SDK, fetch calls)

**Characteristics**:
- **Isolated**: No external services required
- **Fast**: ~800ms total runtime
- **Stubbed Environment**: All env vars explicitly set to `undefined`
- **Mocked Dependencies**: Firecrawl SDK, TEI, Qdrant calls are mocked

**Example Test Files**:
```
src/__tests__/commands/scrape.test.ts
src/__tests__/utils/auth.test.ts
src/__tests__/utils/chunker.test.ts
src/__tests__/utils/embeddings.test.ts
```

### E2E Tests

**Location**: `src/__tests__/e2e/**/*.e2e.test.ts`
**Config**: `vitest.e2e.config.mjs`
**Count**: 206 tests in 9 files

**Scope**:
- Full command execution via spawned CLI process
- Real HTTP calls to local test server
- Integration with TEI, Qdrant, Firecrawl API
- File I/O and output validation
- Signal handling and graceful shutdown

**Characteristics**:
- **Integrated**: Requires running services
- **Slower**: ~20s total runtime
- **Real Execution**: Spawns CLI as subprocess via `node dist/index.js`
- **Isolated Environment**: Clears env vars, passes explicitly

**Test Files**:
```
src/__tests__/e2e/scrape.e2e.test.ts      (24 tests)
src/__tests__/e2e/crawl.e2e.test.ts       (31 tests)
src/__tests__/e2e/map.e2e.test.ts         (22 tests)
src/__tests__/e2e/search.e2e.test.ts      (25 tests)
src/__tests__/e2e/extract.e2e.test.ts     (20 tests)
src/__tests__/e2e/vector.e2e.test.ts      (31 tests - embed, query, retrieve)
src/__tests__/e2e/config.e2e.test.ts      (16 tests)
src/__tests__/e2e/version.e2e.test.ts     (17 tests)
src/__tests__/e2e/status.e2e.test.ts      (20 tests)
```

---

## Running Tests

### Prerequisites

1. **Build the CLI** (required for e2e tests):
   ```bash
   pnpm build
   ```

2. **Start required services** (for full e2e tests):
   ```bash
   # Firecrawl API (if using docker-compose)
   docker compose up -d

   # Test server
   cd /tmp/firecrawl/apps/test-site
   pnpm preview --port 4321 --host 127.0.0.1
   ```

### Test Commands

```bash
# Run all unit tests
pnpm test

# Run unit tests in watch mode
pnpm test:watch

# Run all e2e tests (with env vars)
FIRECRAWL_API_KEY=local-dev \
FIRECRAWL_API_URL=http://localhost:53002 \
TEI_URL=http://100.74.16.82:52000 \
QDRANT_URL=http://localhost:53333 \
pnpm test:e2e

# Run e2e tests in watch mode
pnpm test:e2e:watch

# Run ALL tests (unit + e2e)
pnpm test:all

# Run tests with coverage
pnpm test -- --coverage
```

### Running Specific Tests

```bash
# Run tests matching a pattern
pnpm test scrape

# Run a specific test file
pnpm test src/__tests__/commands/scrape.test.ts

# Run e2e tests for a specific command
FIRECRAWL_API_KEY=local-dev pnpm test:e2e scrape
```

### Environment Variables for E2E Tests

E2E tests require explicit environment variables because `helpers.ts` clears them for test isolation:

```bash
# Minimum for Firecrawl API tests
FIRECRAWL_API_KEY=local-dev \
FIRECRAWL_API_URL=http://localhost:53002 \
pnpm test:e2e

# Full stack (API + vector services)
FIRECRAWL_API_KEY=local-dev \
FIRECRAWL_API_URL=http://localhost:53002 \
TEI_URL=http://100.74.16.82:52000 \
QDRANT_URL=http://localhost:53333 \
pnpm test:e2e
```

**Why env vars are required**: The e2e test helper (`src/__tests__/e2e/helpers.ts`) intentionally clears environment variables to prevent local `.env` files from affecting test results. This ensures tests are reproducible across different environments.

---

## Test Coverage

### Command Coverage

| Command | Unit Tests | E2E Tests | Notes |
|---------|-----------|-----------|-------|
| **scrape** | ✅ | ✅ | 24 e2e tests |
| **crawl** | ✅ | ✅ | 31 e2e tests (async/sync modes) |
| **map** | ✅ | ✅ | 22 e2e tests |
| **search** | ✅ | ✅ | 25 e2e tests |
| **extract** | ✅ | ✅ | 20 e2e tests |
| **embed** | ✅ | ✅ | Part of vector.e2e.test.ts |
| **query** | ✅ | ✅ | Part of vector.e2e.test.ts |
| **retrieve** | ✅ | ✅ | Part of vector.e2e.test.ts |
| **config** | ✅ | ✅ | 16 e2e tests |
| **version** | ❌ | ✅ | 17 e2e tests |
| **status** | ✅ | ✅ | 20 e2e tests (via --status flag) |
| **login** | ✅ | ❌ | Not needed (self-hosted) |
| **logout** | ✅ | ❌ | Not needed (self-hosted) |

**Coverage Summary**:
- **11/13 commands** have e2e tests (85%)
- **13/13 commands** have unit tests (100%)
- **Note**: login/logout e2e tests not needed for self-hosted Firecrawl deployments

### Utility Coverage

All utilities have comprehensive unit tests:
- `auth.ts` - Authentication flow
- `chunker.ts` - Markdown-aware text chunking
- `client.ts` - Firecrawl SDK client
- `config.ts` - Configuration management
- `credentials.ts` - OS credential storage
- `embeddings.ts` - TEI integration
- `embedpipeline.ts` - Embedding orchestration
- `http.ts` - HTTP utilities with retry
- `job.ts` - Job ID detection
- `notebooklm.ts` - NotebookLM integration
- `options.ts` - CLI option parsing
- `output.ts` - Output formatting
- `qdrant.ts` - Qdrant vector database
- `settings.ts` - User settings
- `url.ts` - URL validation

---

## Environment Setup

### Unit Test Environment

Unit tests use **stubbed environment variables** to ensure isolation:

```typescript
// src/__tests__/setup.ts
beforeEach(() => {
  vi.stubEnv('TEI_URL', undefined);
  vi.stubEnv('QDRANT_URL', undefined);
  vi.stubEnv('QDRANT_COLLECTION', undefined);
  vi.stubEnv('FIRECRAWL_API_KEY', undefined);
  vi.stubEnv('FIRECRAWL_API_URL', undefined);
});
```

This prevents local `.env` files from interfering with tests.

### E2E Test Environment

E2E tests explicitly clear and override environment variables:

```typescript
// src/__tests__/e2e/helpers.ts
spawn('node', [CLI_PATH, ...args], {
  env: {
    ...process.env,
    // Clear defaults
    FIRECRAWL_API_KEY: '',
    FIRECRAWL_API_URL: '',
    TEI_URL: '',
    QDRANT_URL: '',
    // Override with test-specific env
    ...env,
  },
});
```

This ensures:
1. Tests don't depend on local `.env` files
2. Each test can specify its own environment
3. Tests are reproducible across machines

### Service Availability Detection

E2E tests gracefully skip when services are unavailable:

```typescript
// Check if Firecrawl API is available
const apiKey = process.env.FIRECRAWL_API_KEY;
if (!apiKey) {
  console.log('Skipping: No API credentials');
  return;
}

// Check if vector services are available
const teiResponse = await fetch(`${teiUrl}/health`);
const qdrantResponse = await fetch(`${qdrantUrl}/collections`);
if (!teiResponse.ok || !qdrantResponse.ok) {
  console.log('Skipping: Vector services not available');
  return;
}
```

---

## Test Architecture

### Directory Structure

```
src/
├── __tests__/
│   ├── commands/           # Unit tests for commands (13 files)
│   ├── utils/              # Unit tests for utilities (7 files)
│   ├── e2e/                # E2E tests (8 files + helpers)
│   │   ├── helpers.ts      # CLI spawning, test utilities
│   │   ├── scrape.e2e.test.ts
│   │   ├── crawl.e2e.test.ts
│   │   ├── map.e2e.test.ts
│   │   ├── search.e2e.test.ts
│   │   ├── extract.e2e.test.ts
│   │   ├── vector.e2e.test.ts
│   │   ├── config.e2e.test.ts
│   │   └── version.e2e.test.ts
│   └── setup.ts            # Unit test setup (env stubbing)
├── commands/               # Command implementations
├── utils/                  # Utility functions
└── types/                  # TypeScript types
```

### Test Configuration Files

```
vitest.config.mjs           # Unit test configuration
vitest.e2e.config.mjs       # E2E test configuration
```

**Key Differences**:

| Setting | Unit Tests | E2E Tests |
|---------|-----------|-----------|
| **Include** | `src/**/*.test.ts` | `src/__tests__/e2e/**/*.e2e.test.ts` |
| **Setup Files** | `./src/__tests__/setup.ts` | None |
| **Timeout** | Default (5s) | 120s (2 minutes) |
| **Hook Timeout** | Default (10s) | 60s (1 minute) |
| **Parallelism** | True | False (sequential) |
| **Isolation** | True | False |

### E2E Test Helpers

**Location**: `src/__tests__/e2e/helpers.ts`

**Key Functions**:

```typescript
// Run CLI command and return result
runCLI(args: string[], options: {
  env?: Record<string, string>;
  input?: string;
  timeout?: number;
  cwd?: string;
}): Promise<CLIResult>

// Run CLI expecting success (exit code 0)
runCLISuccess(args: string[], options): Promise<CLIResult>

// Run CLI expecting failure (non-zero exit code)
runCLIFailure(args: string[], options): Promise<CLIResult>

// Parse JSON from CLI output
parseJSONOutput<T>(output: string): T

// Check if test server is running
isTestServerRunning(): Promise<boolean>

// Get API key from environment
getTestApiKey(): string | undefined

// Create/cleanup temp directories
createTempDir(): Promise<string>
cleanupTempDir(dir: string): Promise<void>
```

### Mocking Strategy

**Unit Tests**:
- Mock Firecrawl SDK client (`vi.mock('@mendable/firecrawl-js')`)
- Mock fetch for TEI/Qdrant calls
- Reset caches between tests (`resetTeiCache()`, `resetQdrantCache()`)
- Stub environment variables

**E2E Tests**:
- No mocking - uses real CLI execution
- Spawns CLI as subprocess
- Real HTTP calls to test server
- Real vector operations (when services available)

---

## Writing Tests

### Unit Test Template

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('MyCommand', () => {
  beforeEach(() => {
    // Reset mocks and caches
    vi.clearAllMocks();
  });

  describe('input validation', () => {
    it('should validate required arguments', () => {
      // Test validation logic
    });

    it('should normalize URLs', () => {
      // Test URL normalization
    });
  });

  describe('execution', () => {
    it('should call API with correct parameters', async () => {
      // Mock API client
      const mockClient = {
        scrapeUrl: vi.fn().mockResolvedValue({ data: {} }),
      };

      // Test execution
      await myCommand(mockClient, { url: 'https://example.com' });

      // Assert
      expect(mockClient.scrapeUrl).toHaveBeenCalledWith({
        url: 'https://example.com',
      });
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      // Test error scenarios
    });
  });
});
```

### E2E Test Template

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  runCLI,
  runCLISuccess,
  runCLIFailure,
  getTestApiKey,
  isTestServerRunning,
  createTempDir,
  cleanupTempDir,
  TEST_SERVER_URL,
} from './helpers';

describe('E2E: my-command', () => {
  let tempDir: string;
  let apiKey: string | undefined;
  let testServerAvailable: boolean;

  beforeAll(async () => {
    apiKey = getTestApiKey();
    testServerAvailable = await isTestServerRunning();
  });

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('input validation', () => {
    it('should fail when no input provided', async () => {
      const result = await runCLIFailure(['my-command'], {
        env: { FIRECRAWL_API_KEY: apiKey || 'test-key' },
      });
      expect(result.stderr).toContain('required argument');
    });
  });

  describe('command execution', () => {
    it('should execute successfully', async () => {
      if (!apiKey || !testServerAvailable) {
        console.log('Skipping: Prerequisites not available');
        return;
      }

      const result = await runCLISuccess(
        ['my-command', TEST_SERVER_URL],
        {
          env: {
            FIRECRAWL_API_KEY: apiKey,
            FIRECRAWL_API_URL: process.env.FIRECRAWL_API_URL || '',
          },
          timeout: 60000,
        }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('expected output');
    });
  });
});
```

### Best Practices

1. **Descriptive Test Names**: Use clear, action-oriented names
   ```typescript
   ✅ it('should validate URL format and reject invalid URLs')
   ❌ it('test URL')
   ```

2. **Arrange-Act-Assert Pattern**:
   ```typescript
   it('should format output correctly', () => {
     // Arrange
     const input = { data: 'test' };

     // Act
     const result = formatOutput(input);

     // Assert
     expect(result).toBe('formatted: test');
   });
   ```

3. **Test One Thing**: Each test should verify one behavior
   ```typescript
   ✅ it('should validate URL format')
   ✅ it('should normalize URL protocol')
   ❌ it('should validate and normalize URL')
   ```

4. **Use Helpers**: Extract common setup to helper functions
   ```typescript
   function createMockClient() {
     return {
       scrapeUrl: vi.fn().mockResolvedValue({ data: {} }),
     };
   }
   ```

5. **Skip Gracefully**: E2E tests should skip when services unavailable
   ```typescript
   if (!apiKey) {
     console.log('Skipping: No API credentials');
     return;
   }
   ```

6. **Clean Up Resources**: Always cleanup temp files and directories
   ```typescript
   afterEach(async () => {
     await cleanupTempDir(tempDir);
   });
   ```

---

## Troubleshooting

### Common Issues

#### 1. E2E Tests Skipping

**Symptom**: Tests show "Skipping: No API credentials"

**Solution**:
```bash
# Pass environment variables explicitly
FIRECRAWL_API_KEY=local-dev \
FIRECRAWL_API_URL=http://localhost:53002 \
pnpm test:e2e
```

**Why**: E2E tests intentionally clear env vars for isolation (see `helpers.ts:36-44`)

#### 2. Test Server Not Available

**Symptom**: Tests show "Skipping: No test server"

**Solution**:
```bash
# Start the test server
cd /tmp/firecrawl/apps/test-site
pnpm preview --port 4321 --host 127.0.0.1
```

**Verify**:
```bash
curl http://127.0.0.1:4321
```

#### 3. Vector Service Tests Skipping

**Symptom**: Tests show "Skipping: Vector services not available"

**Solution**:
```bash
# Check service health
curl http://100.74.16.82:52000/health  # TEI
curl http://localhost:53333/collections # Qdrant

# Pass env vars
TEI_URL=http://100.74.16.82:52000 \
QDRANT_URL=http://localhost:53333 \
pnpm test:e2e
```

#### 4. CLI Not Built

**Symptom**: E2E tests fail with "Cannot find module 'dist/index.js'"

**Solution**:
```bash
# Build the CLI first
pnpm build

# Then run e2e tests
pnpm test:e2e
```

#### 5. Port Conflicts

**Symptom**: Test server fails to start on port 4321

**Solution**:
```bash
# Find process using port
lsof -i :4321

# Kill conflicting process
kill -9 <PID>
```

#### 6. Timeout Errors

**Symptom**: E2E tests timeout after 30s

**Solution**: Increase timeout in test or config
```typescript
// In test
const result = await runCLI(['crawl', url], {
  timeout: 120000, // 2 minutes
});

// Or in vitest.e2e.config.mjs
testTimeout: 180000, // 3 minutes
```

### Debug Mode

Run tests with verbose output:

```bash
# Vitest verbose mode
pnpm test -- --reporter=verbose

# Debug specific test
pnpm test -- --reporter=verbose scrape
```

### Test Logs

E2E tests output to stdout/stderr:

```typescript
const result = await runCLI(['scrape', url]);
console.log('STDOUT:', result.stdout);
console.log('STDERR:', result.stderr);
console.log('EXIT CODE:', result.exitCode);
```

---

## Continuous Integration

### Pre-commit Hooks

Tests run automatically via Husky pre-commit hook:

```bash
# .husky/pre-commit
pnpm test        # Run unit tests before commit
pnpm type-check  # TypeScript validation
pnpm check       # Biome linting
```

### GitHub Actions (Recommended)

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm build
      - run: pnpm test              # Unit tests
      - run: pnpm test:e2e          # E2E tests (services required)
        env:
          FIRECRAWL_API_KEY: ${{ secrets.FIRECRAWL_API_KEY }}
          FIRECRAWL_API_URL: http://localhost:53002
```

---

## Performance

### Test Execution Times

| Suite | Tests | Time | Per Test |
|-------|-------|------|----------|
| **Unit** | 140 | ~800ms | ~5.7ms |
| **E2E** | 186 | ~20s | ~107ms |
| **Total** | 326 | ~21s | ~64ms |

### Optimization Tips

1. **Parallel Unit Tests**: Run unit tests in parallel (default)
2. **Sequential E2E Tests**: E2E tests must run sequentially to avoid port conflicts
3. **Skip When Unavailable**: E2E tests gracefully skip when services unavailable
4. **Mock Aggressively**: Unit tests mock all external dependencies
5. **Reuse Connections**: Cache TEI/Qdrant clients in utils

---

## Future Improvements

### Missing E2E Tests

- [ ] `login` - OS credential storage (complex to test)
- [ ] `logout` - Credential removal
- [ ] `status` - Service health checks

### Test Enhancements

- [ ] Add coverage reporting to CI
- [ ] Add integration tests with real Firecrawl API (staging)
- [ ] Add performance regression tests
- [ ] Add visual regression tests for output formatting
- [ ] Add mutation testing for critical paths

### Infrastructure

- [ ] Docker Compose for test environment
- [ ] Automated test server startup in CI
- [ ] Test data fixtures for consistent results
- [ ] Snapshot testing for output formats

---

## Additional Resources

- **Vitest Documentation**: https://vitest.dev
- **Testing Best Practices**: https://testingjavascript.com
- **CLI Testing Guide**: https://github.com/oclif/oclif/wiki/Testing

---

**Questions or Issues?**
Open an issue at: https://github.com/firecrawl/firecrawl-cli/issues
