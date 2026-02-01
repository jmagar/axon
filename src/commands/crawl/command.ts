/**
 * CLI command definition for crawl
 */

import { Command } from 'commander';
import type {
  CrawlOptions,
  CrawlResult,
  CrawlStatusResult,
} from '../../types/crawl';
import { formatJson } from '../../utils/command';
import { isJobId } from '../../utils/job';
import { recordJob } from '../../utils/job-history';
import { writeOutput } from '../../utils/output';
import { normalizeUrl } from '../../utils/url';
import {
  handleAsyncEmbedding,
  handleManualEmbedding,
  handleSyncEmbedding,
} from './embed';
import { executeCrawl } from './execute';
import { formatCrawlStatus } from './format';
import { executeCrawlCancel, executeCrawlErrors } from './status';

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
 * Handle crawl command execution
 *
 * Orchestrates crawl operations including:
 * - Cancel and errors operations
 * - Manual embedding triggers
 * - Crawl execution
 * - Auto-embedding
 * - Output formatting
 *
 * @param options - Crawl options
 */
export async function handleCrawlCommand(options: CrawlOptions): Promise<void> {
  if (!options.urlOrJobId) {
    console.error('Error: URL or job ID is required.');
    process.exit(1);
    return; // Ensure early return for testing
  }

  // Handle cancel operation
  if (options.cancel) {
    const result = await executeCrawlCancel(options.urlOrJobId, options);
    if (!result.success) {
      console.error('Error:', result.error || 'Unknown error occurred');
      process.exit(1);
      return;
    }
    const outputContent = formatJson(
      { success: true, data: result.data },
      options.pretty
    );
    writeOutput(outputContent, options.output, !!options.output);
    return;
  }

  // Handle errors operation
  if (options.errors) {
    const result = await executeCrawlErrors(options.urlOrJobId, options);
    if (!result.success) {
      console.error('Error:', result.error || 'Unknown error occurred');
      process.exit(1);
      return;
    }
    const outputContent = formatJson(
      { success: true, data: result.data },
      options.pretty
    );
    writeOutput(outputContent, options.output, !!options.output);
    return;
  }

  // Handle manual embedding trigger for job ID
  if (options.embed && isJobId(options.urlOrJobId)) {
    await handleManualEmbedding(options.urlOrJobId, options.apiKey);
    return;
  }

  // Execute crawl
  const result = await executeCrawl(options);

  // Handle errors
  if (!result.success) {
    console.error('Error:', result.error || 'Unknown error occurred');
    process.exit(1);
    return; // Ensure early return for testing
  }

  // Handle status check result - distinguish by absence of 'jobId' and 'data' properties
  // CrawlStatusData has neither, while CrawlJobStartedData has jobId and CrawlJobData has data array
  if (result.data && isStatusOnlyResult(result.data)) {
    const statusResult = result as CrawlStatusResult;
    if (statusResult.data) {
      const outputContent =
        options.pretty || !options.output
          ? formatCrawlStatus(statusResult.data)
          : formatJson(
              { success: true, data: statusResult.data },
              options.pretty
            );
      writeOutput(outputContent, options.output, !!options.output);
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
        options.apiKey
      );
    } else {
      // Synchronous result (--wait or --progress) - embed inline
      await handleSyncEmbedding(crawlResult.data);
    }
  }

  // Format output
  let outputContent: string;
  if ('jobId' in crawlResult.data) {
    // Job ID response
    recordJob('crawl', crawlResult.data.jobId);
    const jobData = {
      jobId: crawlResult.data.jobId,
      url: crawlResult.data.url,
      status: crawlResult.data.status,
    };
    outputContent = formatJson(
      { success: true, data: jobData },
      options.pretty
    );
  } else {
    // Completed crawl - output the data
    outputContent = formatJson(crawlResult.data, options.pretty);
  }

  writeOutput(outputContent, options.output, !!options.output);
}

/**
 * Create and configure the crawl command
 *
 * @returns Configured Commander.js command
 */
export function createCrawlCommand(): Command {
  const crawlCmd = new Command('crawl')
    .description('Crawl a website using Firecrawl')
    .argument('[url-or-job-id]', 'URL to crawl or job ID to check status')
    .option(
      '-u, --url <url>',
      'URL to crawl (alternative to positional argument)'
    )
    .option('--cancel', 'Cancel an existing crawl job', false)
    .option('--errors', 'Fetch crawl errors for a job ID', false)
    .option('--status', 'Check status of existing crawl job', false)
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
    .option(
      '--scrape-timeout <seconds>',
      'Per-page scrape timeout in seconds (default: 15)',
      parseFloat,
      15
    )
    .option('--progress', 'Show progress while waiting (implies --wait)', false)
    .option('--limit <number>', 'Maximum number of pages to crawl', parseInt)
    .option('--max-depth <number>', 'Maximum crawl depth', parseInt)
    .option(
      '--exclude-paths <paths>',
      'Comma-separated list of paths to exclude'
    )
    .option(
      '--include-paths <paths>',
      'Comma-separated list of paths to include'
    )
    .option('--sitemap <mode>', 'Sitemap handling: skip, include', 'include')
    .option(
      '--ignore-query-parameters',
      'Ignore query parameters when crawling',
      false
    )
    .option('--crawl-entire-domain', 'Crawl entire domain', false)
    .option('--allow-external-links', 'Allow external links', false)
    .option('--allow-subdomains', 'Allow subdomains', false)
    .option('--delay <ms>', 'Delay between requests in milliseconds', parseInt)
    .option(
      '--max-concurrency <number>',
      'Maximum concurrent requests',
      parseInt
    )
    .option(
      '-k, --api-key <key>',
      'Firecrawl API key (overrides global --api-key)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--pretty', 'Pretty print JSON output', false)
    .option('--embed', 'Manually trigger embedding for a completed crawl job')
    .option('--no-embed', 'Skip auto-embedding of crawl results')
    .option('--no-default-excludes', 'Skip default exclude paths from settings')
    .action(async (positionalUrlOrJobId, options) => {
      // Use positional argument if provided, otherwise use --url option
      const urlOrJobId = positionalUrlOrJobId || options.url;
      if (!urlOrJobId) {
        console.error(
          'Error: URL or job ID is required. Provide it as argument or use --url option.'
        );
        process.exit(1);
        return;
      }

      if ((options.cancel || options.errors) && !isJobId(urlOrJobId)) {
        console.error(
          'Error: job ID is required for --cancel/--errors (URLs are not valid).'
        );
        process.exit(1);
        return;
      }

      // Validate mutually exclusive options
      if (options.cancel && options.errors) {
        console.error('Error: --cancel and --errors are mutually exclusive');
        process.exit(1);
        return;
      }

      if (
        (options.wait || options.progress) &&
        (options.cancel || options.errors || options.status)
      ) {
        console.error(
          'Error: --wait/--progress cannot be used with --cancel/--errors/--status'
        );
        process.exit(1);
        return;
      }

      // Auto-detect if it's a job ID (UUID format)
      const isStatusCheck =
        options.status ||
        options.cancel ||
        options.errors ||
        isJobId(urlOrJobId);

      const crawlOptions = {
        urlOrJobId: isStatusCheck ? urlOrJobId : normalizeUrl(urlOrJobId),
        status: isStatusCheck,
        cancel: options.cancel,
        errors: options.errors,
        wait: options.wait,
        pollInterval: options.pollInterval,
        timeout: options.timeout,
        scrapeTimeout: options.scrapeTimeout,
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
        noDefaultExcludes: options.defaultExcludes === false,
      };

      await handleCrawlCommand(crawlOptions);
    });

  return crawlCmd;
}
