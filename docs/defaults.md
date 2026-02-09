# CLI Defaults Reference

**Last Updated:** 2026-02-03

This document provides a comprehensive reference of all default values used across the Firecrawl CLI. All default values listed here are the authoritative source and match the implementation in the codebase.

## Table of Contents

- [Configuration Priority](#configuration-priority)
- [Environment Variables](#environment-variables)
- [Global Flags](#global-flags)
- [Command-Specific Defaults](#command-specific-defaults)
  - [scrape](#scrape)
  - [crawl](#crawl)
  - [map](#map)
  - [search](#search)
  - [extract](#extract)
  - [query](#query)
  - [retrieve](#retrieve)
  - [embed](#embed)
  - [batch](#batch)
  - [info](#info)
  - [status](#status)
  - [delete](#delete)
  - [stats](#stats)
  - [list](#list)
  - [sources](#sources)
  - [domains](#domains)
  - [history](#history)
  - [version](#version)
  - [login](#login)
  - [config](#config)
- [Edge Cases and Notes](#edge-cases-and-notes)

---

## Configuration Priority

Configuration values are resolved in the following order (highest priority first):

1. **Runtime flags** - Command-line options (e.g., `--api-key`, `--timeout`)
2. **Environment variables** - Shell environment (e.g., `FIRECRAWL_API_KEY`, `TEI_URL`)
3. **OS credential store** - Stored credentials at `~/.config/firecrawl-cli/` or keychain
4. **Built-in defaults** - Documented in this file

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FIRECRAWL_API_KEY` | `local-dev` | API authentication (for self-hosted deployments) |
| `FIRECRAWL_API_URL` | `http://localhost:53002` | API endpoint |
| `TEI_URL` | `http://localhost:53010` | Text embeddings service |
| `QDRANT_URL` | `http://localhost:53333` | Vector database |
| `QDRANT_COLLECTION` | `firecrawl` | Default collection name |

---

## Global Flags

These flags are available across multiple commands:

| Flag | Default | Description | Available In |
|------|---------|-------------|--------------|
| `--api-key` | from env/credentials | Firecrawl API key | All commands |
| `--json` | `false` | Output as JSON format | scrape, crawl, map, search, extract, query, batch, info, status, retrieve, embed, delete, stats, sources, domains, history |
| `--pretty` | `false` | Pretty print JSON output | scrape, crawl, batch, status, list |
| `--output` | stdout | Output file path | scrape, crawl, map, search, extract, query, batch, info, status, retrieve, sources, stats, domains, history |
| `--collection` | `firecrawl` | Qdrant collection name (from `QDRANT_COLLECTION` env var) | query, retrieve, info, embed, delete, stats, sources, domains, history |

---

## Command-Specific Defaults

### scrape

Scrape a single URL and optionally embed the content.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--format` | `markdown` | string | Output format(s) | Valid: markdown, html, rawHtml, links, images, screenshot, summary, changeTracking, json, attributes, branding. Multiple formats can be comma-separated |
| `--only-main-content` | `true` | boolean | Include only main content | Has negation: `--no-only-main-content` |
| `--timeout` | `15` | number | Request timeout in seconds | Unit: seconds |
| `--exclude-tags` | `nav,footer` | string | Comma-separated list of tags to exclude | |
| `--screenshot` | `false` | boolean | Take a screenshot | |
| `--timing` | `false` | boolean | Show request timing and other useful information | |
| `--embed` | `true` | boolean | Auto-embed scraped content | Has negation: `--no-embed` |
| `--remove` | `false` | boolean | Remove all documents for this domain from Qdrant | |

### crawl

Crawl multiple pages starting from a URL.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--max-depth` | `3` | number | Maximum crawl depth | |
| `--exclude-tags` | `nav,footer` | string | Comma-separated list of tags to exclude from scraped content | |
| `--only-main-content` | `true` | boolean | Include only main content when scraping pages | Has negation: `--no-only-main-content` |
| `--sitemap` | `include` | string | Sitemap handling: skip, include | Valid values: skip, include |
| `--ignore-query-parameters` | `true` | boolean | Ignore query parameters when crawling | Has negation: `--no-ignore-query-parameters` |
| `--allow-subdomains` | `true` | boolean | Allow subdomains | Has negation: `--no-allow-subdomains` |
| `--crawl-entire-domain` | `false` | boolean | Crawl entire domain | |
| `--allow-external-links` | `false` | boolean | Allow external links | |
| `--wait` | `false` | boolean | Wait for crawl to complete before returning results | |
| `--progress` | `false` | boolean | Show progress while waiting (implies --wait) | |
| `--poll-interval` | `5` | number | Status check interval when using --wait | Unit: seconds. Auto-applied when --wait or --progress is set |
| `--embed` | `true` | boolean | Auto-embed results | Has negation: `--no-embed`. Async or sync based on --wait |
| `--no-default-excludes` | `false` | boolean | Skip settings excludes | |

### map

Discover URLs on a site (sitemap-like functionality).

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--sitemap` | `include` | string | Sitemap handling: skip, include | Valid values: skip, include |
| `--include-subdomains` | `true` | boolean | Include subdomains | |
| `--ignore-query-parameters` | `true` | boolean | Ignore URL parameters | |

### search

Web search with optional scraping.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--limit` | `5` | number | Maximum number of results | Max: 100 |
| `--timeout` | `60000` | number | Request timeout | Unit: milliseconds (note: not seconds like other commands) |
| `--ignore-invalid-urls` | `true` | boolean | Skip invalid URLs | |
| `--scrape` | `true` | boolean | Scrape search results | Has negation: `--no-scrape` |
| `--only-main-content` | `true` | boolean | Main content only when scraping results | |
| `--embed` | `true` | boolean | Auto-embed scraped results | Has negation: `--no-embed`. Only when --scrape enabled |

### extract

Extract structured data from URLs.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--allow-external-links` | `false` | boolean | Follow external links | |
| `--enable-web-search` | `false` | boolean | Use web search for additional context | |
| `--include-subdomains` | `false` | boolean | Include subdomains | |
| `--show-sources` | `false` | boolean | Include source URLs | |
| `--embed` | `true` | boolean | Auto-embed extracted data | Has negation: `--no-embed`. Embeds extracted data, not markdown |

### query

Semantic search in Qdrant vector database.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--limit` | `5` | number | Maximum number of results | |
| `--full` | `false` | boolean | Show full chunk text instead of truncated | |
| `--group` | `false` | boolean | Group results by URL | |

### retrieve

Reconstruct documents from Qdrant.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| (uses global `--collection`, `--output`, `--json`) | | | | |

### embed

Manually embed content into Qdrant.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--no-chunk` | `false` | boolean | Disable chunking, embed as single vector | |

### batch

Batch scrape multiple URLs.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--wait` | `false` | boolean | Wait for batch scrape to complete | |
| `--only-main-content` | `false` | boolean | Main content only | Different from scrape! Default is false here |
| `--screenshot` | `false` | boolean | Include screenshots | |
| `--ignore-invalid-urls` | `false` | boolean | Skip invalid URLs | |
| `--zero-data-retention` | `false` | boolean | Enable zero data retention | |

### info

Show detailed information for a specific URL.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--full` | `false` | boolean | Include additional details | |

### status

Show active jobs and embedding queue status.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| (uses global `--json`, `--pretty`, `--output`) | | | | |

### delete

Delete documents from Qdrant.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--yes` | `false` | boolean | Confirm deletion | REQUIRED for safety |

### stats

Show vector database statistics.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--verbose` | `false` | boolean | Include additional details | |

### list

List active crawl jobs.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--pretty` | `false` | boolean | Pretty print JSON output | |

### sources

List all sources in Qdrant.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| (uses global `--collection`, `--output`, `--json`) | | | | |

### domains

List all domains in Qdrant.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| (uses global `--collection`, `--output`, `--json`) | | | | |

### history

Show command history.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| (uses global `--collection`, `--output`, `--json`) | | | | |

### version

Display version information.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--auth-status` | `false` | boolean | Show authentication status | |

### login

Login to Firecrawl.

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--api-url` | `https://api.firecrawl.dev` | string | API URL | Can also use FIRECRAWL_API_URL env var |

### config

Configure Firecrawl (login if not authenticated).

| Flag | Default | Type | Description | Notes |
|------|---------|------|-------------|-------|
| `--api-url` | `https://api.firecrawl.dev` | string | API URL | Can also use FIRECRAWL_API_URL env var |

---

## Edge Cases and Notes

### Boolean Flags

Flags with `true` defaults use the `--flag` / `--no-flag` pattern:

- `--only-main-content` (default: true) / `--no-only-main-content`
- `--embed` (default: true) / `--no-embed`
- `--ignore-query-parameters` (default: true) / `--no-ignore-query-parameters`
- `--allow-subdomains` (default: true) / `--no-allow-subdomains`
- `--scrape` (default: true) / `--no-scrape`

When using the CLI, omitting the flag uses the default value. To override a `true` default to `false`, use the `--no-` prefix.

### Timeout Units

**Important:** Most commands use **seconds**, but the `search` command uses **milliseconds**:

- `scrape --timeout`: 15 seconds (default)
- `search --timeout`: 60000 milliseconds (default)

### Collection Default

The `--collection` flag defaults to the `QDRANT_COLLECTION` environment variable or `firecrawl` if not set. This applies to commands that interact with Qdrant:

- query, retrieve, info, embed, delete, stats, sources, domains, history

### Embed Behavior

The `--embed` flag is `true` by default on commands that produce content:

- `scrape --embed`: Auto-embeds scraped content
- `crawl --embed`: Auto-embeds crawled pages (async or sync based on `--wait`)
- `search --embed`: Auto-embeds search results (only when `--scrape` is enabled)
- `extract --embed`: Auto-embeds extracted data (not the markdown)

To disable embedding, use `--no-embed`.

### Output Default

All commands default to **stdout**. Use `-o` or `--output` to write to a file.

### Batch Command Difference

**Important:** The `batch` command has a different default for `--only-main-content`:

- `scrape --only-main-content`: `true` (default)
- `batch --only-main-content`: `false` (default)

This is intentional to provide different behavior for batch operations.

### Format Handling

The `--format` flag in the `scrape` command accepts multiple comma-separated values:

```bash
firecrawl scrape https://example.com --format markdown,html,screenshot
```

Default is `markdown`.

### Sitemap Handling

Commands with `--sitemap` flag accept two values:

- `skip`: Ignore sitemap
- `include`: Use sitemap (default)

### Delete Safety

The `delete` command **requires** the `--yes` flag to confirm deletion. This is a safety feature to prevent accidental data loss.

### Pagination

The `search` command limits results to a maximum of 100 (`--limit` max value).
