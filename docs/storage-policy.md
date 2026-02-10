# Storage Policy

Firecrawl CLI stores persistent state under a single storage root:

- `FIRECRAWL_HOME` (if set)
- default: `~/.firecrawl`

## Files and Directories

Under the storage root:

- `credentials.json`
  - API key and API URL saved by `login` / `config`
- `settings.json`
  - User defaults (exclude paths/extensions, etc.)
- `job-history.json`
  - Recent crawl/batch/extract job IDs
- `embed-queue/`
  - Background embedding queue (`<jobId>.json` and lock files)

## Overrides

- `FIRECRAWL_HOME`
  - Overrides the storage root for all files above.
- `FIRECRAWL_EMBEDDER_QUEUE_DIR`
  - Optional explicit override for embed queue directory only.
  - If relative, it is resolved from current working directory.

## .env Loading

The CLI reads `<project>/.env` on startup (unless `FIRECRAWL_CLI_DISABLE_LOCAL_ENV=1`).
The embedder daemon also reads `<project>/.env`.

## Migration

On first read/write, the CLI migrates legacy files when found:

- Credentials/settings from older platform-specific `firecrawl-cli` config dirs.
- Job history from old XDG/app-data locations and from legacy `<cwd>/.cache/job-history.json`.
- Embed queue files from old `~/.config/firecrawl-cli/embed-queue` (when queue dir override is not set).

## Migration Status and Legacy Paths

- Migration target is now complete: `FIRECRAWL_HOME` (default `~/.firecrawl`) is the canonical home for persistent CLI state.
- Legacy directories are no longer active storage locations:
  - `~/.config/firecrawl-cli`
  - `~/.local/share/firecrawl-cli`
- `FIRECRAWL_EMBEDDER_QUEUE_DIR` is override-only:
  - when set, queue data is written there;
  - when unset, queue data is written under `<storageRoot>/embed-queue`.
