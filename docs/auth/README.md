# Axon Auth — Overview
Last Modified: 2026-03-10

Axon has five independent authentication methods. They serve different surfaces and are not interchangeable.

## Methods

| Method | Surface | Doc |
|--------|---------|-----|
| **Tailscale serve** | WebSocket (`/ws`), downloads, web UI | [TAILSCALE.md](TAILSCALE.md) |
| **API token** | WebSocket (`/ws`), `/api/*` routes, `/download/*`, `/output/*` | [API-TOKEN.md](API-TOKEN.md) |
| **SSH key** | WebSocket (`/ws`), `/download/*`, `/output/*` | [SSH-KEY.md](SSH-KEY.md) |
| **Shell token** | Shell WebSocket (`/ws/shell`) only | [API-TOKEN.md — Shell WebSocket](API-TOKEN.md#shell-websocket-wsshell) |
| **MCP OAuth** | `/mcp` endpoint only | [MCP-OAUTH.md](MCP-OAUTH.md) |

## Which method to use

```
Accessing via browser on the tailnet?
  → Use Tailscale serve (automatic — no client config needed)

Scripting against /api/* or downloading crawl artifacts from a trusted machine?
  → Use API token (Authorization: Bearer or x-api-key header)

Headless/CLI client that can sign with an SSH key?
  → Use SSH key challenge-response

Connecting a terminal (shell WebSocket at /ws/shell)?
  → Shell token (AXON_SHELL_WS_TOKEN — separate from the main API token)

Connecting an MCP client (Claude Desktop, mcporter, etc.)?
  → Use MCP OAuth — atk_ tokens are scoped to /mcp only
```

## Dual-auth mode

When `AXON_REQUIRE_DUAL_AUTH=true` (the default), the WS gate requires BOTH:
- A valid Tailscale identity header (injected by tailscale serve), AND
- A valid API token (`?token=` query param)

Either factor alone is rejected. Set `AXON_REQUIRE_DUAL_AUTH=false` to allow either factor independently.

**MCP OAuth `atk_` tokens are entirely separate** — they authenticate `/mcp` only and have no effect on the WS gate or `/api/*` routes.

## Hardening options

| Variable | Effect |
|----------|--------|
| `AXON_REQUIRE_DUAL_AUTH=true` (default) | Require BOTH Tailscale identity AND API token on every request |
| `AXON_TAILSCALE_STRICT=true` | Reject all non-Tailscale requests — no token fallback at all |
| `AXON_TAILSCALE_ALLOWED_USERS=a@b.com,c@d.com` | Restrict Tailscale auth to specific email addresses |

Details in [TAILSCALE.md](TAILSCALE.md) and [API-TOKEN.md](API-TOKEN.md).

## Auth priority order (WS gate)

SSH key auth is checked first (when `X-SSH-Nonce` header is present), then dual-auth/Tailscale/token. Full priority:

```
1. SSH key   — X-SSH-Nonce present → check_ssh_headers()
2. Dual-auth — AXON_REQUIRE_DUAL_AUTH=true → both TS header AND token required
3. Tailscale — Tailscale-User-Login header present (single-factor, non-strict mode)
4. Token     — AXON_WEB_API_TOKEN set (single-factor fallback)
5. Open      — debug builds only, no auth configured
```

## Source files

| File | Purpose |
|------|---------|
| `crates/web/tailscale_auth.rs` | Tailscale header extraction, token comparison, `check_auth()`, dual-auth logic |
| `crates/web/ssh_auth.rs` | SSH nonce store, `check_ssh_headers()`, `ssh-keygen -Y verify` subprocess |
| `crates/web.rs` | WS upgrade handler, `/auth/ssh-challenge` endpoint, startup auth log |
| `crates/web/download.rs` | Auth for `/download/*` — same stack as WS (SSH key → TS/token) |
| `apps/web/proxy.ts` | Next.js middleware — token + Tailscale header check for `/api/*` |
| `apps/web/shell-server.mjs` | Shell WebSocket server (port 49011) — token-only auth via `AXON_SHELL_WS_TOKEN` |
| `crates/mcp/server/oauth_google/` | Google OAuth broker — issues `atk_` tokens for `/mcp` |
