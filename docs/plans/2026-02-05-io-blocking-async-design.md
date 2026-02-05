# IO Blocking Async Refactor Design

**Date:** 2026-02-05  
**Project:** cli-firecrawl  
**Scope:** Convert hot-path filesystem operations to async in `embed-queue` and `job-history` only.

## Goals
- Eliminate event-loop blocking in background embedder polling loop.
- Preserve existing behavior and JSON formats.
- Minimize API surface churn outside queue/history paths.

## Non-Goals
- No changes to settings/credentials/output/command file IO.
- No new features or behavior changes beyond async IO.

## Targeted Modules
- `src/utils/embed-queue.ts`
- `src/utils/job-history.ts`
- Callers: `src/utils/background-embedder.ts`, `src/commands/status.ts`, other commands using history or queue helpers.

## Design Overview
### Embed Queue (async)
- Replace sync fs calls with `node:fs/promises` equivalents.
- `ensureQueueDir()` becomes async and is awaited by all public operations.
- `enqueueEmbedJob()`, `getEmbedJob()`, `updateEmbedJob()`, `listEmbedJobs()`, `getPendingJobs()`, `getStalePendingJobs()`, `getStuckProcessingJobs()`, `markJob*()`, `tryClaimJob()` become async.
- Use `proper-lockfile` async `lock()` in `tryClaimJob()` with existing options (`retries: 0`, `stale: 60000`).
- Preserve sorting behavior and error logging.
- Preserve permissions (`mode: 0o600` on writes, `chmod` best-effort).

### Job History (async)
- Use `node:fs/promises` for reads/writes and directory creation.
- `loadHistory()`, `saveHistory()`, `recordJob()`, `getRecentJobIds()`, `removeJobIds()`, `clearJobHistory()` become async.
- Preserve file location (`.cache/job-history.json`) and JSON schema.

## Error Handling
- Maintain current behavior: missing files return empty values; parse errors return empty history or null job.
- Keep existing error messages where they exist.

## Testing Plan
- Update unit tests to `await` async functions and mock `fs/promises` as needed.
- Target tests:
  - `src/__tests__/utils/embed-queue.test.ts`
  - `src/__tests__/utils/background-embedder.test.ts`
  - `src/__tests__/commands/status-command.test.ts`
  - Any tests importing `job-history` helpers

## Rollout
- Narrow change set with focused tests.
- No config changes or new dependencies expected.
