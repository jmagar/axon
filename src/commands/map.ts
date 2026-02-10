/**
 * Map command implementation
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  Document,
  CrawlOptions as SdkCrawlOptions,
  MapOptions as SdkMapOptions,
} from '@mendable/firecrawl-js';
import type { IContainer, IHttpClient } from '../container/types';
import type { MapOptions, MapResult } from '../types/map';
import { processCommandResult } from '../utils/command';
import { displayCommandInfo } from '../utils/display';
import { extensionsToPaths } from '../utils/extensions';
import { fmt } from '../utils/theme';
import { filterUrls } from '../utils/url-filter';
import { mergeExcludePaths } from './crawl/options';
import { requireContainer } from './shared';

const MAP_CRAWL_FALLBACK_MAX_DISCOVERY_DEPTH = 10;
const execFileAsync = promisify(execFile);

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isReadTheDocsHost(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return (
    host === 'readthedocs.io' ||
    host.endsWith('.readthedocs.io') ||
    host === 'readthedocs.org' ||
    host.endsWith('.readthedocs.org')
  );
}

function shouldUseCrawlFallback(url: string, options: MapOptions): boolean {
  if (options.search) {
    return false;
  }
  return isReadTheDocsHost(url);
}

function isReadTheDocsRootUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || !isReadTheDocsHost(url)) {
    return false;
  }
  return parsed.pathname === '/' || parsed.pathname === '';
}

function getReadTheDocsLatestUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed || !isReadTheDocsHost(url)) {
    return null;
  }
  if (parsed.pathname === '/' || parsed.pathname === '') {
    // Note: This assumes English language and "latest" version.
    // Projects with different defaults (e.g., /de/latest/, /en/stable/) may not work correctly.
    // In the future, consider following HTTP redirects to discover the actual default path.
    return new URL('/en/latest/', parsed).toString();
  }
  return null;
}

function extractCrawlDiscoveredLinks(
  crawlData: Document[]
): Array<{ url: string; title?: string; description?: string }> {
  const seen = new Set<string>();
  const links: Array<{ url: string; title?: string; description?: string }> =
    [];

  for (const page of crawlData) {
    const metadata = page.metadata;
    const sourceUrl =
      typeof metadata?.sourceURL === 'string'
        ? metadata.sourceURL
        : typeof metadata?.url === 'string'
          ? metadata.url
          : undefined;

    if (!sourceUrl || seen.has(sourceUrl)) {
      continue;
    }

    seen.add(sourceUrl);
    links.push({
      url: sourceUrl,
      title: typeof metadata?.title === 'string' ? metadata.title : undefined,
      description:
        typeof metadata?.description === 'string'
          ? metadata.description
          : undefined,
    });
  }

  return links;
}

async function executeMapViaCrawlFallback(
  container: IContainer,
  url: string,
  options: MapOptions
): Promise<MapResult> {
  // Inform user that fallback is happening
  console.error(
    fmt.dim(
      'Map returned empty results. Falling back to crawl discovery (depth 10)...'
    )
  );

  const client = container.getFirecrawlClient();
  const crawlOptions: Partial<SdkCrawlOptions> = {
    limit: options.limit,
    maxDiscoveryDepth: MAP_CRAWL_FALLBACK_MAX_DISCOVERY_DEPTH,
    sitemap: 'skip',
    allowSubdomains: options.includeSubdomains,
    ignoreQueryParameters: options.noFiltering
      ? false
      : options.ignoreQueryParameters,
  };

  // Add timeout if specified (not part of standard CrawlOptions type)
  if (options.timeout !== undefined) {
    (crawlOptions as Record<string, unknown>).timeout = options.timeout;
  }

  const crawlResult = await client.crawl(url, crawlOptions);
  const links = extractCrawlDiscoveredLinks(crawlResult.data ?? []);

  return {
    success: true,
    data: { links },
  };
}

/**
 * Build exclude patterns from map options
 */
