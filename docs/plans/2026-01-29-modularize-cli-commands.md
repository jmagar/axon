# Modularize CLI Commands Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce `src/index.ts` from ~850 lines to a minimal entry point by extracting command factory functions into their respective command files.

**Architecture:** Each command file will export a `create<Name>Command()` function that returns a fully configured Commander.js Command instance. The main `index.ts` will only handle global configuration, authentication hooks, and command registration.

**Tech Stack:** TypeScript, Commander.js v14, existing Firecrawl CLI codebase

---

## Task 1: Extract Scrape Command Factory

**Files:**
- Modify: `src/commands/scrape.ts`
- Modify: `src/index.ts:94-174`

**Step 1: Add createScrapeCommand to scrape.ts**

Add the following imports and function to the end of `src/commands/scrape.ts`:

```typescript
import { Command } from 'commander';
import { parseScrapeOptions } from '../utils/options';
import { normalizeUrl } from '../utils/url';

/**
 * Create and configure the scrape command
 */
export function createScrapeCommand(): Command {
  const scrapeCmd = new Command('scrape')
    .description('Scrape a URL using Firecrawl')
    .argument('[url]', 'URL to scrape')
    .argument(
      '[formats...]',
      'Output format(s) as positional args (e.g., markdown screenshot links)'
    )
    .option(
      '-u, --url <url>',
      'URL to scrape (alternative to positional argument)'
    )
    .option('-H, --html', 'Output raw HTML (shortcut for --format html)')
    .option(
      '-f, --format <formats>',
      'Output format(s). Multiple formats can be specified with commas (e.g., "markdown,links,images"). Available: markdown, html, rawHtml, links, images, screenshot, summary, changeTracking, json, attributes, branding. Single format outputs raw content; multiple formats output JSON.'
    )
    .option('--only-main-content', 'Include only main content', false)
    .option(
      '--wait-for <ms>',
      'Wait time before scraping in milliseconds',
      parseInt
    )
    .option(
      '--timeout <seconds>',
      'Request timeout in seconds (default: 5)',
      parseFloat,
      5
    )
    .option('--screenshot', 'Take a screenshot', false)
    .option('--include-tags <tags>', 'Comma-separated list of tags to include')
    .option('--exclude-tags <tags>', 'Comma-separated list of tags to exclude')
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .option(
      '--timing',
      'Show request timing and other useful information',
      false
    )
    .option('--no-embed', 'Skip auto-embedding of scraped content')
    .action(async (positionalUrl, positionalFormats, options) => {
      // Use positional URL if provided, otherwise use --url option
      const url = positionalUrl || options.url;
      if (!url) {
        console.error(
          'Error: URL is required. Provide it as argument or use --url option.'
        );
        process.exit(1);
      }

      // Merge formats: positional formats take precedence, then --format flag, then default to markdown
      let format: string;
      if (positionalFormats && positionalFormats.length > 0) {
        // Positional formats: join them with commas for parseFormats
        format = positionalFormats.join(',');
      } else if (options.html) {
        // Handle --html shortcut flag
        format = 'html';
      } else if (options.format) {
        // Use --format option
        format = options.format;
      } else {
        // Default to markdown
        format = 'markdown';
      }

      const scrapeOptions = parseScrapeOptions({
        ...options,
        url: normalizeUrl(url),
        format,
      });
      await handleScrapeCommand(scrapeOptions);
    });

  return scrapeCmd;
}
```

**Step 2: Update index.ts to use createScrapeCommand**

Remove the `createScrapeCommand` function (lines 94-174) from `src/index.ts` and replace the line:

```typescript
program.addCommand(createScrapeCommand());
```

With an import at the top:

```typescript
import { createScrapeCommand } from './commands/scrape';
```

And keep the registration:

```typescript
program.addCommand(createScrapeCommand());
```

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Run tests to verify**

Run: `pnpm test src/__tests__/commands/scrape.test.ts`
Expected: All scrape tests pass

**Step 5: Commit**

```bash
git add src/commands/scrape.ts src/index.ts
git commit -m "refactor: extract scrape command factory to scrape.ts"
```

---

## Task 2: Extract Crawl Command Factory

