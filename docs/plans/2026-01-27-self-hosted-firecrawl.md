# Self-Hosted Firecrawl CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modify the Firecrawl CLI to work natively with self-hosted Firecrawl instances by fixing UUID detection, removing cloud-only features, relaxing API key validation, and updating documentation/skills.

**Architecture:** The CLI already supports custom API URLs via `FIRECRAWL_API_URL` env var and `--api-url` flag. Changes are surgical: broaden UUID regex, remove cloud-only commands and browser login, relax the `fc-` API key prefix requirement, centralize the default API URL constant, and update skill/rules docs. No new abstractions needed.

**Tech Stack:** TypeScript, Vitest, Commander.js, `@mendable/firecrawl-js` SDK

---

## Baseline

- **All 227 existing tests pass** (12 test files)
- **Test command:** `pnpm test`
- **Build command:** `pnpm run build`
- **Self-hosted instance confirmed working** at `http://localhost:53002` with `FIRECRAWL_API_KEY=local-dev`

---

### Task 1: Fix UUID Detection for Self-Hosted (UUID v7 Support)

Self-hosted Firecrawl generates UUID v7 job IDs (e.g., `019bfe41-f924-77db-8041-13f0d170c87e`). The current regex in `isJobId()` only matches UUID v4. This causes crawl status checks to fail because the CLI treats the job ID as a URL.

**Files:**

- Modify: `src/utils/job.ts:10` (the UUID regex)
- Modify: `src/__tests__/utils/job.test.ts` (update + add tests)

**Step 1: Update tests to expect UUID v7 support**

In `src/__tests__/utils/job.test.ts`, add test cases for UUID v7 and update the v1 test:

```typescript
// ADD this new test block after the "should be case-insensitive" test:
it('should return true for UUID v7 format', () => {
  // UUID v7 has version 7 in the third group
  expect(isJobId('019bfe41-f924-77db-8041-13f0d170c87e')).toBe(true);
  expect(isJobId('019bfe41-f924-7aaa-bbbb-cccccccccccc')).toBe(true);
});

it('should return true for other UUID versions (v1, v5, v6)', () => {
  // UUID v1
  expect(isJobId('550e8400-e29b-11d4-a716-446655440000')).toBe(true);
  // UUID v5-like
  expect(isJobId('550e8400-e29b-51d4-a716-446655440000')).toBe(true);
});
```