function buildExcludePatterns(options: MapOptions): string[] {
  const extensionPatterns = options.excludeExtensions
    ? extensionsToPaths(options.excludeExtensions)
    : [];

  return mergeExcludePaths(
    options.excludePaths,
    options.noDefaultExcludes ?? false,
    extensionPatterns
  );
}

/**
 * Normalize SDK map response to our internal format.
 * The SDK may return links as strings or objects with url/title/description.
 */
function normalizeMapLinks(
  rawLinks: unknown[]
): Array<{ url: string; title?: string; description?: string }> {
  return rawLinks.map((link: unknown) => {
    if (typeof link === 'string') {
      return { url: link, title: undefined, description: undefined };
    }
    const obj = link as Record<string, unknown>;
    return {
      url: obj.url as string,
      title: obj.title as string | undefined,
      description: obj.description as string | undefined,
    };
  });
}

/**
 * Execute map via direct HTTP when custom User-Agent is needed.
 *
 * NOTE: The Firecrawl SDK's map() method does not support custom headers.
 * This is a known SDK limitation. When User-Agent is configured, we must
 * use the HTTP client directly. If the SDK adds header support in the future,
 * this function can be removed and executeMapViaSdk used exclusively.
 *
 * @see https://github.com/mendableai/firecrawl-js - SDK limitations
 */