**Files:**
- Modify: `src/commands/crawl.ts`
- Modify: `src/index.ts:176-276`

**Step 1: Add createCrawlCommand to crawl.ts**

Add the following imports and function to the end of `src/commands/crawl.ts`:

```typescript
import { Command } from 'commander';
import { normalizeUrl } from '../utils/url';
import { isJobId } from '../utils/job';

/**
 * Create and configure the crawl command
 */
export function createCrawlCommand(): Command {
  const crawlCmd = new Command('crawl')
    .description('Crawl a website using Firecrawl')
    .argument('[url-or-job-id]', 'URL to crawl or job ID to check status')
    .option(
      '-u, --url <url>',
      'URL to crawl (alternative to positional argument)'
    )
    .option('--status', 'Check status of existing crawl job', false)
    .option(
      '--wait',
      'Wait for crawl to complete before returning results',
      false
    )
    .option(
      '--poll-interval <seconds>',
      'Polling interval in seconds when waiting (default: 5)',
      parseFloat
    )
    .option(
      '--timeout <seconds>',
      'Timeout in seconds when waiting for crawl job to complete (default: no timeout)',
      parseFloat
    )
    .option(
      '--scrape-timeout <seconds>',
      'Per-page scrape timeout in seconds (default: 5)',
      parseFloat,
      5
    )
    .option('--progress', 'Show progress dots while waiting', false)
    .option('--limit <number>', 'Maximum number of pages to crawl', parseInt)
    .option('--max-depth <number>', 'Maximum crawl depth', parseInt)
    .option(
      '--exclude-paths <paths>',
      'Comma-separated list of paths to exclude'
    )
    .option(
      '--include-paths <paths>',
      'Comma-separated list of paths to include'
    )
    .option('--sitemap <mode>', 'Sitemap handling: skip, include', 'include')
    .option(
      '--ignore-query-parameters',
      'Ignore query parameters when crawling',
      false
    )
    .option('--crawl-entire-domain', 'Crawl entire domain', false)
    .option('--allow-external-links', 'Allow external links', false)
    .option('--allow-subdomains', 'Allow subdomains', false)
    .option('--delay <ms>', 'Delay between requests in milliseconds', parseInt)
    .option(
      '--max-concurrency <number>',
      'Maximum concurrent requests',
      parseInt
    )
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--pretty', 'Pretty print JSON output', false)
    .option('--no-embed', 'Skip auto-embedding of crawl results')
    .option('--no-default-excludes', 'Skip default exclude paths from settings')
    .action(async (positionalUrlOrJobId, options) => {
      // Use positional argument if provided, otherwise use --url option
      const urlOrJobId = positionalUrlOrJobId || options.url;
      if (!urlOrJobId) {
        console.error(
          'Error: URL or job ID is required. Provide it as argument or use --url option.'
        );
        process.exit(1);
      }

      // Auto-detect if it's a job ID (UUID format)
      const isStatusCheck = options.status || isJobId(urlOrJobId);

      const crawlOptions = {
        urlOrJobId: isStatusCheck ? urlOrJobId : normalizeUrl(urlOrJobId),
        status: isStatusCheck,
        wait: options.wait,
        pollInterval: options.pollInterval,
        timeout: options.timeout,
        scrapeTimeout: options.scrapeTimeout,
        progress: options.progress,
        output: options.output,
        pretty: options.pretty,
        apiKey: options.apiKey,
        limit: options.limit,
        maxDepth: options.maxDepth,
        excludePaths: options.excludePaths
          ? options.excludePaths.split(',').map((p: string) => p.trim())
          : undefined,
        includePaths: options.includePaths
          ? options.includePaths.split(',').map((p: string) => p.trim())
          : undefined,
        sitemap: options.sitemap,
        ignoreQueryParameters: options.ignoreQueryParameters,
        crawlEntireDomain: options.crawlEntireDomain,
        allowExternalLinks: options.allowExternalLinks,
        allowSubdomains: options.allowSubdomains,
        delay: options.delay,
        maxConcurrency: options.maxConcurrency,
        embed: options.embed,
        noDefaultExcludes: options.defaultExcludes === false,
      };

      await handleCrawlCommand(crawlOptions);
    });

  return crawlCmd;
}
```

