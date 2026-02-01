# Session Log: Embedder webhook setup

Timestamp: 16:03:22 | 01/31/2026

## Goal
- Configure webhook environment variables for the embedder daemon.

## Changes
- Added FIRECRAWL_EMBEDDER_WEBHOOK_* variables to .env.
- Documented embedder webhook variables in .env.example.

## Notes
- FIRECRAWL_EMBEDDER_WEBHOOK_URL should be reachable by the Firecrawl API server.
- Port 53000 was checked and unused.
