# axon setup

First-run local Docker setup helper. Creates `~/.axon`, writes shared config/env files, installs compose assets, starts the Docker stack, checks health, prewarms TEI, and runs first-run smoke checks.

## Synopsis

```bash
axon setup [--json]
axon setup check [--json]
axon setup repair [--json]
axon setup repair --migrate-env [--json]
axon setup targets [--json]
```

## Subcommands

| Subcommand | Purpose |
|------------|---------|
| none | Create or repair local `~/.axon` config, install compose assets, start the Docker stack, and run first-run checks. |
| `check` | Inspect local setup without mutating files or starting services. |
| `repair` | Repair local config/assets and restart the Docker stack. Add `--migrate-env` for explicit backup-backed env pruning/migration. |
| `targets` | List concrete SSH aliases from `~/.ssh/config` (informational only). |

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | `false` | Print machine-readable JSON output. |

## Examples

```bash
axon setup
axon setup check --json
axon setup repair --migrate-env
axon setup targets
```

## Output

Local setup prints phase status for config, Docker, Qdrant, TEI, Chrome, Axon
server health, TEI prewarm, and smoke checks. `targets` prints SSH aliases with
resolved host/user/port values.