**Step 2: Update index.ts to use createCrawlCommand**

Remove the `createCrawlCommand` function from `src/index.ts` and add import:

```typescript
import { createCrawlCommand } from './commands/crawl';
```

Keep the registration:

```typescript
program.addCommand(createCrawlCommand());
```

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Run tests to verify**

Run: `pnpm test src/__tests__/commands/crawl.test.ts`
Expected: All crawl tests pass

**Step 5: Commit**

```bash
git add src/commands/crawl.ts src/index.ts
git commit -m "refactor: extract crawl command factory to crawl.ts"
```

---

## Task 3: Extract Map Command Factory

**Files:**
- Modify: `src/commands/map.ts`
- Modify: `src/index.ts:278-335`

**Step 1: Add createMapCommand to map.ts**

Add the following imports and function to the end of `src/commands/map.ts`:

```typescript
import { Command } from 'commander';
import { normalizeUrl } from '../utils/url';

/**
 * Create and configure the map command
 */
export function createMapCommand(): Command {
  const mapCmd = new Command('map')
    .description('Map URLs on a website using Firecrawl')
    .argument('[url]', 'URL to map')
    .option(
      '-u, --url <url>',
      'URL to map (alternative to positional argument)'
    )
    .option('--wait', 'Wait for map to complete')
    .option('--limit <number>', 'Maximum URLs to discover', parseInt)
    .option('--search <query>', 'Search query to filter URLs')
    .option(
      '--sitemap <mode>',
      'Sitemap handling: only, include, skip (defaults to include if not specified)'
    )
    .option('--include-subdomains', 'Include subdomains')
    .option('--ignore-query-parameters', 'Ignore query parameters')
    .option('--timeout <seconds>', 'Timeout in seconds', parseFloat)
    .option(
      '--notebook <id-or-name>',
      'Add discovered URLs to NotebookLM notebook (ID or name)'
    )
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (positionalUrl, options) => {
      // Use positional URL if provided, otherwise use --url option
      const url = positionalUrl || options.url;
      if (!url) {
        console.error(
          'Error: URL is required. Provide it as argument or use --url option.'
        );
        process.exit(1);
      }

      const mapOptions = {
        urlOrJobId: normalizeUrl(url),
        wait: options.wait,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
        apiKey: options.apiKey,
        limit: options.limit,
        search: options.search,
        sitemap: options.sitemap,
        includeSubdomains: options.includeSubdomains,
        ignoreQueryParameters: options.ignoreQueryParameters,
        timeout: options.timeout,
        notebook: options.notebook,
      };

      await handleMapCommand(mapOptions);
    });

  return mapCmd;
}
```

**Step 2: Update index.ts to use createMapCommand**

Remove the `createMapCommand` function from `src/index.ts` and add import:

```typescript
import { createMapCommand } from './commands/map';
```

Keep the registration:

```typescript
program.addCommand(createMapCommand());
```

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Run tests to verify**

Run: `pnpm test src/__tests__/commands/map.test.ts`
Expected: All map tests pass

**Step 5: Commit**

```bash
git add src/commands/map.ts src/index.ts
git commit -m "refactor: extract map command factory to map.ts"
```

---

## Task 4: Extract Search Command Factory

**Files:**
- Modify: `src/commands/search.ts`
- Modify: `src/index.ts:337-449`

**Step 1: Add createSearchCommand to search.ts**

Add the following imports and function to the end of `src/commands/search.ts`:

