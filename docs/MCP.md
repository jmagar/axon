# Axon MCP Server Guide
Last Modified: 2026-02-25

## Purpose
`axon-mcp` exposes Axon through one MCP tool named `axon`.

- Transport: stdio
- Tool count: 1
- Tool name: `axon`
- Routing fields: `action` + optional `subaction`
- Response behavior field: `response_mode` (`path|inline|both`, default `path`)

Canonical schema and action contract:
- `docs/MCP-TOOL-SCHEMA.md`

Implementation:
- `mcp_main.rs`
- `crates/mcp/schema.rs`
- `crates/mcp/server.rs`
- `crates/mcp/config.rs`

## Runtime Model
`axon-mcp` is expected to run in the same environment as Axon workers.

It reuses existing stack env vars (no MCP-only env namespace):
- `AXON_PG_URL`
- `AXON_REDIS_URL`
- `AXON_AMQP_URL`
- `QDRANT_URL`
- `TEI_URL`
- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `TAVILY_API_KEY`

## Context-Safe Output Defaults
Default behavior is artifact-first to minimize context/token waste.

- Default `response_mode`: `path`
- Artifact directory: `.cache/axon-mcp/`
- Heavy actions write artifacts and return compact metadata:
  - `path`, `bytes`, `line_count`, `sha256`, `preview`, `preview_truncated`
- `response_mode=inline|both` is allowed, but inline payloads are capped/truncated and include artifact pointers.

## Request Pattern
Primary pattern:

```json
{
  "action": "<operation>",
  "...": "operation fields"
}
```

Lifecycle pattern (job-backed operations):

```json
{
  "action": "crawl|extract|embed|ingest",
  "subaction": "start|status|cancel|list|cleanup|clear|recover",
  "...": "subaction fields"
}
```

## Parser Shim
The server normalizes friendly aliases before validation.

Examples:
- `action: "crawl"` -> defaults to `subaction: "start"`
- `action: "query"` -> normalized to `action: "rag", subaction: "query"`
- `action: "retrieve"` -> normalized to `action: "rag", subaction: "retrieve"`
- `action: "doctor"` -> normalized to `action: "ops", subaction: "doctor"`
- `action: "head"` -> normalized to `action: "artifacts", subaction: "head"`
- missing `action` with `command|op|operation` -> normalized into `action`

This allows client UX like:
- `axon crawl`
- `axon scrape`
- `axon research`
- `axon ask`
- `axon screenshot`

while still routing to one typed contract internally.

## Online Operations
Direct actions:
- `help`
- `scrape`
- `research`
- `ask`
- `screenshot`

Lifecycle/domain actions:
- `crawl.*`
- `extract.*`
- `embed.*`
- `ingest.*`
- `rag.query`
- `rag.retrieve`
- `discover.scrape|map|search`
- `ops.doctor|domains|sources|stats`
- `artifacts.head|grep|wc|read`

## Pagination
List/search style endpoints support `limit` + `offset`, with low defaults.

## MCP Resources
Exposed resources:
- `axon://schema/mcp-tool`

## Response Pattern
Success responses are normalized:

```json
{
  "ok": true,
  "action": "...",
  "subaction": "...",
  "data": { "...": "..." }
}
```

Errors:
- bad input -> MCP `invalid_params`
- runtime failure -> MCP `internal_error`

## Build and Run
```bash
cargo build --bin axon-mcp
./target/debug/axon-mcp
```

## mcporter Smoke Tests
```bash
mcporter list axon --schema
mcporter call axon.axon action:help
mcporter call axon.axon action:ops
mcporter call axon.axon action:scrape url:https://example.com
mcporter call axon.axon action:research query:'rust mcp sdk' limit:5
mcporter call axon.axon action:ask query:'what is rmcp tool router?'
mcporter call axon.axon action:screenshot url:https://example.com
mcporter call axon.axon action:crawl subaction:list limit:5 offset:0
mcporter call axon.axon action:artifacts subaction:head path:.cache/axon-mcp/help-actions.json limit:20
```

## Notes
- `crawl/extract/embed/ingest` are queue-first and non-blocking by design.
- `screenshot` requires configured Chrome remote endpoint (`AXON_CHROME_REMOTE_URL`).
- Keep all schema/routing/doc changes in sync in the same PR.
