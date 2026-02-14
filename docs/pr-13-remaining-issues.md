# PR #13 Remaining Issues - Tracking Document

**Generated:** 2026-02-13
**PR:** feat: centralize storage paths and enhance query deduplication
**Status:** 118 threads analyzed, 65 already fixed, 13 bugs need attention

---

## 🔴 CRITICAL (1 issue)

### 1. EmbedPipeline Promise Caching Bug
- **File:** `src/container/services/EmbedPipeline.ts:43-57`
- **Reporter:** cubic-dev-ai (comment thread PRRT_kwDORCsxCs5uaZQF)
- **Impact:** If TEI/Qdrant connection fails once, ALL future embeddings fail permanently
- **Root Cause:** Rejected promise cached in `this.collectionPromise` and never cleared
- **Symptom:** After any transient network error to TEI or Qdrant, all subsequent `autoEmbed`/`batchEmbed` calls immediately fail with cached rejection
- **Risk:** High - breaks core embedding functionality permanently until process restart

**Fix:**
```typescript
// src/container/services/EmbedPipeline.ts:43-57
private async ensureCollectionReady(): Promise<void> {
  if (this.collectionPromise) {
    return this.collectionPromise;
  }
  this.collectionPromise = (async () => {
    const teiInfo = await this.teiService.getTeiInfo();
    await this.qdrantService.ensureCollection(this.collectionName, teiInfo.dimension);
  })();

  // Clear cache on error so future calls can retry
  this.collectionPromise.catch(() => {
    this.collectionPromise = null;
  });

  return this.collectionPromise;
}
```

---

## 🟠 HIGH PRIORITY (4 issues)

### 2. Status --interval Accepts NaN
- **File:** `src/commands/status.ts:1563`
- **Reporter:** cubic-dev-ai, coderabbitai
- **Impact:** `firecrawl status --watch --interval abc` causes infinite tight loop (CLI hangs)
- **Root Cause:** `Math.max(1, NaN)` returns `NaN`, then `setTimeout(resolve, NaN)` resolves immediately
- **Current Code:** `const intervalMs = Math.max(1, options.intervalSeconds ?? 3) * 1000;`

**Fix:**
```typescript
const intervalMs = Math.max(1000, (Number.isFinite(options.intervalSeconds) ? options.intervalSeconds : 3) * 1000);
```

### 3. Map Settings Default Ignored
- **File:** `src/commands/map.ts:573,616-619`
- **Reporter:** cubic-dev-ai
- **Impact:** User's `settings.map.ignoreQueryParameters` configuration is stripped and not sent to API
- **Root Cause:** Commander's `getOptionValueSource()` returns `'default'` even for settings-sourced values, so the action handler strips them
- **Current Code:**
```typescript
ignoreQueryParameters:
  command.getOptionValueSource('ignoreQueryParameters') === 'default'
    ? undefined
    : options.ignoreQueryParameters,
```

**Fix:** Need to distinguish between Commander's built-in default and settings-configured default. Simplest approach:
```typescript
ignoreQueryParameters: options.ignoreQueryParameters
```
And remove the stripping logic entirely since the API accepts the parameter.

### 4. Extract --output Forces JSON
- **File:** `src/commands/extract.ts:242`
- **Reporter:** cubic-dev-ai
- **Impact:** `firecrawl extract --output results.txt` forces JSON output instead of respecting file extension
- **Root Cause:** `const useJson = shouldOutputJson(options) || !!options.output;` — ANY output file triggers JSON
- **Current Code:** `const useJson = shouldOutputJson(options) || !!options.output;`

**Fix:**
```typescript
const useJson = shouldOutputJson(options);
```
The `shouldOutputJson()` function already correctly checks for `.json` extension and `--json` flag.

### 5. Query --limit Accepts NaN
- **File:** `src/commands/query.ts:62`
- **Reporter:** cubic-dev-ai
- **Impact:** `firecrawl query "test" --limit foo` silently defaults to 10 instead of erroring
- **Root Cause:** `parseInt('foo', 10)` returns `NaN`, and `NaN < 1` evaluates to `false`, so validation passes
- **Current Code:**
```typescript
if (options.limit !== undefined && options.limit < 1) {
  console.error(fmt.error('Limit must be at least 1'));
  process.exitCode = 1;
  return;
}
```