```typescript
import { Command } from 'commander';
import type { SearchSource, SearchCategory } from '../types/search';
import type { ScrapeFormat } from '../types/scrape';

/**
 * Create and configure the search command
 */
export function createSearchCommand(): Command {
  const searchCmd = new Command('search')
    .description('Search the web using Firecrawl')
    .argument('<query>', 'Search query')
    .option(
      '--limit <number>',
      'Maximum number of results (default: 5, max: 100)',
      parseInt
    )
    .option(
      '--sources <sources>',
      'Comma-separated sources to search: web, images, news (default: web)'
    )
    .option(
      '--categories <categories>',
      'Comma-separated categories to filter: github, research, pdf'
    )
    .option(
      '--tbs <value>',
      'Time-based search: qdr:h (hour), qdr:d (day), qdr:w (week), qdr:m (month), qdr:y (year)'
    )
    .option(
      '--location <location>',
      'Location for geo-targeting (e.g., "Germany", "San Francisco,California,United States")'
    )
    .option(
      '--country <code>',
      'ISO country code for geo-targeting (default: US)'
    )
    .option(
      '--timeout <ms>',
      'Timeout in milliseconds (default: 60000)',
      parseInt
    )
    .option(
      '--ignore-invalid-urls',
      'Exclude URLs invalid for other Firecrawl endpoints',
      false
    )
    .option('--scrape', 'Enable scraping of search results', false)
    .option(
      '--scrape-formats <formats>',
      'Comma-separated scrape formats when --scrape is enabled: markdown, html, rawHtml, links, etc. (default: markdown)'
    )
    .option(
      '--only-main-content',
      'Include only main content when scraping',
      true
    )
    .option('--no-embed', 'Skip auto-embedding of search results')
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as compact JSON', false)
    .action(async (query, options) => {
      // Parse sources
      let sources: SearchSource[] | undefined;
      if (options.sources) {
        sources = options.sources
          .split(',')
          .map((s: string) => s.trim().toLowerCase()) as SearchSource[];

        // Validate sources
        const validSources = ['web', 'images', 'news'];
        for (const source of sources) {
          if (!validSources.includes(source)) {
            console.error(
              `Error: Invalid source "${source}". Valid sources: ${validSources.join(', ')}`
            );
            process.exit(1);
          }
        }
      }

      // Parse categories
      let categories: SearchCategory[] | undefined;
      if (options.categories) {
        categories = options.categories
          .split(',')
          .map((c: string) => c.trim().toLowerCase()) as SearchCategory[];

        // Validate categories
        const validCategories = ['github', 'research', 'pdf'];
        for (const category of categories) {
          if (!validCategories.includes(category)) {
            console.error(
              `Error: Invalid category "${category}". Valid categories: ${validCategories.join(', ')}`
            );
            process.exit(1);
          }
        }
      }

      // Parse scrape formats
      let scrapeFormats: ScrapeFormat[] | undefined;
      if (options.scrapeFormats) {
        scrapeFormats = options.scrapeFormats
          .split(',')
          .map((f: string) => f.trim()) as ScrapeFormat[];
      }

      const searchOptions = {
        query,
        limit: options.limit,
        sources,
        categories,
        tbs: options.tbs,
        location: options.location,
        country: options.country,
        timeout: options.timeout,
        ignoreInvalidUrls: options.ignoreInvalidUrls,
        embed: options.embed,
        scrape: options.scrape,
        scrapeFormats,
        onlyMainContent: options.onlyMainContent,
        apiKey: options.apiKey,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
      };

      await handleSearchCommand(searchOptions);
    });

  return searchCmd;
}
```

**Step 2: Update index.ts to use createSearchCommand**

Remove the `createSearchCommand` function from `src/index.ts` and add import:

```typescript
import { createSearchCommand } from './commands/search';
```

Keep the registration:

```typescript
program.addCommand(createSearchCommand());
```

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Run tests to verify**

Run: `pnpm test src/__tests__/commands/search.test.ts`
Expected: All search tests pass

**Step 5: Commit**

```bash
git add src/commands/search.ts src/index.ts
git commit -m "refactor: extract search command factory to search.ts"
```

---

## Task 5: Extract Extract Command Factory

**Files:**
- Modify: `src/commands/extract.ts`
- Modify: `src/index.ts:451-504`

**Step 1: Add createExtractCommand to extract.ts**

Add the following imports and function to the end of `src/commands/extract.ts`:

