/**
 * Embedding orchestration for crawl results
 */

import type { CrawlOptions as FirecrawlCrawlOptions } from '@mendable/firecrawl-js';
import type { CrawlJobData } from '../../types/crawl';
import { getClient } from '../../utils/client';
import { buildEmbedderWebhookConfig } from '../../utils/embedder-webhook';
import { batchEmbed, createEmbedItems } from '../../utils/embedpipeline';
import { recordJob } from '../../utils/job-history';

/**
 * Attach webhook for async auto-embedding
 *
 * @param options - Crawl options to modify
 * @param shouldEmbed - Whether embedding is enabled
 * @param isWaitMode - Whether in wait/progress mode
 * @returns Modified options with webhook attached if applicable
 *
 * @example
 * ```typescript
 * const options = attachEmbedWebhook(crawlOptions, true, false);
 * ```
 */
export function attachEmbedWebhook<T extends FirecrawlCrawlOptions>(
  options: T,
  shouldEmbed: boolean,
  isWaitMode: boolean
): T {
  // Only attach webhook for async mode with embedding enabled
  if (shouldEmbed && !isWaitMode) {
    const webhookConfig = buildEmbedderWebhookConfig();
    if (webhookConfig) {
      return { ...options, webhook: webhookConfig };
    }
  }
  return options;
}

/**
 * Handle async embedding for crawl job
 *
 * Enqueues the job for background processing and displays
 * appropriate messages based on webhook configuration.
 *
 * @param jobId - Crawl job ID
 * @param url - Original URL or fallback
 * @param apiKey - Optional API key
 *
 * @example
 * ```typescript
 * await handleAsyncEmbedding('job-123', 'https://example.com');
 * ```
 */
export async function handleAsyncEmbedding(
  jobId: string,
  url: string,
  apiKey?: string
): Promise<void> {
  const { enqueueEmbedJob } = await import('../../utils/embed-queue');
  const webhookConfig = buildEmbedderWebhookConfig();

  enqueueEmbedJob(jobId, url, apiKey);
  console.error(`\nQueued embedding job for background processing: ${jobId}`);

  if (webhookConfig) {
    console.error(
      'Embeddings will be generated automatically when crawl completes via webhook.'
    );
  } else {
    console.error(
      'Embedder webhook not configured. Set FIRECRAWL_EMBEDDER_WEBHOOK_URL to enable auto-embedding.'
    );
    console.error(
      `Run 'firecrawl crawl ${jobId} --embed' to embed after completion.`
    );
  }
}

/**
 * Handle synchronous embedding for crawl results
 *
 * Embeds pages inline (used with --wait or --progress mode).
 *
 * @param crawlJobData - Completed crawl job data
 *
 * @example
 * ```typescript
 * await handleSyncEmbedding(crawlJobData);
 * ```
 */
export async function handleSyncEmbedding(
  crawlJobData: CrawlJobData
): Promise<void> {
  if (crawlJobData.id) {
    recordJob('crawl', crawlJobData.id);
  }

  const pagesToEmbed = crawlJobData.data ?? [];
  if (pagesToEmbed.length === 0) {
    return;
  }

  const embedItems = createEmbedItems(pagesToEmbed, 'crawl');
  await batchEmbed(embedItems);
}

/**
 * Handle manual embedding for a completed crawl job
 *
 * Checks job status, enqueues if not already queued,
 * and processes the embedding queue.
 *
 * @param jobId - Crawl job ID
 * @param apiKey - Optional API key
 *
 * @example
 * ```typescript
 * await handleManualEmbedding('job-123', 'my-api-key');
 * ```
 */
export async function handleManualEmbedding(
  jobId: string,
  apiKey?: string
): Promise<void> {
  const { processEmbedQueue } = await import('../../utils/background-embedder');
  const { enqueueEmbedJob, getEmbedJob } = await import(
    '../../utils/embed-queue'
  );

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
    let url: string;
    if (Array.isArray(status.data) && status.data.length > 0) {
      const sourceURL = status.data[0]?.metadata?.sourceURL;
      if (sourceURL && typeof sourceURL === 'string') {
        url = sourceURL;
      } else {
        console.warn(
          `Warning: No valid source URL found, using job ID as fallback`
        );
        url = jobId;
      }
    } else {
      console.warn(`Warning: No crawl data available, using job ID as URL`);
      url = jobId;
    }

    enqueueEmbedJob(jobId, url, apiKey);
  }

  // Process queue
  console.error(`Processing embedding queue for job ${jobId}...`);
  await processEmbedQueue();
  console.error(`Embedding processing complete`);
}
