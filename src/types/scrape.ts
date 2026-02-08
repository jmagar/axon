/**
 * Types and interfaces for the scrape command
 */

import type { Document } from '@mendable/firecrawl-js';
import type { CommandResult } from './common';

export type ScrapeFormat =
  | 'markdown'
  | 'html'
  | 'rawHtml'
  | 'links'
  | 'images'
  | 'screenshot'
  | 'summary'
  | 'changeTracking'
  | 'json'
  | 'attributes'
  | 'branding';

export interface ScrapeOptions {
  /** URL to scrape */
  url: string;
  /** Output format(s) - single format or array of formats */
  formats?: ScrapeFormat[];
  /** Include only main content */
  onlyMainContent?: boolean;
  /** Wait time before scraping (ms) */
  waitFor?: number;
  /** Request timeout in seconds (default: 15) */
  timeout?: number;
  /** Take screenshot */
  screenshot?: boolean;
  /** Include tags */
  includeTags?: string[];
  /** Exclude tags */
  excludeTags?: string[];
  /** API key for Firecrawl */
  apiKey?: string;
  /** Output file path */
  output?: string;
  /** Pretty print JSON output */
  pretty?: boolean;
  /** Force JSON output */
  json?: boolean;
  /** Show request timing and other useful information */
  timing?: boolean;
  /** Enable auto-embedding of scraped content (default: true) */
  embed?: boolean;
  /** Remove all documents for this domain from Qdrant */
  remove?: boolean;
}

export interface ScrapeResult extends CommandResult<Document> {
  /** Number of documents removed when using --remove flag */
  removed?: number;
}
