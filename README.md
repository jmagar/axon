# ⚡ **Axon**

Self-hosted RAG pipeline for web scraping, semantic search, and AI-powered Q&A. Scrape, crawl, extract, and embed data from any website directly from your terminal. Includes a built-in embedding pipeline for semantic search and AI-powered Q&A over scraped content via Qdrant, TEI, and Claude/Gemini CLI.

## Installation

### CLI Tool

```bash
npm install -g @jmagar/axon
```

### One-Liner Installer (curl | bash)

Bootstrap Axon in one command. This installer will clone/update the repo, create/update `.env`, generate secrets, detect and adjust conflicting ports, install CLI skill/command links, and start the Docker stack.

```bash
curl -fsSL https://raw.githubusercontent.com/jmagar/axon/main/scripts/install.sh | bash
```

Optional flags:

```bash
curl -fsSL https://raw.githubusercontent.com/jmagar/axon/main/scripts/install.sh | bash -s -- --skip-docker
curl -fsSL https://raw.githubusercontent.com/jmagar/axon/main/scripts/install.sh | bash -s -- --install-dir \"$HOME/src/axon\"
```

### Claude Code Plugin

Install the complete Axon plugin for Claude Code with skills and slash commands:

```bash
# Install from GitHub
/plugin install https://github.com/jmagar/axon.git

# Or via marketplace
/plugin marketplace add jmagar/axon
/plugin install axon @axon-marketplace
```

**Included in the plugin:**
- **Skills**: Automatic Axon integration for web scraping and research tasks
- **Slash Commands**: 10 commands for direct control
  - `/axon:scrape` - Scrape single URLs
  - `/axon:crawl` - Crawl entire websites
  - `/axon:search` - Web search with scraping
  - `/axon:map` - Discover all URLs on a site
  - `/axon:extract` - Structured data extraction
  - `/axon:batch` - Batch operations
  - `/axon:query` - Semantic search
  - `/axon:retrieve` - Document retrieval
  - `/axon:ask` - AI-powered Q&A
  - `/axon:status` - Job status checking

## Self-Hosted Setup

This project includes a self-hosted Firecrawl backend stack with Docker Compose:

```bash
# Start all services (Firecrawl, Patchright, Qdrant, Embedder Daemon)
docker compose up -d

# Check service status
docker compose ps
```

**Services:**
- **Firecrawl API**: http://localhost:53002
- **Patchright** (browser scraping): Internal on port 53006
- **Qdrant** (vector DB): http://localhost:53333
- **Embedder Daemon**: http://localhost:53000

**Note:** TEI (Text Embeddings Inference) runs on a remote GPU server and is not part of the local Docker stack.

**Important:** The project includes a patched `docker/patchright-app.py` file that fixes a bug in the upstream `loorisr/patchright-scrape-api` image. This file is automatically mounted into the container via `docker-compose.yaml`. The fix changes `page.timeout()` to `page.wait_for_timeout()` to prevent 500 errors when using the `--wait-for` flag.

See `CLAUDE.md` for detailed infrastructure documentation.

## Quick Start

Just run a command - the CLI will prompt you to authenticate if needed:

```bash
axon https://example.com
```

## Authentication

On first run, you'll be prompted to authenticate:

```
  ⚡ axon cli
  Turn websites into LLM-ready data

Welcome! To get started, provide your Firecrawl API key.

Tip: You can also set FIRECRAWL_API_KEY and FIRECRAWL_API_URL environment variables
```

### Authentication Methods

```bash
# Environment variables (recommended for self-hosted)
export FIRECRAWL_API_KEY=your-api-key
export FIRECRAWL_API_URL=http://localhost:53002

# Optional: embedding pipeline (enables embed, query, retrieve, ask commands)
# TEI runs on remote GPU server - update with your TEI endpoint
export TEI_URL=http://your-tei-server:52000
export QDRANT_URL=http://localhost:53333

# Optional: default AI model for ask command
# Supported: opus, sonnet, haiku (claude) or gemini-3-pro-preview, gemini-3-flash-preview (gemini)
export ASK_CLI=haiku

# Interactive (prompts automatically when needed)
axon

# Direct API key
axon login --api-key your-api-key --api-url http://localhost:53002

# Per-command API key
axon scrape https://example.com --api-key your-api-key
```

