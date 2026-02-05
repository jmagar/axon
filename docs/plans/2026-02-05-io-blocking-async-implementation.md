# IO Blocking Async Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert hot-path filesystem operations in `embed-queue` and `job-history` to async to avoid event-loop blocking.

**Architecture:** Replace sync `node:fs` calls with `node:fs/promises` in queue and history utilities, then update all call sites and tests to await async APIs. Preserve JSON formats and error handling.

**Tech Stack:** TypeScript, Node.js fs/promises, Vitest

---

### Task 1: Update embed-queue API to async

**Files:**
- Modify: `src/utils/embed-queue.ts`
- Test: `src/__tests__/utils/embed-queue.test.ts`

**Step 1: Write failing test updates**
Update one existing test to `await` a now-async function (e.g., `getEmbedJob`) without changing implementation yet. Expect TypeScript or runtime failure due to sync function.

**Step 2: Run test to verify failure**
Run: `pnpm test src/__tests__/utils/embed-queue.test.ts -t "getEmbedJob"`
Expected: FAIL (promise expected / function not async / returned value not awaited)

**Step 3: Implement async refactor in embed-queue**
Convert all exported functions to async and use `node:fs/promises`:
- `enqueueEmbedJob`, `getEmbedJob`, `updateEmbedJob`, `removeEmbedJob`, `listEmbedJobs`, `getPendingJobs`, `getStalePendingJobs`, `getStuckProcessingJobs`, `markJob*`, `tryClaimJob`.
- Use `fs.promises.mkdir`, `chmod`, `readFile`, `writeFile`, `readdir`, `unlink`, `stat` as needed.
- Preserve secure permissions with `writeFile(..., { mode: 0o600 })` and best-effort `chmod`.
- Replace `proper-lockfile.lockSync` with async `lock()`.
- Keep same sorting and filtering semantics.

**Step 4: Update tests for async queue functions**
- Replace sync mocks of `node:fs` with `node:fs/promises` mocks.
- Update tests to `await` queue functions.
- Ensure file permission expectations use async `stat` where needed.

**Step 5: Run tests**
Run: `pnpm test src/__tests__/utils/embed-queue.test.ts`
Expected: PASS

---

### Task 2: Update background-embedder to await async queue functions

**Files:**
- Modify: `src/utils/background-embedder.ts`
- Test: `src/__tests__/utils/background-embedder.test.ts`

**Step 1: Write failing test update**
Adjust a test to expect async calls (e.g., `getPendingJobs` mocked with `mockResolvedValue`). Without implementation changes, expect failure.

**Step 2: Run test to verify failure**
Run: `pnpm test src/__tests__/utils/background-embedder.test.ts`
Expected: FAIL

**Step 3: Update background-embedder implementation**
- `await getPendingJobs()`
- `await getStalePendingJobs()`
- `await getStuckProcessingJobs()`
- `await updateEmbedJob()`
- `await markJob*()` and any other queue helpers

**Step 4: Update tests**
- Use `mockResolvedValue` for async queue helpers
- `await` the functions under test

**Step 5: Run tests**
Run: `pnpm test src/__tests__/utils/background-embedder.test.ts`
Expected: PASS

---

### Task 3: Convert job-history to async and update callers

**Files:**
- Modify: `src/utils/job-history.ts`
- Modify: `src/commands/status.ts`
- Modify: `src/commands/batch.ts`
- Modify: `src/commands/extract.ts`
- Modify: `src/commands/crawl/command.ts`
- Modify: `src/commands/crawl/embed.ts`
- Test: `src/__tests__/commands/status-command.test.ts`

**Step 1: Write failing test update**
Update a status-command test to mock `getRecentJobIds` with `mockResolvedValue` and `await` use. Expect failure before implementation changes.

**Step 2: Run test to verify failure**
Run: `pnpm test src/__tests__/commands/status-command.test.ts`
Expected: FAIL

**Step 3: Implement async job-history**
- Use `node:fs/promises` for `readFile`, `writeFile`, `mkdir`.
- Convert `loadHistory`, `saveHistory`, `recordJob`, `getRecentJobIds`, `removeJobIds`, `clearJobHistory` to async.
- Preserve `.cache/job-history.json` format and best-effort error handling.

**Step 4: Update callers**
- Add `await` to `recordJob`, `getRecentJobIds`, `removeJobIds` call sites.
- Ensure function signatures remain async in command handlers as needed.

**Step 5: Update tests**
- Switch mocks to async (`mockResolvedValue`).
- `await` command handlers as needed.

**Step 6: Run tests**
Run: `pnpm test src/__tests__/commands/status-command.test.ts`
Expected: PASS

---

### Task 4: Verification sweep

**Files:**
- No code changes unless test failures require it.

**Step 1: Run focused tests**
Run:
- `pnpm test src/__tests__/utils/embed-queue.test.ts`
- `pnpm test src/__tests__/utils/background-embedder.test.ts`
- `pnpm test src/__tests__/commands/status-command.test.ts`

**Expected:** All PASS

---

### Task 5: Documentation update

**Files:**
- Modify: `.docs/sessions/2026-02-05-06-39-io-blocking-investigation.md`

**Step 1: Append implementation summary and test results**
Add a short completion note with files changed and tests run.

**Step 2: (Optional) Commit**
Only if user requests.
