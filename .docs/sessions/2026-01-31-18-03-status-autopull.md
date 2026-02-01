# Session Log: Status auto-pull

Timestamp: 18:03:05 | 01/31/2026

## Goal
- Auto-pull recent crawl/batch/extract job IDs for `firecrawl status`.

## Changes
- Added job history tracking in .cache/job-history.json.
- Recorded job IDs on crawl/batch/extract actions.
- Status command now auto-uses recent job IDs if none provided.
- Added tests for auto-pull behavior.

## Tests
- pnpm test -- src/__tests__/commands/status-command.test.ts