---

## Shell Completion

Enable tab completion for commands, options, and arguments in your shell.

### Installation

**Automatic (recommended):**

The CLI will auto-detect your shell (bash, zsh, or fish) and show installation instructions:

```bash
axon completion install
```

**Manual installation:**

If you prefer to manually add completion to your shell RC file:

```bash
# Bash
axon completion script bash >> ~/.bashrc
source ~/.bashrc

# Zsh
axon completion script zsh >> ~/.zshrc
source ~/.zshrc

# Fish
axon completion script fish >> ~/.config/fish/config.fish
source ~/.config/fish/config.fish
```

**Uninstall:**

```bash
axon completion uninstall
```

### Usage

After installation, restart your shell or source your RC file. Then use Tab to complete:

```bash
axon <TAB>              # Shows all commands
axon scrape --<TAB>      # Shows scrape options
axon crawl --<TAB>       # Shows crawl options
axon batch <TAB>         # Shows batch subcommands
```

### Features

- ✅ All command names (scrape, crawl, map, search, extract, batch, embed, query, retrieve, ask, etc.)
- ✅ All option flags (--wait, --format, --output, --pretty, etc.)
- ✅ Subcommand completion (batch status/cancel/errors, crawl status/cancel/clear/cleanup/errors, embed cancel/clear/cleanup, extract status)
- ✅ File path completion for --output option
- ✅ Context-aware option suggestions based on command

---

## Commands

### `scrape` - Scrape a single URL

Extract content from any webpage in various formats.

```bash
# Basic usage (outputs markdown)
axon https://example.com
axon scrape https://example.com

# Get raw HTML
axon https://example.com --html
axon https://example.com -H

# Multiple formats (outputs JSON)
axon https://example.com --format markdown,links,images

# Save to file
axon https://example.com -o output.md
axon https://example.com --format json -o data.json --pretty
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
axon https://blog.example.com --only-main-content

# Wait for JS to render, then scrape
axon https://spa-app.com --wait-for 3000

# Get all links from a page
axon https://example.com --format links

# Screenshot + markdown
axon https://example.com --format markdown --screenshot

# Extract specific elements only
axon https://example.com --include-tags article,main

# Exclude navigation and ads
axon https://example.com --exclude-tags nav,aside,.ad
```

---

### `search` - Search the web

Search the web and optionally scrape content from search results.

```bash
# Basic search
axon search "firecrawl web scraping"

# Limit results
axon search "AI news" --limit 10

# Search news sources
axon search "tech startups" --sources news

# Search images
axon search "landscape photography" --sources images

# Multiple sources
axon search "machine learning" --sources web,news,images

# Filter by category (GitHub, research papers, PDFs)
axon search "web scraping python" --categories github
axon search "transformer architecture" --categories research
axon search "machine learning" --categories github,research

# Time-based search
axon search "AI announcements" --tbs qdr:d   # Past day
axon search "tech news" --tbs qdr:w          # Past week

# Location-based search
axon search "restaurants" --location "San Francisco,California,United States"
axon search "local news" --country DE

# Search and scrape results
axon search "firecrawl tutorials" --scrape
axon search "API documentation" --scrape --scrape-formats markdown,links

# Output as pretty JSON
axon search "web scraping" --pretty
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
| `--json`                     | Output as compact JSON                                                                       |

#### Examples

```bash
# Research a topic with recent results
axon search "React Server Components" --tbs qdr:m --limit 10

# Find GitHub repositories
axon search "web scraping library" --categories github --limit 20

# Search and get full content
axon search "firecrawl documentation" --scrape --scrape-formats markdown --pretty -o results.json

# Find research papers
axon search "large language models" --categories research --pretty

# Search with location targeting
axon search "best coffee shops" --location "Berlin,Germany" --country DE

