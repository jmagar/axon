# 🔥 **Firecrawl CLI**

Command-line interface for Firecrawl. Scrape, crawl, extract, and embed data from any website directly from your terminal. Includes a built-in embedding pipeline for semantic search over scraped content via Qdrant and TEI.

## Installation

```bash
npm install -g firecrawl-cli
```

If you are using in any AI agent like Claude Code, you can install the skill with:

```bash
npx skills add firecrawl/cli
```

## Quick Start

Just run a command - the CLI will prompt you to authenticate if needed:

```bash
firecrawl https://example.com
```

## Authentication

On first run, you'll be prompted to authenticate:

```
  🔥 firecrawl cli
  Turn websites into LLM-ready data

Welcome! To get started, provide your Firecrawl API key.

Tip: You can also set FIRECRAWL_API_KEY and FIRECRAWL_API_URL environment variables
```

### Authentication Methods

```bash
# Environment variables (recommended for self-hosted)
export FIRECRAWL_API_KEY=your-api-key
export FIRECRAWL_API_URL=http://localhost:53002

# Optional: embedding pipeline (enables embed, query, retrieve commands)
export TEI_URL=http://localhost:52000
export QDRANT_URL=http://localhost:53333

# Interactive (prompts automatically when needed)
firecrawl

# Direct API key
firecrawl login --api-key your-api-key --api-url http://localhost:53002

# Per-command API key
firecrawl scrape https://example.com --api-key your-api-key
```

---

## Commands

### `scrape` - Scrape a single URL

Extract content from any webpage in various formats.

```bash
# Basic usage (outputs markdown)
firecrawl https://example.com
firecrawl scrape https://example.com

# Get raw HTML
firecrawl https://example.com --html
firecrawl https://example.com -H

# Multiple formats (outputs JSON)
firecrawl https://example.com --format markdown,links,images

# Save to file
firecrawl https://example.com -o output.md
firecrawl https://example.com --format json -o data.json --pretty
```

#### Scrape Options

| Option                   | Description                                             |
| ------------------------ | ------------------------------------------------------- |
| `-f, --format <formats>` | Output format(s), comma-separated                       |
| `-H, --html`             | Shortcut for `--format html`                            |
| `--only-main-content`    | Extract only main content (removes navs, footers, etc.) |
| `--wait-for <ms>`        | Wait time before scraping (for JS-rendered content)     |
| `--screenshot`           | Take a screenshot                                       |
| `--include-tags <tags>`  | Only include specific HTML tags                         |
| `--exclude-tags <tags>`  | Exclude specific HTML tags                              |
| `-o, --output <path>`    | Save output to file                                     |
| `--pretty`               | Pretty print JSON output                                |
| `--timing`               | Show request timing info                                |
| `--no-embed`             | Skip auto-embedding (when TEI/Qdrant configured)        |

#### Available Formats

| Format       | Description                |
| ------------ | -------------------------- |
| `markdown`   | Clean markdown (default)   |
| `html`       | Cleaned HTML               |
| `rawHtml`    | Original HTML              |
| `links`      | All links on the page      |
| `screenshot` | Screenshot as base64       |
| `json`       | Structured JSON extraction |

#### Examples

```bash
# Extract only main content as markdown
firecrawl https://blog.example.com --only-main-content

# Wait for JS to render, then scrape
firecrawl https://spa-app.com --wait-for 3000

# Get all links from a page
firecrawl https://example.com --format links

# Screenshot + markdown
firecrawl https://example.com --format markdown --screenshot

# Extract specific elements only
firecrawl https://example.com --include-tags article,main

# Exclude navigation and ads
firecrawl https://example.com --exclude-tags nav,aside,.ad
```

---

### `search` - Search the web

Search the web and optionally scrape content from search results.

```bash
# Basic search
firecrawl search "firecrawl web scraping"

# Limit results
firecrawl search "AI news" --limit 10

# Search news sources
firecrawl search "tech startups" --sources news

# Search images
firecrawl search "landscape photography" --sources images

# Multiple sources
firecrawl search "machine learning" --sources web,news,images

# Filter by category (GitHub, research papers, PDFs)
firecrawl search "web scraping python" --categories github
firecrawl search "transformer architecture" --categories research
firecrawl search "machine learning" --categories github,research

# Time-based search
firecrawl search "AI announcements" --tbs qdr:d   # Past day
firecrawl search "tech news" --tbs qdr:w          # Past week

# Location-based search
firecrawl search "restaurants" --location "San Francisco,California,United States"
firecrawl search "local news" --country DE

# Search and scrape results
firecrawl search "firecrawl tutorials" --scrape
firecrawl search "API documentation" --scrape --scrape-formats markdown,links

# Output as pretty JSON
firecrawl search "web scraping"
```

