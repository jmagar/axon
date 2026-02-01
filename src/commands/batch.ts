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
} from '../utils/command';
import { recordJob } from '../utils/job-history';
import { parseFormats } from '../utils/options';
import { writeOutput } from '../utils/output';
import { normalizeUrl } from '../utils/url';

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
  if (options.scrapeTimeout !== undefined) {
    scrapeOptions.timeout = options.scrapeTimeout * 1000;
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

export async function executeBatch(
  container: IContainer,
  options: BatchOptions
): Promise<CommandResult<unknown>> {
  try {
    const app = container.getFirecrawlClient();

    if (options.cancel && options.jobId) {
      const ok = await app.cancelBatchScrape(options.jobId);
      if (!ok) {
        return { success: false, error: 'Cancel failed' };
      }
      recordJob('batch', options.jobId);
      return { success: true, data: { success: true, message: 'cancelled' } };
    }

    if (options.errors && options.jobId) {
      const errors = await app.getBatchScrapeErrors(options.jobId);
      recordJob('batch', options.jobId);
      return { success: true, data: errors };
    }

    if (options.status && options.jobId) {
      const status = await app.getBatchScrapeStatus(options.jobId);
      recordJob('batch', options.jobId);
      return { success: true, data: status };
    }

    if (options.urls && options.urls.length > 0) {
      const batchOptions = buildBatchScrapeOptions(options);

      if (options.wait) {
        const job = await app.batchScrape(options.urls, {
          ...batchOptions,
          pollInterval: options.pollInterval,
          timeout: options.timeout,
        });
        if (job?.id) {
          recordJob('batch', job.id);
        }
        return { success: true, data: job };
      }

      const started = await app.startBatchScrape(options.urls, batchOptions);
      if (started?.id) {
        recordJob('batch', started.id);
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

  const output = formatJson(
    { success: true, data: result.data },
    options.pretty
  );
  writeOutput(output, options.output, !!options.output);
}

export function createBatchCommand(): Command {
  const batchCmd = new Command('batch')
    .description('Batch scrape multiple URLs using Firecrawl')
    .argument(
      '[urls-or-job-id...]',
      'URLs to scrape or a batch job ID for status/errors/cancel'
    )
    .option('--wait', 'Wait for batch scrape to complete', false)
    .option(
      '--poll-interval <seconds>',
      'Polling interval in seconds',
      parseFloat
    )
    .option('--timeout <seconds>', 'Timeout in seconds for wait', parseFloat)
    .option('--status', 'Get status for a batch job ID', false)
    .option('--cancel', 'Cancel a batch scrape job', false)
    .option('--errors', 'Fetch batch scrape errors', false)
    .option('--format <formats>', 'Scrape format(s) for batch results')
    .option('--only-main-content', 'Only return main content', false)
    .option(
      '--wait-for <ms>',
      'Wait time before scraping in milliseconds',
      parseInt
    )
    .option('--scrape-timeout <seconds>', 'Per-page scrape timeout', parseFloat)
    .option('--screenshot', 'Include screenshot format', false)
    .option('--include-tags <tags>', 'Comma-separated list of tags to include')
    .option('--exclude-tags <tags>', 'Comma-separated list of tags to exclude')
    .option(
      '--max-concurrency <number>',
      'Max concurrency for batch scraping',
      parseInt
    )
    .option('--ignore-invalid-urls', 'Ignore invalid URLs', false)
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
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (rawArgs: string[], options, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      const urlsOrId = rawArgs ?? [];

      if (
        (options.status || options.cancel || options.errors) &&
        !urlsOrId[0]
      ) {
        console.error(
          'Error: job ID is required for --status/--cancel/--errors'
        );
        process.exit(1);
      }

      const jobId =
        options.status || options.cancel || options.errors
          ? urlsOrId[0]
          : undefined;

      const urls =
        options.status || options.cancel || options.errors
          ? undefined
          : urlsOrId
              .flatMap((u) =>
                u.includes('\n') ? u.split('\n').filter(Boolean) : [u]
              )
              .map(normalizeUrl);

      const batchOptions: BatchOptions = {
        urls,
        jobId,
        wait: options.wait,
        status: options.status,
        cancel: options.cancel,
        errors: options.errors,
        pollInterval: options.pollInterval,
        timeout: options.timeout,
        format: options.format,
        onlyMainContent: options.onlyMainContent,
        waitFor: options.waitFor,
        scrapeTimeout: options.scrapeTimeout,
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
        pretty: options.pretty,
      };

      await handleBatchCommand(container, batchOptions);
    });

  return batchCmd;
}