# Get news from the past week
axon search "AI startups funding" --sources news --tbs qdr:w --limit 15
```

---

### `map` - Discover all URLs on a website

Quickly discover all URLs on a website without scraping content.

```bash
# List all URLs (one per line)
axon map https://example.com

# Output as JSON
axon map https://example.com --json

# Search for specific URLs
axon map https://example.com --search "blog"

# Limit results
axon map https://example.com --limit 500
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
| `--json`                    | Output as JSON                    |
| `-o, --output <path>`       | Save to file                      |

#### Examples

```bash
# Find all product pages
axon map https://shop.example.com --search "product"

# Get sitemap URLs only
axon map https://example.com --sitemap only

# Save URL list to file
axon map https://example.com -o urls.txt

# Include subdomains
axon map https://example.com --include-subdomains --limit 1000
```
---

### `crawl` - Crawl an entire website

Crawl multiple pages from a website. Embeddings are automatically generated when TEI/Qdrant are configured.

```bash
# Start async crawl (returns immediately, embeddings queued)
axon crawl https://example.com
# Returns job ID in <1 second
# Embeddings generated automatically when crawl completes

# Wait for crawl to complete and embed inline
axon crawl https://example.com --wait

# With progress indicator
axon crawl https://example.com --progress

# Check crawl status
axon crawl status <job-id>

# List active crawl jobs
axon list

# Show job and embedding status summary
axon status

# Cancel a crawl job
axon crawl cancel <job-id>

# Fetch crawl errors
axon crawl errors <job-id>

# Manually trigger embeddings for completed crawl
axon crawl <job-id> --embed

# Clear crawl queue (history + best-effort active cancel)
axon crawl clear

# Cleanup only failed/stale/stalled crawl history entries
axon crawl cleanup

# Disable embeddings
axon crawl https://example.com --no-embed

# Limit pages
axon crawl https://example.com --limit 100 --max-depth 3
```

#### Crawl Subcommands

| Subcommand | Description |
| ---------- | ----------- |
| `status <job-id>` | Check status for a specific crawl job |
| `cancel <job-id>` | Cancel a specific crawl job |
| `errors <job-id>` | Fetch crawl errors for a specific crawl job |
| `clear` | Clear the entire crawl queue/history and best-effort cancel active crawls |
| `cleanup` | Remove only failed/stale/stalled/not-found crawl entries from queue/history |

#### Crawl Options

| Option                      | Description                                            |
| --------------------------- | ------------------------------------------------------ |
| `--wait`                    | Wait for crawl to complete and embed inline            |
| `--progress`                | Show progress while waiting (implies --wait)           |
| `--embed`                   | Manually trigger embeddings for a completed job        |
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
| `--timeout <seconds>`       | Overall crawl timeout when waiting                     |
| `--poll-interval <seconds>` | Status check interval                                  |

#### Embedding Behavior

**Async mode (default)**:
- Returns immediately with job ID
- Embedding job queued in `~/.axon/embed-queue/` by default
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
$ ls ~/.axon/embed-queue/

# Manually process/retry embeddings
$ axon crawl <job-id> --embed
```

#### Examples

```bash
# Crawl blog section only
axon crawl https://example.com --include-paths /blog,/posts

# Exclude admin pages
axon crawl https://example.com --exclude-paths /admin,/login

# Crawl with rate limiting
axon crawl https://example.com --delay 1000 --max-concurrency 2

# Deep crawl with high limit
axon crawl https://example.com --limit 1000 --max-depth 10 --wait --progress

# Save results
axon crawl https://example.com --wait -o crawl-results.json --pretty

# Cancel a crawl job
axon crawl cancel <job-id>

# Fetch crawl errors
axon crawl errors <job-id>

