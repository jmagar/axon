# axon watch
Last Modified: 2026-03-25

Top-level recurring scheduler definitions and run history.

## Synopsis

```bash
axon watch <SUBCOMMAND> [ARGS]
```

## Subcommands

The following subcommands are implemented:

```bash
axon watch create <name> --task-type <type> --every-seconds <n> [--task-payload <json>]
axon watch list
axon watch run-now <id>
axon watch history <id> [--limit <n>]
```

The following subcommands are defined in the CLI schema but return "not yet implemented" errors:

```bash
axon watch get <id>
axon watch update <id> [--every-seconds <n>]
axon watch pause <id>
axon watch resume <id>
axon watch delete <id>
axon watch artifacts <run_id> [--limit <n>]
```

`axon watch` with no subcommand defaults to `list`.

## Subcommand Details

| Subcommand | Arguments | Description |
|------------|-----------|-------------|
| `create` | `<name>` | Create a new watch definition |
| `list` | — | List all watch definitions (up to 200) |
| `run-now` | `<id>` | Dispatch one immediate run for a watch definition (UUID) |
| `history` | `<id>` | List recent runs for a watch definition. Default `--limit 50` |

### create flags

| Flag | Required | Description |
|------|----------|-------------|
| `--task-type <type>` | Yes | Type of task. `refresh` is the only supported type; any other value is rejected at create time. |
| `--every-seconds <n>` | Yes | Run interval in seconds. Must be between `30` and `604800` (7 days); out-of-range values are rejected at create time. |
| `--task-payload <json>` | No | JSON payload for the task. Defaults to `{}` if omitted. Must be valid JSON. |

## Task Payloads

The only supported task type is `refresh`.

Refresh payload shape:

```json
{"urls":["https://example.com/docs","https://example.com/api"]}
```

A `refresh` run **scrapes each URL inline** (via the scrape service) — re-fetching and
re-embedding the page content. It does not dispatch a separate downstream job. The run's
result payload reports `checked`, `unchanged`, `failed`, and a `refreshed` list with per-URL
markdown character counts.

If `task_payload.urls` is empty or missing, the run **fails** with
`watch refresh task requires task_payload.urls` — the run is recorded with status `failed`
(and `run-now` returns an error).

## Examples

```bash
# Create a 5-minute refresh watch
axon watch create docs-refresh \
  --task-type refresh \
  --every-seconds 300 \
  --task-payload '{"urls":["https://docs.rs/spider"]}'

# List watch definitions
axon watch list --json

# Force one immediate run (pass the UUID from list output)
axon watch run-now <uuid> --json

# Inspect recent run history (default: last 50 runs)
axon watch history <uuid> --limit 20
```

## Automatic Firing

Enabled watches do **not** require `run-now` to execute — they fire automatically on
their interval. An in-process scheduler loop (`src/jobs/workers/watch_scheduler.rs`, spawned
by `spawn_workers`) is active whenever a worker-bearing process is running, i.e. under
`axon serve` and `axon mcp` (and any sync `--wait true` path). Each tick the scheduler leases
every enabled watch whose `next_run_at <= now`, runs its task, and advances `next_run_at` by
`every_seconds`.

Watches created from a short-lived fire-and-forget CLI process are persisted but will only
fire once a worker-bearing process (`serve`/`mcp`) is up. `axon watch create` always creates
the definition as **enabled**, with the first run scheduled `every_seconds` from creation.

Scheduler tuning env vars:

| Variable | Default | Purpose |
|----------|---------|---------|
| `AXON_WATCH_TICK_SECS` | `15` | Scheduler sweep interval (min 1). |
| `AXON_WATCH_LEASE_SECS` | `300` | Watch lease TTL; must exceed one run's wall time (min 1). |

## Notes

- The legacy `axon refresh schedule ...` compatibility surface has been removed; use `axon watch` directly. Watch definitions with `task_type=refresh` are still the supported way to schedule recurring refreshes.
- `axon watch create` always creates the watch in the **enabled** state. Because `pause`/`resume`/`delete`/`update` are not yet implemented, there is currently no CLI way to disable or remove a watch once created.