**Fix:**
```typescript
if (options.limit !== undefined && (!Number.isFinite(options.limit) || options.limit < 1)) {
  console.error(fmt.error('Limit must be a positive number'));
  process.exitCode = 1;
  return;
}
```

---

## 🟡 MEDIUM PRIORITY (8 issues)

### 6. Crawl Cleanup Silent Failures
- **File:** `src/commands/crawl/status.ts:242-248`
- **Reporter:** coderabbitai
- **Impact:** Transient API errors during cleanup (network timeout, 500, etc.) are silently swallowed with no counter or log
- **Root Cause:** Catch block only handles "not found" errors, everything else falls through silently

**Fix:** Add a `skipped` counter:
```typescript
let removedNotFound = 0;
let skipped = 0;

for (const id of crawlIds) {
  try {
    const status = await getCrawlStatus(id);
    // ... existing logic
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isJobNotFoundError(message)) {
      removedNotFound++;
      toRemove.push(id);
    } else {
      skipped++;
      console.warn(fmt.warning(`Skipped ${id}: ${message}`));
    }
  }
}

// Include in result
return { removed: toRemove.length, removedNotFound, skipped };
```

### 7. Doctor-Debug Double OpenAI Request
- **File:** `src/commands/doctor-debug.ts:258-313`
- **Reporter:** cubic-dev-ai
- **Impact:** When provider ignores `stream: true` and returns JSON, code discards successful response and makes second non-streaming request (doubles API cost/latency)
- **Root Cause:** Checks for `text/event-stream` content-type, and if not present, assumes no response and retries

**Fix:** Check if non-SSE response has valid JSON body and use it:
```typescript
if (!contentType?.includes('text/event-stream')) {
  // Non-SSE response - try to consume as JSON
  try {
    const jsonResponse = await streamResponse.json();
    if (jsonResponse?.choices?.[0]?.message?.content) {
      console.log('\n' + fmt.success('OpenAI API Response (non-streaming):'));
      console.log(jsonResponse.choices[0].message.content);
      return;
    }
  } catch {
    // Not valid JSON, fall through to retry
  }
}
```

### 8. Doctor-Debug `-p` Flag for Gemini
- **File:** `src/commands/doctor-debug.ts:160`
- **Reporter:** cubic-dev-ai, misc-investigator
- **Impact:** Passes `-p` flag to both Claude and Gemini CLI, but Gemini doesn't support it
- **Root Cause:** Code assumes `-p` works for both backends

**Fix:** Conditionally include `-p` only for Claude:
```typescript
const args = ['--model', backend.model];
if (backend.cli === 'claude') {
  args.push('-p');
}
const aiProcess = spawn(backend.cli, args, { stdio: ['pipe', 'pipe', 'pipe'] });
```

### 9. Ask Test Mock Mismatch
- **File:** `src/__tests__/commands/ask.test.ts:9`
- **Reporter:** cubic-dev-ai, docs-investigator
- **Impact:** Test mocks `'child_process'` but `ask.ts` imports from `'node:child_process'` (fragile, may break)
- **Current Code:** `vi.mock('child_process', () => ({ spawn: vi.fn() }))`

**Fix:**
```typescript
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));
```

### 10. Ask Test Assertion Bug
- **File:** `src/__tests__/commands/ask.test.ts:428-433`
- **Reporter:** query-commands-investigator
- **Impact:** Test uses `expect.not.stringContaining()` which passes if ANY call doesn't contain the string, not that NO call contains it (false positive)
- **Current Code:**
```typescript
expect(mockProc.stdin.write).toHaveBeenCalledWith(
  expect.not.stringContaining('https://example.com/doc2')
);
```

**Fix:**
```typescript
const allWriteCalls = vi.mocked(mockProc.stdin.write).mock.calls.map(c => String(c[0]));
const fullContext = allWriteCalls.join('');
expect(fullContext).not.toContain('https://example.com/doc2');
```

### 11. Docker Compose JSON Parsing
- **File:** `src/commands/doctor.ts:101`
- **Reporter:** misc-investigator
- **Impact:** `parseComposePsJson` only handles NDJSON format (Docker Compose ≥2.21); older versions output JSON array and will fail silently
- **Root Cause:** Code splits by newline and parses each line

**Fix:** Try array format first, fall back to NDJSON:
```typescript
function parseComposePsJson(raw: string): DockerComposeEntry[] {
  try {
    // Try JSON array format first (older Docker Compose)
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to NDJSON
  }

  // NDJSON format (Docker Compose ≥2.21)
  return raw
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}
```

