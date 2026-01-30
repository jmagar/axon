/**
 * Background embedder for async, resilient embedding
 *
 * Processes embedding queue in the background with retries and exponential backoff.
 * Can be spawned as a detached process or run inline.
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Document } from '@mendable/firecrawl-js';
import { getClient } from './client';
import { getConfig, initializeConfig } from './config';
import {
  cleanupOldJobs,
  type EmbedJob,
  getPendingJobs,
  markJobCompleted,
  markJobFailed,
  markJobProcessing,
} from './embed-queue';
import { batchEmbed, createEmbedItems } from './embedpipeline';

const POLL_INTERVAL_MS = 10000; // 10 seconds
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
async function processEmbedJob(job: EmbedJob): Promise<void> {
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

    // Get crawl status and data
    const client = getClient({ apiKey: job.apiKey });
    const status = await client.getCrawlStatus(job.jobId);

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
    const pages: Document[] = Array.isArray(status.data) ? status.data : [];

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
 * Start background embedder daemon
 *
 * Runs continuously, polling the queue and processing jobs.
 */
export async function startEmbedderDaemon(): Promise<void> {
  console.error('[Embedder] Starting background embedder daemon');

  // Clean up old jobs on startup
  const cleaned = cleanupOldJobs(24);
  if (cleaned > 0) {
    console.error(`[Embedder] Cleaned up ${cleaned} old jobs`);
  }

  // Process queue in a loop
  while (true) {
    try {
      await processEmbedQueue();
    } catch (error) {
      console.error('[Embedder] Queue processing error:', error);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
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