async function executeMapWithUserAgent(
  httpClient: IHttpClient,
  apiUrl: string,
  apiKey: string | undefined,
  userAgent: string | undefined,
  url: string,
  options: MapOptions
): Promise<MapResult> {
  const isCloud = apiUrl.includes('api.firecrawl.dev');
  const body: Record<string, unknown> = { url };

  if (options.limit !== undefined) {
    body.limit = options.limit;
  }
  if (options.search) {
    body.search = options.search;
  }
  if (options.sitemap) {
    body.sitemap = options.sitemap;
  }
  if (options.includeSubdomains !== undefined) {
    body.includeSubdomains = options.includeSubdomains;
  }
  // Handle ignoreQueryParameters based on --no-filtering flag
  if (!options.noFiltering && options.ignoreQueryParameters !== undefined) {
    body.ignoreQueryParameters = options.ignoreQueryParameters;
  } else if (options.noFiltering) {
    // When --no-filtering is set, explicitly disable query param filtering
    body.ignoreQueryParameters = false;
  }
  if (options.ignoreCache !== undefined) {
    body.ignoreCache = options.ignoreCache;
  }
  if (options.timeout !== undefined) {
    body.timeout = options.timeout * 1000; // Convert to milliseconds
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (userAgent) {
    headers['User-Agent'] = userAgent;
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await httpClient.fetchWithRetry(
    `${apiUrl}/v2/map`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    { timeoutMs: 30000 }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const errorMessage =
      errorData?.error || `API request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  const mapData = await response.json();
  let links = normalizeMapLinks(mapData.links || []);

  // Self-hosted endpoints can return empty results via Node fetch/SDK
  // while returning valid data via curl. Retry with curl for parity.
  if (!isCloud && links.length === 0) {
    const curlLinks = await executeMapWithCurl(apiUrl, body);
    if (curlLinks.length > 0) {
      links = curlLinks;
    }
  }

  return {
    success: true,
    data: { links },
  };
}

async function executeMapWithCurl(
  apiUrl: string,
  body: Record<string, unknown>
): Promise<Array<{ url: string; title?: string; description?: string }>> {
  const { stdout } = await execFileAsync('curl', [
    '-sS',
    '-X',
    'POST',
    `${apiUrl}/v2/map`,
    '-H',
    'Content-Type: application/json',
    '--data',
    JSON.stringify(body),
  ]);

  const parsed = JSON.parse(stdout) as {
    links?: unknown[];
  };
  return normalizeMapLinks(parsed.links || []);
}

/**
 * Execute map via Firecrawl SDK (preferred when no custom User-Agent needed).
 */
async function executeMapViaSdk(
  container: IContainer,
  url: string,
  options: MapOptions
): Promise<MapResult> {
  const client = container.getFirecrawlClient();

  const sdkOptions: SdkMapOptions = {};

  if (options.limit !== undefined) {
    sdkOptions.limit = options.limit;
  }
  if (options.search) {
    sdkOptions.search = options.search;
  }
  if (options.sitemap) {
    sdkOptions.sitemap = options.sitemap;
  }
  if (options.includeSubdomains !== undefined) {
    sdkOptions.includeSubdomains = options.includeSubdomains;
  }
  // Handle ignoreQueryParameters based on --no-filtering flag
  if (!options.noFiltering && options.ignoreQueryParameters !== undefined) {
    sdkOptions.ignoreQueryParameters = options.ignoreQueryParameters;
  } else if (options.noFiltering) {
    // When --no-filtering is set, explicitly disable query param filtering
    sdkOptions.ignoreQueryParameters = false;
  }
  if (options.ignoreCache !== undefined) {
    // NOTE: ignoreCache is a newer API parameter not yet in SDK types
    (sdkOptions as Record<string, unknown>).ignoreCache = options.ignoreCache;
  }
  if (options.timeout !== undefined) {
    sdkOptions.timeout = options.timeout * 1000; // Convert to milliseconds
  }

  const mapData = await client.map(url, sdkOptions);
  const links = normalizeMapLinks(mapData.links || []);

  return {
    success: true,
    data: { links },
  };
}

/**
 * Execute map command
 */
export async function executeMap(
  container: IContainer,
  options: MapOptions
): Promise<MapResult> {
  try {
    const userAgent = container.config.userAgent;
    const { urlOrJobId } = options;

    let result: MapResult;

    // When User-Agent is configured, use direct HTTP (SDK limitation)
    // Otherwise, use the SDK for better error handling and retry logic
    if (userAgent) {
      // Prefer options.apiKey over container.config.apiKey
      const apiKey = options.apiKey || container.config.apiKey;
      const apiUrl = container.config.apiUrl || 'https://api.firecrawl.dev';
      const isCloud = apiUrl.includes('api.firecrawl.dev');
      if (isCloud && !apiKey) {
        throw new Error(
          'API key is required. Set FIRECRAWL_API_KEY environment variable, ' +
            'use --api-key flag, or run "firecrawl config" to set the API key.'
        );
      }
      const httpClient = container.getHttpClient();

      result = await executeMapWithUserAgent(
        httpClient,
        apiUrl,
        apiKey,
        isCloud ? userAgent : undefined,
        urlOrJobId,
        options
      );
    } else {
      // Use SDK for standard requests (no User-Agent override)
      result = await executeMapViaSdk(container, urlOrJobId, options);
    }

    // Try crawl fallback if map returned empty results on a ReadTheDocs site
    const shouldFallback =
      shouldUseCrawlFallback(urlOrJobId, options) &&
      result.success &&
      (result.data?.links.length ?? 0) === 0;

    if (shouldFallback) {
      // For root URLs, redirect to /en/latest/ before crawling
      let crawlUrl = urlOrJobId;
      if (isReadTheDocsRootUrl(urlOrJobId)) {
        const latestUrl = getReadTheDocsLatestUrl(urlOrJobId);
        if (latestUrl) {
          crawlUrl = latestUrl;
        }
      }
      result = await executeMapViaCrawlFallback(container, crawlUrl, options);
    }

    // Apply client-side filtering if result succeeded (unless --no-filtering flag set)
    // Filtering applies to both map and crawl fallback results
    if (result.success && result.data?.links && !options.noFiltering) {
      const excludePatterns = buildExcludePatterns(options);

      if (excludePatterns.length > 0) {
        const filterResult = filterUrls(result.data.links, excludePatterns);
        result.data.links = filterResult.filtered;

        // Store stats for display
        if (options.verbose || filterResult.stats.excluded > 0) {
          result.filterStats = filterResult.stats;
          result.excludedUrls = options.verbose
            ? filterResult.excluded
            : undefined;
        }
      }
    }

    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Format map data in human-readable way
 */
function formatMapReadable(
  data: MapResult['data'],
  filterStats?: { total: number; excluded: number; kept: number },
  excludedUrls?: Array<{ url: string; matchedPattern: string }>
): string {
  if (!data || !data.links) return '';

  let output = '';

  // Show filter summary if URLs were excluded
  if (filterStats && filterStats.excluded > 0) {
    output += fmt.dim(
      `Filtered: ${filterStats.kept}/${filterStats.total} URLs ` +
        `(excluded ${filterStats.excluded})\n\n`
    );
  }

  // Output URLs (one per line)
  output += data.links.map((link) => link.url).join('\n');

  // Show excluded URLs if verbose
  if (excludedUrls && excludedUrls.length > 0) {
    output += `\n\n${fmt.dim('Excluded URLs:\n')}`;
    excludedUrls.forEach((item) => {
      output += fmt.dim(`  ${item.url} (matched: ${item.matchedPattern})\n`);
    });
  }

  return `${output}\n`;
}

/**
 * Handle map command output
 */
export async function handleMapCommand(
  container: IContainer,
  options: MapOptions
): Promise<void> {
  // Display command info
  displayCommandInfo('Mapping', options.urlOrJobId, {
    includeSubdomains: options.includeSubdomains,
    ignoreQueryParameters: options.ignoreQueryParameters,
    ignoreCache: options.ignoreCache,
    limit: options.limit,
    sitemap: options.sitemap,
    timeout: options.timeout,
  });

  const result = await executeMap(container, options);
  processCommandResult(result, options, (data) =>
    formatMapReadable(data, result.filterStats, result.excludedUrls)
  );
}

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
      'Sitemap handling: only, include, skip (default: include)'
    )
    .option('--include-subdomains', 'Include subdomains')
    .option('--no-include-subdomains', 'Exclude subdomains')
    .option('--ignore-query-parameters', 'Ignore query parameters')
    .option('--no-ignore-query-parameters', 'Include query parameters')
    .option('--ignore-cache', 'Bypass sitemap cache for fresh URLs')
    .option('--no-ignore-cache', 'Use cached sitemap data')
    .option('--timeout <seconds>', 'Timeout in seconds', parseFloat)
    .option('--exclude-paths <paths...>', 'Paths to exclude from results')
    .option(
      '--exclude-extensions <exts...>',
      'File extensions to exclude (.exe, .pkg, etc.)'
    )
    .option('--no-default-excludes', 'Skip default exclude patterns')
    .option(
      '--no-filtering',
      'Completely disable all filtering (overrides excludes and ignoreQueryParameters)'
    )
    .option('--verbose', 'Show excluded URLs and filter statistics')
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (positionalUrl, options, command: Command) => {
      const container = requireContainer(command);

      // Use positional URL if provided, otherwise use --url option
      const url = positionalUrl || options.url;
      if (!url) {
        console.error(
          fmt.error(
            'URL is required. Provide it as argument or use --url option.'
          )
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
        includeSubdomains:
          command.getOptionValueSource('includeSubdomains') === 'default'
            ? undefined
            : options.includeSubdomains,
        ignoreQueryParameters:
          command.getOptionValueSource('ignoreQueryParameters') === 'default'
            ? undefined
            : options.ignoreQueryParameters,
        ignoreCache:
          command.getOptionValueSource('ignoreCache') === 'default'
            ? undefined
            : options.ignoreCache,
        timeout: options.timeout,
        excludePaths: options.excludePaths,
        excludeExtensions: options.excludeExtensions,
        // Commander.js: --no-default-excludes creates options.defaultExcludes = false
        noDefaultExcludes: options.defaultExcludes === false,
        // Commander.js: --no-filtering creates options.filtering = false
        noFiltering: options.filtering === false,
        verbose: options.verbose,
      };

      await handleMapCommand(container, mapOptions);
    });

  return mapCmd;
}
