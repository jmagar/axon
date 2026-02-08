/**
 * Types for crawl command
 */

import type { Document } from '@mendable/firecrawl-js';
import type { CommandResult } from './common';

export interface CrawlOptions {
  /** API key for Firecrawl */
  apiKey?: string;
  /** URL to crawl or job ID to check status */
  urlOrJobId?: string;
  /** Check status of existing crawl job (internal use only) */
  status?: boolean;
  /** Wait for crawl to complete */
  wait?: boolean;
  /** Polling interval in seconds when waiting */
  pollInterval?: number;
  /** Timeout in seconds when waiting for crawl job to complete */
  timeout?: number;
  /** Show progress dots while waiting */
  progress?: boolean;
  /** Output file path */
  output?: string;
  /** Pretty print JSON output */
  pretty?: boolean;
  /** Maximum number of pages to crawl */
  limit?: number;
  /** Maximum crawl depth */
  maxDepth?: number;
  /** Exclude paths */
  excludePaths?: string[];
  /** Include paths */
  includePaths?: string[];
  /** Sitemap handling */
  sitemap?: 'skip' | 'include';
  /** Ignore query parameters */
  ignoreQueryParameters?: boolean;
  /** Crawl entire domain */
  crawlEntireDomain?: boolean;
  /** Allow external links */
  allowExternalLinks?: boolean;
  /** Allow subdomains */
  allowSubdomains?: boolean;
  /** Delay between requests */
  delay?: number;
  /** Maximum concurrency */
  maxConcurrency?: number;
  /** Enable auto-embedding of crawl results */
  embed?: boolean;
  /** Skip default exclude paths from settings */
  noDefaultExcludes?: boolean;
  /** Include only main content when scraping pages */
  onlyMainContent?: boolean;
  /** Tags to exclude from scraped content */
  excludeTags?: string[];
  /** Tags to include in scraped content */
  includeTags?: string[];
}

/** Response when starting an async crawl job */
export interface CrawlJobStartedData {
  jobId: string;
  url: string;
  status: 'processing';
}

/** Completed crawl job data - matches SDK's CrawlJob interface */
export interface CrawlJobData {
  id: string;
  status: 'scraping' | 'completed' | 'failed' | 'cancelled';
  total: number;
  completed: number;
  creditsUsed?: number;
  expiresAt?: string;
  next?: string | null;
  data: Document[];
}

export type CrawlResult = CommandResult<CrawlJobStartedData | CrawlJobData>;

/** Status-only data returned when checking a crawl job's status */
export interface CrawlStatusData {
  id: string;
  status: 'scraping' | 'completed' | 'failed' | 'cancelled';
  total: number;
  completed: number;
  creditsUsed?: number;
  expiresAt?: string;
}

export type CrawlStatusResult = CommandResult<CrawlStatusData>;

export interface CrawlErrorItem {
  id: string;
  url: string;
  error: string;
  timestamp?: string;
  code?: string;
}

export interface CrawlErrorsData {
  errors: CrawlErrorItem[];
  robotsBlocked: string[];
}

export type CrawlErrorsResult = CommandResult<CrawlErrorsData>;

export interface ActiveCrawlItem {
  id: string;
  teamId: string;
  url: string;
  options?: Record<string, unknown> | null;
}

export interface ActiveCrawlsData {
  success: boolean;
  crawls: ActiveCrawlItem[];
}

export type CrawlActiveResult = CommandResult<ActiveCrawlsData>;

export interface CrawlCancelData {
  status: 'cancelled';
}

export type CrawlCancelResult = CommandResult<CrawlCancelData>;

/** Union of all possible crawl data types */
export type CrawlDataType =
  | CrawlJobStartedData
  | CrawlJobData
  | CrawlStatusData;
