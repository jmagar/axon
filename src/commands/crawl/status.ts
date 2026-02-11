/**
 * Status operations for crawl jobs
 */

import type { IContainer } from '../../container/types';
import type {
  CrawlCancelResult,
  CrawlCleanupResult,
  CrawlClearResult,
  CrawlErrorsResult,
  CrawlStatusResult,
} from '../../types/crawl';
import { isJobNotFoundError } from '../../utils/job-errors';
import {
  clearJobTypeHistory,
  getRecentJobIds,
  removeJobIds,
} from '../../utils/job-history';

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

function isStaleInProgressStatus(status: {
  status?: string;
  total?: number;
  completed?: number;
}): boolean {
  if (
    status.status !== 'scraping' &&
    status.status !== 'processing' &&
    status.status !== 'running'
  ) {
    return false;
  }

  if (
    typeof status.total !== 'number' ||
    typeof status.completed !== 'number'
  ) {
    return false;
  }

  return status.total > 0 && status.completed >= status.total;
}

export async function executeCrawlClear(
  container: IContainer
): Promise<CrawlClearResult> {
  try {
    const app = container.getFirecrawlClient();
    // Note: capped at 100 most-recent IDs, so clearedHistory may underreport
    // if more than 100 crawl jobs exist in the local history file.
    const recentCrawlIds = await getRecentJobIds('crawl', 100);

    let cancelledActive = 0;
    try {
      const active = await app.getActiveCrawls();
      const activeIds = Array.isArray(active.crawls)
        ? active.crawls.map((crawl) => crawl.id)
        : [];

      for (const activeId of activeIds) {
        const cancelled = await app.cancelCrawl(activeId);
        if (cancelled) {
          cancelledActive++;
        }
      }
    } catch {
      // If active-crawl lookup fails, still clear local queue state.
    }

    await clearJobTypeHistory('crawl');

    return {
      success: true,
      data: {
        clearedHistory: recentCrawlIds.length,
        cancelledActive,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: formatError('clear crawl queue', 'history', error),
    };
  }
}

export async function executeCrawlCleanup(
  container: IContainer
): Promise<CrawlCleanupResult> {
  try {
    const app = container.getFirecrawlClient();
    const recentCrawlIds = await getRecentJobIds('crawl', 100);

    let removedFailed = 0;
    let removedStale = 0;
    let removedNotFound = 0;
    const toRemove: string[] = [];

    // Sequential API calls: acceptable for a CLI tool where cleanup runs
    // infrequently and the Firecrawl API has no batch-status endpoint.
    for (const id of recentCrawlIds) {
      try {
        const status = await app.getCrawlStatus(id, { autoPaginate: false });

        const crawlStatus = String(status.status ?? '').toLowerCase();
        if (
          crawlStatus === 'failed' ||
          crawlStatus === 'cancelled' ||
          crawlStatus === 'error'
        ) {
          removedFailed++;
          toRemove.push(id);
          continue;
        }

        if (
          isStaleInProgressStatus({
            status: status.status,
            total: status.total,
            completed: status.completed,
          })
        ) {
          removedStale++;
          toRemove.push(id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isJobNotFoundError(message)) {
          removedNotFound++;
          toRemove.push(id);
        }
      }
    }

    await removeJobIds('crawl', toRemove);

    return {
      success: true,
      data: {
        scanned: recentCrawlIds.length,
        removedFailed,
        removedStale,
        removedNotFound,
        removedTotal: toRemove.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: formatError('cleanup crawl queue', 'history', error),
    };
  }
}