# Cleanup failed/stale/stalled crawl history entries
axon crawl cleanup
```

---

### `list` - List active crawl jobs

Show currently active crawl jobs for your account.

```bash
axon list
```

#### List Options

| Option                | Description                     |
| --------------------- | ------------------------------- |
| `-k, --api-key <key>` | Firecrawl API key override      |
| `--json`              | Output as compact JSON          |
| `--pretty`            | Pretty print JSON output        |
| `-o, --output <path>` | Save output to file             |

---

### `status` - Job and embedding status

Show active crawls, recent crawl/batch/extract job statuses, and embedding queue summary.

```bash
# Summary (active crawls + embedding queue + recent jobs)
axon status
```

#### Status Options

| Option                 | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `--clear`              | Clear local status job-history cache            |
| `--json`               | Output JSON (compact)                           |
| `--pretty`             | Pretty print JSON output                        |
| `-o, --output <path>`  | Save output to file                             |

---

### `batch` - Batch scrape multiple URLs

Start batch scrapes, wait for completion, or manage jobs by ID.

```bash
# Start a batch scrape (async)
axon batch https://a.com https://b.com https://c.com

# Wait for completion
axon batch https://a.com https://b.com --wait

# Check status
axon batch status <job-id>

# Cancel a batch job
axon batch cancel <job-id>

# Fetch batch errors
axon batch errors <job-id>
```

#### Batch Subcommands

| Subcommand | Description                           |
| ---------- | ------------------------------------- |
| `status`   | Get status for a batch job by ID      |
| `cancel`   | Cancel a running batch scrape job     |
| `errors`   | Get error details for a batch job     |

#### Batch Options

| Option                      | Description                               |
| --------------------------- | ----------------------------------------- |
| `--wait`                    | Wait for batch scrape to complete         |
| `--poll-interval <seconds>` | Status polling interval                   |
| `--timeout <seconds>`       | Timeout for wait mode                     |
| `--format <formats>`        | Scrape formats for batch results          |
| `--only-main-content`       | Only return main content                  |
| `--wait-for <ms>`           | Wait before scraping (JS-rendered pages)  |
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
axon extract https://example.com --prompt "Extract product pricing"

# Extract with a JSON schema
axon extract https://example.com --schema '{"name": "string", "price": "number"}'

# Multiple URLs
axon extract https://site1.com https://site2.com --prompt "Get company info"

# Show source URLs
axon extract https://example.com --prompt "Find pricing" --show-sources --pretty

# Check extract job status
axon extract status <job-id>
```

#### Extract Subcommands

| Subcommand | Description                           |
| ---------- | ------------------------------------- |
| `status`   | Get status for an extract job by ID   |

#### Extract Options

| Option                     | Description                           |
| -------------------------- | ------------------------------------- |
| `--prompt <prompt>`        | Natural language extraction prompt    |
| `--schema <json>`          | JSON schema for structured extraction |
| `--system-prompt <prompt>` | System prompt for extraction          |
| `--allow-external-links`   | Allow following external links        |
| `--enable-web-search`      | Enable web search during extraction (default) |
| `--no-enable-web-search`   | Disable web search during extraction  |
| `--include-subdomains`     | Include subdomains (default)          |
| `--no-include-subdomains`  | Exclude subdomains                    |
| `--show-sources`           | Show source URLs in output (default)  |
| `--no-show-sources`        | Hide source URLs in output            |
| `--no-embed`               | Skip auto-embedding                   |
| `--pretty`                 | Pretty print JSON output              |
| `-o, --output <path>`      | Save to file                          |

---

### `embed` - Embed content into Qdrant

Embed content from a URL, file, or stdin into a Qdrant vector database via TEI. Requires `TEI_URL` and `QDRANT_URL` environment variables.

```bash
# Embed a URL (scrapes first, then embeds)
axon embed https://example.com

# Embed a local file
axon embed /path/to/file.md --url https://example.com/page

# Embed from stdin
cat document.md | axon embed - --url https://example.com/doc

# Embed without chunking
axon embed https://example.com --no-chunk

# Custom collection
axon embed https://example.com --collection my_collection

# Cancel a specific embedding job
axon embed cancel <job-id>

# Check a specific embedding job
axon embed status <job-id>

# Clear the entire embedding queue
axon embed clear

# Cleanup only failed/stale/stalled embedding jobs
axon embed cleanup
```

#### Embed Options