#### Search Options

| Option                       | Description                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `--limit <n>`                | Maximum results (default: 5, max: 100)                                                      |
| `--sources <sources>`        | Comma-separated: `web`, `images`, `news` (default: web)                                     |
| `--categories <categories>`  | Comma-separated: `github`, `research`, `pdf`                                                |
| `--tbs <value>`              | Time filter: `qdr:h` (hour), `qdr:d` (day), `qdr:w` (week), `qdr:m` (month), `qdr:y` (year) |
| `--location <location>`      | Geo-targeting (e.g., "Germany", "San Francisco,California,United States")                   |
| `--country <code>`           | ISO country code (default: US)                                                              |
| `--timeout <ms>`             | Timeout in milliseconds (default: 60000)                                                    |
| `--ignore-invalid-urls`      | Exclude URLs invalid for other Firecrawl endpoints                                          |
| `--scrape`                   | Enable scraping of search results                                                           |
| `--scrape-formats <formats>` | Scrape formats when `--scrape` enabled (default: markdown)                                  |
| `--only-main-content`        | Include only main content when scraping (default: true)                                     |
| `-o, --output <path>`        | Save to file                                                                                |
| `--json`                     | Output as compact JSON (use `-p` for pretty JSON)                                           |

#### Examples

```bash
# Research a topic with recent results
firecrawl search "React Server Components" --tbs qdr:m --limit 10

# Find GitHub repositories
firecrawl search "web scraping library" --categories github --limit 20

# Search and get full content
firecrawl search "firecrawl documentation" --scrape --scrape-formats markdown -p -o results.json

# Find research papers
firecrawl search "large language models" --categories research -p

# Search with location targeting
firecrawl search "best coffee shops" --location "Berlin,Germany" --country DE

# Get news from the past week
firecrawl search "AI startups funding" --sources news --tbs qdr:w --limit 15
```

---

### `map` - Discover all URLs on a website

Quickly discover all URLs on a website without scraping content.

```bash
# List all URLs (one per line)
firecrawl map https://example.com

# Output as JSON
firecrawl map https://example.com --json

# Search for specific URLs
firecrawl map https://example.com --search "blog"

# Limit results
firecrawl map https://example.com --limit 500
```

#### Map Options

| Option                      | Description                       |
| --------------------------- | --------------------------------- |
| `--limit <n>`               | Maximum URLs to discover          |
| `--search <query>`          | Filter URLs by search query       |
| `--sitemap <mode>`          | `include`, `skip`, or `only`      |
| `--include-subdomains`      | Include subdomains                |
| `--ignore-query-parameters` | Dedupe URLs with different params |
| `--timeout <seconds>`       | Request timeout                   |
| `--notebook <id-or-name>`   | Add URLs to NotebookLM notebook   |
| `--json`                    | Output as JSON                    |
| `-o, --output <path>`       | Save to file                      |

#### NotebookLM Integration

Add discovered URLs directly to a NotebookLM notebook:

```bash
# Create new notebook from mapped URLs
firecrawl map https://docs.example.com --notebook "Example Docs"

# Add to existing notebook by ID
firecrawl map https://docs.example.com --notebook "abc123def456"

# Combine with other options
firecrawl map https://docs.example.com --limit 50 --search "api" --notebook "API Docs"
```

**Requirements:**

- Python 3.11+ installed
- NotebookLM package: `pip install notebooklm`
- Authenticated: `notebooklm login`

**Notes:**

- Maximum 300 URLs (NotebookLM Pro limit)
- Best-effort: notebook failures don't fail the map command
- Progress messages go to stderr, map output to stdout

#### Examples

```bash
# Find all product pages
firecrawl map https://shop.example.com --search "product"

# Get sitemap URLs only
firecrawl map https://example.com --sitemap only

# Save URL list to file
firecrawl map https://example.com -o urls.txt

# Include subdomains
firecrawl map https://example.com --include-subdomains --limit 1000
```

---

### `crawl` - Crawl an entire website

Crawl multiple pages from a website. Embeddings are automatically generated when TEI/Qdrant are configured.

