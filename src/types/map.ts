/**
 * Types for map command
 */
import type { CommandResult } from './common';

export interface MapOptions {
  /** API key for Firecrawl */
  apiKey?: string;
  /** URL to map or job ID to check status */
  urlOrJobId: string;
  /** Check status of existing map job */
  status?: boolean;
  /** Wait for map to complete */
  wait?: boolean;
  /** Output file path */
  output?: string;
  /** Output as JSON format */
  json?: boolean;
  /** Pretty print JSON output */
  pretty?: boolean;
  /** Maximum URLs to discover */
  limit?: number;
  /** Search query */
  search?: string;
  /** Sitemap handling */
  sitemap?: 'only' | 'include' | 'skip';
  /** Include subdomains */
  includeSubdomains?: boolean;
  /** Ignore query parameters */
  ignoreQueryParameters?: boolean;
  /** Ignore cache (bypass sitemap cache for fresh URLs) */
  ignoreCache?: boolean;
  /** Timeout in seconds */
  timeout?: number;
  /** Paths to exclude from results (client-side filtering) */
  excludePaths?: string[];
  /** File extensions to exclude (converted to regex patterns) */
  excludeExtensions?: string[];
  /** Skip default exclude patterns */
  noDefaultExcludes?: boolean;
  /** Completely disable all filtering (overrides all exclude options and ignoreQueryParameters) */
  noFiltering?: boolean;
  /** Show excluded URLs in output */
  verbose?: boolean;
}

export type MapResult = CommandResult<{
  links: Array<{
    url: string;
    title?: string;
    description?: string;
  }>;
}>;
