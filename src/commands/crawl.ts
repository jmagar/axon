/**
 * Crawl command implementation
 */

import type { CrawlOptions as FirecrawlCrawlOptions } from '@mendable/firecrawl-js';
import { Command } from 'commander';
import type {
  CrawlCancelResult,
  CrawlErrorsResult,
  CrawlJobData,
  CrawlOptions,
  CrawlResult,
  CrawlStatusResult,
} from '../types/crawl';
import { getClient } from '../utils/client';
import { formatJson } from '../utils/command';
import { buildEmbedderWebhookConfig } from '../utils/embedder-webhook';
import { batchEmbed, createEmbedItems } from '../utils/embedpipeline';
import { isJobId } from '../utils/job';
import { recordJob } from '../utils/job-history';
import { writeOutput } from '../utils/output';
import { loadSettings } from '../utils/settings';
import { normalizeUrl } from '../utils/url';

/**
 * Execute crawl status check
 */
async function checkCrawlStatus(
  jobId: string,
  options: CrawlOptions
): Promise<CrawlStatusResult> {
  try {
    const app = getClient({ apiKey: options.apiKey });
    const status = await app.getCrawlStatus(jobId);

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
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Execute crawl cancel
 */
export async function executeCrawlCancel(
  jobId: string
): Promise<CrawlCancelResult> {
  try {
    const app = getClient();
    const ok = await app.cancelCrawl(jobId);

    if (!ok) {
      return { success: false, error: 'Cancel failed' };
    }

    return { success: true, data: { status: 'cancelled' } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Execute crawl errors fetch
 */
export async function executeCrawlErrors(
  jobId: string
): Promise<CrawlErrorsResult> {
  try {
    const app = getClient();
    const errors = await app.getCrawlErrors(jobId);
    return { success: true, data: errors };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Execute crawl command
 */
export async function executeCrawl(
  options: CrawlOptions
): Promise<CrawlResult | CrawlStatusResult> {
  try {
    const app = getClient({ apiKey: options.apiKey });
    const { urlOrJobId, status, pollInterval, timeout } = options;
    if (!urlOrJobId) {
      return { success: false, error: 'URL or job ID is required' };
    }

    // Progress implies wait
    const wait = options.wait || options.progress;

    // If status flag is set or input looks like a job ID, check status
    if (status || isJobId(urlOrJobId)) {
      return await checkCrawlStatus(urlOrJobId, options);
    }

    // Build crawl options - extends SDK CrawlOptions with polling options
    const crawlOptions: FirecrawlCrawlOptions & {
      pollInterval?: number;
      crawlTimeout?: number;
    } = {};

    if (options.limit !== undefined) {
      crawlOptions.limit = options.limit;
    }
    if (options.maxDepth !== undefined) {
      crawlOptions.maxDiscoveryDepth = options.maxDepth;
    }
    // Merge default exclude paths from settings with CLI exclude paths
    const defaultExcludes = options.noDefaultExcludes
      ? []
      : (loadSettings().defaultExcludePaths ?? []);
    const cliExcludes = options.excludePaths ?? [];
    const mergedExcludes = [...new Set([...defaultExcludes, ...cliExcludes])];
    if (mergedExcludes.length > 0) {
      crawlOptions.excludePaths = mergedExcludes;
    }
    if (options.includePaths && options.includePaths.length > 0) {
      crawlOptions.includePaths = options.includePaths;
    }
    if (options.sitemap) {
      crawlOptions.sitemap = options.sitemap;
    }
    if (options.ignoreQueryParameters !== undefined) {
      crawlOptions.ignoreQueryParameters = options.ignoreQueryParameters;
    }
    if (options.crawlEntireDomain !== undefined) {
      crawlOptions.crawlEntireDomain = options.crawlEntireDomain;
    }
    if (options.allowExternalLinks !== undefined) {
      crawlOptions.allowExternalLinks = options.allowExternalLinks;
    }
    if (options.allowSubdomains !== undefined) {
      crawlOptions.allowSubdomains = options.allowSubdomains;
    }
    if (options.delay !== undefined) {
      crawlOptions.delay = options.delay;
    }
    if (options.maxConcurrency !== undefined) {
      crawlOptions.maxConcurrency = options.maxConcurrency;
    }
    if (options.scrapeTimeout !== undefined) {
      // Per-page scrape timeout goes in scrapeOptions, not crawlOptions
      crawlOptions.scrapeOptions = {
        ...(crawlOptions.scrapeOptions || {}),
        timeout: options.scrapeTimeout * 1000, // Convert seconds to milliseconds
      };
    }

    // Attach webhook for async auto-embedding (avoid in wait/progress mode)
    if (options.embed !== false && !wait) {
      const webhookConfig = buildEmbedderWebhookConfig();
      if (webhookConfig) {
        crawlOptions.webhook = webhookConfig;
      }
    }

    // If wait mode, use the convenience crawl method with polling
    if (wait) {
      // Set polling options
      if (pollInterval !== undefined) {
        crawlOptions.pollInterval = pollInterval * 1000; // Convert to milliseconds
      } else {
        // Default poll interval: 5 seconds
        crawlOptions.pollInterval = 5000;
      }
      // Note: timeout (per-page scrape) is already set above from scrapeTimeout
      // The SDK's app.crawl() method handles overall job timeout internally
      // If we need to set total crawl timeout, use crawlTimeout parameter
      if (timeout !== undefined) {
        crawlOptions.crawlTimeout = timeout * 1000; // Convert to milliseconds
      }

      // Show progress if requested - use custom polling for better UX
      if (options.progress) {
        // Start crawl first
        const response = await app.startCrawl(urlOrJobId, crawlOptions);
        const jobId = response.id;

        process.stderr.write(`Crawling ${urlOrJobId}...\n`);
        process.stderr.write(`Job ID: ${jobId}\n`);

        // Poll for status with progress updates
        const pollMs = crawlOptions.pollInterval || 5000;
        const startTime = Date.now();
        const timeoutMs = timeout ? timeout * 1000 : undefined;

        while (true) {
          await new Promise((resolve) => setTimeout(resolve, pollMs));

          const status = await app.getCrawlStatus(jobId);

          // Show progress
          process.stderr.write(
            `\rProgress: ${status.completed}/${status.total} pages (${status.status})`
          );

          if (
            status.status === 'completed' ||
            status.status === 'failed' ||
            status.status === 'cancelled' ||
            (status.total > 0 && status.completed >= status.total)
          ) {
            process.stderr.write('\n');
            return {
              success: true,
              data: status,
            };
          }

          // Check timeout
          if (timeoutMs && Date.now() - startTime > timeoutMs) {
            process.stderr.write('\n');
            return {
              success: false,
              error: `Timeout after ${timeout} seconds. Crawl still in progress.`,
            };
          }
        }
      } else {
        // Use SDK's built-in polling (no progress display)
        const crawlJob = await app.crawl(urlOrJobId, crawlOptions);
        return {
          success: true,
          data: crawlJob,
        };
      }
    }

    // Otherwise, start crawl and return job ID
    const response = await app.startCrawl(urlOrJobId, crawlOptions);

    return {
      success: true,
      data: {
        jobId: response.id,
        url: response.url,
        status: 'processing',
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Format crawl status in human-readable way
 */
function formatCrawlStatus(data: CrawlStatusResult['data']): string {
  if (!data) return '';

  const lines: string[] = [];
  lines.push(`Job ID: ${data.id}`);
  lines.push(`Status: ${data.status}`);
  lines.push(`Progress: ${data.completed}/${data.total} pages`);

  if (data.creditsUsed !== undefined) {
    lines.push(`Credits Used: ${data.creditsUsed}`);
  }

  if (data.expiresAt) {
    const expiresDate = new Date(data.expiresAt);
    lines.push(
      `Expires: ${expiresDate.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`
    );
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Handle manual embedding for a completed crawl job
 */
async function handleManualEmbedding(
  jobId: string,
  apiKey?: string
): Promise<void> {
  const { processEmbedQueue } = await import('../utils/background-embedder');
  const { enqueueEmbedJob, getEmbedJob } = await import('../utils/embed-queue');

  // Check if already queued
  const existingJob = getEmbedJob(jobId);

  if (!existingJob) {
    // Get crawl info to queue it
    const app = getClient({ apiKey });
    const status = await app.getCrawlStatus(jobId);

    if (status.status !== 'completed') {
      console.error(`Crawl ${jobId} is ${status.status}, cannot embed yet`);
      return;
    }

    // Use the first page URL as the URL or fall back to job ID
    const url =
      Array.isArray(status.data) && status.data[0]?.metadata?.sourceURL
        ? status.data[0].metadata.sourceURL
        : jobId;

    enqueueEmbedJob(jobId, url, apiKey);
  }

  // Process queue
  console.error(`Processing embedding queue for job ${jobId}...`);
  await processEmbedQueue();
  console.error(`Embedding processing complete`);
}

/**
 * Handle crawl command output
 */
export async function handleCrawlCommand(options: CrawlOptions): Promise<void> {
  if (!options.urlOrJobId) {
    console.error('Error: URL or job ID is required.');
    process.exit(1);
  }

  if (options.cancel) {
    const result = await executeCrawlCancel(options.urlOrJobId);
    if (!result.success) {
      console.error('Error:', result.error || 'Unknown error occurred');
      process.exit(1);
    }

    const outputContent = formatJson(
      { success: true, data: result.data },
      options.pretty
    );
    writeOutput(outputContent, options.output, !!options.output);
    return;
  }

  if (options.errors) {
    const result = await executeCrawlErrors(options.urlOrJobId);
    if (!result.success) {
      console.error('Error:', result.error || 'Unknown error occurred');
      process.exit(1);
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

  const result = await executeCrawl(options);

  // Handle errors - can't use shared handler due to union type
  if (!result.success) {
    console.error('Error:', result.error || 'Unknown error occurred');
    process.exit(1);
  }

  // Handle status check result
  if ('status' in result && result.data && 'status' in result.data) {
    const statusResult = result as CrawlStatusResult;
    if (statusResult.data) {
      // Human-readable format for status when no output file
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

  // Auto-embed crawl results using shared batch embedding
  if (options.embed !== false && crawlResult.data) {
    if ('jobId' in crawlResult.data) {
      // Async job - enqueue for background processing instead of blocking
      const { enqueueEmbedJob } = await import('../utils/embed-queue');
      const webhookConfig = buildEmbedderWebhookConfig();

      const jobId = crawlResult.data.jobId;
      const url = options.urlOrJobId ?? crawlResult.data.url;

      enqueueEmbedJob(jobId, url, options.apiKey);
      process.stderr.write(
        `\nQueued embedding job for background processing: ${jobId}\n`
      );

      if (webhookConfig) {
        process.stderr.write(
          'Embeddings will be generated automatically when crawl completes via webhook.\n'
        );
      } else {
        process.stderr.write(
          'Embedder webhook not configured. Set FIRECRAWL_EMBEDDER_WEBHOOK_URL to enable auto-embedding.\n'
        );
        process.stderr.write(
          `Run 'firecrawl crawl ${jobId} --embed' to embed after completion.\n`
        );
      }
    } else {
      // Synchronous result (--wait or --progress) - embed inline
      const crawlJobData = crawlResult.data as CrawlJobData;
      if (crawlJobData.id) {
        recordJob('crawl', crawlJobData.id);
      }
      const pagesToEmbed = crawlJobData.data ?? [];

      if (pagesToEmbed.length > 0) {
        const embedItems = createEmbedItems(pagesToEmbed, 'crawl');
        await batchEmbed(embedItems);
      }
    }
  }

  // Format output using shared utility
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
      }

      if ((options.cancel || options.errors) && !isJobId(urlOrJobId)) {
        console.error(
          'Error: job ID is required for --cancel/--errors (URLs are not valid).'
        );
        process.exit(1);
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
