# axon watch
Last Modified: 2026-05-31

Top-level recurring scheduler definitions and run history. A watch is a
URL **change detector**: each scheduler tick it diffs every watched URL against a
stored snapshot, summarizes meaningful changes with the LLM, records a change
artifact, and enqueues a crawl for the changed subtrees.

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
| `--task-type <type>` | Yes | Type of task (`watch` is the only supported type) |
| `--every-seconds <n>` | Yes | Run interval in seconds (30–604800) |
| `--task-payload <json>` | No | JSON payload for the task. Defaults to `{}` if omitted |

The payload is validated at create time: `urls` must be a non-empty array of
strings and every `ignore_patterns` entry must compile as a regex (invalid
patterns are rejected immediately rather than failing every scheduled run).

## Task Payloads

The only supported `task_type` is `watch`.

`watch` payload shape:

```json
{
  "urls": ["https://docs.example.com/guide/intro"],
  "max_depth": 2,
  "ignore_patterns": ["^Last updated:", "\\d+ (users|viewers) online"],
  "change_threshold_words": 0,
  "summarize": true
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `urls` | — (required) | Non-empty array of URLs to watch. |
| `max_depth` | `2` | Crawl depth bound for the change-triggered crawl. |
| `ignore_patterns` | `[]` | Regex patterns; matching lines are stripped before diffing (noise suppression, e.g. timestamps). |
| `change_threshold_words` | `0` | Minimum absolute word-count delta for a text-only change to count as meaningful. Link changes always count. |
| `summarize` | `true` | Produce an AI summary of each change (requires the Gemini CLI, `AXON_HEADLESS_GEMINI_CMD`). Best-effort — the raw diff is retained if the LLM is unavailable. |

### How change detection works

Per URL, each tick:

1. **Conditional probe** with the stored `ETag`/`Last-Modified` validators — an
   HTTP `304` short-circuits to "unchanged" without scraping.
2. **Scrape** the URL to markdown, then **normalize** (line endings, trailing
   whitespace, blank-line runs) and **strip** lines matching `ignore_patterns`.
3. **Fast-equal skip**: a SHA-256 of the filtered markdown equal to the stored
   hash means "unchanged" (snapshot refreshed, no diff).
4. **Diff** the prior snapshot vs the fresh content via the shared `compute_diff`
   (unified text diff + link/word deltas). First-seen URLs are forced "changed"
   (seed run).
5. **Threshold**: a change is meaningful if content changed AND (links changed OR
   `|word_count_delta| >= change_threshold_words`).

Meaningful changes get an AI summary and a `url-change` run artifact (unified
diff + summary + deltas). Changed URLs are then **clustered by common path
prefix** and one depth-bounded crawl is enqueued per cluster — unless that
cluster's prior crawl is still pending/running (in-flight guard). The latest
snapshot and validators live in the `axon_watch_url_state` table.

## Examples

```bash
# Create a 5-minute change-detection watch
axon watch create docs-watch \
  --task-type watch \
  --every-seconds 300 \
  --task-payload '{"urls":["https://docs.rs/spider"],"ignore_patterns":["^Last updated:"]}'

# List watch definitions
axon watch list --json

# Force one immediate run (pass the UUID from list output)
axon watch run-now <uuid> --json

# Inspect recent run history (default: last 50 runs)
axon watch history <uuid> --limit 20
```

## Notes

- The stateless `refresh` task type has been replaced by `watch`. The legacy
  `axon refresh schedule ...` compatibility surface was already removed; use
  `axon watch` directly.
