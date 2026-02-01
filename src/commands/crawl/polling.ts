/**
 * Progress polling for crawl operations
 */

import type { CrawlJobData } from '../../types/crawl';
import { getClient } from '../../utils/client';
import { pollWithProgress } from '../../utils/polling';

/**
 * Poll crawl job status with progress updates and timeout handling
 *
 * @param jobId - Crawl job ID to poll
 * @param options - Polling configuration
 * @returns Final crawl job data when complete
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * const data = await pollCrawlProgress('job-123', {
 *   pollInterval: 5000,
 *   timeout: 60000,
 * });
 * ```
 */
export async function pollCrawlProgress(
  jobId: string,
  options: {
    apiKey?: string;
    pollInterval: number;
    timeout?: number;
  }
): Promise<CrawlJobData> {
  const app = getClient({ apiKey: options.apiKey });

  try {
    // Write initial messages to stderr
    process.stderr.write(`Polling job status...\n`);
    process.stderr.write(`Job ID: ${jobId}\n`);

    return await pollWithProgress({
      jobId,
      statusFetcher: async (id) => app.getCrawlStatus(id),
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
