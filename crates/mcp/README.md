# crates/mcp

Axon MCP server crate for the `axon-mcp` binary.

## Scope
- MCP transport and server wiring (`server.rs`)
- Tool request schema and parser shim (`schema.rs`)
- Runtime config loading (`config.rs`)

## Public Contract
- Single MCP tool: `axon`
- Primary request shape: action-routed requests via `action` + `subaction`
- Backward compatibility: parser shim accepts legacy aliases (`command`, `op`, `operation`) and maps them to canonical actions
- Context-safe default: `response_mode=path` (artifact-first output in `.cache/axon-mcp/`)
- Resource exposed: `axon://schema/mcp-tool`

See source-of-truth docs:
- `docs/MCP.md`
- `docs/MCP-TOOL-SCHEMA.md`

## Local Development
```bash
cargo check --bin axon-mcp
cargo check --bin axon
```

## Schema Validation / Smoke Tests
```bash
mcporter list axon --schema
mcporter call axon.axon action:ops subaction:doctor
mcporter call axon.axon action:crawl subaction:list limit:5
```

## Change Rule
When changing tool behavior, update in the same commit:
1. `crates/mcp/schema.rs`
2. `crates/mcp/server.rs`
3. `docs/MCP.md`
4. `docs/MCP-TOOL-SCHEMA.md`
