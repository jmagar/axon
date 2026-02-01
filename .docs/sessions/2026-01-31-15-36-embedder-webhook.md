# Session Log: Embedder webhook

Timestamp: 15:36:45 | 01/31/2026

## Goal
- Replace crawl status polling for background embedding with webhook-driven completion handling.

## Reasoning
- Polling caused repeated "still scraping" retries. A webhook lets the embedder run only when Firecrawl signals completion.

## Changes
- Added embedder webhook configuration (URL/secret/port/path) to global config.
- Introduced embedder webhook helpers for config and payload parsing.
- Reworked background embedder daemon to start an HTTP webhook server and process jobs on completion events.
- Updated crawl command to attach webhook config for async jobs and adjusted user messaging.
- Added tests for webhook parsing and crawl webhook wiring.

## Tests
- pnpm test -- src/__tests__/commands/crawl.test.ts src/__tests__/utils/embedder-webhook.test.ts
