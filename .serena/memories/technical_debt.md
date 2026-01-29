# Technical Debt and Known Issues

## Known Technical Debt

### 1. Entry Point Bloat
- **File**: `src/index.ts`
- **Issue**: ~850 lines, handles all command setup
- **Solution**: Extract command factory functions to separate module
- **Priority**: Medium

### 2. Type Safety Issues
- **Issue**: 22 occurrences of `any` type throughout codebase
- **Impact**: Reduces type safety and IDE support
- **Solution**: Replace `any` with proper interfaces or unknown
- **Priority**: High (gradually address as you touch files)

### 3. Linting
- **Issue**: No ESLint configuration
- **Impact**: Only Prettier for formatting, no code quality checks
- **Solution**: Add ESLint with TypeScript plugin
- **Priority**: Low

### 4. Module System
- **Issue**: Uses CommonJS instead of ESM
- **Impact**: Not aligned with modern JavaScript ecosystem
- **Solution**: Migrate to ESM (`"type": "module"` in package.json)
- **Priority**: Low (breaking change, defer until v2.0)

### 5. Global Configuration State
- **File**: `src/utils/config.ts`
- **Issue**: Mutable global state, makes testing harder
- **Solution**: Consider dependency injection pattern
- **Priority**: Low (works fine, refactor if complexity grows)

## Important Patterns to Maintain

### 1. HTTP with Timeout and Retry
All external HTTP calls must use `utils/http.ts`:
- `fetchWithRetry()`: 30s timeout, 3 retries with exponential backoff
- Retryable errors: 408, 429, 500, 502, 503, 504 + network errors
- **Do NOT** use raw `fetch()` for TEI, Qdrant, or other external services

### 2. Embedding Concurrency
Commands that embed content must use `p-limit`:
- `MAX_CONCURRENT_EMBEDS = 10`
- Prevents resource exhaustion
- Examples: `crawl`, `search`, `extract` commands

### 3. Path Traversal Protection
All file output must use `output.ts:validateOutputPath()`:
- Ensures output files stay within current working directory
- Security-critical for CLI tools

### 4. Signal Handling
Commands with long-running operations should handle signals:
- Graceful shutdown on SIGINT/SIGTERM
- Double-signal force exit
- Clean up resources (close connections, etc.)

### 5. Python Subprocess Security
When invoking Python (NotebookLM):
- `notebooklm.ts:isValidPythonInterpreter()` validates paths
- Prevent command injection

## Common Anti-Patterns to Avoid

### ❌ Don't Use Raw fetch()
```typescript
// BAD
const response = await fetch(url);

// GOOD
import { fetchWithRetry } from './utils/http';
const response = await fetchWithRetry(url);
```

### ❌ Don't Hardcode Timeouts
```typescript
// BAD
setTimeout(() => {}, 30000);

// GOOD
import { getConfig } from './utils/config';
const { timeoutMs } = getConfig();
setTimeout(() => {}, timeoutMs);
```

### ❌ Don't Skip Input Validation
```typescript
// BAD
function processUrl(url: string) {
  return fetch(url);
}

// GOOD
import { validateUrl } from './utils/url';
function processUrl(url: string) {
  if (!validateUrl(url)) {
    throw new Error('Invalid URL');
  }
  return fetch(url);
}
```

### ❌ Don't Write to Arbitrary Paths
```typescript
// BAD
fs.writeFileSync(outputPath, content);

// GOOD
import { writeOutput } from './utils/output';
await writeOutput(content, outputPath); // Validates path safety
```

## Performance Considerations

### Embedding Pipeline
- Chunks are batched to TEI (24 texts per batch)
- 4 concurrent TEI requests maximum
- 10 concurrent embed operations across commands
- Monitor these limits if scaling to larger crawls

### Memory Usage
- Large crawls can accumulate significant data
- Consider streaming/incremental processing for >1000 URLs
- Qdrant batch inserts use 100-point batches

### Test Performance
- Current: 326 tests in ~800ms
- Keep test suite fast (<2s total)
- Mock external services (Firecrawl, TEI, Qdrant)
- Reset caches between tests
