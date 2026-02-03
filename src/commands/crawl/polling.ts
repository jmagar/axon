/**
 * Progress polling for crawl operations
 */

import type { IContainer } from '../../container/types';
import type { CrawlJobData } from '../../types/crawl';
import { pollWithProgress } from '../../utils/polling';

/**
 * Poll crawl job status with progress updates and timeout handling
 *
 * @param container - Dependency injection container
 * @param jobId - Crawl job ID to poll
 * @param options - Polling configuration
 * @returns Final crawl job data when complete
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * const data = await pollCrawlProgress(container, 'job-123', {
 *   pollInterval: 5000,
 *   timeout: 60000,
 * });
 * ```
 */
export async function pollCrawlProgress(
  container: IContainer,
  jobId: string,
  options: {
    pollInterval: number;
    timeout?: number;
  }
): Promise<CrawlJobData> {
  // Validate pollInterval to prevent zero/negative values causing tight loop
  if (!Number.isFinite(options.pollInterval) || options.pollInterval < 100) {
    throw new Error(
      `Invalid pollInterval: ${options.pollInterval}. Must be >= 100ms to prevent tight loop.`
    );
  }

  const app = container.getFirecrawlClient();

  // Disable auto-pagination during polling - we only need progress counts
  const noPagination = { autoPaginate: false };

  try {
    // Write initial messages to stderr
    process.stderr.write(`Polling job status...\n`);
    process.stderr.write(`Job ID: ${jobId}\n`);

    return await pollWithProgress({
      jobId,
      // Lightweight status fetches during polling (no auto-pagination)
      statusFetcher: async (id) => app.getCrawlStatus(id, noPagination),
      // Full fetch with auto-pagination when complete (for embedding and output)
      finalFetcher: async (id) => app.getCrawlStatus(id),
      pollInterval: options.pollInterval,
      timeout: options.timeout,
      showProgress: true,
      isComplete: (status) =>
        status.status === 'completed' ||
        status.status === 'failed' ||
        status.status === 'cancelled' ||
        (status.total > 0 && status.completed >= status.total),
      formatProgress: (status) =>
        `Progress: ${status.completed}/${status.total} pages (${status.status})`,
    });
  } catch (error) {
    process.stderr.write(`\nPolling failed: ${error}\n`);
    throw error;
  }
}
