# Storage Policy

Axon CLI stores persistent state under a single storage root:

- `AXON_HOME` (if set)
- default: `~/.axon`

## Files and Directories

Under the storage root:

- `credentials.json`
  - API key and API URL saved by `login` / `config`
- `settings.json`
  - User defaults (exclude paths/extensions, etc.)
- `job-history.json`
  - Recent crawl/batch/extract job IDs
- `crawl-baselines.json`
  - Preflight `map` URL-count baselines keyed by crawl job ID (used by low-discovery guardrail + auto sitemap retry)
- `crawl-reconciliation.json`
  - Per-domain crawl URL reconciliation state (missing counters + grace tracking for stale URL pruning)
- `embed-queue/`
  - Background embedding queue (`<jobId>.json` and lock files)

## Overrides

- `AXON_HOME`
  - Overrides the storage root for all files above.
  - Supports `~` (expanded to the home directory) and relative paths (resolved from the current working directory via `path.resolve()`). Absolute paths are accepted as-is.

## .env Loading

The CLI reads `<cwd>/.env` on startup (unless `AXON_CLI_DISABLE_LOCAL_ENV=1`).
The embedder daemon also reads `<cwd>/.env`.

## Migration

On first read/write, the CLI migrates legacy files when found:

- Credentials/settings from older platform-specific `axon-cli` config dirs.
- Job history from old XDG/app-data locations and from legacy `<cwd>/.cache/job-history.json`.
- Embed queue files from old `~/.config/axon-cli/embed-queue` (when queue dir override is not set).

## Migration Status and Legacy Paths

- Migration target is now complete: `AXON_HOME` (default `~/.axon`) is the canonical home for persistent CLI state.
- Legacy directories are no longer active storage locations:
  - `~/.config/axon-cli`
  - `~/.local/share/axon-cli`
- Embed queue location defaults to `<storageRoot>/embed-queue` unless `AXON_EMBEDDER_QUEUE_DIR` is set (relative paths resolve from the current working directory).