Also **remove** the existing test `'should return false for UUID v1 format'` since we now accept all UUID versions.

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/__tests__/utils/job.test.ts`
Expected: FAIL — UUID v7 and v1 tests fail because regex rejects non-v4 UUIDs.

**Step 3: Fix the UUID regex**

In `src/utils/job.ts`, replace the v4-only regex with a general UUID regex:

```typescript
export function isJobId(str: string): boolean {
  // Match any UUID format (v1-v7) — self-hosted Firecrawl uses UUID v7
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(str);
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/__tests__/utils/job.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/utils/job.ts src/__tests__/utils/job.test.ts
git commit -m "fix: broaden UUID regex to support v7 (self-hosted Firecrawl)"
```

---

### Task 2: Remove `fc-` API Key Prefix Validation

Self-hosted Firecrawl with `USE_DB_AUTHENTICATION=false` uses arbitrary API keys (e.g., `local-dev`). The CLI currently rejects any key not starting with `fc-`.

**Files:**

- Modify: `src/utils/auth.ts:296` (remove validation in `manualLogin`)
- Modify: `src/commands/login.ts:44-47` (remove validation in `handleLoginCommand`)
- Modify: `src/__tests__/utils/auth.test.ts` (update tests)

**Step 1: Update auth tests**

In `src/__tests__/utils/auth.test.ts`, add a test that non-`fc-` keys are accepted:

```typescript
it('should return true when API key does not start with fc-', () => {
  initializeConfig({
    apiKey: 'local-dev',
    apiUrl: 'http://localhost:53002',
  });

  expect(isAuthenticated()).toBe(true);
});
```

**Step 2: Run tests to verify they pass (this test should already pass)**

Run: `pnpm test -- src/__tests__/utils/auth.test.ts`
Expected: PASS — `isAuthenticated()` doesn't check the `fc-` prefix, it only checks key existence. This confirms the prefix check is only in the login flow.

**Step 3: Remove `fc-` validation from `manualLogin` in `src/utils/auth.ts`**

Find and remove this block (around line 293-296):

```typescript
// REMOVE these lines:
if (!apiKey.startsWith('fc-')) {
  throw new Error('Invalid API key format. API keys should start with "fc-"');
}
```

Keep the empty-string check above it.

**Step 4: Remove `fc-` validation from `handleLoginCommand` in `src/commands/login.ts`**

Find and remove this block (around line 42-47):

```typescript
// REMOVE these lines:
if (!options.apiKey.startsWith('fc-')) {
  console.error(
    'Error: Invalid API key format. API keys should start with "fc-"'
  );
  process.exit(1);
}
```

**Step 5: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/utils/auth.ts src/commands/login.ts src/__tests__/utils/auth.test.ts
git commit -m "fix: remove fc- API key prefix validation for self-hosted support"
```

---

### Task 3: Remove Cloud-Only `credit-usage` Command

The `credit-usage` command calls `/v2/team/credit-usage` which is a cloud billing endpoint. Self-hosted instances return dummy data (99,999,999 credits). This command is irrelevant and misleading for self-hosters.

**Files:**

- Delete: `src/commands/credit-usage.ts`
- Delete: `src/__tests__/commands/credit-usage.test.ts`
- Modify: `src/index.ts` (remove command registration and import)

**Step 1: Remove the credit-usage command from `src/index.ts`**

Remove the import at the top:

```typescript
// DELETE this line:
import { handleCreditUsageCommand } from './commands/credit-usage';
```

Remove `'credit-usage'` from the `AUTH_REQUIRED_COMMANDS` array:

```typescript
// CHANGE from:
const AUTH_REQUIRED_COMMANDS = [
  'scrape',
  'crawl',
  'map',
  'search',
  'credit-usage',
];
// TO:
const AUTH_REQUIRED_COMMANDS = ['scrape', 'crawl', 'map', 'search'];
```

Remove the entire `credit-usage` command block (the `program.command('credit-usage')...` block, approximately 15 lines).

**Step 2: Delete the source and test files**

```bash
rm src/commands/credit-usage.ts
rm src/__tests__/commands/credit-usage.test.ts
```

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS (11 test files now instead of 12)

**Step 4: Verify build succeeds**

Run: `pnpm run build`
Expected: No errors

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: remove cloud-only credit-usage command"
```

---

### Task 4: Remove Cloud-Only Browser Login and Telemetry

The browser-based PKCE login flow opens `https://firecrawl.dev/cli-auth` which is a cloud-only endpoint. The telemetry/agent detection code is also cloud-specific. For self-hosted, users authenticate via `--api-key` flag or `FIRECRAWL_API_KEY` env var.

**Files:**

- Modify: `src/utils/auth.ts` (remove browser login, telemetry, PKCE, agent detection; keep `manualLogin`, `isAuthenticated`, `ensureAuthenticated`, `printBanner`)
- Modify: `src/commands/login.ts` (remove browser/web-url options, simplify to manual-only)
- Modify: `src/commands/config.ts` (remove web-url references)
- Modify: `src/index.ts` (remove browser/web-url options from login and config commands)
- Modify: `src/__tests__/utils/auth.test.ts` (remove browser login test references if any)

**Step 1: Rewrite `src/utils/auth.ts`**

Remove these functions entirely:

- `openBrowser`
- `generateSessionId`
- `generateCodeVerifier`
- `generateCodeChallenge`
- `pollAuthStatus`
- `waitForAuth`
- `detectCodingAgents`
- `isTelemetryDisabled`
- `getCliMetadata`
- `browserLogin`
- `printEnvHint`
- `printTelemetryNotice`

Remove these constants:

- `WEB_URL`
- `AUTH_TIMEOUT_MS`
- `POLL_INTERVAL_MS`

Remove the `crypto` and `readline` imports (readline is still needed for `promptInput` — keep it).

Keep and update these functions:

- `promptInput` (keep as-is)
- `manualLogin` (keep as-is, but `fc-` validation was already removed in Task 2)
- `envVarLogin` (keep as-is — reads `FIRECRAWL_API_KEY` and `FIRECRAWL_API_URL`)
- `printBanner` (keep as-is)
- `isAuthenticated` (keep as-is)
- `ensureAuthenticated` — simplify the interactive flow

Update `interactiveLogin` to remove browser option:

```typescript
async function interactiveLogin(): Promise<{ apiKey: string; apiUrl: string }> {
  const envResult = envVarLogin();
  if (envResult) {
    printBanner();
    console.log('Using FIRECRAWL_API_KEY from environment variable\n');
    return envResult;
  }

  printBanner();
  console.log('Welcome! To get started, provide your Firecrawl API key.\n');
  console.log(
    'Tip: You can also set FIRECRAWL_API_KEY and FIRECRAWL_API_URL environment variables\n'
  );

  return manualLogin();
}
```

Remove the `browserLogin` export. Update exports to only export what's needed:

```typescript
export { printBanner };
export { manualLogin, interactiveLogin };
export function isAuthenticated(): boolean { ... }
export async function ensureAuthenticated(): Promise<string> { ... }
```

Remove `DEFAULT_API_URL` constant from this file — it's used in `manualLogin` and `envVarLogin` fallbacks. Replace with inline `'https://api.firecrawl.dev'` or better, import from a central location (see Task 6).

**Step 2: Simplify `src/commands/login.ts`**

Remove `browserLogin` import. Remove `WEB_URL` constant. Remove `webUrl` from `LoginOptions`.
Remove the `method` option handling (no more browser vs manual choice).

Update `handleLoginCommand`:

```typescript
import { saveCredentials, getConfigDirectoryPath } from '../utils/credentials';
import { updateConfig } from '../utils/config';
import { manualLogin, interactiveLogin, isAuthenticated } from '../utils/auth';

const DEFAULT_API_URL = 'https://api.firecrawl.dev';

export interface LoginOptions {
  apiKey?: string;
  apiUrl?: string;
}

export async function handleLoginCommand(
  options: LoginOptions = {}
): Promise<void> {
  const apiUrl = options.apiUrl?.replace(/\/$/, '') || DEFAULT_API_URL;

  if (isAuthenticated() && !options.apiKey) {
    console.log('You are already logged in.');
    console.log(`Credentials stored at: ${getConfigDirectoryPath()}`);
    console.log('\nTo login with a different account, run:');
    console.log('  firecrawl logout');
    console.log('  firecrawl login');
    return;
  }

  if (options.apiKey) {
    try {
      saveCredentials({
        apiKey: options.apiKey,
        apiUrl: apiUrl,
      });
      console.log('Login successful!');
      updateConfig({
        apiKey: options.apiKey,
        apiUrl: apiUrl,
      });
    } catch (error) {
      console.error(
        'Error saving credentials:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
    return;
  }

  try {
    const result = await interactiveLogin();

    saveCredentials({
      apiKey: result.apiKey,
      apiUrl: result.apiUrl || apiUrl,
    });

    console.log('\nLogin successful!');

    updateConfig({
      apiKey: result.apiKey,
      apiUrl: result.apiUrl || apiUrl,
    });
  } catch (error) {
    console.error(
      '\nError:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    process.exit(1);
  }
}
```

**Step 3: Simplify login/config commands in `src/index.ts`**

For the `config` command, remove `--web-url` and `--method`/`--browser` options:

```typescript
program
  .command('config')
  .description('Configure Firecrawl (login if not authenticated)')
  .option(
    '-k, --api-key <key>',
    'Provide API key directly (skips interactive flow)'
  )
  .option('--api-url <url>', 'API URL (default: https://api.firecrawl.dev)')
  .action(async (options) => {
    await configure({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
    });
  });
```

For the `login` command, same simplification:

```typescript
program
  .command('login')
  .description('Login to Firecrawl (alias for config)')
  .option(
    '-k, --api-key <key>',
    'Provide API key directly (skips interactive flow)'
  )
  .option('--api-url <url>', 'API URL (default: https://api.firecrawl.dev)')
  .action(async (options) => {
    await handleLoginCommand({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
    });
  });
```

**Step 4: Simplify `src/commands/config.ts`**

Remove `webUrl` from `ConfigureOptions`:

```typescript
export interface ConfigureOptions {
  apiKey?: string;
  apiUrl?: string;
}
```

Update `configure()` to not pass `webUrl` or `method`:

```typescript
export async function configure(options: ConfigureOptions = {}): Promise<void> {
  if (!isAuthenticated() || options.apiKey) {
    const { handleLoginCommand } = await import('./login');
    await handleLoginCommand({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
    });
    return;
  }

  await viewConfig();
  console.log(
    'To re-authenticate, run: firecrawl logout && firecrawl config\n'
  );
}
```

**Step 5: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

**Step 6: Verify build**

Run: `pnpm run build`
Expected: No errors

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: remove cloud-only browser login, PKCE, and telemetry"
```

---

### Task 5: Simplify Status Command (Remove Cloud-Only Credit/Queue Endpoints)

The `status` command calls `/v2/team/credit-usage` and `/v2/team/queue-status` — cloud billing/management endpoints that return dummy data on self-hosted. Simplify to show version and auth status only.

**Files:**

- Modify: `src/commands/status.ts` (remove API calls, simplify output)

**Step 1: Rewrite `src/commands/status.ts`**

```typescript
/**
 * Status command implementation
 * Displays CLI version and auth status
 */

import packageJson from '../../package.json';
import { isAuthenticated } from '../utils/auth';
import { getConfig } from '../utils/config';
import { loadCredentials } from '../utils/credentials';

type AuthSource = 'env' | 'stored' | 'none';

interface StatusResult {
  version: string;
  authenticated: boolean;
  authSource: AuthSource;
  apiUrl?: string;
}

function getAuthSource(): AuthSource {
  if (process.env.FIRECRAWL_API_KEY) {
    return 'env';
  }
  const stored = loadCredentials();
  if (stored?.apiKey) {
    return 'stored';
  }
  return 'none';
}

export async function getStatus(): Promise<StatusResult> {
  const config = getConfig();
  return {
    version: packageJson.version,
    authenticated: isAuthenticated(),
    authSource: getAuthSource(),
    apiUrl: config.apiUrl,
  };
}

export async function handleStatusCommand(): Promise<void> {
  const orange = '\x1b[38;5;208m';
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  const bold = '\x1b[1m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';

  const status = await getStatus();

  console.log('');
  console.log(
    `  ${orange}🔥 ${bold}firecrawl${reset} ${dim}cli${reset} ${dim}v${status.version}${reset}`
  );
  console.log('');

  if (status.authenticated) {
    const sourceLabel =
      status.authSource === 'env'
        ? 'via FIRECRAWL_API_KEY'
        : 'via stored credentials';
    console.log(
      `  ${green}●${reset} Authenticated ${dim}${sourceLabel}${reset}`
    );
    if (status.apiUrl) {
      console.log(`  ${dim}API URL:${reset} ${status.apiUrl}`);
    }
  } else {
    console.log(`  ${red}●${reset} Not authenticated`);
    console.log(`  ${dim}Run 'firecrawl login' to authenticate${reset}`);
  }

  console.log('');
}
```

**Step 2: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

**Step 3: Verify build**

Run: `pnpm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/commands/status.ts
git commit -m "feat: simplify status command, remove cloud-only API calls"
```

---

### Task 6: Centralize Default API URL Constant

The string `'https://api.firecrawl.dev'` appears as a fallback in multiple files. Centralize it in `src/utils/config.ts` so self-hosters only need to change one place (or can just set the env var).

**Files:**

- Modify: `src/utils/config.ts` (export the constant)
- Modify: `src/utils/auth.ts` (import instead of local constant)
- Modify: `src/commands/login.ts` (import instead of local constant)
- Modify: `src/commands/status.ts` (already cleaned up in Task 5, but verify)
- Modify: `src/commands/config.ts` (import instead of inline string)

**Step 1: Add exported constant to `src/utils/config.ts`**

Add at the top of the file, after imports:

```typescript
/** Default Firecrawl API URL. Override with FIRECRAWL_API_URL env var. */
export const DEFAULT_API_URL = 'https://api.firecrawl.dev';
```

**Step 2: Replace local constants and inline strings**

In `src/utils/auth.ts`, remove the local `DEFAULT_API_URL` constant and import from config:

```typescript
import { updateConfig, getApiKey, DEFAULT_API_URL } from './config';
```

In `src/commands/login.ts`, remove the local `DEFAULT_API_URL` constant and import:

```typescript
import { updateConfig, DEFAULT_API_URL } from '../utils/config';
```

In `src/commands/config.ts`, replace the inline fallback `'https://api.firecrawl.dev'` in `viewConfig()`:

```typescript
import { getConfig, DEFAULT_API_URL } from '../utils/config';
// ...
console.log(`API URL:  ${config.apiUrl || DEFAULT_API_URL}`);
```

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

**Step 4: Verify build**

Run: `pnpm run build`
Expected: No errors

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: centralize DEFAULT_API_URL constant in config.ts"
```

---

### Task 7: Update Tests for Removed Features

Some existing tests reference cloud-only patterns (hardcoded `https://api.firecrawl.dev`, `fc-` prefixed keys). Update them for self-hosted compatibility without breaking the test logic.

**Files:**

- Modify: `src/__tests__/utils/auth.test.ts` (use non-`fc-` keys in some tests)
- Modify: `src/__tests__/utils/credentials.test.ts` (use non-`fc-` keys in some tests)
- Modify: `src/__tests__/utils/config.test.ts` (no changes expected, but verify)
- Modify: `src/__tests__/commands/crawl.test.ts` (no changes expected, but verify)

**Step 1: Add self-hosted key tests to `src/__tests__/utils/auth.test.ts`**

Already added one in Task 2. Verify all tests still pass.

**Step 2: Update `src/__tests__/utils/credentials.test.ts`**

Add a test that verifies non-`fc-` keys can be stored and loaded:

```typescript
it('should save and load credentials with non-fc- prefixed key', () => {
  const mockCredentials = {
    apiKey: 'local-dev',
    apiUrl: 'http://localhost:53002',
  };

  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockCredentials));

  const result = loadCredentials();

  expect(result).toEqual(mockCredentials);
});
```

Add this inside the `loadCredentials` describe block.

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "test: add self-hosted API key tests, update test expectations"
```

---

### Task 8: Update Skill Documentation (`SKILL.md` and `rules/install.md`)

Update the skill and rules to reflect self-hosted usage — no browser login, no credits, env var configuration.

**Files:**

- Modify: `skills/firecrawl-cli/SKILL.md`
- Modify: `skills/firecrawl-cli/rules/install.md`

**Step 1: Update `skills/firecrawl-cli/SKILL.md`**

Key changes:

- Remove "Credits" from `--status` output example — replace with API URL
- Change the `firecrawl login --browser` recommendation to `firecrawl login --api-key <key>` or env var setup
- Remove references to "credits" throughout
- Update the installation/auth section
- Keep all command documentation (scrape, crawl, map, search) as-is — they work with self-hosted

Updated `--status` output example:

```
  🔥 firecrawl cli v1.1.1

  ● Authenticated via FIRECRAWL_API_KEY
  API URL: http://localhost:53002
```

Updated Authentication section:

````markdown
## Authentication

Set environment variables for self-hosted Firecrawl:

```bash
export FIRECRAWL_API_KEY="your-api-key"
export FIRECRAWL_API_URL="http://your-server:53002"
```
````

Or run:

```bash
firecrawl login --api-key "your-api-key" --api-url "http://your-server:53002"
```

````

Remove the `--browser` flag references and the concurrency/credits bullets from the status section.

**Step 2: Update `skills/firecrawl-cli/rules/install.md`**

Key changes:
- Replace `firecrawl login --browser` with env var + manual key approach
- Remove browser login references
- Update troubleshooting for self-hosted context
- Remove the Codex-specific browser instructions

**Step 3: Commit**

```bash
git add skills/
git commit -m "docs: update skill docs for self-hosted Firecrawl"
````

---

### Task 9: Final Verification and Integration Test

Run the full test suite, build, and manually verify against the self-hosted instance.

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS (11 test files — credit-usage tests removed)

**Step 2: Build**

Run: `pnpm run build`
Expected: No errors

**Step 3: Manual integration test against self-hosted instance**

```bash
export FIRECRAWL_API_KEY="local-dev"
export FIRECRAWL_API_URL="http://localhost:53002"

# Test status
node dist/index.js --status

# Test scrape
node dist/index.js scrape https://example.com

# Test map
node dist/index.js map https://example.com --json

# Test crawl start
node dist/index.js crawl https://example.com --limit 2

# Test crawl status with UUID v7 job ID (use ID from previous output)
node dist/index.js crawl <job-id-from-above>
```

All commands should work without errors.

**Step 4: Commit final state**

```bash
git add -A
git commit -m "chore: final verification — all tests pass, self-hosted working"
```

---

## Summary of Changes

| File                                          | Action | Description                                                                                |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `src/utils/job.ts`                            | Modify | Broaden UUID regex to accept all versions                                                  |
| `src/utils/auth.ts`                           | Modify | Remove browser login, PKCE, telemetry, agent detection; simplify to manual login + env var |
| `src/utils/config.ts`                         | Modify | Export centralized `DEFAULT_API_URL` constant                                              |
| `src/commands/login.ts`                       | Modify | Remove browser/web-url options, remove `fc-` validation                                    |
| `src/commands/config.ts`                      | Modify | Remove web-url/method options, import centralized constant                                 |
| `src/commands/status.ts`                      | Modify | Remove cloud API calls, show version + auth + API URL only                                 |
| `src/commands/credit-usage.ts`                | Delete | Cloud-only billing command                                                                 |
| `src/index.ts`                                | Modify | Remove credit-usage command, simplify login/config options                                 |
| `src/__tests__/utils/job.test.ts`             | Modify | Add UUID v7 tests, accept all UUID versions                                                |
| `src/__tests__/utils/auth.test.ts`            | Modify | Add non-`fc-` key test                                                                     |
| `src/__tests__/utils/credentials.test.ts`     | Modify | Add self-hosted key test                                                                   |
| `src/__tests__/commands/credit-usage.test.ts` | Delete | Tests for removed command                                                                  |
| `skills/firecrawl-cli/SKILL.md`               | Modify | Update for self-hosted auth, remove credits/browser references                             |
| `skills/firecrawl-cli/rules/install.md`       | Modify | Update for self-hosted auth flow                                                           |

**Total: 10 files modified, 2 files deleted, 0 files created**