| Option                | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `--url <url>`         | Source URL for metadata (required for file/stdin input) |
| `--collection <name>` | Override Qdrant collection name                         |
| `--no-chunk`          | Embed as single vector, skip chunking                   |
| `--json`              | Output as JSON format                                   |
| `-o, --output <path>` | Save to file                                            |

#### Embed Subcommands

| Subcommand | Description |
| ---------- | ----------- |
| `status <job-id>` | Get status for a specific embedding job |
| `cancel <job-id>` | Cancel a specific pending embedding job |
| `clear` | Clear the entire embedding queue (pending/processing/completed/failed) |
| `cleanup` | Remove only failed and stale/stalled embedding jobs |

---

### `query` - Semantic search over embedded content

Search over previously embedded content using natural language. Requires `TEI_URL` and `QDRANT_URL` environment variables.

```bash
# Basic semantic search
axon query "how to authenticate"

# Limit results
axon query "API endpoints" --limit 10

# Filter by domain
axon query "configuration" --domain docs.example.com

# Show full chunk text (for RAG/LLM context)
axon query "setup instructions" --full

# Group results by source URL
axon query "error handling" --group

# JSON output
axon query "authentication" --json
```

#### Query Options

| Option                | Description                     |
| --------------------- | ------------------------------- |
| `--limit <n>`         | Maximum results (default: 10)   |
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
axon retrieve https://example.com

# JSON output with per-chunk metadata
axon retrieve https://example.com --json

# Save to file
axon retrieve https://example.com -o document.md
```

#### Retrieve Options

| Option                | Description                              |
| --------------------- | ---------------------------------------- |
| `--collection <name>` | Override Qdrant collection name          |
| `--json`              | Output as JSON (includes chunk metadata) |
| `-o, --output <path>` | Save to file                             |

---

### `ask` - Ask questions about your embedded documents

Ask natural language questions about your embedded documents and get AI-powered answers. Automatically queries Qdrant, retrieves relevant documents, and uses Claude or Gemini CLI to generate responses.

```bash
# Basic usage (uses haiku by default)
axon ask "How do I create a Claude Code skill?"

# Limit number of documents retrieved
axon ask "What is FastAPI?" --limit 5

# Use a different Claude model
axon ask "Complex technical analysis needed" --model sonnet
axon ask "Comprehensive review required" --model opus

# Use Gemini instead of Claude
axon ask "Explain this concept" --model gemini-3-flash-preview
axon ask "In-depth research needed" --model gemini-3-pro-preview

# Filter by domain
axon ask "React hooks explanation" --domain react.dev

# Custom collection
axon ask "API documentation" --collection docs

# Combine options
axon ask "Authentication best practices" --limit 10 --model sonnet --domain docs.example.com
```

#### Ask Options

| Option                | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| `--limit <n>`         | Maximum documents to retrieve (default: 10)                                 |
| `--domain <domain>`   | Filter results by domain                                                    |
| `--collection <name>` | Qdrant collection name (default: axon)                                 |
| `--model <name>`      | AI model to use (see supported models below)                                |

#### Supported Models

**Claude (via `claude` CLI):**
- `haiku` - Fast, cost-effective (default)
- `sonnet` - Balanced performance and intelligence
- `opus` - Maximum capability for complex tasks

**Gemini (via `gemini` CLI):**
- `gemini-3-flash-preview` - Fast responses
- `gemini-3-pro-preview` - Enhanced capabilities

#### Model Configuration

Set a default model via environment variable:

```bash
# Ask command model default
export ASK_CLI=gemini-3-flash-preview
```

Command-line `--model` flag always overrides `ASK_CLI`.

#### Requirements

- **TEI and Qdrant**: Must be configured for semantic search (`TEI_URL` and `QDRANT_URL` environment variables)
- **Claude CLI**: Install from Anthropic for Claude models
- **Gemini CLI**: Install from Google for Gemini models
- **Embedded content**: Must have previously scraped/crawled content with embeddings enabled

#### How It Works

1. **Query**: Performs semantic search in Qdrant for relevant documents
2. **Retrieve**: Fetches full content from top matching documents
3. **Format**: Builds context string with documents + your question
4. **AI CLI**: Spawns `claude` or `gemini` CLI subprocess (auto-detected from model name)
5. **Stream**: Real-time response output to stdout, sources to stderr

#### Why CLI Subprocess?

- **No API costs**: Uses your Claude Max or Gemini subscription
- **Simple**: No API key management or SDK dependencies
- **Standard**: Same pattern as calling `git`, `docker`, or `npm`
- **Maintained**: Officially supported by Anthropic/Google

#### Examples

```bash
# Quick question with default settings
axon ask "What are the main features?"

