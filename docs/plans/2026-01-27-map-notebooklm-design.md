# Map Command: NotebookLM Integration

**Date:** 2026-01-27
**Status:** Design

## Summary

Add a `--notebook <id-or-name>` flag to the `map` command that sends all discovered URLs as individual sources to a NotebookLM notebook. Uses a Python helper script (shelled out via `child_process`) since the `notebooklm` library is Python-only.

## CLI Interface

```bash
# Create new notebook from mapped URLs
firecrawl map https://docs.example.com --notebook "Example Docs"

# Add to existing notebook by ID
firecrawl map https://docs.example.com --notebook "abc123def456"

# Combine with existing flags
firecrawl map https://docs.example.com --limit 50 --notebook "Example Docs" --search "api"
```

**Flag behavior:**

- If value looks like a notebook ID (long alphanumeric), adds to existing notebook
- If value is a plain name, creates a new notebook with that title
- If omitted, no NotebookLM interaction (current behavior preserved)
- If map fails, notebook step is skipped

## Architecture

### Files

| File                             | Purpose                                                                |
| -------------------------------- | ---------------------------------------------------------------------- |
| `scripts/notebooklm_add_urls.py` | Python script that receives URLs via stdin and adds them to NotebookLM |
| `src/utils/notebooklm.ts`        | TypeScript wrapper that spawns the Python script                       |
| `src/types/map.ts`               | Add `notebook?: string` to `MapOptions`                                |
| `src/commands/map.ts`            | Call notebook integration after successful map                         |
| `src/index.ts`                   | Add `--notebook` option to map command definition                      |

### Data Flow

```
map command
  -> executeMap() returns URLs
  -> if --notebook flag set:
      -> addUrlsToNotebook(target, urls)
          -> spawn python3 scripts/notebooklm_add_urls.py
          -> write JSON to stdin: {"notebook": "...", "urls": [...]}
          -> read JSON from stdout: {"notebook_id": "...", "added": N, "failed": N, "errors": [...]}
      -> log progress/result to stderr
  -> write map output to stdout (unchanged)
```

### Python Script (`scripts/notebooklm_add_urls.py`)

Reads JSON from stdin:

```json
{ "notebook": "Example Docs", "urls": ["https://...", "https://..."] }
```

Outputs JSON to stdout:

```json
{
  "notebook_id": "abc123",
  "notebook_title": "Example Docs",
  "added": 47,
  "failed": 3,
  "errors": ["https://bad.url: timeout"]
}
```

**Batching (two phases, per library docstrings):**

**Phase 1: Add** -- sequential `add_url(wait=False)` calls, collect sources
**Phase 2: Wait** -- single `wait_for_sources()` call, polls all in parallel

```python
# Phase 1: Add all URLs without waiting for processing
added_sources: list[Source] = []
failed: list[tuple[str, str]] = []

for url in urls:
    try:
        source = await client.sources.add_url(nb_id, url)
        added_sources.append(source)
    except Exception as e:
        failed.append((url, str(e)))

# Phase 2: Wait for all sources to finish processing
source_ids = [s.id for s in added_sources]
await client.sources.wait_for_sources(nb_id, source_ids, timeout=120.0)
```

`wait_for_sources()` polls all sources in parallel with exponential backoff
(1s initial, 1.5x factor, 10s max). If Google rate limits the add calls,
the library raises `RateLimitError` which we catch per-URL and report.

**Notebook resolution:**

1. Try `client.notebooks.get(target)` -- if it works, it's an existing ID
2. If that fails, create via `client.notebooks.create(target)`

**Auth:** Uses `NotebookLMClient.from_storage()` (user must have run `notebooklm login`).

### TypeScript Wrapper (`src/utils/notebooklm.ts`)

```typescript
interface NotebookResult {
  notebook_id: string;
  notebook_title: string;
  added: number;
  failed: number;
  errors: string[];
}

async function addUrlsToNotebook(
  notebookTarget: string,
  urls: string[]
): Promise<NotebookResult | null>;
```

- Spawns `python3 scripts/notebooklm_add_urls.py`
- Writes JSON payload to child stdin, closes it
- Parses JSON from stdout
- Returns `null` on any failure (never throws)
- Logs progress to stderr

## Error Handling

| Scenario                   | Behavior                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `python3` not found        | Warn on stderr, skip                                                                           |
| `notebooklm` not installed | Warn: "Install: pip install notebooklm", skip                                                  |
| Auth expired               | Warn: "Run `notebooklm login`", skip                                                           |
| Notebook ID not found      | Treat as name, create new notebook                                                             |
| Rate limited               | Per-URL `RateLimitError` caught and logged as failure; library handles auth retries internally |
| Some URLs fail             | Partial success: "Added 45/50 URLs (5 failed)"                                                 |
| All URLs fail              | Warn and skip, map command still succeeds                                                      |
| Map returns 0 URLs         | Skip notebook step entirely                                                                    |
| More than 300 URLs         | Warn: "Truncating to 300 URLs (NotebookLM limit)", add first 300                               |

**Key principle:** The notebook integration never causes the map command to fail. All errors go to stderr. Map output on stdout is always unaffected.

## Progress Output (stderr)

```
Adding 47 URLs to NotebookLM notebook "Example Docs"...
Created notebook: abc123def456
Added 47/47 URLs as sources
```

Or on partial failure:

```
Adding 50 URLs to NotebookLM notebook "Example Docs"...
Added 47/50 URLs as sources (3 failed)
```
