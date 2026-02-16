# Crawl Guardrails

Operator guide for crawl quality protection and stale-document reconciliation.

## What This Covers

Axon applies two protection layers for `crawl`:

1. Discovery guardrail (map baseline + low-discovery retry)
2. Reconciliation guardrail (safe stale URL pruning in Qdrant)

These are enabled by default.

## Discovery Guardrail

### Flow

1. `axon crawl <url>` runs a preflight `map` to estimate expected URL count.
2. The baseline is stored in `~/.axon/crawl-baselines.json` (or `$AXON_HOME/crawl-baselines.json`).
3. When the crawl is checked and completed, Axon compares:
   - `crawl total` vs `map baseline total`
4. If discovery is unexpectedly low (<10%), Axon auto-starts one `sitemap=only` retry.

### Defaults

- Preflight map: enabled
- Low-discovery threshold: `10%`
- Auto sitemap retry: enabled
- Retry trigger count: once per baseline job

### Opt-Out Flags

```bash
axon crawl https://example.com --no-preflight-map
axon crawl https://example.com --no-auto-sitemap-retry
axon crawl status <job-id> --no-auto-sitemap-retry
```

## Reconciliation Guardrail

### Goal

Prevent stale crawl URLs from living forever in Qdrant while avoiding aggressive deletes.

### Flow

1. Each successful crawl records URLs observed for that domain.
2. Previously seen URLs that are now missing are marked as missing.
3. Missing URLs are deleted only when both conditions pass:
   - Missing in `2` consecutive successful crawls
   - Missing age is at least `7 days`
4. Deletions are scoped to crawl-origin vectors only:
   - `source_command = crawl`

State is stored in `~/.axon/crawl-reconciliation.json` (or `$AXON_HOME/crawl-reconciliation.json`).

### Default Behavior

- Append/upsert remains the default write model.
- Reconciliation runs in both:
  - async crawl auto-embedding path
  - `crawl --wait` inline embedding path

### Immediate Sync Mode

Use `--hard-sync` to bypass threshold/grace and delete missing crawl URLs immediately:

```bash
axon crawl https://example.com --hard-sync
```

This should be reserved for explicit full-sync scenarios.

## Related Commands

```bash
# Start crawl with defaults (guardrails on)
axon crawl https://example.com

# Watch status and guardrail output
axon crawl status <job-id>

# Cleanup failed/stale crawl history entries (queue/history maintenance)
axon crawl cleanup

# Inspect reconciliation state
axon reconcile status [domain]
```

## Storage Files

- `crawl-baselines.json`: map preflight counts + sitemap retry metadata
- `crawl-reconciliation.json`: per-domain URL missing counters and timestamps
- `embed-queue/*.json`: async embedding jobs (includes `hardSync` when set)