# Research-heavy query with more context
axon ask "Compare authentication approaches" --limit 15 --model sonnet

# Domain-specific search
axon ask "API rate limiting best practices" --domain api.docs.example.com

# Use Gemini for variety
axon ask "Summarize the architecture" --model gemini-3-pro-preview

# Save AI response to file (stdout redirect)
axon ask "Setup instructions" > setup-guide.md

# Complex query with maximum intelligence
axon ask "Security implications of this design" --model opus --limit 20
```

#### Output Format

- **stdout**: AI response only (clean, pipe-safe)
- **stderr**: Progress messages, source citations, metadata

This separation allows piping the AI response while still seeing progress:

```bash
# Pipe response to another tool
axon ask "Code examples" | grep -A5 "function"

# Save response, see progress in terminal
axon ask "Documentation" > output.md
```

---

### `config` - View and manage configuration

```bash
# View configuration
axon config

# View configuration as JSON
axon config --json
axon view-config --json

# Legacy top-level settings (still supported)
axon config set exclude-paths "/admin,/api,/login"
axon config set exclude-extensions ".pkg,.exe,.dmg,.zip"
axon config get exclude-paths
axon config get exclude-extensions
axon config get excludes

# Clear legacy top-level settings
axon config clear exclude-paths
axon config clear exclude-extensions

# Nested settings (new)
axon config get crawl.maxDepth
axon config set crawl.maxDepth 10
axon config set search.limit 20
axon config reset crawl.maxDepth
axon config reset
```

Shows authentication status, stored credentials location, user settings, command defaults, and runtime environment values.
Use `--json` for machine-readable diagnostics.

#### Settings File and Precedence

- Settings file path:
  - Default: `~/.axon/settings.json`
  - Override root with `AXON_HOME`; file becomes `$AXON_HOME/settings.json`
- Creation/materialization:
  - The CLI auto-creates `settings.json` on first use.
  - Existing partial files are normalized to a full schema so defaults are visible and editable.
- Runtime precedence:
  - `CLI flags > settings.json > built-in defaults`
- Migration/recovery behavior:
  - Legacy settings locations are migrated automatically.
  - Invalid settings files are backed up and replaced with valid defaults.
  - Backups are written as timestamped files beside `settings.json` (for example: `settings.json.backup-<timestamp>` or `settings.json.invalid-backup-<timestamp>`).

#### Supported Nested `config` Keys

`config get/set/reset` currently supports these typed nested keys:

- `crawl.maxDepth`
- `crawl.sitemap`
- `search.limit`
- `scrape.timeoutSeconds`
- `http.timeoutMs`
- `chunking.maxChunkSize`
- `embedding.maxConcurrent`
- `polling.intervalMs`

#### Example `settings.json`

```json
{
  "settingsVersion": 2,
  "defaultExcludePaths": ["/admin/*", "/private/*"],
  "defaultExcludeExtensions": [".exe", ".pkg", ".zip"],
  "crawl": {
    "maxDepth": 5,
    "sitemap": "include",
    "ignoreQueryParameters": true,
    "allowSubdomains": true,
    "onlyMainContent": true
  },
  "scrape": {
    "timeoutSeconds": 15,
    "formats": ["markdown"]
  },
  "search": {
    "limit": 5,
    "timeoutMs": 60000
  },
  "http": {
    "timeoutMs": 30000,
    "maxRetries": 3
  },
  "embedding": {
    "maxConcurrent": 10,
    "batchSize": 24
  },
  "polling": {
    "intervalMs": 5000
  }
}
```

---

### `doctor` - Diagnose local environment and services

Run connectivity and environment diagnostics for local/self-hosted setups.

```bash
# Human-readable diagnostics
axon doctor

