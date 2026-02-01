# Session Log: Embedder daemon docker wireup

Timestamp: 16:42:12 | 01/31/2026

## Goal
- Wire the embedder webhook endpoint into docker-compose so Firecrawl can call it.

## Changes
- Added embedder-daemon service to docker-compose.
- Set FIRECRAWL_EMBEDDER_WEBHOOK_URL to use docker service name.
- Updated .env.example to match docker URL.

## Notes
- Port 53000 is unused on the host.
- Requires dist build before starting embedder daemon.
