# axon sessions
Last Modified: 2026-03-09

Ingest local AI session history (Claude, Codex, Gemini) into Qdrant.

> For implementation details and troubleshooting see [`docs/ingest/sessions.md`](../ingest/sessions.md).

## Synopsis

```bash
axon sessions [FLAGS]
axon sessions <SUBCOMMAND> [ARGS]
```

## Provider Sources

| Provider | Path |
|----------|------|
| Claude | `~/.claude/projects/` |
| Codex | `~/.codex/sessions/` |
| Gemini | `~/.gemini/history/`, `~/.gemini/tmp/` |

## Flags

All global flags apply. Sessions-specific and key flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--claude` | `false` | Include Claude sessions. |
| `--codex` | `false` | Include Codex sessions. |
| `--gemini` | `false` | Include Gemini sessions. |
| `--project <name>` | — | Case-insensitive substring filter on project name. |
| `--wait <bool>` | `false` | Block until ingestion completes; otherwise enqueue async ingest job. |
| `--collection <name>` | `cortex` | Target Qdrant collection. |
| `--json` | `false` | Machine-readable output. |

Provider selection rule:
- If none of `--claude/--codex/--gemini` is set, all providers are ingested.

## Job Subcommands

```bash
axon sessions status <job_id>
axon sessions cancel <job_id>
axon sessions errors <job_id>
axon sessions list
axon sessions cleanup
axon sessions clear
axon sessions recover
axon sessions worker
```

These subcommands operate on the shared ingest queue across source types.

## Examples

```bash
# Async enqueue (default) for all providers
axon sessions

# Sync run for Codex only
axon sessions --codex --wait true

# Claude + Gemini filtered to project name match
axon sessions --claude --gemini --project axon --wait true

# Check job status
axon sessions status 550e8400-e29b-41d4-a716-446655440000
```

## Notes

- Session ingest uses an incremental state tracker table: `axon_session_ingest_state`.
- Job records for queued runs are stored in `axon_ingest_jobs` with `source_type='sessions'`.

### repo and branch metadata (v0.11.0+)

Each ingested session now carries `repo` and `branch` metadata fields enriched from git at the project level. The scanner decodes the Claude CLI project folder name back to a filesystem path, walks up to the nearest git root, and runs `git rev-parse --abbrev-ref HEAD` (branch) and `git remote get-url origin` (repo, normalized to `owner/repo` form). Results are cached per project for the process lifetime.

These fields appear in:
- The `/api/sessions/list` JSON response as `repo?: string` and `branch?: string`
- The `SessionSummary` TypeScript interface used by `useRecentSessions`
- AxonSidebar's session filter (search matches against `repo`, `branch`, and `project`)

If a project is not inside a git repository or has no `origin` remote, both fields are omitted. The enrichment never throws.

### session_fallback event

When Pulse chat resumes a session by ID and the ACP adapter cannot load it, the Rust bridge falls back to a new session and emits a `session_fallback` event on the WebSocket stream:

```json
{ "type": "session_fallback", "old_session_id": "...", "new_session_id": "..." }
```

The frontend Pulse pipeline (`/api/pulse/chat/route.ts`) propagates this downstream as:

```json
{ "type": "session_fallback", "newSessionId": "..." }
```

The fallback is silent — the user continues into a new session rather than seeing an error. `use-axon-acp.ts` exposes an `onSessionFallback(oldId, newId)` callback for callers that need to react to the swap.
