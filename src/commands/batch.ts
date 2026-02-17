/**
 * Batch scrape command implementation
 */

import { readFileSync } from 'node:fs';
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
import {
  buildFiltersEcho,
  CANONICAL_EMPTY_STATE,
  formatHeaderBlock,
} from '../utils/style-output';
import { fmt, icons } from '../utils/theme';
import { normalizeUrlArgs, requireContainerFromCommandTree } from './shared';

// Commander module augmentation (container injection)
import '../types/commander';

function parseJsonSchemaInput(
  options: BatchOptions
): Record<string, unknown> | undefined {
  if (options.jsonSchema && options.jsonSchemaFile) {
    throw new Error(
      'Use either --json-schema or --json-schema-file, not both.'
    );
  }

  const rawSchema = options.jsonSchemaFile
    ? readFileSync(options.jsonSchemaFile, 'utf-8')
    : options.jsonSchema;

  if (!rawSchema) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSchema);
  } catch (error) {
    throw new Error(
      `Invalid JSON schema: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('JSON schema must be a JSON object.');
  }

  return parsed as Record<string, unknown>;
}

function buildBatchScrapeOptions(options: BatchOptions) {
  const scrapeOptions: Record<string, unknown> = {};
  const schema = parseJsonSchemaInput(options);
  const formats: Array<Record<string, unknown>> = [];

  if (options.format) {
    const parsedFormats = parseFormats(options.format);
    const includeJson = parsedFormats.includes('json');

    for (const type of parsedFormats) {
      if (type === 'json') {
        continue;
      }
      formats.push({ type });
    }

    if (includeJson) {
      if (!options.jsonPrompt && !schema) {
        throw new Error(
          'When using --format json, provide --json-prompt or --json-schema/--json-schema-file.'
        );
      }
      const jsonFormat: Record<string, unknown> = { type: 'json' };
      if (options.jsonPrompt) {
        jsonFormat.prompt = options.jsonPrompt;
      }
      if (schema) {
        jsonFormat.schema = schema;
      }
      formats.push(jsonFormat);
    }
  }
  if (options.onlyMainContent !== undefined) {
    scrapeOptions.onlyMainContent = options.onlyMainContent;
  }
  if (options.waitFor !== undefined) {
    scrapeOptions.waitFor = options.waitFor;
  }
  if (options.screenshot) {
    if (!formats.find((f) => f.type === 'screenshot')) {
      formats.push({ type: 'screenshot' });
    }
  }
  if (formats.length > 0) {
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

function formatBatchResultHuman(data: unknown): string {
  const record = asRecord(data);
  const completed = record.completed;
  const total = record.total;
  const progress =
    typeof completed === 'number' && typeof total === 'number'
      ? `${completed}/${total}`
      : undefined;

  const lines = formatHeaderBlock({
    title: `Batch Job ${String(record.id ?? '—')}`,
    summary: `Status: ${String(record.status ?? 'processing')} | Progress: ${progress ?? '—'}`,
    includeFreshness: true,
  });
  lines.push(`Job ID: ${String(record.id ?? '—')}`);
  lines.push(`Status: ${String(record.status ?? 'processing')}`);
  if (progress) {
    lines.push(`Progress: ${progress}`);
  }
  if (record.url) {
    lines.push(`URL: ${String(record.url)}`);
  }
  return lines.join('\n');
}

function formatBatchErrorsHuman(
  data: unknown,
  context?: { jobId?: string }
): string {
  const record = asRecord(data);
  const errors = Array.isArray(record.errors)
    ? (record.errors as Array<Record<string, unknown>>)
    : [];
  const robotsBlocked = Array.isArray(record.robotsBlocked)
    ? (record.robotsBlocked as string[])
    : [];

  const lines = formatHeaderBlock({
    title: `Batch Errors${context?.jobId ? ` for ${context.jobId}` : ''}`,
    summary: `Errors: ${errors.length} | Robots blocked: ${robotsBlocked.length}`,
    filters: buildFiltersEcho(context?.jobId ? [['jobId', context.jobId]] : []),
    includeFreshness: true,
  });

  if (errors.length > 0 && robotsBlocked.length > 0) {
    lines.push('Legend: ✗ request error  ⚠ robots blocked');
  }

  type Row = { severity: number; text: string };
  const rows: Row[] = [
    ...errors.map((err) => ({
      severity: 0,
      text: `${icons.error} ${String(err.url ?? '—')} (${String(err.error ?? 'unknown error')})`,
    })),
    ...robotsBlocked.map((url) => ({
      severity: 1,
      text: `${icons.warning} ${url}`,
    })),
  ].sort((a, b) => a.severity - b.severity || a.text.localeCompare(b.text));

  if (rows.length === 0) {
    lines.push(`  ${CANONICAL_EMPTY_STATE}`);
  } else {
    for (const row of rows) {
      lines.push(row.text);
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
  operation: (app: ReturnType<IContainer['getAxonClient']>) => Promise<T>,
  formatHuman: (data: T) => string
): Promise<void> {
  try {
    const app = container.getAxonClient();
    const data = await operation(app);

    await recordJob('batch', jobId);

    const result = { success: true, data };
    const useJson = shouldOutputJson(options) || !!options.output;
    const outputContent = useJson
      ? formatJson(result, options.pretty)
      : formatHuman(data);
    await writeCommandOutput(outputContent, options);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred';
    console.error(fmt.error(message));
    process.exitCode = 1;
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
    const app = container.getAxonClient();

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
  await writeCommandOutput(output, options);
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
      const progress =
        typeof completed === 'number' && typeof total === 'number'
          ? `${String(completed)}/${String(total)}`
          : undefined;

      const lines = formatHeaderBlock({
        title: `Batch Status for ${jobId}`,
        summary: `Status: ${String(statusRecord.status ?? 'processing')} | Progress: ${progress ?? '—'}`,
        filters: buildFiltersEcho([['jobId', jobId]]),
        includeFreshness: true,
      });
      lines.push(`Job ID: ${String(statusRecord.id ?? jobId)}`);
      lines.push(`Status: ${String(statusRecord.status ?? 'processing')}`);
      if (progress) {
        lines.push(`Progress: ${progress}`);
      }
      return lines.join('\n');
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
    () =>
      [
        ...formatHeaderBlock({
          title: `Batch Cancel for ${jobId}`,
          summary: 'Status: cancelled',
          filters: buildFiltersEcho([['jobId', jobId]]),
          includeFreshness: true,
        }),
        `${icons.success} Cancelled batch job ${jobId}`,
      ].join('\n')
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
    (data) => formatBatchErrorsHuman(data, { jobId })
  );
}

export function createBatchCommand(): Command {
  const settings = getSettings();

  const batchCmd = new Command('batch')
    .description('Batch scrape multiple URLs using Axon')
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
      '--json-prompt <prompt>',
      'Prompt for structured extraction when using --format json'
    )
    .option(
      '--json-schema <json>',
      'Inline JSON schema for structured extraction when using --format json'
    )
    .option(
      '--json-schema-file <path>',
      'Path to JSON schema file for structured extraction when using --format json'
    )
    .option(
      '--only-main-content',
      'Only return main content',
      settings.batch.onlyMainContent
    )
    .option(
      '--wait-for <ms>',
      'Wait time before scraping in milliseconds',
      (val) => Number.parseInt(val, 10)
    )
    .option('--screenshot', 'Include screenshot format', false)
    .option('--include-tags <tags>', 'Comma-separated list of tags to include')
    .option('--exclude-tags <tags>', 'Comma-separated list of tags to exclude')
    .option(
      '--max-concurrency <number>',
      'Max concurrency for batch scraping',
      (val) => Number.parseInt(val, 10)
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
    .option('-k, --api-key <key>', 'API key (overrides global --api-key)')
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
        jsonPrompt: options.jsonPrompt,
        jsonSchema: options.jsonSchema,
        jsonSchemaFile: options.jsonSchemaFile,
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
