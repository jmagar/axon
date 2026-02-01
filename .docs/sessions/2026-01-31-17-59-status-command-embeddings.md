# Session Log: Status command for jobs + embeddings

Timestamp: 17:59:58 | 01/31/2026

## Goal
- Add `firecrawl status` to show active crawls, optional job statuses, and embedding queue status.

## Changes
- Added status command that reports crawl/batch/extract status and embedding queue summary.
- Wired status command into CLI and documented in README.
- Added unit tests for status command.

## Tests
- pnpm test -- src/__tests__/commands/status-command.test.ts
