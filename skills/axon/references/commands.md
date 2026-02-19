# Axon Complete Command Reference

Comprehensive reference for all Axon CLI commands with full parameter details.

---

## Core Commands

### Scrape Single URL

Extract content from a single webpage with optional auto-embedding.

```bash
# Basic scrape (markdown by default)
axon scrape https://example.com

# Only main content (removes navigation, footers)
axon scrape https://example.com --only-main-content

# Multiple formats (returns JSON)
axon scrape https://example.com --format markdown,html,links,images

# Wait for JavaScript rendering
axon scrape https://example.com --wait-for 5000

# Take screenshot
axon scrape https://example.com --screenshot

# Scrape with timing information
axon scrape https://example.com --timing

# Scrape WITHOUT auto-embedding (disable default behavior)
axon scrape https://example.com --no-embed

# Remove domain from vector DB before scraping
axon scrape https://example.com --remove

# Save to file
axon scrape https://example.com -o output.md
```

**Enhanced Parameters:**
- `--format markdown|html|rawHtml|links|images|screenshot|summary|changeTracking|attributes|branding`: Output format(s)
- `--only-main-content`: Strip navigation and footers (default: true)
- `--no-only-main-content`: Include full page content
- `--wait-for <ms>`: Wait for JavaScript rendering
- `--timeout <seconds>`: Request timeout (default: 15)
- `--screenshot`: Capture page screenshot
- `--include-tags <tags>`: Only include specified HTML tags
- `--exclude-tags <tags>`: Exclude specified HTML tags (default: "nav,footer")
- `-o, --output <path>`: Save output to file
- `--json`: Output as JSON format
- `--pretty`: Pretty-print JSON output
- `--timing`: Show request timing and performance info
- **`--no-embed`**: Skip auto-embedding of scraped content
- **`--remove`**: Remove all documents for this domain from Qdrant before scraping

---

### Extract Structured Data

Extract structured data from URLs using prompts or JSON schemas.

```bash
# Extract with natural language prompt
axon extract https://example.com/products \
  --prompt "Extract product names, prices, and descriptions"

# Extract with JSON schema
axon extract https://example.com/products \
  --schema '{"type":"object","properties":{"name":{"type":"string"},"price":{"type":"number"}}}'

# Extract with system prompt for context
axon extract https://example.com/products \
  --prompt "Extract products" \
  --system-prompt "You are a product data extractor"

# Extract with web search augmentation
axon extract https://example.com \
  --prompt "Extract company info" \
  --enable-web-search

# Extract with external link following
axon extract https://example.com \
  --prompt "Extract all related info" \
  --allow-external-links

# Extract with source URLs included
axon extract https://example.com \
  --prompt "Extract data" \
  --show-sources

# Check extract job status
axon extract status <job-id>
```

**Parameters:**
- `--prompt <prompt>`: Natural language extraction prompt
- `--schema <json>`: JSON schema for structured extraction
- `--system-prompt <prompt>`: System prompt for extraction context
- `--allow-external-links`: Follow external links during extraction
- `--enable-web-search`: Enable web search for additional context
- `--include-subdomains`: Include subdomains when extracting
- `--show-sources`: Include source URLs in result
- `--no-embed`: Disable auto-embedding of extracted content
- `-o, --output <path>`: Save output to file
- `--json`: Output as JSON format
- `--pretty`: Pretty-print JSON output

**Subcommands:**
- `status <job-id>`: Get extract job status by ID

---

### Search the Web

Query the internet with optional scraping.

```bash
# Basic search
axon search "AI agent benchmarks"

# Limit results
axon search "web scraping tutorials" --limit 10

# Search with scraping (extracts content from results)
axon search "AI benchmarks 2026" --scrape --limit 5

# Filter by source
axon search "news about AI" --sources web,news

# Time-based filtering
axon search "latest AI research" --tbs qdr:d  # Last day
axon search "weekly AI updates" --tbs qdr:w   # Last week

# Location-based search
axon search "local events" --location "San Francisco" --country US

# Save results
axon search "AI agents" --scrape -o results/
```

**Parameters:**
- `--limit <n>`: Maximum results to return
- `--scrape`: Extract content from search results
- `--sources web|images|news`: Filter by content type
- `--categories github|research|pdf`: Filter by category
- `--tbs qdr:h|d|w|m|y`: Time-based filters (hour, day, week, month, year)
- `--location <city>`: Geographic location
- `--country <code>`: Country code (US, UK, etc.)
- `-o <path>`: Save results to directory

---

### Map Website URLs

Discover all URLs on a website without scraping.

```bash
# Basic mapping
axon map https://example.com

# Limit results
axon map https://example.com --limit 500

# Search for specific paths
axon map https://example.com --search "blog"

# Include subdomains
axon map https://example.com --include-subdomains

# Sitemap handling
axon map https://example.com --sitemap include  # Use sitemap + crawl
axon map https://example.com --sitemap only     # Only use sitemap

# Output as JSON
axon map https://example.com --json -o sitemap.json
```