```bash
# Start async crawl (returns immediately, embeddings queued)
firecrawl crawl https://example.com
# Returns job ID in <1 second
# Embeddings generated automatically when crawl completes

# Wait for crawl to complete and embed inline
firecrawl crawl https://example.com --wait

# With progress indicator
firecrawl crawl https://example.com --progress

# Check crawl status
firecrawl crawl <job-id>

# List active crawl jobs
firecrawl list

# Show job and embedding status summary
firecrawl status

# Cancel a crawl job
firecrawl crawl <job-id> --cancel

# Fetch crawl errors
firecrawl crawl <job-id> --errors

# List active crawl jobs
firecrawl list

# Manually trigger embeddings for completed crawl
firecrawl crawl <job-id> --embed

# Disable embeddings
firecrawl crawl https://example.com --no-embed

# Limit pages
firecrawl crawl https://example.com --limit 100 --max-depth 3
```

#### Crawl Options

| Option                      | Description                                            |
| --------------------------- | ------------------------------------------------------ |
| `--wait`                    | Wait for crawl to complete and embed inline            |
| `--progress`                | Show progress while waiting (implies --wait)           |
| `--embed`                   | Manually trigger embeddings for a completed job        |
| `--cancel`                  | Cancel an existing crawl job (job ID required)         |
| `--errors`                  | Fetch crawl errors for a job ID                        |
| `--no-embed`                | Skip auto-embedding (useful for large crawls)          |
| `--limit <n>`               | Maximum pages to crawl                                 |
| `--max-depth <n>`           | Maximum crawl depth                                    |
| `--include-paths <paths>`   | Only crawl matching paths                              |
| `--exclude-paths <paths>`   | Skip matching paths                                    |
| `--sitemap <mode>`          | `include`, `skip`, or `only`                           |
| `--allow-subdomains`        | Include subdomains                                     |
| `--allow-external-links`    | Follow external links                                  |
| `--crawl-entire-domain`     | Crawl entire domain                                    |
| `--ignore-query-parameters` | Treat URLs with different params as same               |
| `--delay <ms>`              | Delay between requests                                 |
| `--max-concurrency <n>`     | Max concurrent requests                                |
| `--scrape-timeout <seconds>`| Per-page scrape timeout (default: 15)                  |
| `--timeout <seconds>`       | Overall crawl timeout when waiting                     |
| `--poll-interval <seconds>` | Status check interval                                  |

#### Embedding Behavior

**Async mode (default)**:
- Returns immediately with job ID
- Embedding job queued in `~/.config/firecrawl-cli/embed-queue/`
- Embeddings generated automatically when crawl completes
- Resilient to process interruptions and TEI downtime
- 3 automatic retries with exponential backoff

**Sync mode (--wait or --progress)**:
- Waits for crawl completion
- Embeds results inline before returning
- Traditional blocking behavior

**Manual control**:
```bash
# Check what's queued
$ ls ~/.config/firecrawl-cli/embed-queue/

# Manually process/retry embeddings
$ firecrawl crawl <job-id> --embed
```

#### Examples

```bash
# Crawl blog section only
firecrawl crawl https://example.com --include-paths /blog,/posts

# Exclude admin pages
firecrawl crawl https://example.com --exclude-paths /admin,/login

# Crawl with rate limiting
firecrawl crawl https://example.com --delay 1000 --max-concurrency 2

# Deep crawl with high limit
firecrawl crawl https://example.com --limit 1000 --max-depth 10 --wait --progress

# Save results
firecrawl crawl https://example.com --wait -o crawl-results.json --pretty

# Cancel a crawl job
firecrawl crawl <job-id> --cancel

# Fetch crawl errors
firecrawl crawl <job-id> --errors
```

---

### `list` - List active crawl jobs

Show currently active crawl jobs for your account.

```bash
firecrawl list
```

#### List Options

| Option                | Description                     |
| --------------------- | ------------------------------- |
| `-k, --api-key <key>` | Firecrawl API key override      |
| `--no-pretty`         | Disable pretty JSON output      |
| `-o, --output <path>` | Save output to file             |

---

### `status` - Job and embedding status

Show active crawls plus optional crawl/batch/extract job status and embedding queue summary.

```bash
# Summary (active crawls + embedding queue + recent jobs)
firecrawl status

# Check specific jobs
firecrawl status --crawl <job-id>
firecrawl status --batch <job-id>
firecrawl status --extract <job-id>

# Include a specific embedding job
firecrawl status --embed <job-id>
```

#### Status Options

| Option                 | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `--crawl <job-ids>`    | Comma-separated crawl job IDs to check          |
| `--batch <job-ids>`    | Comma-separated batch job IDs to check          |
| `--extract <job-ids>`  | Comma-separated extract job IDs to check        |
| `--embed [job-id]`     | Show embedding queue status (optionally by job) |
| `--json`               | Output JSON (compact)                           |
| `--pretty`             | Pretty print JSON output                        |
| `-o, --output <path>`  | Save output to file                             |

