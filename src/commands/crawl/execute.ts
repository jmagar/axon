/**
 * Core crawl execution logic
 */

import type {
  CrawlOptions,
  CrawlResult,
  CrawlStatusResult,
} from '../../types/crawl';
import { getClient } from '../../utils/client';
import { isJobId } from '../../utils/job';
import { attachEmbedWebhook } from './embed';
import { buildCrawlOptions } from './options';
import { pollCrawlProgress } from './polling';
import { checkCrawlStatus } from './status';

/**
 * Execute crawl operation
 *
 * Handles three modes:
 * 1. Status check - if status flag or input is job ID
 * 2. Wait mode - polls until completion (with or without progress)
 * 3. Async mode - starts crawl and returns job ID
 *
 * @param options - Crawl options
 * @returns Crawl result or status result
 */
export async function executeCrawl(
  options: CrawlOptions
): Promise<CrawlResult | CrawlStatusResult> {
  try {
    const app = getClient({ apiKey: options.apiKey });
    const { urlOrJobId } = options;

    if (!urlOrJobId) {
      return { success: false, error: 'URL or job ID is required' };
    }

    // Progress implies wait
    const shouldWait = options.wait || options.progress;

    // If status flag is set or input looks like a job ID (but not a URL), check status
    if (
      options.status ||
      (isJobId(urlOrJobId) && !urlOrJobId.includes('://'))
    ) {
      return await checkCrawlStatus(urlOrJobId, options);
    }

    // Build crawl options
    let crawlOptions = buildCrawlOptions(options);

    // Attach webhook for async auto-embedding
    crawlOptions = attachEmbedWebhook(
      crawlOptions,
      options.embed !== false,
      shouldWait ?? false
    );

    // If wait mode, use polling with optional progress
    if (shouldWait) {
      if (options.progress) {
        // Start crawl and poll with progress display
        const response = await app.startCrawl(urlOrJobId, crawlOptions);
        const data = await pollCrawlProgress(response.id, {
          apiKey: options.apiKey,
          pollInterval: crawlOptions.pollInterval || 5000,
          timeout: crawlOptions.crawlTimeout,
        });
        return { success: true, data };
      } else {
        // Use SDK's built-in polling (no progress display)
        const crawlJob = await app.crawl(urlOrJobId, crawlOptions);
        return { success: true, data: crawlJob };
      }
    }

    // Otherwise, start crawl and return job ID
    const response = await app.startCrawl(urlOrJobId, crawlOptions);

    return {
      success: true,
      data: {
        jobId: response.id,
        url: response.url,
        status: 'processing',
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    return {
      success: false,
      error: `Crawl operation failed: ${errorMessage}`,
    };
  }
}
