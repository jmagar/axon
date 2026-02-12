/**
 * Batch scrape command implementation
 */

import { Command } from 'commander';
import type { IContainer } from '../container/types';
import type { BatchOptions } from '../types/batch';
import {
  type CommandResult,
  formatJson,
  handleCommandError,
  shouldOutputJson,
  writeCommandOutput,
} from '../utils/command';
import { recordJob } from '../utils/job-history';
import { parseFormats } from '../utils/options';
import { getSettings } from '../utils/settings';
import { fmt, icons } from '../utils/theme';
import { normalizeUrlArgs, requireContainerFromCommandTree } from './shared';

// Extend Commander's Command type to include our custom _container property
declare module 'commander' {
  interface Command {
    _container?: IContainer;
  }
}

function buildBatchScrapeOptions(options: BatchOptions) {
  const scrapeOptions: Record<string, unknown> = {};

  if (options.format) {
    scrapeOptions.formats = parseFormats(options.format).map((type) => ({
      type,
    }));
  }
  if (options.onlyMainContent !== undefined) {
    scrapeOptions.onlyMainContent = options.onlyMainContent;
  }
  if (options.waitFor !== undefined) {
    scrapeOptions.waitFor = options.waitFor;
  }
  if (options.screenshot) {
    const formats =
      (scrapeOptions.formats as Array<{ type: string }> | undefined) ?? [];
    if (!formats.find((f) => f.type === 'screenshot')) {
      formats.push({ type: 'screenshot' });
    }
    scrapeOptions.formats = formats;
  }
  if (options.includeTags && options.includeTags.length > 0) {
    scrapeOptions.includeTags = options.includeTags;
  }
  if (options.excludeTags && options.excludeTags.length > 0) {
    scrapeOptions.excludeTags = options.excludeTags;
  }

  return {
    options: Object.keys(scrapeOptions).length > 0 ? scrapeOptions : undefined,
    webhook: options.webhook,
    maxConcurrency: options.maxConcurrency,
    ignoreInvalidURLs: options.ignoreInvalidUrls,
    zeroDataRetention: options.zeroDataRetention,
    idempotencyKey: options.idempotencyKey,
    appendToId: options.appendToId,
    integration: options.integration,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function formatBatchSummary(
  title: string,
  details: Array<[string, unknown]>
): string {
  const lines: string[] = [];
  lines.push(`  ${fmt.primary(title)}`);
  for (const [label, value] of details) {
    if (value === undefined || value === null || value === '') continue;
    lines.push(`    ${fmt.dim(`${label}:`)} ${String(value)}`);
  }
  return lines.join('\n');
}

function formatBatchResultHuman(data: unknown): string {
  const record = asRecord(data);
  const completed = record.completed;
  const total = record.total;
  const progress =
    typeof completed === 'number' && typeof total === 'number'
      ? `${completed}/${total}`
      : undefined;

  return formatBatchSummary('Batch job', [
    ['Job ID', record.id],
    ['Status', record.status ?? 'processing'],
    ['Progress', progress],
    ['URL', record.url],
  ]);
}

function formatBatchErrorsHuman(data: unknown): string {
  const record = asRecord(data);
  const errors = Array.isArray(record.errors)
    ? (record.errors as Array<Record<string, unknown>>)
    : [];
  const robotsBlocked = Array.isArray(record.robotsBlocked)
    ? (record.robotsBlocked as string[])
    : [];

  const lines: string[] = [];
  lines.push(`  ${fmt.primary('Batch errors')}`);
  lines.push(`    ${fmt.dim('Errors:')} ${errors.length}`);
  lines.push(`    ${fmt.dim('Robots blocked:')} ${robotsBlocked.length}`);

  if (errors.length > 0) {
    for (const err of errors) {
      lines.push(
        `    ${fmt.error(icons.error)} ${String(err.url ?? 'unknown')} ${fmt.dim(`(${String(err.error ?? 'unknown error')})`)}`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Generic handler for batch subcommands with error handling
 */
async function handleBatchSubcommand<T>(
  container: IContainer,
  jobId: string,
  options: { output?: string; json?: boolean; pretty?: boolean },
  operation: (app: ReturnType<IContainer['getFirecrawlClient']>) => Promise<T>,
  formatHuman: (data: T) => string
): Promise<void> {
  try {
    const app = container.getFirecrawlClient();
    const data = await operation(app);

    await recordJob('batch', jobId);

    const result = { success: true, data };
    const useJson = shouldOutputJson(options) || !!options.output;
    const outputContent = useJson
      ? formatJson(result, options.pretty)
      : formatHuman(data);
    writeCommandOutput(outputContent, options);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred';
    console.error(fmt.error(message));
    process.exit(1);
  }
}

/**
 * Add a standard subcommand with common options
 */
function addBatchSubcommand(
  parent: Command,
  name: string,
  description: string,
  handler: (
    container: IContainer,
    jobId: string,
    options: { output?: string; json?: boolean; pretty?: boolean }
  ) => Promise<void>
): void {
  parent
    .command(name)
    .description(description)
    .argument('<job-id>', 'Batch job ID')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (jobId: string, options, command: Command) => {
      const container = requireContainerFromCommandTree(command);
      await handler(container, jobId, {
        output: options.output,
        json: options.json,
        pretty: options.pretty,
      });
    });
}

export async function executeBatch(
  container: IContainer,
  options: BatchOptions
): Promise<CommandResult<unknown>> {
  try {
    const app = container.getFirecrawlClient();

    if (options.urls && options.urls.length > 0) {
      const batchOptions = buildBatchScrapeOptions(options);

      if (options.wait) {
        const job = await app.batchScrape(options.urls, {
          ...batchOptions,
          pollInterval: options.pollInterval,
          timeout: options.timeout,
        });
        if (job?.id) {
          await recordJob('batch', job.id);
        }
        return { success: true, data: job };
      }

      const started = await app.startBatchScrape(options.urls, batchOptions);
      if (started?.id) {
        await recordJob('batch', started.id);
      }
      return { success: true, data: started };
    }

    return { success: false, error: 'No URLs or job ID provided' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

export async function handleBatchCommand(
  container: IContainer,
  options: BatchOptions
): Promise<void> {
  const result = await executeBatch(container, options);
  if (!handleCommandError(result)) return;

  const useJson = shouldOutputJson(options) || !!options.output;
  const output = useJson
    ? formatJson({ success: true, data: result.data }, options.pretty)
    : formatBatchResultHuman(result.data);
  writeCommandOutput(output, options);
}

/**
 * Handle batch status subcommand
 */
async function handleBatchStatusCommand(
  container: IContainer,
  jobId: string,
  options: { output?: string; json?: boolean; pretty?: boolean }
): Promise<void> {
  await handleBatchSubcommand(
    container,
    jobId,
    options,
    (app) => app.getBatchScrapeStatus(jobId),
    (status) => {
      const statusRecord = asRecord(status);
      const completed = statusRecord.completed;
      const total = statusRecord.total;
      return formatBatchSummary('Batch status', [
        ['Job ID', statusRecord.id ?? jobId],
        ['Status', statusRecord.status],
        [
          'Progress',
          typeof completed === 'number' && typeof total === 'number'
            ? `${String(completed)}/${String(total)}`
            : undefined,
        ],
      ]);
    }
  );
}

/**
 * Handle batch cancel subcommand
 */
async function handleBatchCancelCommand(
  container: IContainer,
  jobId: string,
  options: { output?: string; json?: boolean; pretty?: boolean }
): Promise<void> {
  await handleBatchSubcommand(
    container,
    jobId,
    options,
    async (app) => {
      const ok = await app.cancelBatchScrape(jobId);
      if (!ok) {
        throw new Error('Cancel failed');
      }
      return { success: true, message: 'cancelled' };
    },
    () => `${fmt.success(icons.success)} Cancelled batch job ${fmt.dim(jobId)}`
  );
}

/**
 * Handle batch errors subcommand
 */
async function handleBatchErrorsCommand(
  container: IContainer,
  jobId: string,
  options: { output?: string; json?: boolean; pretty?: boolean }
): Promise<void> {
  await handleBatchSubcommand(
    container,
    jobId,
    options,
    (app) => app.getBatchScrapeErrors(jobId),
    formatBatchErrorsHuman
  );
}

export function createBatchCommand(): Command {
  const settings = getSettings();

  const batchCmd = new Command('batch')
    .description('Batch scrape multiple URLs using Firecrawl')
    .argument('[urls...]', 'URLs to scrape')
    .option('--wait', 'Wait for batch scrape to complete', false)
    .option(
      '--poll-interval <seconds>',
      'Polling interval in seconds',
      parseFloat
    )
    .option('--timeout <seconds>', 'Timeout in seconds for wait', parseFloat)
    .option('--format <formats>', 'Scrape format(s) for batch results')
    .option(
      '--only-main-content',
      'Only return main content',
      settings.batch.onlyMainContent
    )
    .option(
      '--wait-for <ms>',
      'Wait time before scraping in milliseconds',
      (val) => parseInt(val, 10)
    )
    .option('--screenshot', 'Include screenshot format', false)
    .option('--include-tags <tags>', 'Comma-separated list of tags to include')
    .option('--exclude-tags <tags>', 'Comma-separated list of tags to exclude')
    .option(
      '--max-concurrency <number>',
      'Max concurrency for batch scraping',
      (val) => parseInt(val, 10)
    )
    .option(
      '--ignore-invalid-urls',
      'Ignore invalid URLs',
      settings.batch.ignoreInvalidUrls
    )
    .option('--webhook <url>', 'Webhook URL for batch completion')
    .option('--zero-data-retention', 'Enable zero data retention', false)
    .option('--idempotency-key <key>', 'Idempotency key for batch job')
    .option('--append-to-id <id>', 'Append results to existing batch id')
    .option('--integration <name>', 'Integration name for analytics')
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (rawArgs: string[], options, command: Command) => {
      const container = requireContainerFromCommandTree(command);

      const urls = normalizeUrlArgs(rawArgs ?? []);

      const batchOptions: BatchOptions = {
        urls,
        wait: options.wait,
        pollInterval: options.pollInterval,
        timeout: options.timeout,
        format: options.format,
        onlyMainContent: options.onlyMainContent,
        waitFor: options.waitFor,
        screenshot: options.screenshot,
        includeTags: options.includeTags
          ? options.includeTags.split(',').map((t: string) => t.trim())
          : undefined,
        excludeTags: options.excludeTags
          ? options.excludeTags.split(',').map((t: string) => t.trim())
          : undefined,
        maxConcurrency: options.maxConcurrency,
        ignoreInvalidUrls: options.ignoreInvalidUrls,
        webhook: options.webhook,
        zeroDataRetention: options.zeroDataRetention,
        idempotencyKey: options.idempotencyKey,
        appendToId: options.appendToId,
        integration: options.integration,
        apiKey: options.apiKey,
        output: options.output,
        json: options.json,
        pretty: options.pretty,
      };

      await handleBatchCommand(container, batchOptions);
    });

  // Add subcommands
  addBatchSubcommand(
    batchCmd,
    'status',
    'Get batch job status by ID',
    handleBatchStatusCommand
  );

  addBatchSubcommand(
    batchCmd,
    'cancel',
    'Cancel a batch scrape job',
    handleBatchCancelCommand
  );

  addBatchSubcommand(
    batchCmd,
    'errors',
    'Get errors for a batch scrape job',
    handleBatchErrorsCommand
  );

  return batchCmd;
}
