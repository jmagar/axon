/**
 * Status command implementation
 * Displays CLI version, auth status, and API URL
 * Also supports job status inspection via `firecrawl status`
 */

import { Command } from 'commander';
import packageJson from '../../package.json';
import type { IContainer, ImmutableConfig } from '../container/types';
import { getAuthSource, isAuthenticated } from '../utils/auth';
import { formatJson, writeCommandOutput } from '../utils/command';
import { DEFAULT_API_URL } from '../utils/defaults';
import {
  cleanupOldJobs,
  listEmbedJobs,
  updateEmbedJob,
} from '../utils/embed-queue';
import { withTimeout } from '../utils/http';
import { isJobId } from '../utils/job';
import {
  clearJobHistory,
  getRecentJobIds,
  removeJobIds,
} from '../utils/job-history';
import {
  colorize,
  colors,
  fmt,
  formatProgress,
  formatRetries,
  getStatusColor,
  getStatusIcon,
  icons,
} from '../utils/theme';
import { requireContainer } from './shared';

type AuthSource = 'explicit' | 'env' | 'stored' | 'none';

interface StatusResult {
  version: string;
  authenticated: boolean;
  authSource: AuthSource;
  apiUrl: string;
}

interface JobStatusOptions {
  apiKey?: string;
  crawl?: string;
  batch?: string;
  extract?: string;
  embed?: string | boolean;
  output?: string;
  json?: boolean;
  pretty?: boolean;
}

