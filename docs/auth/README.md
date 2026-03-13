# Axon Auth — Overview
Last Modified: 2026-03-11

Axon currently uses a simple development auth model:

- API token for `/api/*`, `/ws`, `/download/*`, and `/output/*`
- Optional shell-specific token for `/ws/shell`
- MCP auth (OAuth or API key) for `/mcp`

## Methods

| Method | Surface | Doc |
|--------|---------|-----|
| **API token** | WebSocket (`/ws`), `/api/*` routes, `/download/*`, `/output/*` | [API-TOKEN.md](API-TOKEN.md) |
| **Shell token** | Shell WebSocket (`/ws/shell`) only | [API-TOKEN.md — Shell WebSocket](API-TOKEN.md#shell-websocket-wsshell) |
| **MCP auth** | `/mcp` endpoint only | [MCP-AUTH.md](MCP-AUTH.md) |

## Which method to use

```text
Using the web UI, browser websocket, API routes, downloads, or output files?
  → Use the shared API token

Connecting a terminal (shell WebSocket at /ws/shell)?
  → Use AXON_SHELL_WS_TOKEN, or let it fall back to AXON_WEB_API_TOKEN

Connecting an MCP client (Claude Desktop, mcporter, etc.)?
  → Use MCP auth — OAuth `atk_` tokens or `AXON_MCP_API_KEY` bearer token are scoped to /mcp
```

## Source files

| File | Purpose |
|------|---------|
| `crates/web/tailscale_auth.rs` | Shared token comparison and auth result types for Rust web surfaces |
| `crates/web.rs` | WS upgrade handler and startup auth log |
| `crates/web/download.rs` | Auth for `/download/*` via shared API token |
| `apps/web/proxy.ts` | Next.js middleware enforcing token auth on `/api/*` |
| `apps/web/shell-server.mjs` | Shell WebSocket server (port 49011) — token-only auth |
| `crates/mcp/server/oauth_google/` | Google OAuth broker — issues `atk_` tokens for `/mcp` |