---

### `batch` - Batch scrape multiple URLs

Start batch scrapes, wait for completion, or manage jobs by ID.

```bash
# Start a batch scrape (async)
firecrawl batch https://a.com https://b.com https://c.com

# Wait for completion
firecrawl batch https://a.com https://b.com --wait

# Check status
firecrawl batch <job-id> --status

# Cancel a batch job
firecrawl batch <job-id> --cancel

# Fetch batch errors
firecrawl batch <job-id> --errors
```

#### Batch Options

| Option                      | Description                               |
| --------------------------- | ----------------------------------------- |
| `--wait`                    | Wait for batch scrape to complete         |
| `--poll-interval <seconds>` | Status polling interval                   |
| `--timeout <seconds>`       | Timeout for wait mode                     |
| `--status`                  | Get status for a batch job ID             |
| `--cancel`                  | Cancel a batch job                        |
| `--errors`                  | Fetch batch scrape errors                 |
| `--format <formats>`        | Scrape formats for batch results          |
| `--only-main-content`       | Only return main content                  |
| `--wait-for <ms>`           | Wait before scraping (JS-rendered pages)  |
| `--scrape-timeout <seconds>`| Per-page scrape timeout                   |
| `--screenshot`              | Include screenshot format                 |
| `--include-tags <tags>`     | Comma-separated tags to include           |
| `--exclude-tags <tags>`     | Comma-separated tags to exclude           |
| `--max-concurrency <number>`| Max concurrency for batch scraping        |
| `--ignore-invalid-urls`     | Ignore invalid URLs                       |
| `--webhook <url>`           | Webhook URL for batch completion          |
| `--zero-data-retention`     | Enable zero data retention                |
| `--idempotency-key <key>`   | Idempotency key for batch job             |
| `--append-to-id <id>`       | Append results to existing batch id       |
| `--integration <name>`      | Integration name for analytics            |
| `-o, --output <path>`       | Save to file                              |
| `--pretty`                  | Pretty print JSON output                  |

---

### `extract` - Extract structured data from URLs

Extract structured data from one or more URLs using natural language prompts or JSON schemas.

```bash
# Extract with a prompt
firecrawl extract https://example.com --prompt "Extract product pricing"

# Extract with a JSON schema
firecrawl extract https://example.com --schema '{"name": "string", "price": "number"}'

# Multiple URLs
firecrawl extract https://site1.com https://site2.com --prompt "Get company info"

# Show source URLs
firecrawl extract https://example.com --prompt "Find pricing" --show-sources --pretty

# Check extract job status
firecrawl extract <job-id> --status
```

#### Extract Options

| Option                     | Description                           |
| -------------------------- | ------------------------------------- |
| `--status`                 | Get extract job status by ID          |
| `--prompt <prompt>`        | Natural language extraction prompt    |
| `--schema <json>`          | JSON schema for structured extraction |
| `--system-prompt <prompt>` | System prompt for extraction          |
| `--allow-external-links`   | Allow following external links        |
| `--enable-web-search`      | Enable web search during extraction   |
| `--include-subdomains`     | Include subdomains                    |
| `--show-sources`           | Show source URLs in output            |
| `--no-embed`               | Skip auto-embedding                   |
| `--pretty`                 | Pretty print JSON output              |
| `-o, --output <path>`      | Save to file                          |

---

### `embed` - Embed content into Qdrant

Embed content from a URL, file, or stdin into a Qdrant vector database via TEI. Requires `TEI_URL` and `QDRANT_URL` environment variables.

```bash
# Embed a URL (scrapes first, then embeds)
firecrawl embed https://example.com

# Embed a local file
firecrawl embed /path/to/file.md --url https://example.com/page

# Embed from stdin
cat document.md | firecrawl embed - --url https://example.com/doc

# Embed without chunking
firecrawl embed https://example.com --no-chunk

# Custom collection
firecrawl embed https://example.com --collection my_collection
```

#### Embed Options

| Option                | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `--url <url>`         | Source URL for metadata (required for file/stdin input) |
| `--collection <name>` | Override Qdrant collection name                         |
| `--no-chunk`          | Embed as single vector, skip chunking                   |
| `--json`              | Output as JSON format                                   |
| `-o, --output <path>` | Save to file                                            |

---

### `query` - Semantic search over embedded content

Search over previously embedded content using natural language. Requires `TEI_URL` and `QDRANT_URL` environment variables.

