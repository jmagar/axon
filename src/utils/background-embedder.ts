/**
 * Background embedder for async, resilient embedding
 *
 * Processes embedding queue in the background with retries and exponential backoff.
 * Can be spawned as a detached process or run inline.
 */

import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { Document } from '@mendable/firecrawl-js';
import { createDaemonContainer } from '../container/DaemonContainerFactory';
import type { IContainer, ImmutableConfig } from '../container/types';
import { createEmbedItems } from '../container/utils/embed-helpers';
import {
  cleanupIrrecoverableFailedJobs,
  cleanupOldJobs,
  type EmbedJob,
  getEmbedJob,
  getPendingJobs,
  getQueueStats,
  getStalePendingJobs,
  getStuckProcessingJobs,
  markJobCompleted,
  markJobConfigError,
  markJobFailed,
  markJobPendingNoRetry,
  markJobPermanentFailed,
  markJobProcessing,
  updateEmbedJob,
  updateJobProgress,
} from './embed-queue';
import {
  EMBEDDER_WEBHOOK_HEADER,
  extractEmbedderWebhookJobInfo,
  getEmbedderWebhookSettings,
} from './embedder-webhook';
import { isJobNotFoundError } from './job-errors';
import { getSettings } from './settings';
import { fmt } from './theme';

const BACKOFF_MULTIPLIER = 2;
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB request body limit

function isPermanentJobError(error: string): boolean {
  return isJobNotFoundError(error);
}

// String matching is necessary here because the Firecrawl API returns plain
// error messages (e.g. "Crawl still scraping"), not structured error codes.
// The message is generated locally in processEmbedJob (line ~152) so the
// format is stable within this codebase.
function isCrawlStillRunningError(error: string): boolean {
  return error.toLowerCase().startsWith('crawl still ');
}

/**
 * Log embedder configuration for debugging
 */
export function logEmbedderConfig(config: Partial<ImmutableConfig>): void {
  console.error(fmt.dim('[Embedder] Config:'));
  console.error(
    fmt.dim(`[Embedder]   TEI_URL: ${config.teiUrl || '(not configured)'}`)
  );
  console.error(
    fmt.dim(
      `[Embedder]   QDRANT_URL: ${config.qdrantUrl || '(not configured)'}`
    )
  );
  console.error(
    fmt.dim(
      `[Embedder]   QDRANT_COLLECTION: ${config.qdrantCollection || 'firecrawl'}`
    )
  );
}

/**
 * Calculate backoff delay with exponential backoff
 */
function getBackoffDelay(retries: number): number {
  const settings = getSettings();
  const pollIntervalMs = settings.polling.intervalMs;
  const maxBackoffMs = settings.http.maxDelayMs;
  const delay = Math.min(
    pollIntervalMs * BACKOFF_MULTIPLIER ** retries,
    maxBackoffMs
  );
  return delay;
}

/**
 * Process a single embedding job
 */
