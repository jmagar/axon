/**
 * Map command implementation
 */

import type { MapOptions as SdkMapOptions } from '@mendable/firecrawl-js';
import type { IContainer, IHttpClient } from '../container/types';
import type { MapOptions, MapResult } from '../types/map';
import { formatJson, handleCommandError } from '../utils/command';
import { displayCommandInfo } from '../utils/display';
import { writeOutput } from '../utils/output';
import { fmt } from '../utils/theme';

/** HTTP timeout for map API requests (60 seconds) */
const MAP_TIMEOUT_MS = 60000;

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
  if (options.ignoreQueryParameters !== undefined) {
    body.ignoreQueryParameters = options.ignoreQueryParameters;
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
    `${apiUrl}/v1/map`,
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
  if (options.ignoreQueryParameters !== undefined) {
    sdkOptions.ignoreQueryParameters = options.ignoreQueryParameters;
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
    const config = container.config;
    const userAgent = config.userAgent;
    const { urlOrJobId } = options;

    // When User-Agent is configured, use direct HTTP (SDK limitation)
    // Otherwise, use the SDK for better error handling and retry logic
    if (userAgent) {
      // Prefer options.apiKey over container.config.apiKey
      const apiKey = options.apiKey || config.apiKey;
      if (!apiKey) {
        throw new Error(
          'API key is required. Set FIRECRAWL_API_KEY environment variable, ' +
            'use --api-key flag, or run "firecrawl config" to set the API key.'
        );
      }
      const apiUrl = config.apiUrl || 'https://api.firecrawl.dev';
      const httpClient = container.getHttpClient();

      return await executeMapWithUserAgent(
        httpClient,
        apiUrl,
        apiKey,
        userAgent,
        urlOrJobId,
        options
      );
    }

    // Use SDK for standard requests (no User-Agent override)
    return await executeMapViaSdk(container, urlOrJobId, options);
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
function formatMapReadable(data: MapResult['data']): string {
  if (!data || !data.links) return '';

  // Output one URL per line (like curl)
  return `${data.links.map((link) => link.url).join('\n')}\n`;
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
    limit: options.limit,
    sitemap: options.sitemap,
    timeout: options.timeout,
  });

  const result = await executeMap(container, options);

  // Use shared error handler
  if (!handleCommandError(result)) {
    return;
  }

  if (!result.data) {
    return;
  }

  let outputContent: string;

  // Use JSON format if --json flag is set
  if (options.json) {
    outputContent = formatJson(
      { success: true, data: result.data },
      options.pretty
    );
  } else {
    // Default to human-readable format (one URL per line)
    outputContent = formatMapReadable(result.data);
  }

  writeOutput(outputContent, options.output, !!options.output);
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
    .option('--timeout <seconds>', 'Timeout in seconds', parseFloat)
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (positionalUrl, options, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

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
        timeout: options.timeout,
      };

      await handleMapCommand(container, mapOptions);
    });

  return mapCmd;
}
