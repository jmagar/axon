/**
 * Embedding orchestration for crawl results
 */

import type { CrawlOptions as FirecrawlCrawlOptions } from '@mendable/firecrawl-js';
import type { IContainer, ImmutableConfig } from '../../container/types';
import type { CrawlJobData } from '../../types/crawl';
import { buildEmbedderWebhookConfig } from '../../utils/embedder-webhook';
import { recordJob } from '../../utils/job-history';
import { fmt, icons } from '../../utils/theme';

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
  isWaitMode: boolean,
  config: ImmutableConfig
): T {
  // Only attach webhook for async mode with embedding enabled
  if (shouldEmbed && !isWaitMode) {
    const webhookConfig = buildEmbedderWebhookConfig(config);
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
  config: ImmutableConfig,
  apiKey?: string
): Promise<void> {
  const { enqueueEmbedJob } = await import('../../utils/embed-queue');
  const webhookConfig = buildEmbedderWebhookConfig(config);

  await enqueueEmbedJob(jobId, url, apiKey);
  console.error();
  console.error(
    `  ${fmt.primary(icons.pending)} Queued embedding job for background processing: ${fmt.dim(jobId)}`
  );

  if (webhookConfig) {
    console.error(
      fmt.dim(
        '  Embeddings will be generated automatically when crawl completes via webhook.'
      )
    );
  } else {
    console.error(
      fmt.warning(
        `  ${icons.warning} Embedder webhook not configured. Set FIRECRAWL_EMBEDDER_WEBHOOK_URL to enable auto-embedding.`
      )
    );
    console.error(
      fmt.dim(
        `  Run 'firecrawl crawl ${jobId} --embed' to embed after completion.`
      )
    );
  }
}

/**
 * Handle synchronous embedding for crawl results
 *
 * Embeds pages inline (used with --wait or --progress mode).
 *
 * @param container - Dependency injection container
 * @param crawlJobData - Completed crawl job data
 *
 * @example
 * ```typescript
 * await handleSyncEmbedding(container, crawlJobData);
 * ```
 */
export async function handleSyncEmbedding(
  container: IContainer,
  crawlJobData: CrawlJobData
): Promise<void> {
  if (crawlJobData.id) {
    await recordJob('crawl', crawlJobData.id);
  }

  const pagesToEmbed = crawlJobData.data ?? [];
  if (pagesToEmbed.length === 0) {
    return;
  }

  const pipeline = container.getEmbedPipeline();
  const jobId = crawlJobData.id || 'unknown';

  // Embed each page using the pipeline
  for (let i = 0; i < pagesToEmbed.length; i++) {
    const page = pagesToEmbed[i];
    const content = page.markdown || page.html;
    if (content) {
      // Use deterministic fallback to prevent dedupe collisions from empty URLs
      const url =
        page.metadata?.sourceURL || page.metadata?.url || `${jobId}:page-${i}`;
      await pipeline.autoEmbed(content, {
        url,
        title: page.metadata?.title,
        sourceCommand: 'crawl',
        contentType: page.markdown ? 'markdown' : 'html',
      });
    }
  }
}

/**
 * Handle manual embedding for a completed crawl job
 *
 * Checks job status, enqueues if not already queued,
 * and processes the embedding queue.
 *
 * @param container - Dependency injection container
 * @param jobId - Crawl job ID
 * @param apiKey - Optional API key
 *
 * @example
 * ```typescript
 * await handleManualEmbedding(container, 'job-123', 'my-api-key');
 * ```
 */
export async function handleManualEmbedding(
  container: IContainer,
  jobId: string,
  apiKey?: string
): Promise<void> {
  const { processEmbedQueue } = await import('../../utils/background-embedder');
  const { enqueueEmbedJob, getEmbedJob } = await import(
    '../../utils/embed-queue'
  );

  // Check if already queued
  const existingJob = await getEmbedJob(jobId);

  if (!existingJob) {
    // Get crawl info to queue it (only need first page for URL extraction)
    const app = container.getFirecrawlClient();
    const status = await app.getCrawlStatus(jobId, { autoPaginate: false });

    if (status.status !== 'completed') {
      console.error(
        fmt.warning(
          `${icons.warning} Crawl ${jobId} is ${status.status}, cannot embed yet`
        )
      );
      return;
    }

    // Use the first page URL as the URL or fall back to job ID
    let url: string;
    if (Array.isArray(status.data) && status.data.length > 0) {
      const sourceURL = status.data[0]?.metadata?.sourceURL;
      if (sourceURL && typeof sourceURL === 'string') {
        url = sourceURL;
      } else {
        console.error(
          fmt.warning(
            `${icons.warning} No valid source URL found, using job ID as fallback`
          )
        );
        url = jobId;
      }
    } else {
      console.error(
        fmt.warning(
          `${icons.warning} No crawl data available, using job ID as URL`
        )
      );
      url = jobId;
    }

    await enqueueEmbedJob(jobId, url, apiKey);
  }

  // Process queue
  console.error(
    `  ${fmt.primary(icons.processing)} Processing embedding queue for job ${fmt.dim(jobId)}...`
  );
  await processEmbedQueue(container);
  console.error(
    `  ${fmt.success(icons.success)} Embedding processing complete`
  );
}
