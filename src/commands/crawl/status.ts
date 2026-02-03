/**
 * Status operations for crawl jobs
 */

import type { IContainer } from '../../container/types';
import type {
  CrawlCancelResult,
  CrawlErrorsResult,
  CrawlStatusResult,
} from '../../types/crawl';

/**
 * Format error message for status operations
 *
 * @param operation - Description of the operation being performed
 * @param jobId - Job ID
 * @param error - Error that occurred
 * @returns Formatted error message
 */
function formatError(operation: string, jobId: string, error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'Unknown error occurred';
  return `Failed to ${operation} job ${jobId}: ${message}`;
}

/**
 * Execute crawl status check
 *
 * @param container - Dependency injection container
 * @param jobId - Crawl job ID
 * @returns Status result with job details or error
 * @throws Never throws - errors are returned in result object
 */
export async function checkCrawlStatus(
  container: IContainer,
  jobId: string
): Promise<CrawlStatusResult> {
  try {
    const app = container.getFirecrawlClient();
    // Disable auto-pagination - we only need summary fields, not document data
    const status = await app.getCrawlStatus(jobId, { autoPaginate: false });

    return {
      success: true,
      data: {
        id: status.id,
        status: status.status,
        total: status.total,
        completed: status.completed,
        creditsUsed: status.creditsUsed,
        expiresAt: status.expiresAt,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: formatError('check status for', jobId, error),
    };
  }
}

/**
 * Execute crawl cancel
 *
 * @param container - Dependency injection container
 * @param jobId - Crawl job ID
 * @returns Cancel result indicating success or failure
 * @throws Never throws - errors are returned in result object
 */
export async function executeCrawlCancel(
  container: IContainer,
  jobId: string
): Promise<CrawlCancelResult> {
  try {
    const app = container.getFirecrawlClient();
    const ok = await app.cancelCrawl(jobId);

    if (!ok) {
      return { success: false, error: `Failed to cancel job ${jobId}` };
    }

    return { success: true, data: { status: 'cancelled' } };
  } catch (error) {
    return {
      success: false,
      error: formatError('cancel', jobId, error),
    };
  }
}

/**
 * Execute crawl errors fetch
 *
 * @param container - Dependency injection container
 * @param jobId - Crawl job ID
 * @returns Errors result containing array of errors or failure
 * @throws Never throws - errors are returned in result object
 */
export async function executeCrawlErrors(
  container: IContainer,
  jobId: string
): Promise<CrawlErrorsResult> {
  try {
    const app = container.getFirecrawlClient();
    const errors = await app.getCrawlErrors(jobId);
    return { success: true, data: errors };
  } catch (error) {
    return {
      success: false,
      error: formatError('fetch errors for', jobId, error),
    };
  }
}
