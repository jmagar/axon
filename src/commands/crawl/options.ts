/**
 * Option building for crawl operations
 */

import type { CrawlOptions as FirecrawlCrawlOptions } from '@mendable/firecrawl-js';
import type { CrawlOptions } from '../../types/crawl';
import { OptionsBuilder } from '../../utils/options-builder';
import { loadSettings } from '../../utils/settings';

/**
 * Default polling interval in milliseconds when in wait/progress mode
 */
const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * Extended crawl options with polling configuration
 */
export type ExtendedCrawlOptions = FirecrawlCrawlOptions & {
  pollInterval?: number;
  crawlTimeout?: number;
  [key: string]: unknown;
};

/**
 * Build Firecrawl API options from CLI options
 *
 * @param options - CLI crawl options
 * @returns Firecrawl API options with polling configuration
 *
 * @example
 * ```typescript
 * const crawlOptions = buildCrawlOptions({
 *   limit: 100,
 *   maxDepth: 3,
 *   scrapeTimeout: 15,
 * });
 * ```
 */
export function buildCrawlOptions(
  options: CrawlOptions
): Partial<ExtendedCrawlOptions> {
  const builder = new OptionsBuilder<ExtendedCrawlOptions>()
    .add('limit', options.limit)
    .addMapped('maxDiscoveryDepth', options.maxDepth)
    .add('sitemap', options.sitemap)
    .add('ignoreQueryParameters', options.ignoreQueryParameters)
    .add('crawlEntireDomain', options.crawlEntireDomain)
    .add('allowExternalLinks', options.allowExternalLinks)
    .add('allowSubdomains', options.allowSubdomains)
    .add('delay', options.delay)
    .add('maxConcurrency', options.maxConcurrency);

  // Handle merged exclude paths
  const excludePaths = mergeExcludePaths(
    options.excludePaths,
    options.noDefaultExcludes ?? false
  );
  if (excludePaths.length > 0) {
    builder.add('excludePaths', excludePaths);
  }

  // Handle include paths
  if (options.includePaths && options.includePaths.length > 0) {
    builder.add('includePaths', options.includePaths);
  }

  // Handle scrape timeout (nested + transformation)
  if (options.scrapeTimeout !== undefined) {
    builder.addNested(
      'scrapeTimeout',
      'scrapeOptions.timeout',
      options.scrapeTimeout * 1000 // Convert seconds to milliseconds
    );
  }

  // Handle polling options
  if (options.pollInterval !== undefined) {
    builder.add('pollInterval', options.pollInterval * 1000); // Convert seconds to milliseconds
  } else if (options.wait || options.progress) {
    // Default poll interval when in wait/progress mode
    builder.add('pollInterval', DEFAULT_POLL_INTERVAL_MS);
  }

  if (options.timeout !== undefined) {
    builder.add('crawlTimeout', options.timeout * 1000); // Convert seconds to milliseconds
  }

  return builder.build();
}

/**
 * Merge CLI exclude paths with default exclude paths from settings
 *
 * @param cliExcludes - Exclude paths from CLI options
 * @param skipDefaults - Whether to skip default exclude paths
 * @returns Merged and deduplicated exclude paths (empty strings filtered out)
 *
 * @example
 * ```typescript
 * const excludes = mergeExcludePaths(['/admin', '/api'], false);
 * // Returns: ['/login', '/logout', '/admin', '/api'] (assuming defaults)
 * ```
 */
export function mergeExcludePaths(
  cliExcludes: string[] | undefined,
  skipDefaults: boolean
): string[] {
  const defaultExcludes = skipDefaults
    ? []
    : (loadSettings().defaultExcludePaths ?? []);

  // Filter out empty strings and merge
  const validDefaults = defaultExcludes.filter(
    (path) => path && path.trim() !== ''
  );
  const validCliExcludes = (cliExcludes ?? []).filter(
    (path) => path && path.trim() !== ''
  );

  const mergedExcludes = [...new Set([...validDefaults, ...validCliExcludes])];

  return mergedExcludes;
}
