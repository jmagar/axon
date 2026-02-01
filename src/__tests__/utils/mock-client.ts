/**
 * Test utilities for mocking the Firecrawl client
 */

import type { Mock } from 'vitest';
import { resetClient } from '../../utils/client';
import { resetConfig } from '../../utils/config';

/**
 * Mock Firecrawl client methods
 * These are typed as any to allow flexible mocking in tests
 */
export interface MockFirecrawlClient {
  scrape: Mock;
  crawl?: Mock;
  search?: Mock;
  map?: Mock;
  extract?: Mock;
  agent?: Mock;
  startCrawl?: Mock;
  getCrawlStatus?: Mock;
  cancelCrawl?: Mock;
  getCrawlErrors?: Mock;
  getActiveCrawls?: Mock;
  getExtractStatus?: Mock;
  startExtract?: Mock;
  startBatchScrape?: Mock;
  batchScrape?: Mock;
  getBatchScrapeStatus?: Mock;
  getBatchScrapeErrors?: Mock;
  cancelBatchScrape?: Mock;
}

/**
 * Setup test environment - reset client and config
 */
export function setupTest(): void {
  resetClient();
  resetConfig();
}

/**
 * Teardown test environment
 */
export function teardownTest(): void {
  resetClient();
  resetConfig();
}
