# API Token Auth
Last Modified: 2026-03-11

The shared API token is the primary auth mechanism for current Axon development.

It protects:

- `/api/*`
- `/ws`
- `/download/*`
- `/output/*`

The browser copy of the same token is also used by the web UI client helpers.

## Environment

| Variable | Used by | Purpose |
|----------|---------|---------|
| `AXON_WEB_API_TOKEN` | Rust web server + Next middleware | Server-side token check |
| `NEXT_PUBLIC_AXON_API_TOKEN` | Browser client | Appended as `?token=` on `/ws` and sent as `x-api-key` on `/api/*` |
| `AXON_WEB_ALLOW_INSECURE_DEV` | Next middleware + shell server | Localhost-only development bypass |
| `AXON_SHELL_WS_TOKEN` | Shell websocket server | Optional dedicated token for `/ws/shell` |
| `NEXT_PUBLIC_SHELL_WS_TOKEN` | Browser shell client | Optional client token for `/ws/shell` |

## Delivery

### WebSocket (`/ws`)

The web UI appends the token as a query parameter:

```text
ws://host/ws?token=<url-encoded-token>
```

Source:

- `apps/web/hooks/use-axon-ws.ts`
- `crates/web.rs`

### HTTP API (`/api/*`)

The Next.js client helper sends:

- `x-api-key: <token>`

The middleware also accepts:

- `Authorization: Bearer <token>`

Source:

- `apps/web/lib/api-fetch.ts`
- `apps/web/proxy.ts`

### Downloads (`/download/*`) and output files (`/output/*`)

These Rust endpoints accept the shared token from:

- `Authorization: Bearer <token>`
- `x-api-key: <token>`
- `?token=<token>`

Source:

- `crates/web/download.rs`
- `crates/web.rs`

## Shell WebSocket (`/ws/shell`)

The shell server runs separately on port `49011` and uses token auth only.

Priority:

1. `AXON_SHELL_WS_TOKEN`
2. `AXON_WEB_API_TOKEN`
3. `AXON_WEB_ALLOW_INSECURE_DEV=true` loopback bypass

## Security Notes

- Keep `AXON_WEB_API_TOKEN` and `NEXT_PUBLIC_AXON_API_TOKEN` identical.
- If the token changes, restart or rebuild the web app so the browser bundle picks up the new value.
- Query-string delivery for `/ws` and browser downloads is convenient but visible in URL logs. Rotate the token if those logs are exposed.

## Troubleshooting

### `401 Unauthorized`

1. Verify `AXON_WEB_API_TOKEN` is set.
2. Verify `NEXT_PUBLIC_AXON_API_TOKEN` matches it for browser clients.
3. Confirm the client is actually sending `x-api-key`, `Authorization: Bearer`, or `?token=`.

### `API authentication is not configured`

`AXON_WEB_API_TOKEN` is not configured and `AXON_WEB_ALLOW_INSECURE_DEV` is false. Set the token and restart the web app.
