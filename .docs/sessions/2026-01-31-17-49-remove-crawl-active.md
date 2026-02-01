# Session Log: Remove crawl --active

Timestamp: 17:49:48 | 01/31/2026

## Goal
- Remove `firecrawl crawl --active` and rely on `firecrawl list`.

## Changes
- Removed `--active` flag from crawl command and options.
- Removed crawl active handler/tests.
- Updated README to document list as a standalone command.

## Tests
- pnpm test -- src/__tests__/commands/crawl.test.ts src/__tests__/commands/list.test.ts