### 12. Stats Duplicate Empty State
- **File:** `src/commands/stats.ts:134,162`
- **Reporter:** cubic-dev-ai
- **Impact:** When no domains exist, shows both dash-row table AND empty-state message (visual duplication)
- **Current Behavior:** `formatAlignedTable` inserts placeholder row, then line 162 appends `CANONICAL_EMPTY_STATE`

**Fix:** Pass `emptyWithDashRow: false` when using explicit empty-state message:
```typescript
const table = formatAlignedTable(headers, rows, {
  alignRight: ['Unique URLs', 'Avg Score'],
  emptyWithDashRow: false,  // We have our own empty state message
});
```

### 13. Display EST Label
- **File:** `src/utils/display.ts:86`
- **Reporter:** test-infrastructure-investigator
- **Impact:** Hardcoded "EST" label but uses `America/New_York` which outputs EDT during daylight saving (incorrect half the year)
- **Current Code:** `return \`As of (EST): ${time} | ${formattedDate}\`;`

**Fix:**
```typescript
return `As of (ET): ${time} | ${formattedDate}`;
```
Use "ET" (Eastern Time) which is correct year-round.

---

## ✅ QUICK WINS (5 easy one-line fixes)

### 14. Remove Redundant existsSync
- **File:** `src/utils/settings.ts:52-56`
- **Impact:** CodeQL TOCTOU warning (harmless but noisy)
- **Fix:** Remove `existsSync` check before `mkdirSync({recursive:true})` which is already idempotent
```typescript
function ensureConfigDir(): void {
  const configDir = getConfigDirectoryPath();
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
}
```

### 15. Fix Trap Quoting
- **File:** `scripts/extract-base-urls.sh:133`
- **Fix:** Quote temp file path in trap
```bash
trap "rm -f \"$temp_file\"" EXIT
```

### 16. Fix Mock Import Consistency
- **File:** `src/__tests__/commands/ask.test.ts:9`
- **Fix:** Use `node:` prefix for consistency
```typescript
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));
```

### 17. Change EST to ET
- **File:** `src/utils/display.ts:86`
- **Fix:** One word change
```typescript
return `As of (ET): ${time} | ${formattedDate}`;
```

### 18. Remove Duplicate Empty State
- **File:** `src/commands/stats.ts:134`
- **Fix:** Pass `emptyWithDashRow: false`
```typescript
const table = formatAlignedTable(headers, rows, {
  alignRight: ['Unique URLs', 'Avg Score'],
  emptyWithDashRow: false,
});
```

---

## 📝 LOW PRIORITY / NITPICKS (~40 items)

**File:** `src/commands/config.ts`
- Line 513: `validateSettingKey` uses `process.exit(1)` instead of `process.exitCode` (consistency)
- Line 873: Import at bottom of file (convention violation)
- Line 569: `viewConfig` declared async but no await (unnecessary)

**File:** `src/commands/doctor.ts`
- Line 330: `access(path)` without `fs.constants.W_OK` (redundant check)
- Line 356: Shell command with string interpolation (safe but fragile)
- Line 607: Useless initial assignment to `message` variable (CodeQL warning)

**File:** `src/commands/embed.ts`
- Line 290: `--pretty` alone doesn't trigger JSON output (by design, not a bug)

**File:** `src/commands/domains.ts`
- Line 122: Empty domains render both empty message AND dash row (cosmetic)

**File:** `src/commands/crawl/options.ts`
- Line 55: `getSettings()` called 3x per invocation (cached, negligible impact)

**File:** `src/utils/embed-queue.ts`
- Line 108: Migration doesn't remove legacy directory (intentional safety net)
- Line 668: `cleanupEmbedQueue` removes ALL failed jobs regardless of age (inconsistent with `cleanupOldJobs`)

**File:** `src/utils/theme.ts`
- Line 19: Truecolor escapes mixed with basic ANSI (may not render in old terminals)

**File:** `src/utils/default-settings.ts`
- Line 124: Shallow merge one level deep (works for current flat structure)

**File:** `src/utils/http.ts`
- Line 35: `getDefaultHttpOptions()` calls `getSettings()` every time (cached stat calls)

**File:** `.claude/skills/firecrawl/examples/ask-command-usage.md`
- Line 229: Wrong Claude CLI package name (`@anthropic-ai/claude` should be `@anthropic-ai/claude-code`)
- Line 232: Markdown lint warnings (MD031/MD040)