# JSON diagnostics for automation
axon doctor --json
axon doctor --json --pretty

# Run doctor, then stream AI troubleshooting guidance
axon doctor debug
```

Checks include:

- Docker compose container status/health
- Service URL reachability (docker hostname checks use localhost published ports when available, otherwise probe from a running compose container)
- Directory write access (`AXON_HOME`, embed queue, `QDRANT_DATA_DIR`)
- AI CLI install check for configured model (`ASK_CLI` => gemini/claude `--version`)
- Storage config files existence (`credentials.json`, `settings.json`, `job-history.json`)

#### Doctor Options

| Option           | Description                                  |
| ---------------- | -------------------------------------------- |
| `--json`         | Output machine-readable JSON                 |
| `--pretty`       | Pretty print JSON output                     |
| `--timeout <ms>` | Per-check timeout in milliseconds (default: 3000) |

#### Doctor Debug Options

| Option              | Description                                        |
| ------------------- | -------------------------------------------------- |
| `--timeout <ms>`    | Per-check timeout in milliseconds (default: 3000)  |
| `--ai-timeout <ms>` | AI debug analysis timeout in milliseconds (default: 120000) |

`doctor debug` backend selection:
- Uses `ASK_CLI` (Gemini/Claude CLI) when configured.
- Falls back to OpenAI-compatible endpoint when `ASK_CLI` is not set and all of `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `OPENAI_MODEL` are configured.

#### Binary File Exclusion

The CLI automatically excludes common binary files during crawls to prevent worker crashes. By default, these extensions are excluded:

**Executables/Installers:** `.exe`, `.msi`, `.dmg`, `.pkg`, `.deb`, `.rpm`
**Archives:** `.zip`, `.tar`, `.gz`, `.bz2`, `.7z`, `.rar`
**Media:** `.mp4`, `.mp3`, `.avi`, `.mov`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.pdf`
**Fonts:** `.ttf`, `.woff`, `.woff2`

You can customize this list:

```bash
# Override default extensions (replaces built-in list)
axon config set exclude-extensions ".pkg,.exe,.dmg"

# Revert to built-in defaults
axon config clear exclude-extensions

