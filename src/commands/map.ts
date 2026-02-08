/**
 * Map command implementation
 */

import type { MapOptions as SdkMapOptions } from '@mendable/firecrawl-js';
import type { IContainer, IHttpClient } from '../container/types';
import type { MapOptions, MapResult } from '../types/map';
import { processCommandResult } from '../utils/command';
import { displayCommandInfo } from '../utils/display';
import { extensionsToPaths } from '../utils/extensions';
import { fmt } from '../utils/theme';
import { filterUrls } from '../utils/url-filter';
import { mergeExcludePaths } from './crawl/options';
import { requireContainer } from './shared';

/** HTTP timeout for map API requests (60 seconds) */
const MAP_TIMEOUT_MS = 60000;

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
  apiKey: string,
  userAgent: string,
  url: string,
  options: MapOptions
): Promise<MapResult> {
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
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': userAgent,
  };

  const response = await httpClient.fetchWithTimeout(
    `${apiUrl}/v2/map`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    MAP_TIMEOUT_MS
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const errorMessage =
      errorData?.error || `API request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  const mapData = await response.json();
  const links = normalizeMapLinks(mapData.links || []);

  return {
    success: true,
    data: { links },
  };
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
      if (!apiKey) {
        throw new Error(
          'API key is required. Set FIRECRAWL_API_KEY environment variable, ' +
            'use --api-key flag, or run "firecrawl config" to set the API key.'
        );
      }
      const apiUrl = container.config.apiUrl || 'https://api.firecrawl.dev';
      const httpClient = container.getHttpClient();

      result = await executeMapWithUserAgent(
        httpClient,
        apiUrl,
        apiKey,
        userAgent,
        urlOrJobId,
        options
      );
    } else {
      // Use SDK for standard requests (no User-Agent override)
      result = await executeMapViaSdk(container, urlOrJobId, options);
    }

    // Apply client-side filtering if result succeeded (unless --no-filtering flag set)
    if (result.success && result.data?.links && !options.noFiltering) {
      const excludePatterns = buildExcludePatterns(options);

      if (excludePatterns.length > 0) {
        const filterResult = filterUrls(result.data.links, excludePatterns);
        result.data.links = filterResult.filtered;

        // Store stats for display
        if (options.verbose || filterResult.stats.excluded > 0) {
          (result as any).filterStats = filterResult.stats;
          (result as any).excludedUrls = options.verbose
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
    output += '\n\n' + fmt.dim('Excluded URLs:\n');
    excludedUrls.forEach((item) => {
      output += fmt.dim(`  ${item.url} (matched: ${item.matchedPattern})\n`);
    });
  }

  return output + '\n';
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
    formatMapReadable(
      data,
      (result as any).filterStats,
      (result as any).excludedUrls
    )
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
    .option('--include-subdomains', 'Include subdomains', true)
    .option('--no-include-subdomains', 'Exclude subdomains')
    .option(
      '--ignore-query-parameters',
      'Ignore query parameters (default: true)',
      true
    )
    .option('--no-ignore-query-parameters', 'Include query parameters')
    .option(
      '--ignore-cache',
      'Bypass sitemap cache for fresh URLs (default: true)',
      true
    )
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
        includeSubdomains: options.includeSubdomains,
        ignoreQueryParameters: options.ignoreQueryParameters,
        ignoreCache: options.ignoreCache,
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