```typescript
import { Command } from 'commander';
import { normalizeUrl } from '../utils/url';

/**
 * Create and configure the extract command
 */
export function createExtractCommand(): Command {
  const extractCmd = new Command('extract')
    .description('Extract structured data from URLs using Firecrawl')
    .argument('<urls...>', 'URL(s) to extract from')
    .option('--prompt <prompt>', 'Extraction prompt describing what to extract')
    .option('--schema <json>', 'JSON schema for structured extraction')
    .option('--system-prompt <prompt>', 'System prompt for extraction context')
    .option('--allow-external-links', 'Allow following external links', false)
    .option(
      '--enable-web-search',
      'Enable web search for additional context',
      false
    )
    .option('--include-subdomains', 'Include subdomains when extracting', false)
    .option('--show-sources', 'Include source URLs in result', false)
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .option('--no-embed', 'Disable auto-embedding of extracted content')
    .action(async (rawUrls: string[], options) => {
      // Flatten URLs that may contain newlines (e.g. zsh doesn't word-split variables)
      const urls = rawUrls
        .flatMap((u) =>
          u.includes('\n') ? u.split('\n').filter(Boolean) : [u]
        )
        .map(normalizeUrl);
      await handleExtractCommand({
        urls,
        prompt: options.prompt,
        schema: options.schema,
        systemPrompt: options.systemPrompt,
        allowExternalLinks: options.allowExternalLinks,
        enableWebSearch: options.enableWebSearch,
        includeSubdomains: options.includeSubdomains,
        showSources: options.showSources,
        apiKey: options.apiKey,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
        embed: options.embed,
      });
    });

  return extractCmd;
}
```

**Step 2: Update index.ts to use createExtractCommand**

Remove the `createExtractCommand` function from `src/index.ts` and add import:

```typescript
import { createExtractCommand } from './commands/extract';
```

Keep the registration:

```typescript
program.addCommand(createExtractCommand());
```

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Run tests to verify**

Run: `pnpm test src/__tests__/commands/extract.test.ts`
Expected: All extract tests pass

**Step 5: Commit**

```bash
git add src/commands/extract.ts src/index.ts
git commit -m "refactor: extract extract command factory to extract.ts"
```

---

## Task 6: Extract Embed Command Factory

**Files:**
- Modify: `src/commands/embed.ts`
- Modify: `src/index.ts:506-551`

**Step 1: Add createEmbedCommand to embed.ts**

Add the following imports and function to the end of `src/commands/embed.ts`:

```typescript
import { Command } from 'commander';
import { isUrl } from '../utils/url';
import { normalizeUrl } from '../utils/url';
import { ensureAuthenticated } from '../utils/auth';

/**
 * Create and configure the embed command
 */
export function createEmbedCommand(): Command {
  const embedCmd = new Command('embed')
    .description('Embed content into Qdrant vector database')
    .argument('<input>', 'URL to scrape and embed, file path, or "-" for stdin')
    .option(
      '--url <url>',
      'Explicit URL for metadata (required for file/stdin)'
    )
    .option('--collection <name>', 'Qdrant collection name')
    .option('--no-chunk', 'Disable chunking, embed as single vector')
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .action(async (input: string, options) => {
      // Normalize URL input (but not file paths or stdin "-")
      const normalizedInput = isUrl(input) ? normalizeUrl(input) : input;

      // Conditionally require auth only for URL input
      if (
        normalizedInput.startsWith('http://') ||
        normalizedInput.startsWith('https://')
      ) {
        await ensureAuthenticated();
      }

      await handleEmbedCommand({
        input: normalizedInput,
        url: options.url,
        collection: options.collection,
        noChunk: !options.chunk,
        apiKey: options.apiKey,
        output: options.output,
        json: options.json,
      });
    });

  return embedCmd;
}
```

**Step 2: Update index.ts to use createEmbedCommand**

Remove the `createEmbedCommand` function from `src/index.ts` and add import:

```typescript
import { createEmbedCommand } from './commands/embed';
```

Keep the registration:

```typescript
program.addCommand(createEmbedCommand());
```

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Run tests to verify**

Run: `pnpm test src/__tests__/commands/embed.test.ts`
Expected: All embed tests pass

**Step 5: Commit**

```bash
git add src/commands/embed.ts src/index.ts
git commit -m "refactor: extract embed command factory to embed.ts"
```

---

## Task 7: Extract Query Command Factory

**Files:**
- Modify: `src/commands/query.ts`
- Modify: `src/index.ts:553-584`

**Step 1: Add createQueryCommand to query.ts**

Add the following imports and function to the end of `src/commands/query.ts`:

