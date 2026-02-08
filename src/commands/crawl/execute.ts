/**
 * Core crawl execution logic
 */

import type { IContainer } from '../../container/types';
import type {
  CrawlOptions,
  CrawlResult,
  CrawlStatusResult,
} from '../../types/crawl';
import { attachEmbedWebhook } from './embed';
import { buildCrawlOptions } from './options';
import { pollCrawlProgress } from './polling';
import { checkCrawlStatus } from './status';

/**
 * Execute crawl operation
 *
 * Handles three modes:
 * 1. Status check - if status flag is set
 * 2. Wait mode - polls until completion (with or without progress)
 * 3. Async mode - starts crawl and returns job ID
 *
 * @param container - Dependency injection container
 * @param options - Crawl options
 * @returns Crawl result or status result
 */
export async function executeCrawl(
  container: IContainer,
  options: CrawlOptions
): Promise<CrawlResult | CrawlStatusResult> {
  try {
    const app = container.getFirecrawlClient();
    const { urlOrJobId } = options;

    if (!urlOrJobId) {
      return { success: false, error: 'URL is required' };
    }

    // Progress implies wait
    const shouldWait = options.wait || options.progress;

    // Explicit status mode
    if (options.status) {
      return await checkCrawlStatus(container, urlOrJobId);
    }

    // Build crawl options
    let crawlOptions = buildCrawlOptions(options);

    // Attach webhook for async auto-embedding
    crawlOptions = attachEmbedWebhook(
      crawlOptions,
      options.embed !== false,
      shouldWait ?? false,
      container.config
    );

    // If wait mode, use polling with optional progress
    if (shouldWait) {
      if (options.progress) {
        // Start crawl and poll with progress display
        const response = await app.startCrawl(urlOrJobId, crawlOptions);
        const data = await pollCrawlProgress(container, response.id, {
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
