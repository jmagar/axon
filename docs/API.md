# API Reference

Version: 1.0.0
Last Updated: 01:26:53 | 02/25/2026 EST

## Table of Contents

1. Scope
2. Transport Summary
3. WebSocket API (`/ws`)
4. HTTP API (`apps/web` routes)
5. Error Model
6. Security Constraints
7. Compatibility Notes
8. Source Map

## Scope

This document covers externally consumed interfaces in this repo:

- Axum WebSocket bridge from `crates/web.rs` (`/ws`)
- Axum download/output routes from `crates/web.rs` and `crates/web/download.rs`
- Next.js API routes under `apps/web/app/api/*`

It does not document internal Rust function signatures.

## Transport Summary

| Surface | Path | Producer | Consumer |
|---|---|---|---|
| WebSocket | `/ws` | `crates/web.rs` + `crates/web/execute/*` | `apps/web/hooks/*` |
| HTTP GET | `/output/{*path}` | `crates/web.rs` | browser UI |
| HTTP GET | `/download/{job_id}/...` | `crates/web/download.rs` | browser UI |
| HTTP REST | `/api/*` | Next.js route handlers | browser UI |

## WebSocket API (`/ws`)

### Client -> Server Messages

Defined in `apps/web/lib/ws-protocol.ts` as `WsClientMsg`.

| Type | Shape | Description |
|---|---|---|
| `execute` | `{ type, mode, input, flags }` | Run one allowed axon mode via subprocess |
| `cancel` | `{ type, id }` | Cancel async job by id |
| `read_file` | `{ type, path }` | Read a generated file from crawl output context |

`mode` is allowlisted by server-side `ALLOWED_MODES` in `crates/web/execute/mod.rs`.

### Server -> Client Messages

Defined in `apps/web/lib/ws-protocol.ts` as `WsServerMsg`.

| Type | Shape | Description |
|---|---|---|
| `command_start` | `{ mode }` | Command accepted and about to run |
| `output` | `{ line }` | generic output line |
| `log` | `{ line }` | stderr/log line |
| `stdout_json` | `{ data }` | parsed JSON stdout payload |
| `stdout_line` | `{ line }` | raw stdout line |
| `crawl_progress` | `{ job_id, status, pages_crawled, ... }` | async crawl status polling update |
| `crawl_files` | `{ files, output_dir, job_id? }` | output manifest payload |
| `file_content` | `{ path, content }` | markdown/text file content |
| `screenshot_files` | `{ files[] }` | screenshot metadata |
| `stats` | `{ aggregate, containers, container_count }` | docker runtime stats |
| `done` | `{ exit_code, elapsed_ms }` | command completed |
| `error` | `{ message, elapsed_ms?, stderr? }` | command/request failed |

### Mode Execution Rules

- Async modes are server-controlled: `crawl`, `extract`, `embed`, `github`, `reddit`, `youtube`.
- For async modes, server strips client `--wait` and does fire-and-poll behavior.
- `--json` is injected for most modes, except allowlisted exceptions (`search`, `research`).
- Flags are passed through a server allowlist (`ALLOWED_FLAGS`), not blindly forwarded.

## HTTP API (`apps/web` routes)

### `GET /api/omnibox/files`

Handler: `apps/web/app/api/omnibox/files/route.ts`

Query params:

- none: list available mentionable local docs
- `id=<source:path>`: fetch file by id

Response (list):

```json
{
  "files": [
    {
      "id": "docs:ARCHITECTURE.md",
      "label": "ARCHITECTURE",
      "path": "docs/ARCHITECTURE.md",
      "source": "docs"
    }
  ]
}
```

Response (single file):

```json
{
  "file": {
    "id": "docs:ARCHITECTURE.md",
    "label": "ARCHITECTURE",
    "path": "docs/ARCHITECTURE.md",
    "source": "docs",
    "content": "..."
  }
}
```

Errors:

- `404` not found/invalid id

### `POST /api/pulse/chat`

Handler: `apps/web/app/api/pulse/chat/route.ts`

Request schema from `PulseChatRequestSchema` (`apps/web/lib/pulse/types.ts`):

- `prompt` string
- `documentMarkdown` string (default `""`)
- `selectedCollections` string[] (default `["pulse"]`)
- `conversationHistory` array of `{role: "user"|"assistant", content}`
- `permissionLevel`: `plan | training-wheels | full-access`

Response (`PulseChatResponse`):

```json
{
  "text": "...",
  "citations": [
    { "url": "...", "title": "...", "snippet": "...", "collection": "pulse", "score": 0.91 }
  ],
  "operations": [
    { "type": "append_markdown", "markdown": "..." }
  ]
}
```

Errors:

- `503` missing `OPENAI_BASE_URL` or `OPENAI_API_KEY`
- `400` invalid request schema
- `502` upstream LLM error
- `500` runtime failure

### `GET /api/pulse/doc`

Handler: `apps/web/app/api/pulse/doc/route.ts`

Query params:

- none: list pulse docs
- `filename=<name>.md`: load one pulse doc

Errors:

- `404` filename not found
- `500` loader failure

### `POST /api/pulse/save`

Handler: `apps/web/app/api/pulse/save/route.ts`

Request schema:

- `title` string
- `markdown` string
- `tags?` string[]
- `collections?` string[]
- `embed?` boolean (default `true`)

Response:

```json
{ "path": "...", "filename": "...", "saved": true }
```

Behavior:

- Saves note to pulse storage.
- If `embed=true` and `TEI_URL` + `QDRANT_URL` are set, chunks/embeds note and upserts to Qdrant.
- Embed failure does not fail save.

Errors:

- `400` invalid request schema
- `500` save failure

### `POST /api/ai/copilot`

Handler: `apps/web/app/api/ai/copilot/route.ts`

Request:

- `{ prompt, system?, model? }` validated by `CopilotRequestSchema`

Response:

- `{ completion }`

Errors:

- `503` missing `OPENAI_BASE_URL` or `OPENAI_API_KEY`
- `400` invalid schema
- `502` upstream LLM error
- `500` runtime failure

## Error Model

WebSocket:

- Command/protocol errors are emitted as `type: "error"` messages.
- Invalid mode requests are rejected by server before subprocess spawn.

HTTP:

- `400` client payload invalid
- `404` resource not found
- `500` internal runtime error
- `502` upstream dependency error
- `503` service not configured (missing env)

## Security Constraints

- WebSocket command surface is constrained by explicit mode and flag allowlists.
- File APIs enforce path safety and source-root containment.
- Output/download routes reject traversal and serve from validated roots only.
- URL fetching uses SSRF controls documented in `docs/SECURITY.md`.

## Compatibility Notes

- Active UI runtime is `apps/web`.
- Legacy static UI served by `axon serve` remains available but is deprecated.
- Keep `apps/web/lib/ws-protocol.ts` and Rust websocket payloads in sync.

## Source Map

- `crates/web.rs`
- `crates/web/execute/mod.rs`
- `crates/web/execute/polling.rs`
- `crates/web/execute/files.rs`
- `crates/web/download.rs`
- `apps/web/lib/ws-protocol.ts`
- `apps/web/app/api/omnibox/files/route.ts`
- `apps/web/app/api/pulse/chat/route.ts`
- `apps/web/app/api/pulse/doc/route.ts`
- `apps/web/app/api/pulse/save/route.ts`
- `apps/web/app/api/ai/copilot/route.ts`