```bash
# Basic semantic search
firecrawl query "how to authenticate"

# Limit results
firecrawl query "API endpoints" --limit 10

# Filter by domain
firecrawl query "configuration" --domain docs.example.com

# Show full chunk text (for RAG/LLM context)
firecrawl query "setup instructions" --full

# Group results by source URL
firecrawl query "error handling" --group

# JSON output
firecrawl query "authentication" --json
```

#### Query Options

| Option                | Description                     |
| --------------------- | ------------------------------- |
| `--limit <n>`         | Maximum results (default: 5)    |
| `--domain <domain>`   | Filter to specific domain       |
| `--full`              | Show complete chunk text        |
| `--group`             | Group results by source URL     |
| `--collection <name>` | Override Qdrant collection name |
| `--json`              | Output as JSON format           |
| `-o, --output <path>` | Save to file                    |

---

### `retrieve` - Retrieve full document from Qdrant

Reconstruct a full document from its stored chunks in Qdrant. Requires `QDRANT_URL` environment variable.

```bash
# Retrieve a previously embedded document
firecrawl retrieve https://example.com

# JSON output with per-chunk metadata
firecrawl retrieve https://example.com --json

# Save to file
firecrawl retrieve https://example.com -o document.md
```

#### Retrieve Options

| Option                | Description                              |
| --------------------- | ---------------------------------------- |
| `--collection <name>` | Override Qdrant collection name          |
| `--json`              | Output as JSON (includes chunk metadata) |
| `-o, --output <path>` | Save to file                             |

---

### `config` - View configuration

```bash
firecrawl config
```

Shows authentication status and stored credentials location.

---

### `login` / `logout`

```bash
# Login interactively
firecrawl login

# Login with API key and custom URL
firecrawl login --api-key your-key --api-url http://localhost:53002

# Logout
firecrawl logout
```

---

## Embedding Pipeline

When configured, `scrape`, `crawl`, `search --scrape`, and `extract` automatically embed their output into Qdrant for semantic search. This also enables the `embed`, `query`, and `retrieve` commands.

### Setup

Set these environment variables (or add to `.env`):

```bash
export TEI_URL=http://localhost:52000        # Text Embeddings Inference server
export QDRANT_URL=http://localhost:53333      # Qdrant vector database
export QDRANT_COLLECTION=firecrawl_collection # optional, this is the default
```

### Auto-Embed Behavior

Content-producing commands automatically embed their output when TEI and Qdrant are configured. Use `--no-embed` on any command to skip:

```bash
firecrawl scrape https://example.com --no-embed
firecrawl crawl https://example.com --wait --no-embed
```

Without TEI/Qdrant configured, the CLI works normally and silently skips embedding.

---

## Global Options

These options work with any command:

| Option                | Description                     |
| --------------------- | ------------------------------- |
| `--status`            | Show version, auth, and API URL |
| `-k, --api-key <key>` | Use specific API key            |
| `-V, --version`       | Show version                    |
| `-h, --help`          | Show help                       |

### Check Status (CLI)

```bash
firecrawl --status
```

```
  🔥 firecrawl cli v1.1.1

  ● Authenticated via FIRECRAWL_API_KEY
  API URL: http://localhost:53002
```

---

## Output Handling

### Stdout vs File

```bash
# Output to stdout (default)
firecrawl https://example.com

# Pipe to another command
firecrawl https://example.com | head -50

# Save to file
firecrawl https://example.com -o output.md

# JSON output
firecrawl https://example.com --format links --pretty
```

### Format Behavior

- **Single format**: Outputs raw content (markdown text, HTML, etc.)
- **Multiple formats**: Outputs JSON with all requested data

```bash
# Raw markdown output
firecrawl https://example.com --format markdown

# JSON output with multiple formats
firecrawl https://example.com --format markdown,links,images
```

---

## Tips & Tricks

### Scrape multiple URLs

```bash
# Using a loop
for url in https://example.com/page1 https://example.com/page2; do
  firecrawl "$url" -o "$(echo $url | sed 's/[^a-zA-Z0-9]/_/g').md"
done

# From a file
cat urls.txt | xargs -I {} firecrawl {} -o {}.md
```

### Combine with other tools

```bash
# Extract links and process with jq
firecrawl https://example.com --format links | jq '.links[].url'

# Convert to PDF (with pandoc)
firecrawl https://example.com | pandoc -o document.pdf

# Search within scraped content
firecrawl https://example.com | grep -i "keyword"
```

### CI/CD Usage

```bash
# Set API key via environment
export FIRECRAWL_API_KEY=${{ secrets.FIRECRAWL_API_KEY }}
firecrawl crawl https://docs.example.com --wait -o docs.json
```

---

## Documentation

For more details, visit the [Firecrawl Documentation](https://docs.firecrawl.dev).