```typescript
import { Command } from 'commander';

/**
 * Create and configure the query command
 */
export function createQueryCommand(): Command {
  const queryCmd = new Command('query')
    .description('Semantic search over embedded content in Qdrant')
    .argument('<query>', 'Search query text')
    .option(
      '--limit <number>',
      'Maximum number of results (default: 5)',
      parseInt
    )
    .option('--domain <domain>', 'Filter results by domain')
    .option('--full', 'Show full chunk text instead of truncated', false)
    .option('--group', 'Group results by URL', false)
    .option('--collection <name>', 'Qdrant collection name')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .action(async (query: string, options) => {
      await handleQueryCommand({
        query,
        limit: options.limit,
        domain: options.domain,
        full: options.full,
        group: options.group,
        collection: options.collection,
        output: options.output,
        json: options.json,
      });
    });

  return queryCmd;
}
```

**Step 2: Update index.ts to use createQueryCommand**

Remove the `createQueryCommand` function from `src/index.ts` and add import:

```typescript
import { createQueryCommand } from './commands/query';
```

Keep the registration:

```typescript
program.addCommand(createQueryCommand());
```

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Run tests to verify**

Run: `pnpm test src/__tests__/commands/query.test.ts`
Expected: All query tests pass

**Step 5: Commit**

```bash
git add src/commands/query.ts src/index.ts
git commit -m "refactor: extract query command factory to query.ts"
```

---

## Task 8: Extract Retrieve Command Factory

**Files:**
- Modify: `src/commands/retrieve.ts`
- Modify: `src/index.ts:586-604`

**Step 1: Add createRetrieveCommand to retrieve.ts**

Add the following imports and function to the end of `src/commands/retrieve.ts`:

```typescript
import { Command } from 'commander';
import { normalizeUrl } from '../utils/url';

/**
 * Create and configure the retrieve command
 */
export function createRetrieveCommand(): Command {
  const retrieveCmd = new Command('retrieve')
    .description('Retrieve full document from Qdrant by URL')
    .argument('<url>', 'URL of the document to retrieve')
    .option('--collection <name>', 'Qdrant collection name')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .action(async (url: string, options) => {
      await handleRetrieveCommand({
        url: normalizeUrl(url),
        collection: options.collection,
        output: options.output,
        json: options.json,
      });
    });

  return retrieveCmd;
}
```

**Step 2: Update index.ts to use createRetrieveCommand**

Remove the `createRetrieveCommand` function from `src/index.ts` and add import:

```typescript
import { createRetrieveCommand } from './commands/retrieve';
```

Keep the registration:

```typescript
program.addCommand(createRetrieveCommand());
```

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Run tests to verify**

Run: `pnpm test src/__tests__/commands/retrieve.test.ts`
Expected: All retrieve tests pass

**Step 5: Commit**

```bash
git add src/commands/retrieve.ts src/index.ts
git commit -m "refactor: extract retrieve command factory to retrieve.ts"
```

---

## Task 9: Extract Config Command Factory

**Files:**
- Modify: `src/commands/config.ts`
- Modify: `src/index.ts:606-649`

**Step 1: Add createConfigCommand to config.ts**

Add the following imports and function to the end of `src/commands/config.ts`:

```typescript
import { Command } from 'commander';

/**
 * Create and configure the config command
 */
export function createConfigCommand(): Command {
  const configCmd = new Command('config')
    .description('Configure Firecrawl (login if not authenticated)')
    .option(
      '-k, --api-key <key>',
      'Provide API key directly (skips interactive flow)'
    )
    .option('--api-url <url>', 'API URL (default: https://api.firecrawl.dev)')
    .action(async (options) => {
      await configure({
        apiKey: options.apiKey,
        apiUrl: options.apiUrl,
      });
    });

  configCmd
    .command('set')
    .description('Set a configuration value')
    .argument('<key>', 'Setting key (e.g., exclude-paths)')
    .argument('<value>', 'Setting value (comma-separated for lists)')
    .action((key: string, value: string) => {
      handleConfigSet(key, value);
    });

  configCmd
    .command('get')
    .description('Get a configuration value')
    .argument('<key>', 'Setting key (e.g., exclude-paths)')
    .action((key: string) => {
      handleConfigGet(key);
    });

  configCmd
    .command('clear')
    .description('Clear a configuration value')
    .argument('<key>', 'Setting key (e.g., exclude-paths)')
    .action((key: string) => {
      handleConfigClear(key);
    });

  return configCmd;
}
```

