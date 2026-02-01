/**
 * Status command implementation
 * Displays CLI version, auth status, and API URL
 * Also supports job status inspection via `firecrawl status`
 */

import { Command } from 'commander';
import packageJson from '../../package.json';
import type { IContainer } from '../container/types';
import { isAuthenticated } from '../utils/auth';
import { formatJson } from '../utils/command';
import { DEFAULT_API_URL, getConfig } from '../utils/config';
import { loadCredentials } from '../utils/credentials';
import {
  getEmbedJob,
  listEmbedJobs,
  removeEmbedJob,
  updateEmbedJob,
} from '../utils/embed-queue';
import { isJobId } from '../utils/job';
import { getRecentJobIds, removeJobIds } from '../utils/job-history';
import { writeOutput } from '../utils/output';

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
  cancelEmbed?: string;
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
export function getStatus(): StatusResult {
  const authSource = getAuthSource();
  const config = getConfig();

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
export async function handleStatusCommand(): Promise<void> {
  const orange = '\x1b[38;5;208m';
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  const bold = '\x1b[1m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';

  const status = getStatus();

  // Header
  console.log('');
  console.log(
    `  ${orange}🔥 ${bold}firecrawl${reset} ${dim}cli${reset} ${dim}v${status.version}${reset}`
  );
  console.log('');

  // Auth status with source
  if (status.authenticated) {
    const sourceLabel =
      status.authSource === 'env'
        ? 'via FIRECRAWL_API_KEY'
        : 'via stored credentials';
    console.log(
      `  ${green}●${reset} Authenticated ${dim}${sourceLabel}${reset}`
    );
  } else {
    console.log(`  ${red}●${reset} Not authenticated`);
    console.log(`  ${dim}Run 'firecrawl login' to authenticate${reset}`);
    console.log('');
    return;
  }

  // API URL
  console.log(`  ${dim}API URL:${reset} ${status.apiUrl}`);
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

function summarizeEmbedQueue(): { summary: EmbedQueueSummary; jobs: any[] } {
  const jobs = listEmbedJobs();
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

async function executeJobStatus(
  container: IContainer,
  options: JobStatusOptions
) {
  const client = container.getFirecrawlClient();
  const embedQueue = summarizeEmbedQueue();
  const crawlIds = parseIds(options.crawl);
  const batchIds = parseIds(options.batch);
  const extractIds = parseIds(options.extract);
  const embedJobIds = embedQueue.jobs.map((job) => job.jobId);

  const resolvedCrawlIds = filterValidJobIds(
    crawlIds.length > 0
      ? crawlIds
      : Array.from(new Set([...getRecentJobIds('crawl'), ...embedJobIds]))
  );
  const resolvedBatchIds = filterValidJobIds(
    batchIds.length > 0 ? batchIds : getRecentJobIds('batch')
  );
  const resolvedExtractIds = filterValidJobIds(
    extractIds.length > 0 ? extractIds : getRecentJobIds('extract')
  );

  const activeCrawlsPromise = client.getActiveCrawls();
  const crawlStatusesPromise = Promise.all(
    resolvedCrawlIds.map(async (id) => {
      try {
        return await client.getCrawlStatus(id);
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
        return await client.getBatchScrapeStatus(id);
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
        return await client.getExtractStatus(id);
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

  removeJobIds('crawl', crawlPruneIds);
  removeJobIds('batch', batchPruneIds);
  removeJobIds('extract', extractPruneIds);

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
      updateEmbedJob(job);
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
      lastError: job.lastError,
      updatedAt: job.updatedAt,
    }));
  const pendingEmbeds = embedQueue.jobs
    .filter((job) => job.status === 'pending')
    .map((job) => ({
      jobId: job.jobId,
      url: job.url,
      retries: job.retries,
      maxRetries: job.maxRetries,
      updatedAt: job.updatedAt,
    }));

  return {
    activeCrawls,
    crawls: crawlStatuses,
    batches: batchStatuses,
    extracts: extractStatuses,
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
    },
  };
}

function renderHumanStatus(data: Awaited<ReturnType<typeof executeJobStatus>>) {
  console.log('');
  console.log('Crawls');
  if (data.activeCrawls.crawls.length === 0) {
    console.log('  No active crawls.');
  } else {
    for (const crawl of data.activeCrawls.crawls) {
      console.log(`  ${crawl.id} ${crawl.url}`);
    }
  }

  if (data.crawls.length > 0) {
    console.log('');
    console.log('Crawl Status');
    const activeUrlById = new Map(
      data.activeCrawls.crawls.map((crawl) => [crawl.id, crawl.url])
    );
    for (const crawl of data.crawls) {
      const crawlError = (crawl as { error?: string }).error;
      const crawlData = (
        crawl as {
          data?: Array<{ metadata?: { sourceURL?: string; url?: string } }>;
        }
      ).data;
      const sourceUrl = Array.isArray(crawlData)
        ? (crawlData[0]?.metadata?.sourceURL ?? crawlData[0]?.metadata?.url)
        : undefined;
      const displayUrl = sourceUrl ?? activeUrlById.get(crawl.id);
      if (crawlError) {
        const suffix = displayUrl ? ` ${displayUrl}` : '';
        console.log(`  ${crawl.id}: error (${crawlError})${suffix}`);
      } else if ('completed' in crawl && 'total' in crawl) {
        console.log(
          `  ${crawl.id}: ${crawl.status} (${crawl.completed}/${crawl.total})${displayUrl ? ` ${displayUrl}` : ''}`
        );
      } else {
        console.log(
          `  ${crawl.id}: ${crawl.status}${displayUrl ? ` ${displayUrl}` : ''}`
        );
      }
    }
  } else if (data.resolvedIds.crawls.length === 0) {
    console.log('');
    console.log('Crawl Status');
    console.log('  No recent crawl job IDs found.');
  }

  console.log('');
  console.log('Batch Status');
  if (data.batches.length === 0) {
    console.log('  No recent batch job IDs found.');
  } else {
    for (const batch of data.batches) {
      const batchError = (batch as { error?: string }).error;
      if (batchError) {
        console.log(`  ${batch.id}: error (${batchError})`);
      } else if ('completed' in batch && 'total' in batch) {
        console.log(
          `  ${batch.id}: ${batch.status} (${batch.completed}/${batch.total})`
        );
      } else {
        console.log(`  ${batch.id}: ${batch.status}`);
      }
    }
  }

  console.log('');
  console.log('Extract Status');
  if (data.extracts.length === 0) {
    console.log('  No recent extract job IDs found.');
  } else {
    for (const extract of data.extracts) {
      const extractError = (extract as { error?: string }).error;
      if (extractError) {
        console.log(`  ${extract.id}: error (${extractError})`);
      } else {
        console.log(`  ${extract.id}: ${extract.status ?? 'unknown'}`);
      }
    }
  }

  console.log('');
  console.log('Embeddings');
  const summary = data.embeddings.summary;
  const total =
    summary.pending + summary.processing + summary.completed + summary.failed;
  if (total === 0) {
    console.log('  No embedding jobs found.');
  } else {
    console.log(
      `  pending ${summary.pending} | processing ${summary.processing} | completed ${summary.completed} | failed ${summary.failed}`
    );
  }

  if (data.embeddings.job) {
    const job = data.embeddings.job;
    console.log(
      `  job ${job.jobId}: ${job.status} (retries ${job.retries}/${job.maxRetries})`
    );
    if (job.lastError) {
      console.log(`  last error: ${job.lastError}`);
    }
  }

  console.log('  Failed embeds:');
  if (data.embeddings.failed.length === 0) {
    console.log('    No failed embedding jobs.');
  } else {
    for (const job of data.embeddings.failed) {
      console.log(`    ${job.jobId}: ${job.lastError ?? 'Unknown error'}`);
    }
  }

  console.log('  Pending embeds:');
  if (data.embeddings.pending.length === 0) {
    console.log('    No pending embedding jobs.');
  } else {
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
    for (const job of data.embeddings.pending) {
      const displayUrl = crawlUrlById.get(job.jobId) ?? job.url;
      console.log(
        `    ${job.jobId} (${job.retries}/${job.maxRetries}) ${displayUrl}`
      );
    }
  }
  console.log('');
}

export async function handleJobStatusCommand(
  container: IContainer,
  options: JobStatusOptions
): Promise<void> {
  try {
    let cancelledEmbedJobId: string | undefined;
    let cancelledEmbedJobFound: boolean | undefined;
    if (options.cancelEmbed) {
      const existing = getEmbedJob(options.cancelEmbed);
      cancelledEmbedJobId = options.cancelEmbed;
      cancelledEmbedJobFound = Boolean(existing);
      if (existing) {
        removeEmbedJob(options.cancelEmbed);
      }
    }

    const data = await executeJobStatus(container, options);
    const wantsJson = options.json || options.pretty || options.output;
    if (!wantsJson) {
      if (cancelledEmbedJobId) {
        if (cancelledEmbedJobFound) {
          console.log(`\nCancelled embed job ${cancelledEmbedJobId}\n`);
        } else {
          console.log(`\nEmbed job ${cancelledEmbedJobId} not found\n`);
        }
      }
      renderHumanStatus(data);
      return;
    }

    const outputContent = formatJson(
      {
        success: true,
        data,
        cancelledEmbedJobId,
        cancelledEmbedJobFound,
      },
      options.pretty ?? false
    );
    writeOutput(outputContent, options.output, !!options.output);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

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
    .option('--cancel-embed <job-id>', 'Cancel a pending embedding job')
    .option('--json', 'Output JSON (compact)', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .action(async (options, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      await handleJobStatusCommand(container, {
        apiKey: options.apiKey,
        crawl: options.crawl,
        batch: options.batch,
        extract: options.extract,
        embed: options.embed,
        cancelEmbed: options.cancelEmbed,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
      });
    });

  return statusCmd;
}
