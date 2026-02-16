/**
 * CLI command definition for crawl
 */

import type { MapOptions as SdkMapOptions } from '@mendable/firecrawl-js';
import { Command } from 'commander';
import type { IContainer } from '../../container/types';
import type {
  CrawlOptions,
  CrawlResult,
  CrawlStatusResult,
} from '../../types/crawl';
import { formatJson, writeCommandOutput } from '../../utils/command';
import {
  type CrawlBaselineEntry,
  getCrawlBaseline,
  markSitemapRetry,
  recordCrawlBaseline,
} from '../../utils/crawl-baselines';
import { displayCommandInfo } from '../../utils/display';
import { isJobId, normalizeJobId } from '../../utils/job';
import { recordJob } from '../../utils/job-history';
import { getSettings } from '../../utils/settings';
import {
  buildFiltersEcho,
  CANONICAL_EMPTY_STATE,
  formatHeaderBlock,
} from '../../utils/style-output';
import { fmt, icons } from '../../utils/theme';
import { normalizeUrl } from '../../utils/url';
import { requireContainer, requireContainerFromCommandTree } from '../shared';
import {
  handleAsyncEmbedding,
  handleManualEmbedding,
  handleSyncEmbedding,
} from './embed';
import { executeCrawl } from './execute';
import { formatCrawlStatus } from './format';
import {
  checkCrawlStatus,
  executeCrawlCancel,
  executeCrawlCleanup,
  executeCrawlClear,
  executeCrawlErrors,
} from './status';

/**
 * Type guard to check if result data is a status-only result
 *
 * @param data - Result data to check
 * @returns True if data is status-only (has neither jobId nor data array)
 */
function isStatusOnlyResult(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    !('jobId' in data) &&
    !('data' in data) &&
    'status' in data
  );
}

/**
 * Handle subcommand result with standard error handling and output formatting
 */
async function handleSubcommandResult<T>(
  result: { success: boolean; error?: string; data?: T },
  options: { output?: string; pretty?: boolean },
  formatOutput: (data: T) => string
): Promise<void> {
  if (!result.success) {
    console.error(fmt.error(result.error || 'Unknown error occurred'));
    process.exitCode = 1;
    return;
  }

  if (!result.data) {
    return;
  }

  const outputContent = options.output
    ? formatJson({ success: true, data: result.data }, options.pretty)
    : formatOutput(result.data);
  try {
    await writeCommandOutput(outputContent, options);
  } catch (error) {
    console.error(
      fmt.error(error instanceof Error ? error.message : 'Invalid output path')
    );
    process.exitCode = 1;
  }
}

function formatCrawlStartedResponse(
  data: { jobId: string; status: string; url: string },
  options: CrawlOptions,
  mapPreflightCount?: number
): string {
  const lines = formatHeaderBlock({
    title: `Crawl Job ${data.jobId}`,
    summary: `Status: ${data.status} | URL: ${data.url}`,
    filters: buildFiltersEcho([
      ['maxDepth', options.maxDepth],
      ['limit', options.limit],
      ['allowSubdomains', options.allowSubdomains],
      ['onlyMainContent', options.onlyMainContent],
      ['wait', options.wait],
      ['progress', options.progress],
    ]),
  });

  lines.push(`Job ID: ${data.jobId}`);
  lines.push(`Status: ${data.status}`);
  lines.push(`URL: ${data.url}`);
  if (mapPreflightCount !== undefined) {
    lines.push(`Preflight map URLs: ${mapPreflightCount}`);
  }
  return lines.join('\n');
}

const LOW_DISCOVERY_RATIO = 0.1;

