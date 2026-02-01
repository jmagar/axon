/**
 * Background embedder for async, resilient embedding
 *
 * Processes embedding queue in the background with retries and exponential backoff.
 * Can be spawned as a detached process or run inline.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { Document } from '@mendable/firecrawl-js';
import { getClient } from './client';
import { getConfig, initializeConfig } from './config';
import {
  cleanupOldJobs,
  type EmbedJob,
  getEmbedJob,
  getPendingJobs,
  getStalePendingJobs,
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
  updateEmbedJob,
} from './embed-queue';
import {
  EMBEDDER_WEBHOOK_HEADER,
  extractEmbedderWebhookJobInfo,
  getEmbedderWebhookSettings,
} from './embedder-webhook';
import { batchEmbed, createEmbedItems } from './embedpipeline';

const POLL_INTERVAL_MS = 10000; // 10 seconds (retry base)
const BACKOFF_MULTIPLIER = 2;
const MAX_BACKOFF_MS = 60000; // 1 minute

/**
 * Calculate backoff delay with exponential backoff
 */
function getBackoffDelay(retries: number): number {
  const delay = Math.min(
    POLL_INTERVAL_MS * BACKOFF_MULTIPLIER ** retries,
    MAX_BACKOFF_MS
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
    `[Embedder] Processing job ${job.jobId} (attempt ${job.retries + 1}/${job.maxRetries})`
  );

  try {
    markJobProcessing(job.jobId);

    // Initialize config if needed (for standalone process)
    const config = getConfig();
    if (!config.teiUrl || !config.qdrantUrl) {
      initializeConfig({ apiKey: job.apiKey });
    }

    // Check if TEI/Qdrant are configured
    const finalConfig = getConfig();
    if (!finalConfig.teiUrl || !finalConfig.qdrantUrl) {
      throw new Error(
        'TEI_URL or QDRANT_URL not configured - skipping embedding'
      );
    }

    // Get crawl status and data (from webhook or API)
    const client = getClient({ apiKey: job.apiKey });
    const status = crawlStatus?.status
      ? crawlStatus
      : await client.getCrawlStatus(job.jobId);

    if (status.status === 'failed' || status.status === 'cancelled') {
      throw new Error(`Crawl ${status.status}, cannot embed`);
    }

    if (status.status !== 'completed') {
      // Still processing, re-queue for later
      console.error(
        `[Embedder] Job ${job.jobId} still ${status.status}, will retry later`
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
      console.error(`[Embedder] Job ${job.jobId} has no pages to embed`);
      markJobCompleted(job.jobId);
      return;
    }

    // Embed pages
    console.error(`[Embedder] Embedding ${pages.length} pages for ${job.url}`);
    const embedItems = createEmbedItems(pages, 'crawl');
    await batchEmbed(embedItems);

    console.error(
      `[Embedder] Successfully embedded ${pages.length} pages for ${job.url}`
    );
    markJobCompleted(job.jobId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Embedder] Job ${job.jobId} failed:`, errorMsg);
    markJobFailed(job.jobId, errorMsg);

    // Apply backoff for next retry
    if (job.retries + 1 < job.maxRetries) {
      const delay = getBackoffDelay(job.retries);
      console.error(`[Embedder] Will retry in ${delay / 1000}s`);
    }
  }
}

/**
 * Process all pending jobs in the queue
 */
export async function processEmbedQueue(): Promise<void> {
  const pendingJobs = getPendingJobs();

  if (pendingJobs.length === 0) {
    return;
  }

  console.error(`[Embedder] Processing ${pendingJobs.length} pending jobs`);

  // Process jobs sequentially to avoid overwhelming TEI/Qdrant
  for (const job of pendingJobs) {
    await processEmbedJob(job);
  }
}

/**
 * Process stale pending jobs once, returning count processed.
 */
export async function processStaleJobsOnce(maxAgeMs: number): Promise<number> {
  const staleJobs = getStalePendingJobs(maxAgeMs);
  if (staleJobs.length === 0) {
    return 0;
  }

  console.error(`[Embedder] Processing ${staleJobs.length} stale jobs`);
  for (const job of staleJobs) {
    await processEmbedJob(job);
  }

  return staleJobs.length;
}

async function readJsonBody(req: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
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
    console.error('[Embedder] Webhook payload missing job ID');
    return;
  }

  const job = getEmbedJob(info.jobId);
  if (!job) {
    console.error(`[Embedder] Webhook for unknown job: ${info.jobId}`);
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
    updateEmbedJob(job);
    return;
  }

  if (status !== 'completed') {
    console.error(
      `[Embedder] Ignoring webhook for ${info.jobId} with status ${info.status}`
    );
    return;
  }

  await processEmbedJob(job, {
    status: 'completed',
    data: info.pages,
  });
}

async function startEmbedderWebhookServer(): Promise<void> {
  const settings = getEmbedderWebhookSettings();
  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (req.method !== 'POST' || requestUrl.pathname !== settings.path) {
      res.statusCode = req.method === 'POST' ? 404 : 405;
      res.end();
      return;
    }

    if (settings.secret) {
      const provided = req.headers[EMBEDDER_WEBHOOK_HEADER];
      if (provided !== settings.secret) {
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
      console.error('[Embedder] Failed to parse webhook payload:', error);
      res.statusCode = 400;
      res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(settings.port, '0.0.0.0', () => resolve());
  });

  const localUrl = `http://localhost:${settings.port}${settings.path}`;
  console.error(`[Embedder] Webhook server listening on ${localUrl}`);

  if (!settings.url) {
    console.error(
      '[Embedder] FIRECRAWL_EMBEDDER_WEBHOOK_URL not set; configure a public URL to receive crawl completion events.'
    );
  }
}

/**
 * Start background embedder daemon
 *
 * Runs webhook server and processes jobs on completion events.
 */
export async function startEmbedderDaemon(): Promise<void> {
  console.error('[Embedder] Starting background embedder daemon');

  // Clean up old jobs on startup
  const cleaned = cleanupOldJobs(24);
  if (cleaned > 0) {
    console.error(`[Embedder] Cleaned up ${cleaned} old jobs`);
  }

  await startEmbedderWebhookServer();

  const staleMinutes = Number.parseFloat(
    process.env.FIRECRAWL_EMBEDDER_STALE_MINUTES ?? '10'
  );
  const staleMs =
    Number.isFinite(staleMinutes) && staleMinutes > 0
      ? staleMinutes * 60_000
      : 10 * 60_000;
  const intervalMs = Math.max(60_000, Math.floor(staleMs / 2));

  console.error(
    `[Embedder] Checking for stale jobs every ${Math.round(intervalMs / 1000)}s (stale after ${Math.round(staleMs / 1000)}s)`
  );

  void processStaleJobsOnce(staleMs).catch((error) => {
    console.error('[Embedder] Failed to process stale jobs:', error);
  });

  setInterval(() => {
    void processStaleJobsOnce(staleMs).catch((error) => {
      console.error('[Embedder] Failed to process stale jobs:', error);
    });
  }, intervalMs);
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

  console.error('[Embedder] Background embedder spawned');
}

/**
 * Check if embedder daemon is running
 */
export function isEmbedderRunning(): boolean {
  // TODO: Implement proper daemon detection (PID file, process check, etc.)
  // For now, always return false (embedder runs on-demand)
  return false;
}