**Step 2: Update index.ts to use createConfigCommand**

Remove the `configCmd` definition (lines 606-649) from `src/index.ts` and add import:

```typescript
import { createConfigCommand } from './commands/config';
```

Add registration:

```typescript
program.addCommand(createConfigCommand());
```

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Run tests to verify**

Run: `pnpm test src/__tests__/commands/config.test.ts`
Expected: All config tests pass (or skip if no tests exist)

**Step 5: Commit**

```bash
git add src/commands/config.ts src/index.ts
git commit -m "refactor: extract config command factory to config.ts"
```

---

## Task 10: Extract Login Command Factory

**Files:**
- Modify: `src/commands/login.ts`
- Modify: `src/index.ts:651-663`

**Step 1: Add createLoginCommand to login.ts**

Add the following imports and function to the end of `src/commands/login.ts`:

```typescript
import { Command } from 'commander';

/**
 * Create and configure the login command
 */
export function createLoginCommand(): Command {
  const loginCmd = new Command('login')
    .description('Login to Firecrawl (alias for config)')
    .option(
      '-k, --api-key <key>',
      'Provide API key directly (skips interactive flow)'
    )
    .option('--api-url <url>', 'API URL (default: https://api.firecrawl.dev)')
    .action(async (options) => {
      await handleLoginCommand({
        apiKey: options.apiKey,
        apiUrl: options.apiUrl,
      });
    });

  return loginCmd;
}
```

**Step 2: Update index.ts to use createLoginCommand**

Remove the login command definition from `src/index.ts` and add import:

```typescript
import { createLoginCommand } from './commands/login';
```

Add registration:

```typescript
program.addCommand(createLoginCommand());
```

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Commit**

```bash
git add src/commands/login.ts src/index.ts
git commit -m "refactor: extract login command factory to login.ts"
```

---

## Task 11: Extract Logout Command Factory

**Files:**
- Modify: `src/commands/logout.ts`
- Modify: `src/index.ts:665-670`

**Step 1: Add createLogoutCommand to logout.ts**

Add the following imports and function to the end of `src/commands/logout.ts`:

```typescript
import { Command } from 'commander';

/**
 * Create and configure the logout command
 */
export function createLogoutCommand(): Command {
  const logoutCmd = new Command('logout')
    .description('Logout and clear stored credentials')
    .action(async () => {
      await handleLogoutCommand();
    });

  return logoutCmd;
}
```

**Step 2: Update index.ts to use createLogoutCommand**

Remove the logout command definition from `src/index.ts` and add import:

```typescript
import { createLogoutCommand } from './commands/logout';
```

Add registration:

```typescript
program.addCommand(createLogoutCommand());
```

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Commit**

```bash
git add src/commands/logout.ts src/index.ts
git commit -m "refactor: extract logout command factory to logout.ts"
```

---

## Task 12: Extract Version and View-Config Commands

**Files:**
- Modify: `src/commands/version.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/index.ts:672-680,651-658`

**Step 1: Add createVersionCommand to version.ts**

Add the following imports and function to the end of `src/commands/version.ts`:

```typescript
import { Command } from 'commander';

/**
 * Create and configure the version command
 */
export function createVersionCommand(): Command {
  const versionCmd = new Command('version')
    .description('Display version information')
    .option('--auth-status', 'Also show authentication status', false)
    .action((options) => {
      handleVersionCommand({ authStatus: options.authStatus });
    });

  return versionCmd;
}
```

**Step 2: Add createViewConfigCommand to config.ts**

Add the following function to `src/commands/config.ts` (after createConfigCommand):

```typescript
/**
 * Create and configure the view-config command
 */
export function createViewConfigCommand(): Command {
  const viewConfigCmd = new Command('view-config')
    .description('View current configuration and authentication status')
    .action(async () => {
      await viewConfig();
    });

  return viewConfigCmd;
}
```

