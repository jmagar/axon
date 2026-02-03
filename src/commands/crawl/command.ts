/**
 * CLI command definition for crawl
 */

import { Command } from 'commander';
import type { IContainer } from '../../container/types';
import type {
  CrawlOptions,
  CrawlResult,
  CrawlStatusResult,
} from '../../types/crawl';
import { formatJson } from '../../utils/command';
import { displayCommandInfo } from '../../utils/display';
import { isJobId } from '../../utils/job';
import { recordJob } from '../../utils/job-history';
import { validateOutputPath, writeOutput } from '../../utils/output';
import { normalizeUrl } from '../../utils/url';
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
    console.error('Error: URL or job ID is required.');
    process.exit(1);
    return; // Ensure early return for testing
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
    scrapeTimeout: options.scrapeTimeout,
    wait: options.wait,
    progress: options.progress,
  });

  // Execute crawl
  const result = await executeCrawl(container, options);

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
      if (options.output) {
        try {
          validateOutputPath(options.output);
        } catch (error) {
          console.error(
            'Error:',
            error instanceof Error ? error.message : 'Invalid output path'
          );
          process.exit(1);
          return;
        }
      }
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
      await handleSyncEmbedding(container, crawlResult.data);
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

  if (options.output) {
    try {
      validateOutputPath(options.output);
    } catch (error) {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Invalid output path'
      );
      process.exit(1);
      return;
    }
  }
  writeOutput(outputContent, options.output, !!options.output);
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
  options: { output?: string; pretty?: boolean }
): Promise<void> {
  const result = await checkCrawlStatus(container, jobId);

  if (!result.success) {
    console.error('Error:', result.error || 'Unknown error occurred');
    process.exit(1);
    return;
  }

  if (options.output) {
    try {
      validateOutputPath(options.output);
    } catch (error) {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Invalid output path'
      );
      process.exit(1);
      return;
    }
  }

  const outputContent =
    options.pretty || !options.output
      ? formatCrawlStatus(result.data)
      : formatJson({ success: true, data: result.data }, options.pretty);

  writeOutput(outputContent, options.output, !!options.output);
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

  if (!result.success) {
    console.error('Error:', result.error || 'Unknown error occurred');
    process.exit(1);
    return;
  }

  if (options.output) {
    try {
      validateOutputPath(options.output);
    } catch (error) {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Invalid output path'
      );
      process.exit(1);
      return;
    }
  }

  const outputContent = formatJson(
    { success: true, data: result.data },
    options.pretty
  );
  writeOutput(outputContent, options.output, !!options.output);
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

  if (!result.success) {
    console.error('Error:', result.error || 'Unknown error occurred');
    process.exit(1);
    return;
  }

  if (options.output) {
    try {
      validateOutputPath(options.output);
    } catch (error) {
      console.error(
        'Error:',
        error instanceof Error ? error.message : 'Invalid output path'
      );
      process.exit(1);
      return;
    }
  }

  const outputContent = formatJson(
    { success: true, data: result.data },
    options.pretty
  );
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
    .option(
      '--max-depth <number>',
      'Maximum crawl depth (default: 3)',
      (value: string) => parseInt(value, 10),
      3
    )
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
      'Ignore query parameters when crawling (default: true)',
      true
    )
    .option(
      '--no-ignore-query-parameters',
      'Include query parameters when crawling'
    )
    .option('--crawl-entire-domain', 'Crawl entire domain', false)
    .option('--allow-external-links', 'Allow external links', false)
    .option('--allow-subdomains', 'Allow subdomains (default: true)', true)
    .option('--no-allow-subdomains', 'Disallow subdomains')
    .option(
      '--only-main-content',
      'Include only main content when scraping pages (default: true)',
      true
    )
    .option('--no-only-main-content', 'Include full page content')
    .option(
      '--exclude-tags <tags>',
      'Comma-separated list of tags to exclude from scraped content (default: nav,footer)',
      'nav,footer'
    )
    .option(
      '--include-tags <tags>',
      'Comma-separated list of tags to include in scraped content'
    )
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
    .action(async (positionalUrlOrJobId, options, command: Command) => {
      const container = command._container;
      if (!container) {
        throw new Error('Container not initialized');
      }

      // Use positional argument if provided, otherwise use --url option
      const urlOrJobId = positionalUrlOrJobId || options.url;
      if (!urlOrJobId) {
        console.error(
          'Error: URL or job ID is required. Provide it as argument or use --url option.'
        );
        process.exit(1);
        return;
      }

      // Auto-detect if it's a job ID and show deprecation warning
      if (isJobId(urlOrJobId)) {
        console.warn(
          '⚠️  Detected job ID. Use "firecrawl crawl status <job-id>" instead.'
        );
        await handleCrawlStatusCommand(container, urlOrJobId, {
          output: options.output,
          pretty: options.pretty,
        });
        return;
      }

      const crawlOptions = {
        urlOrJobId: normalizeUrl(urlOrJobId),
        status: false,
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
    .argument('<job-id>', 'Crawl job ID to check status')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (jobId: string, options, command: Command) => {
      const container = command.parent?._container;
      if (!container) {
        throw new Error('Container not initialized');
      }
      await handleCrawlStatusCommand(container, jobId, options);
    });

  crawlCmd.addCommand(statusCmd);

  // Cancel subcommand
  const cancelCmd = new Command('cancel')
    .description('Cancel a crawl job')
    .argument('<job-id>', 'Crawl job ID to cancel')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (jobId: string, options, command: Command) => {
      const container = command.parent?._container;
      if (!container) {
        throw new Error('Container not initialized');
      }
      await handleCrawlCancelCommand(container, jobId, options);
    });

  crawlCmd.addCommand(cancelCmd);

  // Errors subcommand
  const errorsCmd = new Command('errors')
    .description('Get errors from a crawl job')
    .argument('<job-id>', 'Crawl job ID to get errors')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (jobId: string, options, command: Command) => {
      const container = command.parent?._container;
      if (!container) {
        throw new Error('Container not initialized');
      }
      await handleCrawlErrorsCommand(container, jobId, options);
    });

  crawlCmd.addCommand(errorsCmd);

  return crawlCmd;
}
