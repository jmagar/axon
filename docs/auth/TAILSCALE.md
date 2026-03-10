# Tailscale Serve — Axon Network Access
Last Modified: 2026-03-10

## Table of Contents

1. [Overview](#overview)
2. [How It Works](#how-it-works)
3. [Route Map](#route-map)
4. [Auth Architecture](#auth-architecture)
5. [Setup](#setup)
6. [Environment Variables](#environment-variables)
7. [Verification](#verification)
8. [Troubleshooting](#troubleshooting)
9. [Security Model](#security-model)

---

## Overview

Axon is accessed remotely via `tailscale serve`, which acts as the network-layer identity provider.
All tailnet devices can reach the app at:

```
https://<machine-name>.<tailnet-name>.ts.net/
```

No client-side configuration is required. Any device authenticated to the tailnet gets identity
headers injected automatically by the Tailscale daemon.

---

## How It Works

```
[Browser on tailnet device]
        │
        │  wss://<machine>.ts.net/ws?token=...
        ▼
[tailscale serve daemon]
   ① Strips any incoming Tailscale-* headers (prevents spoofing)
   ② Injects verified identity headers for the authenticated user:
        Tailscale-User-Login: user@domain
        Tailscale-User-Name: Display Name
        Tailscale-User-Profile-Pic: https://...
        ▼
[splits by path — see Route Map]
        ▼
[Rust axon serve / Next.js / Shell server]
   ③ Rust WS gate validates BOTH injected TS header AND API token (dual-auth)
```

**Critical invariant:** Tailscale only injects identity headers for `tailscale serve` traffic.
Direct connections to port 49010 or 49000 via the Tailscale IP do NOT receive headers.
Always access the app through the `.ts.net` URL, never via a raw Tailscale IP + port.

---

## Route Map

| Path | Backend | Purpose |
|------|---------|---------|
| `/` | `http://localhost:49010` | Next.js web UI |
| `/ws` | `http://localhost:49000/ws` | Rust WebSocket gate (Tailscale headers injected here) |
| `/ws/shell` | `http://localhost:49011` | Shell server (node-pty) — more specific than `/ws`, takes precedence |
| `/output` | `http://localhost:49000` | Rust output file serving |
| `/download` | `http://localhost:49000` | Rust crawl artifact downloads |

**Why `/ws` routes directly to Rust (not through Next.js):**
The Tailscale identity headers must reach the Rust WS auth gate. If routed through Next.js first,
the headers arrive at Next.js but the Next.js WS rewrite proxy creates a new connection to Rust
without forwarding them. Routing `/ws` directly from tailscale serve to Rust bypasses this hop
and delivers the headers intact.

**Why `/ws/shell` is a separate route:**
Tailscale serve uses prefix matching. Without an explicit `/ws/shell` entry, `/ws` would catch
shell WebSocket connections and misroute them to Rust at port 49000, which has no shell handler.
The more specific `/ws/shell` route takes precedence.

---

## Auth Architecture

Axon uses **dual-auth** by default (`AXON_REQUIRE_DUAL_AUTH=true`): both factors must be present
on every WebSocket and download/output request.

| Factor | Source | Verified by |
|--------|--------|-------------|
| **Tailscale identity** | `Tailscale-User-Login` header injected by tailscale serve | Rust `tailscale_auth.rs` |
| **API token** | `?token=` query param appended by `use-axon-ws.ts` | Rust `tailscale_auth.rs` |

The client-side token is set via `NEXT_PUBLIC_AXON_API_TOKEN` in `.env`. It must equal
`AXON_WEB_API_TOKEN` (what Rust reads). The browser sends it as `?token=<encoded>` on the WS URL;
`encodeURIComponent` handles special characters (e.g. `+` → `%2B`).

**To allow either factor alone** (e.g. API-token-only from non-Tailscale clients):
```bash
AXON_REQUIRE_DUAL_AUTH=false
```

---

## Setup

### First-time configuration

```bash
# 1. Reset any stale config
tailscale serve reset

# 2. Route web UI to Next.js
tailscale serve --bg --set-path / http://localhost:49010

# 3. Route WebSocket directly to Rust (so Tailscale headers reach the auth gate)
tailscale serve --bg --set-path /ws http://localhost:49000/ws

# 4. Route shell WebSocket (more specific than /ws — must be registered explicitly)
tailscale serve --bg --set-path /ws/shell http://localhost:49011

# 5. Route file-serving endpoints
tailscale serve --bg --set-path /output   http://localhost:49000
tailscale serve --bg --set-path /download http://localhost:49000

# 6. Verify
tailscale serve status
```

Expected output:
```
https://<machine>.ts.net (tailnet only)
|-- /         proxy http://localhost:49010
|-- /ws       proxy http://localhost:49000/ws
|-- /ws/shell proxy http://localhost:49011
|-- /output   proxy http://localhost:49000
|-- /download proxy http://localhost:49000
```

### After a machine reboot

`tailscale serve` config **persists across reboots** — the daemon restores it automatically.
No re-configuration needed after rebooting the machine.

---

## Environment Variables

All in `.env` at project root. The binary calls `load_dotenv()` at startup and finds `.env` by
walking ancestors of the executable path and CWD — no manual sourcing required.

| Variable | Where used | Notes |
|----------|-----------|-------|
| `AXON_WEB_API_TOKEN` | Rust WS gate | Second factor in dual-auth. Must match `NEXT_PUBLIC_AXON_API_TOKEN`. |
| `NEXT_PUBLIC_AXON_API_TOKEN` | Browser WS client | Sent as `?token=` on WS URL. Must match `AXON_WEB_API_TOKEN`. |
| `AXON_REQUIRE_DUAL_AUTH` | Rust WS gate | Default: `true`. Set `false` to allow token-only auth. |
| `AXON_TAILSCALE_STRICT` | Rust WS gate | Default: `false`. Set `true` to reject any request without TS headers. |
| `AXON_TAILSCALE_ALLOWED_USERS` | Rust WS gate | Comma-separated email allowlist. Empty = any tailnet user allowed. |

---

## Verification

### Check current routes
```bash
tailscale serve status
```

### Test WebSocket auth end-to-end
```bash
TS_URL=$(tailscale serve status 2>/dev/null | grep -oP 'https://[^\s]+(?= \()')
TOKEN=$(grep '^AXON_WEB_API_TOKEN=' .env | cut -d= -f2-)
ENCODED=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$TOKEN")

# Expect: HTTP 101 (WebSocket upgrade) — curl times out holding the connection, exit 28 is normal
curl -s --max-time 2 \
  --http1.1 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "${TS_URL}/ws?token=${ENCODED}" \
  -o /dev/null -w "%{http_code}\n"
# → 101
```

### Test web UI
```bash
TS_URL=$(tailscale serve status 2>/dev/null | grep -oP 'https://[^\s]+(?= \()')
curl -s -o /dev/null -w "%{http_code}\n" "${TS_URL}/"
# → 200
```

---

## Troubleshooting

### `ws denied: AXON_REQUIRE_DUAL_AUTH=true but no valid Tailscale header`

The Tailscale identity header isn't reaching Rust. Causes in order of likelihood:

1. **Accessing via raw IP/port instead of `.ts.net` URL** — direct connections bypass tailscale
   serve and never get headers injected. Always use the `https://<machine>.ts.net` URL.

2. **`tailscale serve` misconfigured or stale** — run `tailscale serve status` and verify all five
   routes are present. If `/ws` is missing or points to the wrong port, run the setup commands above.

3. **`/ws` route missing the `/ws` path suffix in destination** — the destination must be
   `http://localhost:49000/ws`, not `http://localhost:49000`. Without the suffix, requests hit
   Rust's root handler and return 404 before auth is even checked.

4. **`/ws/shell` not registered as its own route** — without it, `/ws` prefix-matches shell
   connections and sends them to Rust at 49000, which returns 404.

### `ws denied: AXON_REQUIRE_DUAL_AUTH=true but token missing or wrong`

Tailscale header arrived (TS routing is correct) but the API token check failed.

1. Verify `AXON_WEB_API_TOKEN` and `NEXT_PUBLIC_AXON_API_TOKEN` are set and identical in `.env`.
2. The token may contain `+` or other URL-special characters. The browser's `encodeURIComponent`
   handles this correctly; manual `curl` tests must URL-encode the token manually:
   ```bash
   python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$TOKEN"
   ```
3. The running `axon serve` process loads `.env` automatically via `load_dotenv()` in `main.rs`.
   Note: `/proc/PID/environ` will NOT show these vars — they are set via `std::env::set_var()`
   at runtime, which `/proc/PID/environ` doesn't reflect. This is expected behavior.

### `tailscale serve status` shows old/wrong routes

Reset and re-apply:
```bash
tailscale serve reset
# then re-run the setup commands above
```

### Routes disappear after partial reconfiguration

Removing a route with `tailscale serve --https=443 <path> off` can drop sibling routes in some
tailscale versions. Always run `tailscale serve status` after any route change and re-add any
missing entries.

---

## Security Model

**Header injection trust model:**
- `tailscale serve` strips ALL incoming `Tailscale-*` headers before forwarding.
- It then injects its own verified headers for the authenticated tailnet user.
- This means the presence of `Tailscale-User-Login` in a request that reached Rust via port 49000
  can only have been injected by the local tailscale daemon — not forged by a client.
- **This is only true while port 49000 is not directly reachable from the network.** Rust binds to
  `0.0.0.0:49000` for local dev, so firewall rules or network isolation are required if running
  in an environment where 49000 could be reached externally.

**Dual-auth rationale:**
- Tailscale identity alone: verifies the user is on the tailnet, but not that they have the
  application secret.
- API token alone: verifies knowledge of the secret, but not tailnet membership.
- Both together: verifies tailnet membership AND knowledge of the application secret.

**Allowlist (optional hardening):**
To restrict access to specific tailnet users even if you've shared your device externally:
```bash
AXON_TAILSCALE_ALLOWED_USERS=you@domain.com,colleague@domain.com
```