**File:** `docker-compose.tei.mxbai.yaml`
- Line 52: Hardcoded `jakenet` external network (developer-specific, breaks for others)

**File:** `docker-compose.tei.yaml`
- Line 63: Hardcoded `jakenet` external network (developer-specific)

**File:** `scripts/extract-base-urls.sh`
- Line 36: Missing TTY detection for ANSI colors (outputs escapes when piped)
- Line 190: Division by zero when no URLs extracted (needs guard)

**File:** `scripts/check-qdrant-quality.ts`
- Line 571-572: Uses `reduce` for min/max on already-sorted array (inefficient)

**File:** Test files
- Various: Console spy restoration in afterEach (Vitest auto-restores, not critical)
- Various: Edge-case test coverage suggestions (nice-to-have)

---

## ✅ ALREADY RESOLVED (~65 items)

These threads flagged issues that are already fixed in the current codebase:

- FIRECRAWL_HOME fallback in docker-compose volume mounts
- Hardcoded user-specific paths in docker-compose files
- TEI unpinned image tag (now pinned to 1.5)
- Bare `fetch()` calls in check-qdrant-quality.ts (now use `fetchWithTimeout`)
- Null guards on Qdrant API responses
- `Array.from()` on Map.entries() (removed)
- Double-counting in emptyContent/missingContent
- Migration using `flag: 'wx'` for exclusive creation
- Per-file error handling in embed-queue migration
- `parseIntegerSetting` strict validation
- `homedir()` instead of `process.env.HOME`
- `startsWith('/')` replaced with `path.isAbsolute()`
- `readFileSync` bare catch now checks ENOENT
- Module-level `migrationDone` flags
- Duplicate `isNotFoundError` logic consolidated
- Query deduplication logic fixed
- `||` vs `??` in extractResults
- Console log spies properly restored
- Test file pollution (`process.env.FIRECRAWL_HOME = undefined`)
- And ~45 more...

---

## 🛡️ SECURITY: ALL CLEAR

All 20 CodeQL security alerts are **FALSE POSITIVES**:

**Clear-text logging (7 alerts):**
- All sensitive values are masked via `maskValue()` or `maskUrlCredentials()` before logging
- CodeQL flags the *access* of sensitive variables but doesn't trace the masking

**File system race conditions (9 alerts):**
- All mitigated with `flag: 'wx'` atomic exclusive creation
- Remaining TOCTOU patterns are harmless in single-user CLI context
- Several alerts reference outdated code that has been refactored

**URL sanitization (1 alert):**
- Already using proper URL parsing and validation

---

## 📊 Statistics

- **Total threads analyzed:** 228 (118 unresolved + ~110 duplicates from multiple reviewers)
- **Already resolved:** ~65 (55%)
- **Real bugs requiring fixes:** 13 (11%)
- **Low-priority nitpicks:** ~40 (34%)
- **False positives:** ~20 (CodeQL alerts)

**By Agent:**
- env-config: 5 threads (4 fixed, 5 need fixes)
- docker-scripts: 19 threads (12 fixed, 3 need fixes)
- utils: 72 threads (10 fixed, 5 medium priority)
- security: 16 threads (0 real vulnerabilities!)
- crawl-commands: 10 threads (3 fixes, 5 resolved)
- embedder: 5 threads (1 critical bug)
- config-commands: 30 threads (6 fixed, 3 non-trivial)
- test-infrastructure: 25 threads (7 fixed, 5 actionable)
- query-commands: 8 threads (4 fixes, 1 already fixed)
- docs: 5 threads (3 easy fixes)
- misc: 27 threads (9 valid, 7 resolved)

---

## 🎯 Recommended Fix Order

1. **Critical:** EmbedPipeline promise caching (#1)
2. **High:** Status NaN interval (#2)
3. **High:** Map settings default (#3)
4. **High:** Extract output format (#4)
5. **High:** Query NaN limit (#5)
6. **Quick Wins:** All 5 one-line fixes (#14-18)
7. **Medium:** Remaining 8 issues (#6-13)
8. **Low:** Cherry-pick from nitpicks as time permits

---

**Document maintained by:** CLI Firecrawl Team
**Last updated:** 2026-02-13
**Related PR:** #13 (feat: centralize storage paths and enhance query deduplication)
