# API Token Auth — Axon
Last Modified: 2026-03-10

## Table of Contents

1. [Overview](#overview)
2. [How It Works](#how-it-works)
3. [Surfaces](#surfaces)
4. [Setup](#setup)
5. [Environment Variables](#environment-variables)
6. [Token Delivery Methods](#token-delivery-methods)
7. [Dual-Auth Mode](#dual-auth-mode)
8. [Security Notes](#security-notes)
9. [Troubleshooting](#troubleshooting)

---

## Overview

The API token is a static shared secret that gates access to two surfaces:

- **WebSocket (`/ws`)** — validated by the Rust WS gate (`crates/web.rs`)
- **`/api/*` routes** — validated by the Next.js middleware (`apps/web/proxy.ts`)

One token covers both. The same secret is configured in two env vars that must always match:

| Env var | Used by | How |
|---------|---------|-----|
| `AXON_WEB_API_TOKEN` | Rust WS gate + Next.js middleware | Server-side comparison |
| `NEXT_PUBLIC_AXON_API_TOKEN` | Browser WS client | Appended as `?token=` on WS URL |

---

## How It Works

```
[Browser]
    │  WS: wss://<host>/ws?token=<encoded-token>
    ▼
[Rust WS gate — crates/web.rs]
    ① Checks for X-SSH-Nonce (SSH key auth takes priority)
    ② Checks AXON_REQUIRE_DUAL_AUTH (requires TS header + token together)
    ③ Checks Tailscale-User-Login header (single-factor, non-strict mode)
    ④ Checks ?token= against AXON_WEB_API_TOKEN (token fallback)

[Browser / Script]
    │  HTTP: GET /api/...  Authorization: Bearer <token>
    ▼
[Next.js middleware — apps/web/proxy.ts]
    ① Checks Authorization: Bearer <token>
    ② Checks x-api-key header
    ③ Checks ?token= query param (only if AXON_WEB_ALLOW_QUERY_TOKEN=true)
    ④ Compares against AXON_WEB_API_TOKEN using constant-time equality
```

Both comparison functions use constant-time equality (`timingSafeEqual` in TypeScript, XOR-fold in Rust) to prevent timing-based token oracle attacks.

---

## Surfaces

### WebSocket (`/ws`)

The browser client (`hooks/use-axon-ws.ts`) appends the token as a URL query parameter:

```
wss://<host>/ws?token=<encodeURIComponent(token)>
```

`encodeURIComponent` handles special characters (e.g. `+` → `%2B`). The Rust gate reads `query_token` from the URL and compares it to `AXON_WEB_API_TOKEN`.

### Download and Output Endpoints (`/download/*`, `/output/*`)

These Rust endpoints use the same full auth stack as the WebSocket gate: SSH key auth first (if `X-SSH-Nonce` is present), then dual-auth/Tailscale/token via `check_auth()`. The token is read from the `Authorization: Bearer` header.

```bash
TOKEN=$(grep '^AXON_WEB_API_TOKEN=' .env | cut -d= -f2-)
curl -H "Authorization: Bearer $TOKEN" https://<host>/download/<job_id>/pack.md
```

### `/api/*` Routes

Next.js middleware (`proxy.ts`) validates on every `/api/*` request. Token can arrive via:

1. `Authorization: Bearer <token>` header
2. `x-api-key: <token>` header
3. `?token=<token>` query param (opt-in only — see below)

---

## Setup

### 1. Generate a token

```bash
# 32 random bytes — base64 encoded (no padding)
openssl rand -base64 32
```

Example output: `4TDc7+OFAzm29G5Pjz4qhUox3MeA1bn0MSiRp0LGrE4=`

### 2. Set in `.env`

```bash
# Server-side token (Rust gate + Next.js middleware)
AXON_WEB_API_TOKEN=4TDc7+OFAzm29G5Pjz4qhUox3MeA1bn0MSiRp0LGrE4=

# Client-side copy — must be the same value
NEXT_PUBLIC_AXON_API_TOKEN=4TDc7+OFAzm29G5Pjz4qhUox3MeA1bn0MSiRp0LGrE4=
```

Both variables must be set and must match exactly.

### 3. Restart servers

The Rust binary loads `.env` via `load_dotenv()` at startup. Next.js reads `NEXT_PUBLIC_*` at build time (dev: at startup via `pnpm dev`). Restart both after changing `.env`:

```bash
# Restart everything
just stop && just dev
```

---

## Environment Variables

| Variable | Where | Notes |
|----------|-------|-------|
| `AXON_WEB_API_TOKEN` | Rust WS gate + Next.js middleware | Required for token auth. If unset, token auth is disabled. |
| `NEXT_PUBLIC_AXON_API_TOKEN` | Browser WS client | Must match `AXON_WEB_API_TOKEN`. Sent as `?token=` on WS URL. |
| `AXON_REQUIRE_DUAL_AUTH` | Rust WS gate + Next.js middleware | Default: `true`. When true, token alone is not sufficient — Tailscale header also required. |
| `AXON_WEB_ALLOW_QUERY_TOKEN` | Next.js middleware | Default: `false`. Set `true` to enable `?token=` on `/api/*` routes (not needed for WS). |
| `AXON_WEB_ALLOW_INSECURE_DEV` | Next.js middleware | Default: `false`. Allows localhost access without auth in dev. Never enable in production. |

---

## Token Delivery Methods

### WebSocket (always `?token=`)

The WS upgrade request does not support custom headers in browser clients. The token is always sent as a URL query param. The browser client URL-encodes it automatically:

```typescript
// hooks/use-axon-ws.ts
const url = `${wsBase}?token=${encodeURIComponent(apiToken)}`
```

### `/api/*` (headers preferred)

Scripts and API clients should use headers (not query params) for `/api/*`:

```bash
# Preferred: Authorization header
curl -H "Authorization: Bearer $TOKEN" https://<host>/api/cortex/stats

# Alternative: x-api-key header
curl -H "x-api-key: $TOKEN" https://<host>/api/cortex/stats

# Query param: requires AXON_WEB_ALLOW_QUERY_TOKEN=true (disabled by default)
curl "https://<host>/api/cortex/stats?token=$TOKEN"
```

---

## Shell WebSocket (`/ws/shell`)

The shell WebSocket (node-pty terminal) runs as a separate server on port `49011` (`apps/web/shell-server.mjs`) and has its **own independent token**. It does not participate in Tailscale auth, SSH key auth, or dual-auth mode.

**Token resolution order:**
1. `AXON_SHELL_WS_TOKEN` — if set, this is the only accepted token
2. `AXON_WEB_API_TOKEN` — fallback if `AXON_SHELL_WS_TOKEN` is unset
3. If neither is set and `AXON_WEB_ALLOW_INSECURE_DEV=true` — loopback connections are allowed
4. Otherwise — denied

**Token delivery:** `Authorization: Bearer <token>` header or `?token=` query param.

**Origin validation:** `AXON_SHELL_ALLOWED_ORIGINS` (comma-separated), falling back to `AXON_WEB_ALLOWED_ORIGINS`. When neither is set, origin must match the request host.

```bash
# Separate shell token (optional — otherwise falls back to AXON_WEB_API_TOKEN)
AXON_SHELL_WS_TOKEN=separate-shell-token

# Shell-specific allowed origins (optional — otherwise inherits AXON_WEB_ALLOWED_ORIGINS)
AXON_SHELL_ALLOWED_ORIGINS=
```

In `just dev`, the shell server starts alongside `axon serve` and Next.js. The Next.js rewrite (`/ws/shell → http://localhost:49011`) proxies browser connections to it.

---

## Dual-Auth Mode

When `AXON_REQUIRE_DUAL_AUTH=true` (the default), the token is the **second factor** — not sufficient alone:

- **WS gate**: requires `Tailscale-User-Login` header AND `?token=` param. Either alone → denied.
- **Next.js middleware**: requires `tailscale-user-login` header AND valid token. Either alone → denied.

This means:
- Requests from non-Tailscale clients (e.g. direct API calls from scripts not on the tailnet) are denied in dual-auth mode.
- To allow token-only access (e.g. from a server on the tailnet but not via Tailscale Serve), set `AXON_REQUIRE_DUAL_AUTH=false`.

**MCP OAuth `atk_` tokens are separate** — they authenticate `/mcp` only and have no effect here.

---

## Security Notes

**Treat the token as a password:**
- Never commit it to version control (`.env` is gitignored)
- Never log it (the Rust gate and proxy.ts do not log tokens)
- Rotate by updating `.env` and restarting both servers

**Constant-time comparison** is used in both the Rust gate and proxy.ts to prevent timing attacks.

**Token in WS URL is visible in server logs.** If your Nginx/Tailscale logs include full URLs, the token appears in the query string. Rotate if logs may be accessible to untrusted parties.

**`AXON_WEB_API_TOKEN` and `AXON_WEB_ALLOW_INSECURE_DEV=true` cannot coexist safely.** If `ALLOW_INSECURE_DEV` is set and no token is configured, any localhost request is allowed. Only use this for local development.

---

## Troubleshooting

### `ws denied: AXON_REQUIRE_DUAL_AUTH=true but token missing or wrong`

The Tailscale header arrived (tailscale serve is configured correctly) but the token check failed.

1. Verify `AXON_WEB_API_TOKEN` and `NEXT_PUBLIC_AXON_API_TOKEN` are set and identical in `.env`.
2. The token may contain `+` or other URL-special characters. The browser's `encodeURIComponent` handles this; for manual `curl` tests, URL-encode manually:
   ```bash
   TOKEN=$(grep '^AXON_WEB_API_TOKEN=' .env | cut -d= -f2-)
   ENCODED=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$TOKEN")
   curl -s --max-time 2 ... "https://<host>/ws?token=${ENCODED}"
   ```
3. Check the running process loaded the current `.env`. Restart `axon serve` if `.env` changed after startup.

### `401 Unauthorized` on `/api/*`

1. Check that `AXON_WEB_API_TOKEN` is set in `.env`.
2. Verify the token is being sent in the request:
   ```bash
   TOKEN=$(grep '^AXON_WEB_API_TOKEN=' .env | cut -d= -f2-)
   curl -s -w "\nHTTP %{http_code}\n" \
     -H "Authorization: Bearer $TOKEN" \
     http://localhost:49010/api/cortex/stats
   ```
3. In dual-auth mode, ensure the Tailscale header is also present (see `docs/auth/TAILSCALE.md`).

### `503 Service Unavailable` on `/api/*`

`AXON_WEB_API_TOKEN` is not configured and `AXON_WEB_ALLOW_INSECURE_DEV` is false. Set the token in `.env` and restart Next.js.

### `/proc/PID/environ` does not show the token

Expected. The Rust binary sets environment variables via `std::env::set_var()` at runtime (from `dotenvy`), which `/proc/PID/environ` (the initial execve snapshot) does not reflect. The token is active even if it appears absent in `/proc/PID/environ`.