interface EmbedQueueSummary {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

function statusHeading(text: string): string {
  return fmt.bold(colorize(colors.primary, text));
}

function accentJobId(id: string): string {
  return colorize(colors.materialLightBlue, id);
}

function accentProgressText(text: string): string {
  return text.replace(/(\d+%|\(\d+\/\d+\))/g, (segment) =>
    colorize(colors.materialLightBlue, segment)
  );
}

/**
 * Get status information
 */
export function getStatus(config: ImmutableConfig): StatusResult {
  const authSource = getAuthSource();

  return {
    version: packageJson.version,
    authenticated: isAuthenticated(config.apiKey),
    authSource,
    apiUrl: config.apiUrl || DEFAULT_API_URL,
  };
}

/**
 * Handle status command output
 */
export async function handleStatusCommand(
  container: IContainer,
  _options: Record<string, unknown>
): Promise<void> {
  const status = getStatus(container.config);

  // Header
  console.log('');
  console.log(
    `  ${fmt.primary(`${icons.success} firecrawl`)} ${fmt.dim('cli')} ${fmt.dim(`v${status.version}`)}`
  );
  console.log('');

  // Auth status with source
  if (status.authenticated) {
    const sourceLabel =
      status.authSource === 'explicit'
        ? 'via --api-key'
        : status.authSource === 'env'
          ? 'via FIRECRAWL_API_KEY'
          : 'via stored credentials';
    console.log(
      `  ${fmt.success(icons.active)} Authenticated ${fmt.dim(sourceLabel)}`
    );
  } else {
    console.log(`  ${fmt.error(icons.active)} Not authenticated`);
    console.log(fmt.dim("Run 'firecrawl login' to authenticate"));
    console.log('');
    return;
  }

  // API URL
  console.log(`  ${colorize(colors.primary, 'API URL:')} ${status.apiUrl}`);
  console.log('');
}

function parseIds(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function filterValidJobIds(ids: string[]): string[] {
  return ids.filter((id) => isJobId(id));
}

function shouldPruneError(error: string | undefined): boolean {
  if (!error) return false;
  const normalized = error.toLowerCase();
  return (
    normalized.includes('job not found') ||
    normalized.includes('invalid job id')
  );
}

/**
 * Extract job IDs that should be pruned from a list of statuses
 * @param statuses Array of status objects that may contain errors
 * @returns Array of string job IDs that should be removed from history
 */
function extractPruneIds<T extends { id?: string; error?: string }>(
  statuses: T[]
): string[] {
  return statuses
    .filter((status) => shouldPruneError(status.error))
    .map((status) => status.id)
    .filter((id): id is string => Boolean(id));
}

async function summarizeEmbedQueue(): Promise<{
  summary: EmbedQueueSummary;
  jobs: Array<{
    id: string;
    jobId: string;
    url: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    retries: number;
    maxRetries: number;
    createdAt: string;
    updatedAt: string;
    lastError?: string;
    apiKey?: string;
    totalDocuments?: number;
    processedDocuments?: number;
    failedDocuments?: number;
    progressUpdatedAt?: string;
  }>;
}> {
  const jobs = await listEmbedJobs();
  const summary: EmbedQueueSummary = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  for (const job of jobs) {
    if (job.status in summary) {
      summary[job.status as keyof EmbedQueueSummary] += 1;
    }
  }

  return { summary, jobs };
}

/**
 * Fetches job statuses from the Firecrawl API in parallel
 *
 * @param client - Firecrawl client instance
 * @param resolvedIds - Resolved job IDs to fetch
 * @returns Promise containing active crawls and all job statuses
 */
async function fetchJobStatuses(
  client: ReturnType<IContainer['getFirecrawlClient']>,
  resolvedIds: {
    crawls: string[];
    batches: string[];
    extracts: string[];
  }
) {
  const STATUS_TIMEOUT_MS = 10000; // 10 second timeout per API call
  const noPagination = { autoPaginate: false };

  const activeCrawlsPromise = withTimeout(
    client.getActiveCrawls(),
    STATUS_TIMEOUT_MS,
    'getActiveCrawls timed out'
  ).catch(() => ({ success: false, crawls: [] }));

  const crawlStatusesPromise = Promise.all(
    resolvedIds.crawls.map(async (id) => {
      try {
        return await withTimeout(
          client.getCrawlStatus(id, noPagination),
          STATUS_TIMEOUT_MS,
          `getCrawlStatus(${id}) timed out`
        );
      } catch (error) {
        return {
          id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    })
  );

  const batchStatusesPromise = Promise.all(
    resolvedIds.batches.map(async (id) => {
      try {
        return await withTimeout(
          client.getBatchScrapeStatus(id, noPagination),
          STATUS_TIMEOUT_MS,
          `getBatchScrapeStatus(${id}) timed out`
        );
      } catch (error) {
        return {
          id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    })
  );

  const extractStatusesPromise = Promise.all(
    resolvedIds.extracts.map(async (id) => {
      try {
        return await withTimeout(
          client.getExtractStatus(id),
          STATUS_TIMEOUT_MS,
          `getExtractStatus(${id}) timed out`
        );
      } catch (error) {
        return {
          id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    })
  );

  const [activeCrawls, crawlStatuses, batchStatuses, extractStatuses] =
    await Promise.all([
      activeCrawlsPromise,
      crawlStatusesPromise,
      batchStatusesPromise,
      extractStatusesPromise,
    ]);

  return {
    activeCrawls,
    crawlStatuses,
    batchStatuses,
    extractStatuses,
  };
}

/**
 * Builds a map of crawl IDs to their source URLs
 *
 * @param activeCrawls - Active crawls from the API
 * @param crawlStatuses - Crawl status responses
 * @returns Map of crawl ID to source URL
 */
function buildCrawlSourceMap(
  activeCrawls: { crawls: Array<{ id: string; url: string }> },
  crawlStatuses: Array<{
    id: string;
    status?: string;
    data?: Array<{ metadata?: { sourceURL?: string; url?: string } }>;
  }>
): Map<string, string> {
  const activeUrlById = new Map(
    activeCrawls.crawls.map((crawl) => [crawl.id, crawl.url])
  );
  const crawlSourceById = new Map<string, string>();

  for (const crawl of crawlStatuses) {
    const maybeData = (
      crawl as {
        data?: Array<{ metadata?: { sourceURL?: string; url?: string } }>;
      }
    ).data;
    const sourceUrl = Array.isArray(maybeData)
      ? (maybeData[0]?.metadata?.sourceURL ?? maybeData[0]?.metadata?.url)
      : undefined;
    const displayUrl = sourceUrl ?? activeUrlById.get(crawl.id);
    if (displayUrl && crawl.id) {
      crawlSourceById.set(crawl.id, displayUrl);
      (crawl as { url?: string }).url = displayUrl;
    }
  }

  return crawlSourceById;
}

/**
 * Updates embed job URLs in batch (not in a loop) to fix N+1 query pattern
 *
 * @param jobs - Embed jobs to update
 * @param crawlSourceById - Map of crawl IDs to source URLs
 */
async function updateEmbedJobUrls(
  jobs: Array<{
    id: string;
    jobId: string;
    url: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    retries: number;
    maxRetries: number;
    createdAt: string;
    updatedAt: string;
    lastError?: string;
    apiKey?: string;
    totalDocuments?: number;
    processedDocuments?: number;
    failedDocuments?: number;
    progressUpdatedAt?: string;
  }>,
  crawlSourceById: Map<string, string>
): Promise<void> {
  // Batch collect all jobs that need updating
  const jobsToUpdate = jobs.filter((job) => {
    const sourceUrl = crawlSourceById.get(job.jobId);
    return sourceUrl && job.url.includes('/v2/crawl/');
  });

  // Batch update all jobs in parallel
  await Promise.all(
    jobsToUpdate.map(async (job) => {
      const sourceUrl = crawlSourceById.get(job.jobId);
      if (sourceUrl) {
        job.url = sourceUrl;
        await updateEmbedJob(job);
      }
    })
  );
}

/**
 * Filters and sorts embed jobs by status, returning top 10
 *
 * @param jobs - All embed jobs
 * @param status - Status to filter by
 * @returns Filtered and sorted job list (top 10, newest first)
 */
function filterAndSortEmbeds<T extends { status: string; updatedAt: string }>(
  jobs: T[],
  status: string
): T[] {
  return jobs
    .filter((job) => job.status === status)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10);
}

/**
 * Formats job lists for output (sorts by ID descending, takes top 10)
 *
 * @param crawlStatuses - Crawl status responses
 * @param batchStatuses - Batch status responses
 * @param extractStatuses - Extract status responses
 * @returns Sorted and sliced job lists
 */
function formatJobsForDisplay<
  T extends { id?: string; status?: string },
  U extends { id?: string; status?: string },
  V extends { id?: string; status?: string },
>(crawlStatuses: Array<T>, batchStatuses: Array<U>, extractStatuses: Array<V>) {
  // Sort by ID descending (ULIDs are lexicographically sortable by timestamp)
  const sortedCrawls = crawlStatuses
    .sort((a, b) => (b.id ?? '').localeCompare(a.id ?? ''))
    .slice(0, 10);
  const sortedBatches = batchStatuses
    .sort((a, b) => (b.id ?? '').localeCompare(a.id ?? ''))
    .slice(0, 10);
  const sortedExtracts = extractStatuses
    .sort((a, b) => (b.id ?? '').localeCompare(a.id ?? ''))
    .slice(0, 10);

  return {
    crawls: sortedCrawls,
    batches: sortedBatches,
    extracts: sortedExtracts,
  };
}

interface EmbedContext {
  message: string;
  metadata?: string;
}

/**
 * Get display context for an embedding job based on its status and related crawl data
 *
 * @param embedJob - The embedding job to generate context for
 * @param embedJob.jobId - Unique job identifier
 * @param embedJob.status - Current job status (pending, processing, completed, failed)
 * @param embedJob.retries - Number of retry attempts made
 * @param embedJob.maxRetries - Maximum retry attempts allowed
 * @param crawlData - Optional crawl status data for showing progress on pending embeds
 * @param crawlData.status - Crawl status (scraping, completed, failed, cancelled, etc.)
 * @param crawlData.completed - Number of pages scraped so far
 * @param crawlData.total - Total number of pages to scrape
 * @returns Object with user-friendly message and optional metadata string
 *
 * @example
 * // Pending embed with no crawl data
 * getEmbedContext({ jobId: 'job-1', status: 'pending', retries: 0, maxRetries: 3 })
 * // => { message: 'Queued for embedding' }
 *
 * @example
 * // Pending embed with active crawl showing progress
 * getEmbedContext(
 *   { jobId: 'job-1', status: 'pending', retries: 0, maxRetries: 3 },
 *   { status: 'scraping', completed: 268, total: 1173 }
 * )
 * // => { message: 'Queued for embedding', metadata: 'crawl: 268/1173 scraped' }
 *
 * @example
 * // Failed embed showing retry count
 * getEmbedContext({ jobId: 'job-1', status: 'failed', retries: 2, maxRetries: 3 })
 * // => { message: 'Embedding failed', metadata: 'retries: 2/3' }
 */
export function getEmbedContext(
  embedJob: {
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    retries: number;
    maxRetries: number;
    totalDocuments?: number;
    processedDocuments?: number;
    failedDocuments?: number;
  },
  crawlData?: {
    status: string;
    completed: number;
    total: number;
  }
): EmbedContext {
  const {
    status,
    retries,
    maxRetries,
    totalDocuments,
    processedDocuments,
    failedDocuments,
  } = embedJob;

  if (status === 'processing') {
    // Show progress if available
    if (totalDocuments && processedDocuments !== undefined) {
      const percentage = Math.floor(
        (processedDocuments / totalDocuments) * 100
      );
      return {
        message: 'Embedding in progress',
        metadata: `${processedDocuments}/${totalDocuments} - ${percentage}%`,
      };
    }
    // Fallback for old jobs without progress tracking
    return { message: 'Embedding in progress...' };
  }

  if (status === 'completed') {
    // Show final counts if available
    if (
      totalDocuments !== undefined &&
      processedDocuments !== undefined &&
      failedDocuments !== undefined &&
      failedDocuments > 0
    ) {
      return {
        message: 'Completed with failures',
        metadata: `${processedDocuments}/${totalDocuments} succeeded, ${failedDocuments} failed`,
      };
    }
    return { message: 'Embedded successfully' };
  }

  if (status === 'failed') {
    return {
      message: 'Embedding failed',
      metadata: formatRetries(retries, maxRetries),
    };
  }

  // Status is 'pending'
  if (!crawlData) {
    return { message: 'Queued for embedding' };
  }

  const { status: crawlStatus, completed, total } = crawlData;

  if (crawlStatus === 'failed' || crawlStatus === 'cancelled') {
    return { message: 'Blocked (crawl failed)' };
  }

  if (crawlStatus === 'completed') {
    return {
      message: 'Ready to embed',
      metadata: `${total} documents`,
    };
  }

  // Crawl is still scraping
  return {
    message: 'Queued for embedding',
    metadata: `crawl: ${completed}/${total} scraped`,
  };
}

async function executeJobStatus(
  container: IContainer,
  options: JobStatusOptions
) {
  const client = container.getFirecrawlClient();

  // Clean up old completed/failed embed jobs (older than 1 hour)
  // This prevents "Job not found" errors from completed crawls that no longer exist in the API
  await cleanupOldJobs(1); // 1 hour retention

  const embedQueue = await summarizeEmbedQueue();
  const crawlIds = parseIds(options.crawl);
  const batchIds = parseIds(options.batch);
  const extractIds = parseIds(options.extract);

  // Only include pending/processing embed jobs in crawl status checks
  // Completed/failed embeds indicate the crawl is done, so no need to query API
  const activeEmbedJobIds = embedQueue.jobs
    .filter((job) => job.status === 'pending' || job.status === 'processing')
    .map((job) => job.jobId);

  const recentCrawlIds = await getRecentJobIds('crawl', 10);
  const recentBatchIds = await getRecentJobIds('batch', 10);
  const recentExtractIds = await getRecentJobIds('extract', 10);

  const resolvedCrawlIds = filterValidJobIds(
    crawlIds.length > 0
      ? crawlIds
      : Array.from(new Set([...recentCrawlIds, ...activeEmbedJobIds])).slice(
          0,
          10
        )
  );
  const resolvedBatchIds = filterValidJobIds(
    batchIds.length > 0 ? batchIds : recentBatchIds
  );
  const resolvedExtractIds = filterValidJobIds(
    extractIds.length > 0 ? extractIds : recentExtractIds
  );

  // Fetch all job statuses in parallel
  const { activeCrawls, crawlStatuses, batchStatuses, extractStatuses } =
    await fetchJobStatuses(client, {
      crawls: resolvedCrawlIds,
      batches: resolvedBatchIds,
      extracts: resolvedExtractIds,
    });

  // Prune invalid job IDs from history
  const crawlPruneIds = extractPruneIds(crawlStatuses);
  const batchPruneIds = extractPruneIds(batchStatuses);
  const extractStatusPruneIds = extractPruneIds(extractStatuses);

  await removeJobIds('crawl', crawlPruneIds);
  await removeJobIds('batch', batchPruneIds);
  await removeJobIds('extract', extractStatusPruneIds);

  // Build source URL mapping and update embed job URLs in batch
  const crawlSourceById = buildCrawlSourceMap(activeCrawls, crawlStatuses);
  await updateEmbedJobUrls(embedQueue.jobs, crawlSourceById);

  // Find specific embed job if requested
  const embedJobId = typeof options.embed === 'string' ? options.embed : null;
  const embedJob = embedJobId
    ? embedQueue.jobs.find((job) => job.jobId === embedJobId)
    : null;

  // Filter and sort embed jobs by status (uses common helper to avoid duplication)
  type EmbedJobBase = {
    jobId: string;
    url: string;
    maxRetries: number;
    updatedAt: string;
    totalDocuments?: number;
    processedDocuments?: number;
    failedDocuments?: number;
  };

  type FailedEmbed = EmbedJobBase & {
    retries: number;
    lastError?: string;
  };

  type PendingEmbed = EmbedJobBase & {
    retries: number;
  };

  const failedEmbeds = filterAndSortEmbeds(embedQueue.jobs, 'failed').map(
    (job): FailedEmbed => ({
      jobId: job.jobId,
      url: job.url,
      retries: job.retries,
      maxRetries: job.maxRetries,
      lastError: job.lastError,
      updatedAt: job.updatedAt,
      totalDocuments: job.totalDocuments,
      processedDocuments: job.processedDocuments,
      failedDocuments: job.failedDocuments,
    })
  );

  const pendingEmbeds = filterAndSortEmbeds(embedQueue.jobs, 'pending').map(
    (job): PendingEmbed => ({
      jobId: job.jobId,
      url: job.url,
      retries: job.retries,
      maxRetries: job.maxRetries,
      updatedAt: job.updatedAt,
      totalDocuments: job.totalDocuments,
      processedDocuments: job.processedDocuments,
      failedDocuments: job.failedDocuments,
    })
  );

  const completedEmbeds = filterAndSortEmbeds(embedQueue.jobs, 'completed').map(
    (job): EmbedJobBase => ({
      jobId: job.jobId,
      url: job.url,
      maxRetries: job.maxRetries,
      updatedAt: job.updatedAt,
      totalDocuments: job.totalDocuments,
      processedDocuments: job.processedDocuments,
      failedDocuments: job.failedDocuments,
    })
  );

  // Format job lists for display
  const formattedJobs = formatJobsForDisplay(
    crawlStatuses,
    batchStatuses,
    extractStatuses
  );

  return {
    activeCrawls,
    crawls: formattedJobs.crawls,
    batches: formattedJobs.batches,
    extracts: formattedJobs.extracts,
    resolvedIds: {
      crawls: resolvedCrawlIds,
      batches: resolvedBatchIds,
      extracts: resolvedExtractIds,
    },
    embeddings: {
      summary: embedQueue.summary,
      job: embedJob ?? undefined,
      failed: failedEmbeds,
      pending: pendingEmbeds,
      completed: completedEmbeds,
    },
  };
}

/**
 * Renders the active crawls section showing currently running crawls.
 *
 * @param data - Job status data containing active crawls
 */
function renderActiveCrawlsSection(
  data: Awaited<ReturnType<typeof executeJobStatus>>
): void {
  console.log('');
  console.log(statusHeading('Crawls'));
  if (data.activeCrawls.crawls.length === 0) {
    console.log(fmt.dim('  No active crawls.'));
  } else {
    for (const crawl of data.activeCrawls.crawls) {
      console.log(
        `  ${colorize(colors.warning, icons.processing)} ${crawl.id} ${crawl.url}`
      );
    }
  }
}

/**
 * Renders the crawl status section showing completed/pending/failed crawls.
 *
 * @param data - Job status data containing crawl job results
 * @param crawlUrlById - Map of crawl IDs to their URLs
 */
function renderCrawlStatusSection(
  data: Awaited<ReturnType<typeof executeJobStatus>>,
  crawlUrlById: Map<string, string>
): void {
  const hasCrawlLookup =
    data.crawls.length > 0 || data.resolvedIds.crawls.length > 0;

  if (hasCrawlLookup) {
    console.log('');
    console.log(statusHeading('Crawl Status'));
    if (data.crawls.length === 0) {
      console.log(fmt.dim('  No crawl jobs found.'));
    }

    const crawlRows = data.crawls.map((crawl) => {
      const crawlError = (crawl as { error?: string }).error;
      const displayUrl = crawlUrlById.get(crawl.id);
      const status = crawl.status ?? 'unknown';
      const isFailed =
        Boolean(crawlError) || status === 'failed' || status === 'error';
      const isCompleted = status === 'completed';
      const hasProgress = 'completed' in crawl && 'total' in crawl;
      const completedValue = hasProgress ? (crawl.completed as number) : 0;
      const totalValue = hasProgress ? (crawl.total as number) : 0;
      const isStaleScraping =
        !isFailed &&
        !isCompleted &&
        (status === 'scraping' ||
          status === 'processing' ||
          status === 'running') &&
        hasProgress &&
        totalValue > 0 &&
        completedValue >= totalValue;
      const icon = getStatusIcon(status, isFailed);
      const statusColor = getStatusColor(status, isFailed);
      const progress = hasProgress
        ? formatProgress(completedValue, totalValue)
        : null;

      let line = `${colorize(statusColor, icon)} ${accentJobId(crawl.id)} `;
      if (isFailed) {
        line += `${colorize(statusColor, 'error')} ${fmt.dim(`(${crawlError ?? 'Unknown error'})`)}`;
      } else if (progress) {
        line += `${colorize(statusColor, status)} ${accentProgressText(progress)}`;
      } else {
        line += `${colorize(statusColor, status)}`;
      }
      if (isStaleScraping) {
        line += ` ${colorize(colors.warning, '[stale: reached total but not completed]')}`;
      }
      if (displayUrl) {
        line += ` ${fmt.dim(displayUrl)}`;
      }
      return {
        crawl,
        line,
        isFailed,
        isCompleted,
        isStaleScraping,
      };
    });

    const failedCrawls = crawlRows.filter((row) => row.isFailed);
    const completedCrawls = crawlRows.filter((row) => row.isCompleted);
    const pendingCrawls = crawlRows.filter(
      (row) => !row.isFailed && !row.isCompleted
    );
    const staleCrawls = pendingCrawls.filter((row) => row.isStaleScraping);

    console.log(`  ${colorize(colors.primary, 'Failed crawls:')}`);
    if (failedCrawls.length === 0) {
      console.log(fmt.dim('    No failed crawl jobs.'));
    } else {
      for (const row of failedCrawls) {
        console.log(`    ${row.line}`);
      }
    }

    console.log(`  ${colorize(colors.primary, 'Pending crawls:')}`);
    if (pendingCrawls.length === 0) {
      console.log(fmt.dim('    No pending crawl jobs.'));
    } else {
      for (const row of pendingCrawls) {
        console.log(`    ${row.line}`);
      }
    }

    if (staleCrawls.length > 0) {
      console.log(`  ${colorize(colors.warning, 'Stale pending crawls:')}`);
      for (const row of staleCrawls) {
        console.log(`    ${row.line}`);
      }
    }

    console.log(`  ${colorize(colors.primary, 'Completed crawls:')}`);
    if (completedCrawls.length === 0) {
      console.log(fmt.dim('    No completed crawl jobs.'));
    } else {
      for (const row of completedCrawls) {
        console.log(`    ${row.line}`);
      }
    }
  } else {
    console.log('');
    console.log(statusHeading('Crawl Status'));
    console.log(fmt.dim('  No recent crawl job IDs found.'));
  }
}

/**
 * Renders the batch scrape status section.
 *
 * @param data - Job status data containing batch job results
 */
function renderBatchSection(
  data: Awaited<ReturnType<typeof executeJobStatus>>
): void {
  console.log('');
  console.log(statusHeading('Batch Status'));
  if (data.batches.length === 0) {
    console.log(fmt.dim('  No recent batch job IDs found.'));
  } else {
    for (const batch of data.batches) {
      const batchError = (batch as { error?: string }).error;
      const icon = getStatusIcon(batch.status ?? 'unknown', !!batchError);
      const statusColor = getStatusColor(
        batch.status ?? 'unknown',
        !!batchError
      );

      if (batchError) {
        console.log(
          `  ${colorize(statusColor, icon)} ${accentJobId(batch.id)} ${colorize(statusColor, 'error')} ${fmt.dim(`(${batchError})`)}`
        );
      } else if ('completed' in batch && 'total' in batch) {
        const progress = formatProgress(
          batch.completed as number,
          batch.total as number
        );
        console.log(
          `  ${colorize(statusColor, icon)} ${accentJobId(batch.id)} ${colorize(statusColor, batch.status)} ${accentProgressText(progress)}`
        );
      } else {
        console.log(
          `  ${colorize(statusColor, icon)} ${accentJobId(batch.id)} ${colorize(statusColor, batch.status ?? 'unknown')}`
        );
      }
    }
  }
}

/**
 * Renders the extract job status section.
 *
 * @param data - Job status data containing extract job results
 */
function renderExtractSection(
  data: Awaited<ReturnType<typeof executeJobStatus>>
): void {
  console.log('');
  console.log(statusHeading('Extract Status'));
  if (data.extracts.length === 0) {
    console.log(fmt.dim('  No recent extract job IDs found.'));
  } else {
    for (const extract of data.extracts) {
      const extractError = (extract as { error?: string }).error;
      const extractId = extract.id ?? 'unknown';
      const icon = getStatusIcon(extract.status ?? 'unknown', !!extractError);
      const statusColor = getStatusColor(
        extract.status ?? 'unknown',
        !!extractError
      );

      if (extractError) {
        console.log(
          `  ${colorize(statusColor, icon)} ${accentJobId(extractId)} ${colorize(statusColor, 'error')} ${fmt.dim(`(${extractError})`)}`
        );
      } else {
        console.log(
          `  ${colorize(statusColor, icon)} ${accentJobId(extractId)} ${colorize(statusColor, extract.status ?? 'unknown')}`
        );
      }
    }
  }
}

/**
 * Renders the embedding status section including summary and job details.
 *
 * @param data - Job status data containing embedding job results
 * @param crawlUrlById - Map of crawl IDs to their URLs for display
 * @param crawlDataById - Map of crawl IDs to their progress data
 */
function renderEmbeddingSection(
  data: Awaited<ReturnType<typeof executeJobStatus>>,
  crawlUrlById: Map<string, string>,
  crawlDataById: Map<
    string,
    { status: string; completed: number; total: number }
  >
): void {
  console.log('');
  console.log(statusHeading('Embeddings'));
  const summary = data.embeddings.summary;
  const total =
    summary.pending + summary.processing + summary.completed + summary.failed;
  if (total === 0) {
    console.log(fmt.dim('  No embedding jobs found.'));
  } else {
    const stats = [
      `${colorize(colors.warning, icons.processing)} pending ${summary.pending}`,
      `${colorize(colors.info, icons.processing)} processing ${summary.processing}`,
      `${colorize(colors.success, icons.success)} completed ${summary.completed}`,
      `${colorize(colors.error, icons.error)} failed ${summary.failed}`,
    ];
    console.log(`  ${stats.join(' | ')}`);
  }

  if (data.embeddings.job) {
    const job = data.embeddings.job;
    const statusColor = getStatusColor(job.status);
    const icon = getStatusIcon(job.status);
    console.log(
      `  ${colorize(statusColor, icon)} job ${accentJobId(job.jobId)} ${colorize(statusColor, job.status)} ${fmt.dim(`(retries ${job.retries}/${job.maxRetries})`)}`
    );
    if (job.lastError) {
      console.log(
        `  ${colorize(colors.error, `last error: ${job.lastError}`)}`
      );
    }
  }

  console.log(`  ${colorize(colors.primary, 'Failed embeds:')}`);
  if (data.embeddings.failed.length === 0) {
    console.log(fmt.dim('    No failed embedding jobs.'));
  } else {
    for (const job of data.embeddings.failed) {
      const displayUrl = crawlUrlById.get(job.jobId) ?? job.url;
      const context = getEmbedContext(
        {
          jobId: job.jobId,
          status: 'failed',
          retries: job.retries,
          maxRetries: job.maxRetries,
          totalDocuments: job.totalDocuments,
          processedDocuments: job.processedDocuments,
          failedDocuments: job.failedDocuments,
        },
        undefined
      );

      let line = `    ${colorize(colors.error, icons.error)} ${accentJobId(job.jobId)} ${context.message}`;
      if (context.metadata) {
        line += ` ${fmt.dim(`(${context.metadata})`)}`;
      }
      line += ` ${fmt.dim(displayUrl)}`;

      if (job.lastError) {
        console.log(line);
        console.log(`      ${colorize(colors.error, `└─ ${job.lastError}`)}`);
      } else {
        console.log(line);
      }
    }
  }

  console.log(`  ${colorize(colors.primary, 'Pending embeds:')}`);
  if (data.embeddings.pending.length === 0) {
    console.log(fmt.dim('    No pending embedding jobs.'));
  } else {
    for (const job of data.embeddings.pending) {
      const displayUrl = crawlUrlById.get(job.jobId) ?? job.url;
      const crawlData = crawlDataById.get(job.jobId);
      const context = getEmbedContext(
        {
          jobId: job.jobId,
          status: 'pending',
          retries: job.retries,
          maxRetries: job.maxRetries,
          totalDocuments: job.totalDocuments,
          processedDocuments: job.processedDocuments,
          failedDocuments: job.failedDocuments,
        },
        crawlData
      );

      let line = `    ${colorize(colors.warning, icons.processing)} ${accentJobId(job.jobId)} ${context.message}`;
      if (context.metadata) {
        line += ` ${fmt.dim(`(${context.metadata})`)}`;
      }
      line += ` ${fmt.dim(displayUrl)}`;
      console.log(line);
    }
  }

  console.log(`  ${colorize(colors.primary, 'Completed embeds:')}`);
  if (data.embeddings.completed.length === 0) {
    console.log(fmt.dim('    No completed embedding jobs.'));
  } else {
    for (const job of data.embeddings.completed) {
      const displayUrl = crawlUrlById.get(job.jobId) ?? job.url;
      const context = getEmbedContext(
        {
          jobId: job.jobId,
          status: 'completed',
          retries: 0,
          maxRetries: job.maxRetries,
          totalDocuments: job.totalDocuments,
          processedDocuments: job.processedDocuments,
          failedDocuments: job.failedDocuments,
        },
        undefined
      );
      console.log(
        `    ${colorize(colors.success, icons.success)} ${accentJobId(job.jobId)} ${context.message} ${fmt.dim(displayUrl)}`
      );
    }
  }
  console.log('');
}

/**
 * Renders the complete job status in human-readable format.
 * Delegates to specialized rendering functions for each section.
 *
 * @param data - Job status data from executeJobStatus
 */
function renderHumanStatus(data: Awaited<ReturnType<typeof executeJobStatus>>) {
  // Build URL mapping for all crawls (used throughout the function)
  const activeUrlById = new Map(
    data.activeCrawls.crawls.map((crawl) => [crawl.id, crawl.url])
  );
  const crawlUrlById = new Map(activeUrlById);
  for (const crawl of data.crawls) {
    const maybeData = (
      crawl as {
        data?: Array<{ metadata?: { sourceURL?: string; url?: string } }>;
      }
    ).data;
    const sourceUrl = Array.isArray(maybeData)
      ? (maybeData[0]?.metadata?.sourceURL ?? maybeData[0]?.metadata?.url)
      : undefined;
    if (sourceUrl && crawl.id) {
      crawlUrlById.set(crawl.id, sourceUrl);
    }
  }

  // Build lookup for crawl progress data
  const crawlDataById = new Map<
    string,
    { status: string; completed: number; total: number }
  >();
  for (const crawl of data.crawls) {
    if (
      crawl.id &&
      'completed' in crawl &&
      'total' in crawl &&
      crawl.status &&
      typeof crawl.completed === 'number' &&
      typeof crawl.total === 'number'
    ) {
      crawlDataById.set(crawl.id, {
        status: crawl.status,
        completed: crawl.completed,
        total: crawl.total,
      });
    }
  }

  // Render sections
  renderActiveCrawlsSection(data);
  renderCrawlStatusSection(data, crawlUrlById);
  renderBatchSection(data);
  renderExtractSection(data);
  renderEmbeddingSection(data, crawlUrlById, crawlDataById);
}

export async function handleJobStatusCommand(
  container: IContainer,
  options: JobStatusOptions
): Promise<void> {
  try {
    const data = await executeJobStatus(container, options);
    const wantsJson = options.json || options.pretty || options.output;
    if (!wantsJson) {
      renderHumanStatus(data);
      return;
    }

    const { embeddings, ...rest } = data;
    const { completed: _completed, ...embeddingsWithoutCompleted } = embeddings;
    const outputContent = formatJson(
      {
        success: true,
        data: {
          ...rest,
          embeddings: embeddingsWithoutCompleted,
        },
      },
      options.pretty ?? false
    );
    writeCommandOutput(outputContent, options);
  } catch (error) {
    console.error(
      fmt.error(error instanceof Error ? error.message : String(error))
    );
    process.exit(1);
  }
}

/**
 * UX Pattern Note:
 * Actions on resources should use subcommands (e.g., `firecrawl embed cancel <id>`)
 * rather than option flags (e.g., `--cancel-embed <id>`). This provides:
 * - Better discoverability via help text
 * - Clearer intent and semantics
 * - Follows standard CLI patterns (resource action target)
 * - Avoids cluttering status/info commands with action flags
 */
export function createStatusCommand(): Command {
  const statusCmd = new Command('status')
    .description('Show active jobs and embedding queue status')
    .option('-k, --api-key <key>', 'Firecrawl API key override')
    .option('--clear', 'Clear job history cache', false)
    .option('--json', 'Output JSON (compact)', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .action(async (options, command: Command) => {
      const container = requireContainer(command);

      if (options.clear) {
        await clearJobHistory();
        console.log('');
        console.log(`  ${fmt.success(icons.success)} Job history cleared`);
        console.log('');
        return;
      }

      await handleJobStatusCommand(container, {
        apiKey: options.apiKey,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
      });
    });

  return statusCmd;
}