**Parameters:**
- `--limit <n>`: Maximum URLs to discover
- `--search <pattern>`: Filter URLs by pattern
- `--include-subdomains`: Include subdomain URLs
- `--ignore-query-parameters`: Remove query strings for deduplication
- `--sitemap include|skip|only`: Sitemap handling mode
- `--json`: Output as JSON
- `-o <path>`: Save to file

---

### Crawl Entire Website

Systematically crawl websites with depth and path controls.

```bash
# Basic crawl with waiting
axon crawl https://example.com --wait --progress

# Limit pages and depth
axon crawl https://example.com --limit 100 --max-depth 3 --wait

# Path filtering
axon crawl https://example.com --include-paths "/blog/*" --wait
axon crawl https://example.com --exclude-paths "/admin/*,/api/*" --wait

# Rate limiting
axon crawl https://example.com --delay 1000 --max-concurrency 5 --wait

# Crawl entire domain (no scope restrictions)
axon crawl https://example.com --crawl-entire-domain --wait

# Async crawl (returns job ID)
axon crawl https://example.com --limit 50
```

**Parameters:**
- `--limit <n>`: Maximum pages to crawl
- `--max-depth <n>`: Maximum crawl depth from start URL
- `--include-paths <patterns>`: Comma-separated path patterns to include
- `--exclude-paths <patterns>`: Comma-separated path patterns to exclude
- `--delay <ms>`: Delay between requests (milliseconds)
- `--max-concurrency <n>`: Maximum concurrent requests
- `--wait`: Wait for crawl completion (synchronous)
- `--progress`: Show progress indicator
- `--poll-interval <ms>`: Status check interval (async mode)
- `--crawl-entire-domain`: Remove scope restrictions

---

## Batch Operations

### Batch Scrape

Batch scrape multiple URLs with job management.

```bash
# Batch scrape URLs
axon batch https://example.com/page1 https://example.com/page2

# Batch with wait
axon batch https://example.com/page1 https://example.com/page2 --wait

# Batch with format
axon batch url1 url2 url3 --format markdown,html

# Batch with webhook
axon batch url1 url2 --webhook https://example.com/callback

# Check batch status
axon batch status <job-id>

# Cancel batch job
axon batch cancel <job-id>

# Get batch errors
axon batch errors <job-id>
```

**Parameters:**
- `[urls...]`: URLs to scrape
- `--wait`: Wait for batch scrape to complete
- `--poll-interval <seconds>`: Polling interval in seconds
- `--timeout <seconds>`: Timeout in seconds for wait
- `--format <formats>`: Scrape format(s) for batch results
- `--only-main-content`: Only return main content
- `--wait-for <ms>`: Wait time before scraping in milliseconds
- `--scrape-timeout <seconds>`: Per-page scrape timeout
- `--screenshot`: Include screenshot format
- `--include-tags <tags>`: Comma-separated list of tags to include
- `--exclude-tags <tags>`: Comma-separated list of tags to exclude
- `--max-concurrency <number>`: Max concurrency for batch scraping
- `--ignore-invalid-urls`: Ignore invalid URLs
- `--webhook <url>`: Webhook URL for batch completion
- `--zero-data-retention`: Enable zero data retention
- `--idempotency-key <key>`: Idempotency key for batch job
- `--append-to-id <id>`: Append results to existing batch ID
- `--integration <name>`: Integration name for analytics
- `-o, --output <path>`: Save output to file
- `--pretty`: Pretty-print JSON output

**Subcommands:**
- `status <job-id>`: Get batch job status by ID
- `cancel <job-id>`: Cancel a batch scrape job
- `errors <job-id>`: Get errors for a batch scrape job

---

## Utility Commands

### Configuration

```bash
# View current configuration
axon view-config

# View configuration and auth status
axon config

# Login with API key
axon login --api-key fc-YOUR-KEY

# Login with browser OAuth
axon login --browser

# Logout
axon logout
```

---

### Version & Status

```bash
# Check version (detailed)
axon version

# Check version with extra info
axon version --verbose

# Output version as JSON
axon version --json

# Check CLI version (short)
axon --version

# Check authentication and credits
axon --status
```

**Version Parameters:**
- `--verbose`: Show detailed version information
- `--json`: Output as JSON format

---

## List Active Crawls

List all active crawl jobs.

```bash
# List all active crawl jobs
axon list

# Save to file
axon list -o crawls.json
```

**Parameters:**
- `-o, --output <path>`: Save output to file
- `--no-pretty`: Disable pretty JSON output

---

## Wrapper Scripts

For common operations, use provided wrapper scripts in `scripts/`:

```bash
# Scrape with standard settings
./scripts/scrape.sh https://example.com

# Search and scrape top results
./scripts/search-scrape.sh "AI agents" 5

# Map website to file
./scripts/map-site.sh https://example.com sitemap.json

# Crawl with progress
./scripts/crawl-site.sh https://example.com 100 3
```

All scripts:
- Source credentials from `~/claude-homelab/.env`
- Include error handling and validation
- Return JSON output where appropriate
- Support `--help` flag

---

For parameter details, see [parameters.md](./parameters.md)
For job management, see [job-management.md](./job-management.md)
For RAG/vector database commands, see [vector-database.md](./vector-database.md)