# Check current configuration
axon config get exclude-extensions
```

Extensions are converted to wildcard patterns (e.g., `.pkg` → `**/*.pkg`) and merged with `excludePaths` transparently. To disable all default exclusions (both paths and extensions) for a single crawl:

```bash
axon crawl https://example.com --no-default-excludes
```

---

### `login` / `logout`

```bash
# Login interactively
axon login

# Login with API key and custom URL
axon login --api-key your-key --api-url http://localhost:53002

# Logout
axon logout
```

---

## Embedding Pipeline

When configured, `scrape`, `crawl`, `search --scrape`, and `extract` automatically embed their output into Qdrant for semantic search. This also enables the `embed`, `query`, `retrieve`, and `ask` commands.

### Setup

Set these environment variables (or add to `.env`):

```bash
# TEI runs on remote GPU server - update with your TEI endpoint
export TEI_URL=http://your-tei-server:52000     # Text Embeddings Inference server
export QDRANT_URL=http://localhost:53333        # Qdrant vector database
export QDRANT_COLLECTION=axon                    # optional, this is the default
```

### TEI Deployment Options

This repo includes two standalone TEI compose profiles:

| Profile | Compose File | Env File | Recommended For | Default Port |
| --- | --- | --- | --- | --- |
| General GPU profile | `docker-compose.tei.yaml` | `.env.tei` | NVIDIA GPU hosts (optimized defaults) | `53020` |
| Broad compatibility (Mixedbread) | `docker-compose.tei.mxbai.yaml` | `.env.tei.mxbai` | CPU-first or mixed hardware environments | `53021` |

#### 1) General GPU TEI

```bash
cp .env.tei.example .env.tei
docker compose --env-file .env.tei -f docker-compose.tei.yaml up -d
```

#### 2) Mixedbread (1024-dim, broader hardware)

```bash
cp .env.tei.mxbai.example .env.tei.mxbai
docker compose --env-file .env.tei.mxbai -f docker-compose.tei.mxbai.yaml up -d
```

Notes:
- CPU image defaults to `float32` in the Mixedbread profile (required for TEI CPU backend).
- For RTX 40xx users on Mixedbread, set:
  - `TEI_IMAGE=ghcr.io/huggingface/text-embeddings-inference:89-1.8.1`

#### Choosing a collection for crawl auto-embedding

`scrape`/`embed`/`query`/`retrieve` commands use the current CLI environment.

`crawl` auto-embedding is processed asynchronously by `axon-embedder`, so collection routing comes from the compose/runtime environment of that service (`QDRANT_COLLECTION` in `.env` for the embedder service), not from one-off shell overrides.

### Auto-Embed Behavior

Content-producing commands automatically embed their output when TEI and Qdrant are configured. Use `--no-embed` on any command to skip:

```bash
axon scrape https://example.com --no-embed
axon crawl https://example.com --wait --no-embed
```

Without TEI/Qdrant configured, the CLI works normally and silently skips embedding.

### Queue Maintenance & Stale Recovery

- `axon embed cleanup` removes only failed/stale/stalled embedding jobs.
- To wipe the entire embedding queue, use `axon embed clear`.
- For crawl history, `axon crawl cleanup` prunes failed/stale/stalled/not-found entries.
- Crawl jobs that are actively progressing (for example, `completed < total`) are not removed by cleanup.
- Crawl jobs in an in-progress state (`scraping`/`processing`/`running`) with `completed >= total` are treated as stale and removed by cleanup.
- `axon crawl clear` clears crawl queue/history and attempts to cancel active crawls.
- Automatic stale pending threshold is controlled by `AXON_EMBEDDER_STALE_MINUTES` (default `10` minutes).
- Stuck processing recovery threshold is `5` minutes.
- Stale scan interval is half the stale threshold with a minimum of `60s` (default `5m`).
- Old completed/failed embedding jobs are pruned automatically:
  - `axon status`: jobs older than `1h`
  - embedder daemon startup: jobs older than `24h`
- Irrecoverable failed embedding jobs (for example, `Job not found` / `invalid job id`) are auto-pruned during daemon stale cycles.
- Active crawls that are still scraping do not consume embedding retry attempts.

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
axon --status
```

```
  ⚡ axon cli v1.1.1

  ● Authenticated via FIRECRAWL_API_KEY
  API URL: http://localhost:53002
```

---

## Output Handling

### Stdout vs File

```bash
# Output to stdout (default)
axon https://example.com

# Pipe to another command
axon https://example.com | head -50

# Save to file
axon https://example.com -o output.md

# JSON output
axon https://example.com --format links --pretty
```

### Format Behavior

- **Single format**: Outputs raw content (markdown text, HTML, etc.)
- **Multiple formats**: Outputs JSON with all requested data

```bash
# Raw markdown output
axon https://example.com --format markdown

# JSON output with multiple formats
axon https://example.com --format markdown,links,images
```

---

## Tips & Tricks

### Scrape multiple URLs

```bash
# Using a loop
for url in https://example.com/page1 https://example.com/page2; do
  axon "$url" -o "$(echo $url | sed 's/[^a-zA-Z0-9]/_/g').md"
done

# From a file
cat urls.txt | xargs -I {} axon {} -o {}.md
```

### Combine with other tools

```bash
# Extract links and process with jq
axon https://example.com --format links | jq '.links[].url'

# Convert to PDF (with pandoc)
axon https://example.com | pandoc -o document.pdf

# Search within scraped content
axon https://example.com | grep -i "keyword"
```

### CI/CD Usage

```bash
# Set API key via environment
export FIRECRAWL_API_KEY=${{ secrets.FIRECRAWL_API_KEY }}
axon crawl https://docs.example.com --wait -o docs.json
```

---

## Documentation

For details on the upstream Firecrawl scraping backend, visit the [Firecrawl Documentation](https://docs.firecrawl.dev).
