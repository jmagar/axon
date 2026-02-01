# Session Log: Embedder daemon operational

Timestamp: 17:11:48 | 01/31/2026

## Goal
- Make embedder daemon fully operational with Docker stack and webhook delivery.

## Changes
- Added configurable embed queue directory via FIRECRAWL_EMBEDDER_QUEUE_DIR.
- Ignored .cache directory in git.
- Allowed local webhook delivery in Firecrawl via ALLOW_LOCAL_WEBHOOKS.
- Set embedder-daemon container overrides for FIRECRAWL_API_URL and QDRANT_URL.

## Verification
- Built CLI (pnpm build).
- Started docker compose stack.
- Triggered crawl with embed; webhook delivered and embedder processed the job.

## Notes
- Embedder daemon now reads queue from .cache/embed-queue shared with host.
- Webhook delivery to embedder-daemon confirmed after allowing local webhooks.