async function runMapPreflight(
  container: IContainer,
  options: CrawlOptions
): Promise<number | undefined> {
  if (!options.urlOrJobId || options.preflightMap === false) {
    return undefined;
  }

  if (isJobId(options.urlOrJobId)) {
    return undefined;
  }

  try {
    const app = container.getAxonClient() as {
      map?: (
        url: string,
        options?: SdkMapOptions
      ) => Promise<{ links?: unknown[] }>;
    };
    if (typeof app.map !== 'function') {
      return undefined;
    }

    const mapOptions: SdkMapOptions = {};
    if (options.limit !== undefined) {
      mapOptions.limit = options.limit;
    }
    if (options.sitemap !== undefined) {
      mapOptions.sitemap = options.sitemap;
    }
    if (options.allowSubdomains !== undefined) {
      mapOptions.includeSubdomains = options.allowSubdomains;
    }
    if (options.ignoreQueryParameters !== undefined) {
      mapOptions.ignoreQueryParameters = options.ignoreQueryParameters;
    }

    const mapped = await app.map(options.urlOrJobId, mapOptions);
    return Array.isArray(mapped.links) ? mapped.links.length : 0;
  } catch (error) {
    console.error(
      fmt.dim(
        `[Guardrail] Map preflight failed, continuing crawl: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    );
    return undefined;
  }
}

function formatDiscoveryGuardrail(
  status: NonNullable<CrawlStatusResult['data']>,
  baseline?: CrawlBaselineEntry,
  autoRetryJobId?: string
): string {
  if (!baseline) {
    return '';
  }

  const lines = [`Preflight map URLs: ${baseline.mapCount}`];
  if (
    status.status === 'completed' &&
    baseline.mapCount > 0 &&
    Number.isFinite(status.total)
  ) {
    const ratio = status.total / baseline.mapCount;
    if (ratio < LOW_DISCOVERY_RATIO) {
      const percent = (ratio * 100).toFixed(1);
      lines.push(
        fmt.warning(
          `Guardrail warning: low discovery (${status.total}/${baseline.mapCount}, ${percent}%).`
        )
      );
      if (autoRetryJobId) {
        lines.push(
          fmt.primary(
            `Auto-recrawl started with sitemap=only. New job: ${autoRetryJobId}`
          )
        );
      } else if (baseline.sitemapRetryJobId) {
        lines.push(
          fmt.dim(
            `Auto-recrawl already started. Retry job: ${baseline.sitemapRetryJobId}`
          )
        );
      } else {
        lines.push(
          fmt.dim(`Try rerun with: axon crawl ${baseline.url} --sitemap only`)
        );
      }
    }
  }

  return lines.length > 0 ? `\n${lines.join('\n')}\n` : '';
}

function isLowDiscovery(
  status: NonNullable<CrawlStatusResult['data']>,
  baseline?: CrawlBaselineEntry
): boolean {
  if (!baseline) return false;
  if (status.status !== 'completed') return false;
  if (!Number.isFinite(status.total)) return false;
  if (baseline.mapCount <= 0) return false;
  return status.total / baseline.mapCount < LOW_DISCOVERY_RATIO;
}

async function maybeAutoRecrawlSitemapOnly(
  container: IContainer,
  status: NonNullable<CrawlStatusResult['data']>,
  baseline?: CrawlBaselineEntry
): Promise<string | undefined> {
  if (!isLowDiscovery(status, baseline)) {
    return undefined;
  }
  if (!baseline) {
    return undefined;
  }
  if (baseline.sitemapRetryJobId) {
    return undefined;
  }

  try {
    const settings = getSettings();
    const app = container.getAxonClient();
    const retryLimit = Math.max(status.total, baseline.mapCount);
    const retry = await app.startCrawl(baseline.url, {
      sitemap: 'only',
      limit: retryLimit > 0 ? retryLimit : undefined,
      maxDiscoveryDepth: settings.crawl.maxDepth,
      ignoreQueryParameters: settings.crawl.ignoreQueryParameters,
      crawlEntireDomain: settings.crawl.crawlEntireDomain,
      allowSubdomains: settings.crawl.allowSubdomains,
      scrapeOptions: {
        onlyMainContent: settings.crawl.onlyMainContent,
        excludeTags: settings.crawl.excludeTags,
      },
    });

    await recordJob('crawl', retry.id);
    await recordCrawlBaseline({
      jobId: retry.id,
      url: baseline.url,
      mapCount: baseline.mapCount,
      createdAt: new Date().toISOString(),
    });
    await markSitemapRetry(status.id, retry.id);

    return retry.id;
  } catch (error) {
    console.error(
      fmt.warning(
        `[Guardrail] Auto-recrawl failed for ${status.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    );
    return undefined;
  }
}

function formatCrawlErrorsHuman(
  data: unknown,
  jobId: string,
  options: { output?: string; pretty?: boolean }
): string {
  if (options.output) {
    return formatJson({ success: true, data }, options.pretty);
  }

  const normalized = Array.isArray(data)
    ? { errors: data, robotsBlocked: [] }
    : (data as {
        errors?: Array<{ url?: string; error?: string; code?: string }>;
        robotsBlocked?: string[];
      });

  const errors = Array.isArray(normalized.errors) ? normalized.errors : [];
  const robotsBlocked = Array.isArray(normalized.robotsBlocked)
    ? normalized.robotsBlocked
    : [];

  const summary = `Errors: ${errors.length} | Robots blocked: ${robotsBlocked.length}`;
  const lines = formatHeaderBlock({
    title: `Crawl Errors for ${jobId}`,
    summary,
    filters: buildFiltersEcho([['jobId', jobId]]),
    includeFreshness: true,
  });

  if (errors.length > 0 && robotsBlocked.length > 0) {
    lines.push('Legend: ✗ crawl error  ⚠ robots blocked');
  }

  type Row = { severity: number; line: string };
  const rows: Row[] = [
    ...errors.map((item) => ({
      severity: 0,
      line: `✗ ${String(item.url ?? '—')} (${String(item.error ?? item.code ?? 'unknown error')})`,
    })),
    ...robotsBlocked.map((url) => ({
      severity: 1,
      line: `⚠ ${url}`,
    })),
  ].sort((a, b) => a.severity - b.severity || a.line.localeCompare(b.line));

  if (rows.length === 0) {
    lines.push(`  ${CANONICAL_EMPTY_STATE}`);
  } else {
    for (const row of rows) {
      lines.push(row.line);
    }
  }

  return `${lines.join('\n')}\n`;
}

function formatCrawlClearHuman(data: {
  clearedHistory: number;
  cancelledActive: number;
}): string {
  const lines = formatHeaderBlock({
    title: 'Crawl Queue Clear',
    summary: `Cleared history: ${data.clearedHistory} | Cancelled active: ${data.cancelledActive}`,
    includeFreshness: true,
  });
  lines.push(`Cleared history: ${data.clearedHistory}`);
  lines.push(`Cancelled active crawls: ${data.cancelledActive}`);
  return lines.join('\n');
}

function formatCrawlCleanupHuman(data: {
  scanned: number;
  removedFailed: number;
  removedStale: number;
  removedNotFound: number;
  skipped: number;
  removedTotal: number;
}): string {
  const lines = formatHeaderBlock({
    title: 'Crawl Queue Cleanup',
    summary: `Scanned: ${data.scanned} | Removed: ${data.removedTotal}`,
    includeFreshness: true,
  });

  const mixedStates =
    data.removedFailed > 0 &&
    (data.removedStale > 0 || data.removedNotFound > 0);
  if (mixedStates) {
    lines.push(
      'Legend: ✗ failed/cancelled  ⚠ stale in-progress  ○ missing job'
    );
  }

  const entries = [
    {
      label: 'Failed/Cancelled removed',
      value: data.removedFailed,
      severity: 0,
    },
    { label: 'Stale removed', value: data.removedStale, severity: 1 },
    { label: 'Not found removed', value: data.removedNotFound, severity: 2 },
    { label: 'Skipped', value: data.skipped, severity: 3 },
  ].sort((a, b) => a.severity - b.severity);

  for (const entry of entries) {
    lines.push(`${entry.label}: ${entry.value}`);
  }

  return lines.join('\n');
}

/**
 * Handle crawl command execution
 *
 * Orchestrates crawl operations including:
 * - Cancel and errors operations
 * - Manual embedding triggers
 * - Crawl execution
 * - Auto-embedding
 * - Output formatting
 *
 * @param container - Dependency injection container
 * @param options - Crawl options
 */
export async function handleCrawlCommand(
  container: IContainer,
  options: CrawlOptions
): Promise<void> {
  if (!options.urlOrJobId) {
    console.error(fmt.error('URL or job ID is required.'));
    process.exitCode = 1;
    return;
  }

  // Handle manual embedding trigger for job ID
  if (options.embed && isJobId(options.urlOrJobId)) {
    await handleManualEmbedding(container, options.urlOrJobId, options.apiKey);
    return;
  }

  // Display command info
  displayCommandInfo('Crawling', options.urlOrJobId, {
    maxDepth: options.maxDepth,
    limit: options.limit,
    allowSubdomains: options.allowSubdomains,
    ignoreQueryParameters: options.ignoreQueryParameters,
    onlyMainContent: options.onlyMainContent,
    excludeTags: options.excludeTags,
    excludePaths: options.excludePaths,
    wait: options.wait,
    progress: options.progress,
    preflightMap: options.preflightMap,
  });

  const mapPreflightCount = await runMapPreflight(container, options);
  if (mapPreflightCount !== undefined) {
    console.error(
      fmt.dim(`[Guardrail] Preflight map found ${mapPreflightCount} URLs.`)
    );
  }

  // Execute crawl
  const result = await executeCrawl(container, options);

  // Handle errors
  if (!result.success) {
    console.error(fmt.error(result.error || 'Unknown error occurred'));
    process.exitCode = 1;
    return;
  }

  // Handle status check result - distinguish by absence of 'jobId' and 'data' properties
  // CrawlStatusData has neither, while CrawlJobStartedData has jobId and CrawlJobData has data array
  if (result.data && isStatusOnlyResult(result.data)) {
    const statusResult = result as CrawlStatusResult;
    if (statusResult.data) {
      const baseline = await getCrawlBaseline(statusResult.data.id);
      const autoRetryJobId = await maybeAutoRecrawlSitemapOnly(
        container,
        statusResult.data,
        options.autoSitemapRetry !== false ? baseline : undefined
      );
      const outputContent =
        options.pretty || !options.output
          ? `${formatCrawlStatus(statusResult.data, {
              filters: [['jobId', statusResult.data.id]],
            })}${formatDiscoveryGuardrail(
              statusResult.data,
              baseline,
              autoRetryJobId
            )}`
          : formatJson(
              { success: true, data: statusResult.data },
              options.pretty
            );
      try {
        await writeCommandOutput(outputContent, options);
      } catch (error) {
        console.error(
          fmt.error(
            error instanceof Error ? error.message : 'Invalid output path'
          )
        );
        process.exitCode = 1;
        return;
      }
      return;
    }
  }

  // Handle crawl result (job ID or completed crawl)
  const crawlResult = result as CrawlResult;
  if (!crawlResult.data) {
    return;
  }

  // Auto-embed crawl results
  if (options.embed !== false && crawlResult.data) {
    if ('jobId' in crawlResult.data) {
      // Async job - enqueue for background processing
      await handleAsyncEmbedding(
        crawlResult.data.jobId,
        options.urlOrJobId ?? crawlResult.data.url,
        container.config,
        options.apiKey,
        options.hardSync
      );
    } else {
      // Synchronous result (--wait or --progress) - embed inline
      await handleSyncEmbedding(container, crawlResult.data, {
        startUrl: options.urlOrJobId,
        hardSync: options.hardSync,
      });
    }
  }

  // Format output
  let outputContent: string;
  if ('jobId' in crawlResult.data) {
    // Job ID response
    await recordJob('crawl', crawlResult.data.jobId);
    if (
      mapPreflightCount !== undefined &&
      options.urlOrJobId &&
      !isJobId(options.urlOrJobId)
    ) {
      await recordCrawlBaseline({
        jobId: crawlResult.data.jobId,
        url: options.urlOrJobId,
        mapCount: mapPreflightCount,
        createdAt: new Date().toISOString(),
      });
    }
    const jobData = {
      jobId: crawlResult.data.jobId,
      url: crawlResult.data.url,
      status: crawlResult.data.status,
    };
    if (options.output) {
      outputContent = formatJson(
        { success: true, data: jobData },
        options.pretty
      );
    } else {
      outputContent = formatCrawlStartedResponse(
        jobData,
        options,
        mapPreflightCount
      );
    }
  } else {
    // Completed crawl - output the data
    if (mapPreflightCount !== undefined && mapPreflightCount > 0) {
      const ratio = crawlResult.data.total / mapPreflightCount;
      if (ratio < LOW_DISCOVERY_RATIO) {
        const percent = (ratio * 100).toFixed(1);
        console.error(
          fmt.warning(
            `[Guardrail] Low discovery: ${crawlResult.data.total}/${mapPreflightCount} (${percent}%).`
          )
        );
        if (options.urlOrJobId && !isJobId(options.urlOrJobId)) {
          console.error(
            fmt.dim(
              `[Guardrail] Try rerun with: axon crawl ${options.urlOrJobId} --sitemap only`
            )
          );
        }
      }
    }
    outputContent = formatJson(crawlResult.data, options.pretty);
  }

  try {
    await writeCommandOutput(outputContent, options);
  } catch (error) {
    console.error(
      fmt.error(error instanceof Error ? error.message : 'Invalid output path')
    );
    process.exitCode = 1;
    return;
  }
}

/**
 * Handle crawl status subcommand
 *
 * @param container - Dependency injection container
 * @param jobId - Crawl job ID
 * @param options - Command options (output, pretty)
 */
async function handleCrawlStatusCommand(
  container: IContainer,
  jobId: string,
  options: {
    output?: string;
    pretty?: boolean;
    autoSitemapRetry?: boolean;
  }
): Promise<void> {
  const result = await checkCrawlStatus(container, jobId);
  const baseline = await getCrawlBaseline(jobId);
  const autoRetryJobId =
    options.autoSitemapRetry !== false && result.success && result.data
      ? await maybeAutoRecrawlSitemapOnly(container, result.data, baseline)
      : undefined;
  await handleSubcommandResult(
    result,
    options,
    (data) =>
      `${formatCrawlStatus(data, { filters: [['jobId', jobId]] })}${formatDiscoveryGuardrail(
        data,
        baseline,
        autoRetryJobId
      )}`
  );
}

/**
 * Handle crawl cancel subcommand
 *
 * @param container - Dependency injection container
 * @param jobId - Crawl job ID
 * @param options - Command options (output, pretty)
 */
async function handleCrawlCancelCommand(
  container: IContainer,
  jobId: string,
  options: { output?: string; pretty?: boolean }
): Promise<void> {
  const result = await executeCrawlCancel(container, jobId);
  await handleSubcommandResult(result, options, (data) =>
    [
      ...formatHeaderBlock({
        title: `Crawl Cancel for ${jobId}`,
        summary: `Status: ${data.status}`,
        filters: buildFiltersEcho([['jobId', jobId]]),
        includeFreshness: true,
      }),
      `Status: ${data.status}`,
    ].join('\n')
  );
}

/**
 * Handle crawl errors subcommand
 *
 * @param container - Dependency injection container
 * @param jobId - Crawl job ID
 * @param options - Command options (output, pretty)
 */
async function handleCrawlErrorsCommand(
  container: IContainer,
  jobId: string,
  options: { output?: string; pretty?: boolean }
): Promise<void> {
  const result = await executeCrawlErrors(container, jobId);
  await handleSubcommandResult(result, options, (data) =>
    formatCrawlErrorsHuman(data, jobId, options)
  );
}

async function handleCrawlClearCommand(
  container: IContainer,
  options: { output?: string; pretty?: boolean; force?: boolean }
): Promise<void> {
  // Safety check: require confirmation unless --force is used
  if (!options.force) {
    // For non-interactive environments (CI, piped stdin/output), require --force flag
    // Check both stdin (for reading input) and stdout (for displaying prompts)
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error(
        fmt.error(
          'Cannot clear queue in non-interactive mode. Use --force to bypass confirmation.'
        )
      );
      process.exitCode = 1;
      return;
    }

    // Interactive TTY: ask for confirmation
    const { askForConfirmation } = await import('../../utils/prompts');
    const confirmed = await askForConfirmation(
      fmt.warning(
        `\n  ${icons.warning}  Are you sure you want to clear the entire crawl queue?\n  This action cannot be undone. (y/N) `
      )
    );

    if (!confirmed) {
      console.log(fmt.dim('  Cancelled.'));
      return;
    }
  }

  const result = await executeCrawlClear(container);
  await handleSubcommandResult(result, options, formatCrawlClearHuman);
}

async function handleCrawlCleanupCommand(
  container: IContainer,
  options: { output?: string; pretty?: boolean }
): Promise<void> {
  const result = await executeCrawlCleanup(container);
  await handleSubcommandResult(result, options, formatCrawlCleanupHuman);
}

/**
 * Create and configure the crawl command
 *
 * @returns Configured Commander.js command
 */
export function createCrawlCommand(): Command {
  const settings = getSettings();

  const crawlCmd = new Command('crawl')
    .description('Crawl a website using Axon')
    .argument('[url]', 'URL to crawl')
    .option(
      '-u, --url <url>',
      'URL to crawl (alternative to positional argument)'
    )
    .option(
      '--wait',
      'Wait for crawl to complete before returning results',
      false
    )
    .option(
      '--poll-interval <seconds>',
      'Polling interval in seconds when waiting (default: 5)',
      parseFloat
    )
    .option(
      '--timeout <seconds>',
      'Timeout in seconds when waiting for crawl job to complete (default: no timeout)',
      parseFloat
    )
    .option('--progress', 'Show progress while waiting (implies --wait)', false)
    .option('--limit <number>', 'Maximum number of pages to crawl', (val) =>
      Number.parseInt(val, 10)
    )
    .option(
      '--max-depth <number>',
      'Maximum crawl depth',
      (value: string) => Number.parseInt(value, 10),
      settings.crawl.maxDepth
    )
    .option(
      '--exclude-paths <paths>',
      'Comma-separated list of paths to exclude'
    )
    .option(
      '--include-paths <paths>',
      'Comma-separated list of paths to include'
    )
    .option(
      '--sitemap <mode>',
      'Sitemap handling: skip, include (default: include)',
      settings.crawl.sitemap
    )
    .option(
      '--ignore-query-parameters',
      'Ignore query parameters when crawling',
      settings.crawl.ignoreQueryParameters
    )
    .option(
      '--no-ignore-query-parameters',
      'Include query parameters when crawling'
    )
    .option(
      '--crawl-entire-domain',
      'Crawl entire domain',
      settings.crawl.crawlEntireDomain
    )
    .option('--allow-external-links', 'Allow external links', false)
    .option(
      '--allow-subdomains',
      'Allow subdomains',
      settings.crawl.allowSubdomains
    )
    .option('--no-allow-subdomains', 'Disallow subdomains')
    .option(
      '--only-main-content',
      'Include only main content when scraping pages',
      settings.crawl.onlyMainContent
    )
    .option('--no-only-main-content', 'Include full page content')
    .option(
      '--exclude-tags <tags>',
      'Comma-separated list of tags to exclude from scraped content',
      settings.crawl.excludeTags.join(',')
    )
    .option(
      '--include-tags <tags>',
      'Comma-separated list of tags to include in scraped content'
    )
    .option('--delay <ms>', 'Delay between requests in milliseconds', (val) =>
      Number.parseInt(val, 10)
    )
    .option(
      '--max-concurrency <number>',
      'Maximum concurrent requests',
      (val) => Number.parseInt(val, 10)
    )
    .option('-k, --api-key <key>', 'API key (overrides global --api-key)')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--pretty', 'Pretty print JSON output', false)
    .option('--embed', 'Manually trigger embedding for a completed crawl job')
    .option('--no-embed', 'Skip auto-embedding of crawl results')
    .option(
      '--no-preflight-map',
      'Skip map preflight before crawl (disables discovery guardrail)'
    )
    .option(
      '--no-auto-sitemap-retry',
      'Disable automatic sitemap=only retry when discovery is unexpectedly low'
    )
    .option(
      '--hard-sync',
      'Immediately delete crawl-missing URLs from Qdrant (bypasses safe reconciliation grace)'
    )
    .option('--no-default-excludes', 'Skip default exclude paths from settings')
    .action(async (positionalUrlOrJobId, options, command: Command) => {
      const container = requireContainer(command);

      // Use positional argument if provided, otherwise use --url option
      const urlOrJobId = positionalUrlOrJobId || options.url;
      if (!urlOrJobId) {
        console.error(
          fmt.error(
            'URL is required. Provide it as argument or use --url option.'
          )
        );
        process.exitCode = 1;
        return;
      }

      // Job IDs are accepted here only for manual embedding.
      if (isJobId(urlOrJobId) && !options.embed) {
        console.error(
          fmt.error(
            'Job IDs are not accepted here. Use "axon crawl status <job-id>" instead.'
          )
        );
        process.exitCode = 1;
        return;
      }

      const crawlOptions = {
        urlOrJobId:
          options.embed && isJobId(urlOrJobId)
            ? urlOrJobId
            : normalizeUrl(urlOrJobId),
        status: false,
        wait: options.wait,
        pollInterval: options.pollInterval,
        timeout: options.timeout,
        progress: options.progress,
        output: options.output,
        pretty: options.pretty,
        apiKey: options.apiKey,
        limit: options.limit,
        maxDepth: options.maxDepth,
        excludePaths: options.excludePaths
          ? options.excludePaths.split(',').map((p: string) => p.trim())
          : undefined,
        includePaths: options.includePaths
          ? options.includePaths.split(',').map((p: string) => p.trim())
          : undefined,
        sitemap: options.sitemap,
        ignoreQueryParameters: options.ignoreQueryParameters,
        crawlEntireDomain: options.crawlEntireDomain,
        allowExternalLinks: options.allowExternalLinks,
        allowSubdomains: options.allowSubdomains,
        delay: options.delay,
        maxConcurrency: options.maxConcurrency,
        embed: options.embed,
        preflightMap: options.preflightMap,
        autoSitemapRetry: options.autoSitemapRetry,
        hardSync: options.hardSync,
        noDefaultExcludes: options.defaultExcludes === false,
        onlyMainContent: options.onlyMainContent,
        excludeTags: options.excludeTags
          ? options.excludeTags.split(',').map((t: string) => t.trim())
          : undefined,
        includeTags: options.includeTags
          ? options.includeTags.split(',').map((t: string) => t.trim())
          : undefined,
      };

      await handleCrawlCommand(container, crawlOptions);
    });

  // Status subcommand
  const statusCmd = new Command('status')
    .description('Check status of a crawl job')
    .argument('<job-id>', 'Crawl job ID or URL containing job ID')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--pretty', 'Pretty print JSON output', false)
    .option(
      '--no-auto-sitemap-retry',
      'Disable automatic sitemap=only retry when discovery is unexpectedly low'
    )
    .action(async (jobId: string, options, command: Command) => {
      const container = requireContainerFromCommandTree(command);
      const normalizedJobId = normalizeJobId(jobId);
      await handleCrawlStatusCommand(container, normalizedJobId, options);
    });

  crawlCmd.addCommand(statusCmd);

  // Cancel subcommand
  const cancelCmd = new Command('cancel')
    .description('Cancel a crawl job')
    .argument('<job-id>', 'Crawl job ID or URL containing job ID')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (jobId: string, options, command: Command) => {
      const container = requireContainerFromCommandTree(command);
      const normalizedJobId = normalizeJobId(jobId);
      await handleCrawlCancelCommand(container, normalizedJobId, options);
    });

  crawlCmd.addCommand(cancelCmd);

  const clearCmd = new Command('clear')
    .description('Clear the entire crawl queue')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--pretty', 'Pretty print JSON output', false)
    .option(
      '--force',
      'Skip confirmation prompt (required for non-interactive environments)',
      false
    )
    .action(async (options, command: Command) => {
      const container = requireContainerFromCommandTree(command);
      await handleCrawlClearCommand(container, options);
    });

  crawlCmd.addCommand(clearCmd);

  const cleanupCmd = new Command('cleanup')
    .description('Cleanup failed and stale/stalled crawl jobs')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (options, command: Command) => {
      const container = requireContainerFromCommandTree(command);
      await handleCrawlCleanupCommand(container, options);
    });

  crawlCmd.addCommand(cleanupCmd);

  // Errors subcommand
  const errorsCmd = new Command('errors')
    .description('Get errors from a crawl job')
    .argument('<job-id>', 'Crawl job ID or URL containing job ID')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (jobId: string, options, command: Command) => {
      const container = requireContainerFromCommandTree(command);
      const normalizedJobId = normalizeJobId(jobId);
      await handleCrawlErrorsCommand(container, normalizedJobId, options);
    });

  crawlCmd.addCommand(errorsCmd);

  return crawlCmd;
}
