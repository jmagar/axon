# axon mcp
Last Modified: 2026-03-10

Start Axon's MCP server exposing a single unified tool: `axon`.

## Synopsis

```bash
axon mcp [--transport stdio|http|both]
```

## Transport Modes

`axon mcp` supports three transport modes:

- `http` (default): starts the HTTP MCP server on `/mcp`
- `stdio`: starts stdio transport only
- `both`: starts stdio and HTTP concurrently

Transport selection:

| Selector | Default | Description |
|----------|---------|-------------|
| `--transport` | `http` | CLI transport selector |
| `AXON_MCP_TRANSPORT` | `http` | Env override: `stdio`, `http`, or `both` |

## HTTP Runtime Binding

When HTTP transport is enabled (`http` or `both`), these environment variables control bind address:

| Variable | Default | Description |
|----------|---------|-------------|
| `AXON_MCP_HTTP_HOST` | `0.0.0.0` | MCP server bind host |
| `AXON_MCP_HTTP_PORT` | `8001` | MCP server bind port |

The primary HTTP MCP endpoint is mounted at `/mcp`.

## Tool Contract

- Tool count: 1
- Tool name: `axon`
- Routing: `action` + `subaction` (for lifecycle families)

Supported top-level action families include: `status`, `help`, `crawl`, `extract`, `embed`, `ingest`, `refresh`, `query`, `retrieve`, `search`, `map`, `doctor`, `domains`, `sources`, `stats`, `artifacts`, `scrape`, `research`, `ask`, `screenshot`.

## Examples

```bash
# Default HTTP bind 0.0.0.0:8001
axon mcp

# Stdio only
axon mcp --transport stdio

# HTTP + stdio together
axon mcp --transport both

# Custom HTTP bind
AXON_MCP_HTTP_HOST=127.0.0.1 AXON_MCP_HTTP_PORT=8900 axon mcp

# Env-driven stdio
AXON_MCP_TRANSPORT=stdio axon mcp
```

## Notes

- If `AXON_MCP_HTTP_PORT` is not a valid `u16`, startup fails immediately.
- OAuth-related endpoints apply to HTTP mode only.
- `stdio` mode is intended for local MCP clients such as Claude Desktop.
- See `docs/MCP.md` and `docs/MCP-TOOL-SCHEMA.md` for full request/response contract details.
