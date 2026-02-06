/**
 * Status command implementation
 * Displays CLI version, auth status, and API URL
 * Also supports job status inspection via `firecrawl status`
 */

import { Command } from 'commander';
import packageJson from '../../package.json';
import type { IContainer, ImmutableConfig } from '../container/types';
import { isAuthenticated } from '../utils/auth';
import { formatJson } from '../utils/command';
import { DEFAULT_API_URL } from '../utils/config';
import { loadCredentials } from '../utils/credentials';
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
import { writeOutput } from '../utils/output';
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

type AuthSource = 'env' | 'stored' | 'none';

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

/**
 * Detect how the user is authenticated
 */
function getAuthSource(): AuthSource {
  if (process.env.FIRECRAWL_API_KEY) {
    return 'env';
  }
  const stored = loadCredentials();
  if (stored?.apiKey) {
    return 'stored';
  }
  return 'none';
}

/**
 * Get status information
 */
export function getStatus(config: ImmutableConfig): StatusResult {
  const authSource = getAuthSource();

  return {
    version: packageJson.version,
    authenticated: isAuthenticated(),
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
      status.authSource === 'env'
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
  console.log(`  ${fmt.dim('API URL:')} ${status.apiUrl}`);
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
  },
  crawlData?: {
    status: string;
    completed: number;
    total: number;
  }
): EmbedContext {
  const { status, retries, maxRetries } = embedJob;

  if (status === 'processing') {
    return { message: 'Embedding in progress...' };
  }

  if (status === 'completed') {
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

  const STATUS_TIMEOUT_MS = 10000; // 10 second timeout per API call

  const activeCrawlsPromise = withTimeout(
    client.getActiveCrawls(),
    STATUS_TIMEOUT_MS,
    'getActiveCrawls timed out'
  ).catch(() => ({ success: false, crawls: [] }));

  // Disable auto-pagination for status checks - we only need summary, not all data
  const noPagination = { autoPaginate: false };

  const crawlStatusesPromise = Promise.all(
    resolvedCrawlIds.map(async (id) => {
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
    resolvedBatchIds.map(async (id) => {
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
    resolvedExtractIds.map(async (id) => {
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

  const crawlPruneIds = crawlStatuses
    .filter((status) => shouldPruneError((status as { error?: string }).error))
    .map((status) => status.id)
    .filter((id): id is string => Boolean(id));
  const batchPruneIds = batchStatuses
    .filter((status) => shouldPruneError((status as { error?: string }).error))
    .map((status) => status.id)
    .filter((id): id is string => Boolean(id));
  const extractPruneIds = extractStatuses
    .filter((status) => shouldPruneError((status as { error?: string }).error))
    .map((status) => status.id)
    .filter((id): id is string => Boolean(id));

  await removeJobIds('crawl', crawlPruneIds);
  await removeJobIds('batch', batchPruneIds);
  await removeJobIds('extract', extractPruneIds);

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

  for (const job of embedQueue.jobs) {
    const sourceUrl = crawlSourceById.get(job.jobId);
    if (sourceUrl && job.url.includes('/v2/crawl/')) {
      job.url = sourceUrl;
      await updateEmbedJob(job);
    }
  }

  const embedJobId = typeof options.embed === 'string' ? options.embed : null;
  const embedJob = embedJobId
    ? embedQueue.jobs.find((job) => job.jobId === embedJobId)
    : null;
  const failedEmbeds = embedQueue.jobs
    .filter((job) => job.status === 'failed')
    .map((job) => ({
      jobId: job.jobId,
      url: job.url,
      retries: job.retries,
      maxRetries: job.maxRetries,
      lastError: job.lastError,
      updatedAt: job.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10);
  const pendingEmbeds = embedQueue.jobs
    .filter((job) => job.status === 'pending')
    .map((job) => ({
      jobId: job.jobId,
      url: job.url,
      retries: job.retries,
      maxRetries: job.maxRetries,
      updatedAt: job.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10);
  const completedEmbeds = embedQueue.jobs
    .filter((job) => job.status === 'completed')
    .map((job) => ({
      jobId: job.jobId,
      url: job.url,
      maxRetries: job.maxRetries,
      updatedAt: job.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10);

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
    activeCrawls,
    crawls: sortedCrawls,
    batches: sortedBatches,
    extracts: sortedExtracts,
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
  console.log(fmt.bold('Crawls'));
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
    console.log(fmt.bold('Crawl Status'));
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
      const icon = getStatusIcon(status, isFailed);
      const statusColor = getStatusColor(status, isFailed);
      const progress =
        'completed' in crawl && 'total' in crawl
          ? formatProgress(crawl.completed as number, crawl.total as number)
          : null;

      let line = `${colorize(statusColor, icon)} ${crawl.id} `;
      if (isFailed) {
        line += `${colorize(statusColor, 'error')} ${fmt.dim(`(${crawlError ?? 'Unknown error'})`)}`;
      } else if (progress) {
        line += `${colorize(statusColor, status)} ${progress}`;
      } else {
        line += `${colorize(statusColor, status)}`;
      }
      if (displayUrl) {
        line += ` ${fmt.dim(displayUrl)}`;
      }
      return {
        crawl,
        line,
        isFailed,
        isCompleted,
      };
    });

    const failedCrawls = crawlRows.filter((row) => row.isFailed);
    const completedCrawls = crawlRows.filter((row) => row.isCompleted);
    const pendingCrawls = crawlRows.filter(
      (row) => !row.isFailed && !row.isCompleted
    );

    console.log(`  ${fmt.dim('Failed crawls:')}`);
    if (failedCrawls.length === 0) {
      console.log(fmt.dim('    No failed crawl jobs.'));
    } else {
      for (const row of failedCrawls) {
        console.log(`    ${row.line}`);
      }
    }

    console.log(`  ${fmt.dim('Pending crawls:')}`);
    if (pendingCrawls.length === 0) {
      console.log(fmt.dim('    No pending crawl jobs.'));
    } else {
      for (const row of pendingCrawls) {
        console.log(`    ${row.line}`);
      }
    }

    console.log(`  ${fmt.dim('Completed crawls:')}`);
    if (completedCrawls.length === 0) {
      console.log(fmt.dim('    No completed crawl jobs.'));
    } else {
      for (const row of completedCrawls) {
        console.log(`    ${row.line}`);
      }
    }
  } else {
    console.log('');
    console.log(fmt.bold('Crawl Status'));
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
  console.log(fmt.bold('Batch Status'));
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
          `  ${colorize(statusColor, icon)} ${batch.id} ${colorize(statusColor, 'error')} ${fmt.dim(`(${batchError})`)}`
        );
      } else if ('completed' in batch && 'total' in batch) {
        const progress = formatProgress(
          batch.completed as number,
          batch.total as number
        );
        console.log(
          `  ${colorize(statusColor, icon)} ${batch.id} ${colorize(statusColor, batch.status)} ${progress}`
        );
      } else {
        console.log(
          `  ${colorize(statusColor, icon)} ${batch.id} ${colorize(statusColor, batch.status ?? 'unknown')}`
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
  console.log(fmt.bold('Extract Status'));
  if (data.extracts.length === 0) {
    console.log(fmt.dim('  No recent extract job IDs found.'));
  } else {
    for (const extract of data.extracts) {
      const extractError = (extract as { error?: string }).error;
      const icon = getStatusIcon(extract.status ?? 'unknown', !!extractError);
      const statusColor = getStatusColor(
        extract.status ?? 'unknown',
        !!extractError
      );

      if (extractError) {
        console.log(
          `  ${colorize(statusColor, icon)} ${extract.id} ${colorize(statusColor, 'error')} ${fmt.dim(`(${extractError})`)}`
        );
      } else {
        console.log(
          `  ${colorize(statusColor, icon)} ${extract.id} ${colorize(statusColor, extract.status ?? 'unknown')}`
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
  console.log(fmt.bold('Embeddings'));
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
      `  ${colorize(statusColor, icon)} job ${job.jobId} ${colorize(statusColor, job.status)} ${fmt.dim(`(retries ${job.retries}/${job.maxRetries})`)}`
    );
    if (job.lastError) {
      console.log(
        `  ${colorize(colors.error, `last error: ${job.lastError}`)}`
      );
    }
  }

  console.log(`  ${fmt.dim('Failed embeds:')}`);
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
        },
        undefined
      );

      let line = `    ${colorize(colors.error, icons.error)} ${job.jobId} ${context.message}`;
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

  console.log(`  ${fmt.dim('Pending embeds:')}`);
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
        },
        crawlData
      );

      let line = `    ${colorize(colors.warning, icons.processing)} ${job.jobId} ${context.message}`;
      if (context.metadata) {
        line += ` ${fmt.dim(`(${context.metadata})`)}`;
      }
      line += ` ${fmt.dim(displayUrl)}`;
      console.log(line);
    }
  }

  console.log(`  ${fmt.dim('Completed embeds:')}`);
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
        },
        undefined
      );
      console.log(
        `    ${colorize(colors.success, icons.success)} ${job.jobId} ${context.message} ${fmt.dim(displayUrl)}`
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
    writeOutput(outputContent, options.output, !!options.output);
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
    .option('--crawl <job-ids>', 'Comma-separated crawl job IDs to check')
    .option('--batch <job-ids>', 'Comma-separated batch job IDs to check')
    .option('--extract <job-ids>', 'Comma-separated extract job IDs to check')
    .option(
      '--embed [job-id]',
      'Show embedding queue status (optionally for job ID)'
    )
    .option('--clear', 'Clear job history cache', false)
    .option('--json', 'Output JSON (compact)', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .action(async (options, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      if (options.clear) {
        await clearJobHistory();
        console.log('');
        console.log(`  ${fmt.success(icons.success)} Job history cleared`);
        console.log('');
        return;
      }

      await handleJobStatusCommand(container, {
        apiKey: options.apiKey,
        crawl: options.crawl,
        batch: options.batch,
        extract: options.extract,
        embed: options.embed,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
      });
    });

  return statusCmd;
}