async function processEmbedJob(
  job: EmbedJob,
  crawlStatus?: { status?: string; data?: Document[] }
): Promise<void> {
  console.error(
    fmt.dim(
      `[Embedder] Processing job ${job.jobId} (attempt ${job.retries + 1}/${job.maxRetries})`
    )
  );

  try {
    await markJobProcessing(job.jobId);
    // Keep in-memory state aligned so later updateEmbedJob() calls
    // do not overwrite processing status back to pending.
    job.status = 'processing';

    // Create job-specific container with job's API key
    const jobContainer = createDaemonContainer({
      apiKey: job.apiKey,
    });

    // Check if TEI/Qdrant are configured
    if (!jobContainer.config.teiUrl || !jobContainer.config.qdrantUrl) {
      const missingConfigs = [];
      if (!jobContainer.config.teiUrl) missingConfigs.push('TEI_URL');
      if (!jobContainer.config.qdrantUrl) missingConfigs.push('QDRANT_URL');

      const errorMsg = `Missing required configuration: ${missingConfigs.join(', ')}. Set these environment variables to enable embedding.`;

      console.error(fmt.error(`[Embedder] CONFIGURATION ERROR: ${errorMsg}`));
      console.error(
        fmt.dim(
          `[Embedder] To enable embedding, configure:\n` +
            `  - TEI_URL: Text Embeddings Inference service endpoint (e.g., http://localhost:53080)\n` +
            `  - QDRANT_URL: Qdrant vector database endpoint (e.g., http://localhost:53333)`
        )
      );

      await markJobConfigError(job.jobId, errorMsg);
      return;
    }

    // Get crawl status and data (from webhook or API)
    const client = jobContainer.getFirecrawlClient();
    const status = crawlStatus?.status
      ? crawlStatus
      : await client.getCrawlStatus(job.jobId);

    if (status.status === 'failed' || status.status === 'cancelled') {
      throw new Error(`Crawl ${status.status}, cannot embed`);
    }

    if (status.status !== 'completed') {
      // Still processing, re-queue for later
      console.error(
        fmt.warning(
          `[Embedder] Job ${job.jobId} still ${status.status}, will retry later`
        )
      );
      throw new Error(`Crawl still ${status.status}`);
    }

    // Extract pages
    let pages: Document[] = Array.isArray(status.data)
      ? status.data
      : Array.isArray(crawlStatus?.data)
        ? crawlStatus.data
        : [];

    if (pages.length === 0 && status.status === 'completed') {
      const refreshed = await client.getCrawlStatus(job.jobId);
      pages = Array.isArray(refreshed.data) ? refreshed.data : [];
    }

    if (pages.length === 0) {
      console.error(
        fmt.warning(`[Embedder] Job ${job.jobId} has no pages to embed`)
      );
      // Initialize with zero progress for empty jobs
      job.totalDocuments = 0;
      job.processedDocuments = 0;
      job.failedDocuments = 0;
      await markJobCompleted(job.jobId);
      return;
    }

    // Initialize progress tracking
    job.totalDocuments = pages.length;
    job.processedDocuments = 0;
    job.failedDocuments = 0;
    await updateEmbedJob(job);

    // Embed pages using job-specific container config
    console.error(
      fmt.dim(`[Embedder] Embedding ${pages.length} pages for ${job.url}`)
    );
    // Transform pages to embed items and use container's EmbedPipeline
    const embedItems = createEmbedItems(pages, 'crawl').map((item) => ({
      content: item.content,
      metadata: {
        url: item.metadata.url,
        title: item.metadata.title,
        sourceCommand: item.metadata.sourceCommand,
        contentType: item.metadata.contentType,
      },
    }));
    const pipeline = jobContainer.getEmbedPipeline();

    // Track progress with throttled persistence
    let updateCounter = 0;
    const THROTTLE_INTERVAL = 10; // Update disk every 10 documents

    const result = await pipeline.batchEmbed(embedItems, {
      onProgress: async (current, _total) => {
        updateCounter++;
        const shouldPersist = updateCounter % THROTTLE_INTERVAL === 0;

        // Use current count from callback (result is not yet available)
        await updateJobProgress(
          job.jobId,
          current,
          0, // Failed count not available during progress, updated at completion
          shouldPersist
        ).catch((error) => {
          // Log but don't throw - embedding should continue even if progress update fails
          console.error(
            fmt.warning(
              `[Embedder] Failed to persist progress: ${error instanceof Error ? error.message : String(error)}`
            )
          );
        });
      },
    });

    // Final progress update on completion
    job.processedDocuments = result.succeeded;
    job.failedDocuments = result.failed;

    // Log partial failures if any
    if (result.failed > 0) {
      const total = result.succeeded + result.failed;
      console.error(
        fmt.warning(
          `[Embedder] Partial embed: ${result.succeeded}/${total} succeeded`
        )
      );
    } else {
      console.error(
        fmt.success(
          `[Embedder] Successfully embedded ${result.succeeded} pages for ${job.url}`
        )
      );
    }
    await markJobCompleted(job.jobId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (isCrawlStillRunningError(errorMsg)) {
      console.error(
        fmt.warning(
          `[Embedder] Job ${job.jobId} deferred (no retry consumed): ${errorMsg}`
        )
      );
      await markJobPendingNoRetry(job.jobId, errorMsg);
      return;
    }

    console.error(fmt.error(`[Embedder] Job ${job.jobId} failed: ${errorMsg}`));
    if (isPermanentJobError(errorMsg)) {
      await markJobPermanentFailed(job.jobId, errorMsg);
    } else {
      await markJobFailed(job.jobId, errorMsg);
    }

    // Apply backoff for next retry
    if (!isPermanentJobError(errorMsg) && job.retries + 1 < job.maxRetries) {
      const delay = getBackoffDelay(job.retries);
      console.error(fmt.dim(`[Embedder] Will retry in ${delay / 1000}s`));
    }
  }
}

/**
 * Process all pending jobs in the queue
 */
export async function processEmbedQueue(_container: IContainer): Promise<void> {
  const pendingJobs = await getPendingJobs();

  if (pendingJobs.length === 0) {
    return;
  }

  console.error(
    fmt.dim(`[Embedder] Processing ${pendingJobs.length} pending jobs`)
  );

  // Process jobs sequentially to avoid overwhelming TEI/Qdrant
  for (const job of pendingJobs) {
    await processEmbedJob(job);
  }
}

/**
 * Process stale pending jobs once, returning count processed.
 */
export async function processStaleJobsOnce(
  _container: IContainer,
  maxAgeMs: number
): Promise<number> {
  // First, recover any stuck processing jobs (use shorter threshold for faster recovery)
  const stuckMaxAgeMs = 5 * 60_000; // 5 minutes
  const stuckJobs = await getStuckProcessingJobs(stuckMaxAgeMs);
  if (stuckJobs.length > 0) {
    console.error(
      fmt.dim(`[Embedder] Recovering ${stuckJobs.length} stuck processing jobs`)
    );
    for (const job of stuckJobs) {
      job.status = 'pending';
      await updateEmbedJob(job);
    }
  }

  // Then process stale pending jobs
  const staleJobs = await getStalePendingJobs(maxAgeMs);
  if (staleJobs.length > 0) {
    console.error(
      fmt.dim(`[Embedder] Processing ${staleJobs.length} stale jobs`)
    );
    for (const job of staleJobs) {
      await processEmbedJob(job);
    }
  }

  const irrecoverableCleaned = await cleanupIrrecoverableFailedJobs();
  if (irrecoverableCleaned > 0) {
    console.error(
      fmt.dim(
        `[Embedder] Removed ${irrecoverableCleaned} irrecoverable failed job(s)`
      )
    );
  }

  return staleJobs.length;
}

async function readJsonBody(req: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalSize = 0;

  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalSize += buffer.length;

    if (totalSize > MAX_BODY_SIZE) {
      throw new Error(
        `Request body too large (${totalSize} bytes exceeds ${MAX_BODY_SIZE} bytes)`
      );
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

async function handleWebhookPayload(payload: unknown): Promise<void> {
  const info = extractEmbedderWebhookJobInfo(payload);
  if (!info) {
    console.error(fmt.error('[Embedder] Webhook payload missing job ID'));
    return;
  }

  const job = await getEmbedJob(info.jobId);
  if (!job) {
    console.error(
      fmt.error(`[Embedder] Webhook for unknown job: ${info.jobId}`)
    );
    return;
  }

  if (job.status === 'completed') {
    return;
  }

  const status = info.status?.toLowerCase();
  if (status === 'failed' || status === 'cancelled') {
    job.status = 'failed';
    job.retries = job.maxRetries;
    job.lastError = `Crawl ${status}`;
    await updateEmbedJob(job);
    return;
  }

  if (status !== 'completed') {
    console.error(
      fmt.warning(
        `[Embedder] Ignoring webhook for ${info.jobId} with status ${info.status}`
      )
    );
    return;
  }

  await processEmbedJob(job, {
    status: 'completed',
    data: info.pages,
  });
}

async function startEmbedderWebhookServer(container: IContainer): Promise<{
  intervalMs: number;
  staleMs: number;
  server: ReturnType<typeof createServer>;
}> {
  const settings = getEmbedderWebhookSettings(container.config);

  // Calculate polling intervals
  const staleMinutes = Number.parseFloat(
    process.env.FIRECRAWL_EMBEDDER_STALE_MINUTES ?? '10'
  );
  const staleMs =
    Number.isFinite(staleMinutes) && staleMinutes > 0
      ? staleMinutes * 60_000
      : 10 * 60_000;
  const intervalMs = Math.max(60_000, Math.floor(staleMs / 2));

  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');

    // Health check endpoint for daemon detection
    if (req.method === 'GET' && requestUrl.pathname === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', service: 'embedder-daemon' }));
      return;
    }

    // Status endpoint for monitoring
    if (req.method === 'GET' && requestUrl.pathname === '/status') {
      const stats = await getQueueStats();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          webhookConfigured: !!settings.url,
          pollingIntervalMs: intervalMs,
          staleThresholdMs: staleMs,
          pendingJobs: stats.pending,
          processingJobs: stats.processing,
        })
      );
      return;
    }

    if (req.method !== 'POST' || requestUrl.pathname !== settings.path) {
      res.statusCode = req.method === 'POST' ? 404 : 405; // 404 for wrong path, 405 for wrong method
      res.end();
      return;
    }

    if (settings.secret) {
      const provided = req.headers[EMBEDDER_WEBHOOK_HEADER];

      // Type check and validate provided secret
      if (!provided || typeof provided !== 'string') {
        res.statusCode = 401;
        res.end();
        return;
      }

      // Convert to buffers for timing-safe comparison
      const providedBuf = Buffer.from(provided, 'utf8');
      const secretBuf = Buffer.from(settings.secret, 'utf8');

      // Length check before comparison (timingSafeEqual requires equal lengths)
      if (providedBuf.length !== secretBuf.length) {
        res.statusCode = 401;
        res.end();
        return;
      }

      // Use constant-time comparison to prevent timing attacks
      try {
        if (!timingSafeEqual(providedBuf, secretBuf)) {
          res.statusCode = 401;
          res.end();
          return;
        }
      } catch {
        // timingSafeEqual can throw if lengths don't match (shouldn't happen due to check above)
        res.statusCode = 401;
        res.end();
        return;
      }
    }

    try {
      const payload = await readJsonBody(req);
      void handleWebhookPayload(payload);
      res.statusCode = 202;
      res.end();
    } catch (error) {
      console.error(
        fmt.error(
          `[Embedder] Failed to parse webhook payload: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      res.statusCode = 400;
      res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(settings.port, '0.0.0.0', () => resolve());
  });

  const localUrl = `http://localhost:${settings.port}${settings.path}`;
  console.error(fmt.dim(`[Embedder] Webhook server listening on ${localUrl}`));

  if (!settings.url) {
    console.error(fmt.warning('[Embedder] WARNING: No webhook URL configured'));
    console.error(
      fmt.dim(
        `[Embedder] Jobs will be processed via polling (every ${Math.round(intervalMs / 1000)}s, stale after ${Math.round(staleMs / 1000)}s)`
      )
    );
    console.error(
      fmt.dim(
        '[Embedder] For faster processing, set FIRECRAWL_EMBEDDER_WEBHOOK_URL'
      )
    );
  }

  return { intervalMs, staleMs, server };
}

/**
 * Start background embedder daemon
 *
 * Runs webhook server and processes jobs on completion events.
 * Returns async cleanup function to stop server and interval.
 */
export async function startEmbedderDaemon(
  container: IContainer
): Promise<() => Promise<void>> {
  console.error(fmt.dim('[Embedder] Starting background embedder daemon'));
  logEmbedderConfig(container.config);

  // Track consecutive failures for health monitoring
  let consecutiveFailures = 0;
  const MAX_FAILURES_BEFORE_ALERT = 3;

  // Clean up old jobs on startup
  const cleaned = await cleanupOldJobs(24);
  if (cleaned > 0) {
    console.error(fmt.dim(`[Embedder] Cleaned up ${cleaned} old jobs`));
  }

  const { intervalMs, staleMs, server } =
    await startEmbedderWebhookServer(container);

  console.error(
    fmt.dim(
      `[Embedder] Checking for stale jobs every ${Math.round(intervalMs / 1000)}s (stale after ${Math.round(staleMs / 1000)}s)`
    )
  );

  void processStaleJobsOnce(container, staleMs)
    .then(() => {
      // Reset failure counter on success
      if (consecutiveFailures > 0) {
        console.error(fmt.dim('[Embedder] Stale job processing recovered'));
        consecutiveFailures = 0;
      }
    })
    .catch((error) => {
      consecutiveFailures++;
      const failureMsg = `[Embedder] Failed to process stale jobs (${consecutiveFailures} consecutive failures): ${error instanceof Error ? error.message : String(error)}`;

      if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT) {
        console.error(fmt.error(`CRITICAL: ${failureMsg}`));
        console.error(
          fmt.error(
            '[Embedder] Daemon may be unhealthy - check TEI/Qdrant connectivity'
          )
        );
      } else {
        console.error(fmt.error(failureMsg));
      }
    });

  const intervalId = setInterval(() => {
    void processStaleJobsOnce(container, staleMs)
      .then(() => {
        // Reset failure counter on success
        if (consecutiveFailures > 0) {
          console.error(fmt.dim('[Embedder] Stale job processing recovered'));
          consecutiveFailures = 0;
        }
      })
      .catch((error) => {
        consecutiveFailures++;
        const failureMsg = `[Embedder] Failed to process stale jobs (${consecutiveFailures} consecutive failures): ${error instanceof Error ? error.message : String(error)}`;

        if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT) {
          console.error(fmt.error(`CRITICAL: ${failureMsg}`));
          console.error(
            fmt.error(
              '[Embedder] Daemon may be unhealthy - check TEI/Qdrant connectivity'
            )
          );
        } else {
          console.error(fmt.error(failureMsg));
        }
      });
  }, intervalMs);

  // Return async cleanup function
  return async () => {
    clearInterval(intervalId);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };
}

/**
 * Spawn background embedder as detached process
 *
 * Returns immediately, embedder runs in background.
 */
export function spawnBackgroundEmbedder(): void {
  // Get the path to the embedder script
  const scriptPath = join(__dirname, '..', '..', 'dist', 'embedder-daemon.js');

  // Spawn detached process
  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  console.error(fmt.dim('[Embedder] Background embedder spawned'));
}

/**
 * Check if embedder daemon is running
 *
 * Attempts to connect to the webhook server to verify daemon is responsive.
 */
export async function isEmbedderRunning(
  container?: IContainer
): Promise<boolean> {
  const settings = getEmbedderWebhookSettings(container?.config);

  try {
    // Attempt HTTP GET to webhook server (returns 200 with health status)
    const response = await fetch(`http://localhost:${settings.port}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(1000),
    });

    // Only treat a healthy response as running (2xx status codes)
    return response.ok;
  } catch (_error) {
    // Connection refused, timeout, or network error means daemon is not running
    return false;
  }
}