**Step 3: Update index.ts**

Remove the version and view-config command definitions from `src/index.ts` and add imports:

```typescript
import { createVersionCommand } from './commands/version';
import { createViewConfigCommand } from './commands/config';
```

Add registrations:

```typescript
program.addCommand(createVersionCommand());
program.addCommand(createViewConfigCommand());
```

**Step 4: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 5: Commit**

```bash
git add src/commands/version.ts src/commands/config.ts src/index.ts
git commit -m "refactor: extract version and view-config command factories"
```

---

## Task 13: Clean Up index.ts Imports

**Files:**
- Modify: `src/index.ts`

**Step 1: Remove unused imports**

After all command factories are extracted, remove the following imports from `src/index.ts`:

```typescript
// REMOVE these imports:
import { handleCrawlCommand } from './commands/crawl';
import { handleEmbedCommand } from './commands/embed';
import { handleExtractCommand } from './commands/extract';
import { handleMapCommand } from './commands/map';
import { handleQueryCommand } from './commands/query';
import { handleRetrieveCommand } from './commands/retrieve';
import { handleScrapeCommand } from './commands/scrape';
import { handleSearchCommand } from './commands/search';
import { handleVersionCommand } from './commands/version';
import type { ScrapeFormat } from './types/scrape';
import type { SearchCategory, SearchSource } from './types/search';
import { parseScrapeOptions } from './utils/options';
```

Keep these imports:

```typescript
import { ensureAuthenticated, printBanner } from './utils/auth';
import { initializeConfig, updateConfig } from './utils/config';
import { isUrl, normalizeUrl } from './utils/url';
```

**Step 2: Verify imports organization**

The imports section should look like this:

```typescript
#!/usr/bin/env node

/**
 * Firecrawl CLI
 * Entry point for the CLI application
 */

import { resolve } from 'node:path';
import { Command } from 'commander';
import { config as loadDotenv } from 'dotenv';

// Load .env from the CLI project directory
const envPath = resolve(__dirname, '..', '.env');
loadDotenv({ path: envPath });

import packageJson from '../package.json';

// Command factories
import { createScrapeCommand } from './commands/scrape';
import { createCrawlCommand } from './commands/crawl';
import { createMapCommand } from './commands/map';
import { createSearchCommand } from './commands/search';
import { createExtractCommand } from './commands/extract';
import { createEmbedCommand } from './commands/embed';
import { createQueryCommand } from './commands/query';
import { createRetrieveCommand } from './commands/retrieve';
import { createConfigCommand, createViewConfigCommand } from './commands/config';
import { createLoginCommand } from './commands/login';
import { createLogoutCommand } from './commands/logout';
import { createVersionCommand } from './commands/version';

// Utilities
import { ensureAuthenticated, printBanner } from './utils/auth';
import { initializeConfig, updateConfig } from './utils/config';
import { isUrl, normalizeUrl } from './utils/url';
```

**Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors

**Step 4: Run linter to verify**

Run: `pnpm check`
Expected: No linting errors

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "refactor: clean up imports in index.ts"
```

---

## Task 14: Final Verification

**Files:**
- Run tests on all files

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: All 326 tests pass

**Step 2: Verify build**

Run: `pnpm build`
Expected: Build succeeds with no errors

**Step 3: Check linting**

Run: `pnpm check`
Expected: No linting errors

**Step 4: Verify line count reduction**

Run: `wc -l src/index.ts`
Expected: ~400-500 lines (down from ~850)

**Step 5: Create summary commit**

```bash
git add -A
git commit -m "refactor: complete CLI command factory modularization

- Extracted command factory functions from index.ts to command files
- Reduced index.ts from ~850 lines to ~450 lines
- Each command file now exports createXCommand() factory
- All tests passing, no linting errors
- Improved maintainability and separation of concerns"
```

---

## Success Criteria

- [ ] `src/index.ts` reduced to <500 lines
- [ ] Each command file exports `create<Name>Command()` function
- [ ] All 326 tests pass
- [ ] No TypeScript compilation errors
- [ ] No linting errors
- [ ] Each task committed separately
- [ ] CLI still works identically to before refactoring
