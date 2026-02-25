# Axon MCP Tool Schema (Source of Truth)
Last Modified: 2026-02-25

## Contract
- MCP server binary: `axon-mcp`
- Tool count: `1`
- Tool name: `axon`
- Primary route field: `action`
- Optional route field: `subaction` (required for lifecycle actions)
- Response control field: `response_mode` (`path|inline|both`, default `path`)

Code references:
- `/home/jmagar/workspace/axon_rust/crates/mcp/schema.rs`
- `/home/jmagar/workspace/axon_rust/crates/mcp/server.rs`

## Canonical Success Envelope
```json
{
  "ok": true,
  "action": "<resolved action>",
  "subaction": "<resolved subaction>",
  "data": { "...": "..." }
}
```

## Parser Shim Rules
Incoming request map is normalized before serde validation:

- If `action` missing, fallback keys: `command`, `op`, `operation`
- Token normalization: lowercase, `-` -> `_`, spaces -> `_`
- `response_mode` token normalization also applied
- Defaults:
  - `crawl|extract|embed|ingest` -> `subaction=start` when omitted
  - `rag` -> `subaction=query` unless `url` provided (`retrieve`)
  - `discover` -> `subaction=search` when `query` present, else `scrape`
  - `ops` -> `subaction=doctor` when omitted
  - `artifacts` -> `subaction=head` when omitted
- Alias actions:
  - `query` -> `rag.query`
  - `retrieve` -> `rag.retrieve`
  - `search` -> `discover.search`
  - `map` -> `discover.map`
  - `doctor|domains|sources|stats` -> `ops.<same>`
  - `head|grep|wc|read` -> `artifacts.<same>`
  - `github|reddit|youtube|sessions` -> `ingest.start` + `source_type=<same>`

## Response Policy (Context-Safe Defaults)
- Default is artifact-first (`response_mode=path`).
- Heavy operations write result artifacts to `.cache/axon-mcp/`.
- Tool response returns compact metadata only by default:
  - `path`, `bytes`, `line_count`, `sha256`, `preview`, `preview_truncated`
- Inline modes are capped/truncated and always include artifact pointers.

## Direct Actions
These actions do not require `subaction`:

### `help`
Request:
```json
{ "action": "help" }
```
Returns current actions/subactions/resources.

### `scrape`
Request:
```json
{ "action": "scrape", "url": "https://example.com" }
```

### `research`
Request:
```json
{ "action": "research", "query": "rust mcp sdk", "limit": 5 }
```

### `ask`
Request:
```json
{ "action": "ask", "query": "how does rmcp tool routing work?" }
```

### `screenshot`
Request:
```json
{ "action": "screenshot", "url": "https://example.com", "full_page": true }
```
Optional fields: `viewport` (`"1920x1080"`), `output` (path).

## Lifecycle Action Families

### `crawl`
Subactions: `start|status|cancel|list|cleanup|clear|recover`

### `extract`
Subactions: `start|status|cancel|list|cleanup|clear|recover`

### `embed`
Subactions: `start|status|cancel|list|cleanup|clear|recover`

### `ingest`
Subactions: `start|status|cancel|list|cleanup|clear|recover`
`start` accepts `source_type` and `target`/`sessions` options.

### `rag`
Subactions: `query|retrieve`

### `discover`
Subactions: `scrape|map|search`

### `ops`
Subactions: `doctor|domains|sources|stats`

### `artifacts`
Subactions: `head|grep|wc|read`

`artifacts` fields:
- `path` (required)
- `pattern` (required for `grep`)
- `limit` and `offset` for paginated inspection

## Pagination Defaults
List/search style endpoints default to low limits and accept `limit` + `offset`.

## MCP Resources
Implemented resource(s):
- `axon://schema/mcp-tool`

## Runtime Dependencies
No MCP-specific env namespace. Server reads existing Axon stack vars:
- `AXON_PG_URL`, `AXON_REDIS_URL`, `AXON_AMQP_URL`
- `QDRANT_URL`, `TEI_URL`
- `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`
- `TAVILY_API_KEY`

## Error Semantics
- Input or shape failures -> MCP `invalid_params`
- Runtime failures -> MCP `internal_error`
