/**
 * Option building for crawl operations
 */

import type { CrawlOptions as FirecrawlCrawlOptions } from '@mendable/firecrawl-js';
import type { CrawlOptions } from '../../types/crawl';
import {
  DEFAULT_EXCLUDE_EXTENSIONS,
  DEFAULT_EXCLUDE_PATHS,
} from '../../utils/constants.js';
import { extensionsToPaths } from '../../utils/extensions.js';
import { OptionsBuilder } from '../../utils/options-builder';
import { loadSettings } from '../../utils/settings';

/**
 * Default polling interval in milliseconds when in wait/progress mode
 */
const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * Normalize user-facing exclude path literals to regex-safe patterns
 * expected by Firecrawl.
 */
function normalizeExcludePathPattern(pattern: string): string {
  const trimmed = pattern.trim();
  // Firecrawl treats excludePaths as regex; leading ? is invalid regex syntax.
  if (trimmed.startsWith('?')) {
    return `\\${trimmed}`;
  }
  return trimmed;
}

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

  // Handle merged exclude extensions and paths
  const extensions = mergeExcludeExtensions(
    undefined, // No CLI extension flag yet
    options.noDefaultExcludes ?? false
  );
  const extensionPatterns = extensionsToPaths(extensions);
  const excludePaths = mergeExcludePaths(
    options.excludePaths,
    options.noDefaultExcludes ?? false,
    extensionPatterns
  );
  if (excludePaths.length > 0) {
    builder.add('excludePaths', excludePaths);
  }

  // Handle include paths
  if (options.includePaths && options.includePaths.length > 0) {
    builder.add('includePaths', options.includePaths);
  }

  // Handle scrapeOptions (nested properties)
  if (options.onlyMainContent !== undefined) {
    builder.addNested('scrapeOptions.onlyMainContent', options.onlyMainContent);
  }

  if (options.excludeTags && options.excludeTags.length > 0) {
    builder.addNested('scrapeOptions.excludeTags', options.excludeTags);
  }

  if (options.includeTags && options.includeTags.length > 0) {
    builder.addNested('scrapeOptions.includeTags', options.includeTags);
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
 * Merge CLI exclude extensions with default exclude extensions from settings
 *
 * @param cliExtensions - Extensions from CLI options (not implemented yet)
 * @param skipDefaults - Whether to skip default exclude extensions
 * @returns Merged and deduplicated extensions (empty strings filtered out)
 *
 * @example
 * ```typescript
 * const extensions = mergeExcludeExtensions(undefined, false);
 * // Returns: ['.exe', '.pkg', '.dmg', ...] (default extensions)
 * ```
 */
export function mergeExcludeExtensions(
  cliExtensions: string[] | undefined,
  skipDefaults: boolean
): string[] {
  const settingsExtensions = loadSettings().defaultExcludeExtensions ?? [];

  // If user has custom settings, use those; otherwise use built-in defaults
  const defaultExtensions = skipDefaults
    ? []
    : settingsExtensions.length > 0
      ? settingsExtensions
      : DEFAULT_EXCLUDE_EXTENSIONS;

  // Filter out empty strings and merge
  const validDefaults = defaultExtensions.filter(
    (ext) => ext && ext.trim() !== ''
  );
  const validCliExtensions = (cliExtensions ?? []).filter(
    (ext) => ext && ext.trim() !== ''
  );

  const mergedExtensions = [
    ...new Set([...validDefaults, ...validCliExtensions]),
  ];

  return mergedExtensions;
}

/**
 * Merge CLI exclude paths with default exclude paths from settings and extension patterns
 *
 * @param cliExcludes - Exclude paths from CLI options
 * @param skipDefaults - Whether to skip default exclude paths
 * @param extensionPatterns - Wildcard patterns converted from extensions
 * @returns Merged and deduplicated exclude paths (empty strings filtered out)
 *
 * @example
 * ```typescript
 * const excludes = mergeExcludePaths(['/admin', '/api'], false, ['**\/*.pkg']);
 * // Returns: ['/login', '/logout', '/admin', '/api', '**\/*.pkg'] (assuming defaults)
 * ```
 */
export function mergeExcludePaths(
  cliExcludes: string[] | undefined,
  skipDefaults: boolean,
  extensionPatterns: string[] = []
): string[] {
  const settingsPaths = loadSettings().defaultExcludePaths ?? [];
  const defaultExcludes = skipDefaults
    ? []
    : settingsPaths.length > 0
      ? settingsPaths
      : DEFAULT_EXCLUDE_PATHS;

  // Filter out empty strings and merge
  const validDefaults = defaultExcludes
    .filter((path) => path && path.trim() !== '')
    .map(normalizeExcludePathPattern);
  const validCliExcludes = (cliExcludes ?? [])
    .filter((path) => path && path.trim() !== '')
    .map(normalizeExcludePathPattern);
  const validExtensionPatterns = extensionPatterns.filter(
    (pattern) => pattern && pattern.trim() !== ''
  );

  const mergedExcludes = [
    ...new Set([
      ...validDefaults,
      ...validCliExcludes,
      ...validExtensionPatterns,
    ]),
  ];

  return mergedExcludes;
}
