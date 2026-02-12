/**
 * Embedding queue for resilient, async embedding operations
 *
 * Persists embedding jobs to disk so they survive process interruptions.
 * Supports background processing with retries and exponential backoff.
 */

import {
  access,
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as lockfile from 'proper-lockfile';
import { isJobNotFoundError } from './job-errors';
import { getSettings } from './settings';
import { getEmbedQueueDir } from './storage-paths';
import { fmt } from './theme';

/**
 * Check if a path exists
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write file with secure permissions (owner-only read/write)
 */
async function writeSecureFile(filePath: string, data: string): Promise<void> {
  await writeFile(filePath, data, { mode: 0o600 });
}

export interface EmbedJob {
  id: string;
  jobId: string;
  url: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retries: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  apiKey?: string;
  // Progress tracking for background processing and status reporting
  totalDocuments?: number;
  processedDocuments?: number;
  failedDocuments?: number;
  progressUpdatedAt?: string;
}

function getQueueDir(): string {
  return getEmbedQueueDir();
}

function getLegacyQueueDir(): string {
  const homeDir = homedir();
  return join(homeDir, '.config', 'firecrawl-cli', 'embed-queue');
}

async function migrateLegacyQueueDir(): Promise<void> {
  if (process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR) {
    return;
  }

  const legacyDir = getLegacyQueueDir();
  const queueDir = getQueueDir();
  if (legacyDir === queueDir) {
    return;
  }

  if (!(await pathExists(legacyDir)) || (await pathExists(queueDir))) {
    return;
  }

  await mkdir(queueDir, { recursive: true, mode: 0o700 });
  const files = await readdir(legacyDir);
  for (const file of files) {
    try {
      const source = join(legacyDir, file);
      const target = join(queueDir, file);
      await copyFile(source, target);
    } catch (error) {
      // Continue on individual file copy errors
      console.error(
        fmt.error(
          `[Embed Queue] Failed to copy ${file}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }
  console.error(
    fmt.dim(
      `[Embed Queue] Migrated queue files from ${legacyDir} to ${queueDir}`
    )
  );
}

/**
 * Ensure queue directory exists with secure permissions
 */
async function ensureQueueDir(): Promise<void> {
  await migrateLegacyQueueDir();

  if (!(await pathExists(getQueueDir()))) {
    await mkdir(getQueueDir(), { recursive: true, mode: 0o700 });
    return;
  }

  try {
    await chmod(getQueueDir(), 0o700);
  } catch {
    // Ignore errors on Windows
  }
}

/**
 * Get path for a job file
 */
function getJobPath(jobId: string): string {
  return join(getQueueDir(), `${jobId}.json`);
}

/**
 * Add a new embedding job to the queue
 */
export async function enqueueEmbedJob(
  jobId: string,
  url: string,
  apiKey?: string
): Promise<EmbedJob> {
  await ensureQueueDir();

  const job: EmbedJob = {
    id: jobId,
    jobId,
    url,
    status: 'pending',
    retries: 0,
    maxRetries: getSettings().embedding.maxRetries,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    apiKey,
  };

  await writeSecureFile(getJobPath(jobId), JSON.stringify(job, null, 2));
  return job;
}

export interface JobReadResult {
  job: EmbedJob | null;
  /** 'found' | 'not_found' | 'corrupted' */
  status: 'found' | 'not_found' | 'corrupted';
  error?: string;
}

/**
 * Get a job from the queue with detailed error reporting
 *
 * Distinguishes between "not found" and "corrupted" states, allowing callers
 * to handle each case appropriately (e.g., warn about corruption, suggest repair).
 */
export async function getEmbedJobDetailed(
  jobId: string
): Promise<JobReadResult> {
  const path = getJobPath(jobId);
  if (!(await pathExists(path))) {
    return { job: null, status: 'not_found' };
  }

  try {
    const data = await readFile(path, 'utf-8');
    const job = JSON.parse(data);
    return { job, status: 'found' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(fmt.error(`Failed to read job ${jobId}: ${errorMsg}`));
    console.warn(
      fmt.warning(`Job file may be corrupted. Consider removing: ${path}`)
    );
    return { job: null, status: 'corrupted', error: errorMsg };
  }
}

/**
 * Get a job from the queue (legacy compatibility)
 *
 * @deprecated Use getEmbedJobDetailed() to distinguish "not found" from "corrupted"
 */
export async function getEmbedJob(jobId: string): Promise<EmbedJob | null> {
  const result = await getEmbedJobDetailed(jobId);
  return result.job;
}

/**
 * Update a job in the queue
 */
export async function updateEmbedJob(job: EmbedJob): Promise<void> {
  await ensureQueueDir();
  job.updatedAt = new Date().toISOString();
  await writeSecureFile(getJobPath(job.jobId), JSON.stringify(job, null, 2));
}

/**
 * Atomically claim a job for processing using file locking.
 * Only succeeds if job is in 'pending' status.
 * @returns true if job was successfully claimed, false otherwise
 */
export async function tryClaimJob(jobId: string): Promise<boolean> {
  const jobPath = getJobPath(jobId);
  if (!(await pathExists(jobPath))) return false;

  let release: (() => void) | undefined;
  try {
    // Acquire lock BEFORE reading job status to prevent TOCTOU race
    release = await lockfile.lock(jobPath, { retries: 0, stale: 60000 });

    // Read job file directly while holding lock (don't use getEmbedJob which doesn't know about our lock)
    const data = await readFile(jobPath, 'utf-8');
    const job: EmbedJob = JSON.parse(data);

    // Check status while holding lock
    if (!job || job.status !== 'pending') {
      return false;
    }

    // Update status while holding lock
    job.status = 'processing';
    job.updatedAt = new Date().toISOString();
    await writeSecureFile(jobPath, JSON.stringify(job, null, 2));

    return true;
  } catch (error) {
    // Log specific error details for debugging
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    // Categorize error types for better diagnostics
    if (errorMsg.includes('EACCES')) {
      console.error(
        fmt.error(`Failed to claim job ${jobId}: Permission denied (EACCES)`)
      );
    } else if (errorMsg.includes('ENOSPC')) {
      console.error(
        fmt.error(
          `Failed to claim job ${jobId}: No space left on device (ENOSPC)`
        )
      );
    } else if (errorMsg.includes('EIO')) {
      console.error(fmt.error(`Failed to claim job ${jobId}: I/O error (EIO)`));
    } else if (errorName === 'SyntaxError') {
      console.error(
        fmt.error(`Failed to claim job ${jobId}: Corrupted JSON in job file`)
      );
    } else if (errorMsg.includes('lock')) {
      console.error(
        fmt.error(
          `Failed to claim job ${jobId}: Lock acquisition failed - ${errorMsg}`
        )
      );
    } else {
      console.error(
        fmt.error(`Failed to claim job ${jobId}: ${errorName} - ${errorMsg}`)
      );
    }

    return false;
  } finally {
    // Ensure lock is always released if acquired
    if (release) {
      try {
        await release();
      } catch (releaseError) {
        // Log release errors separately to avoid masking the original error
        const releaseMsg =
          releaseError instanceof Error
            ? releaseError.message
            : String(releaseError);
        console.error(
          fmt.error(`Failed to release lock for job ${jobId}: ${releaseMsg}`)
        );
      }
    }
  }
}

/**
 * Remove a job from the queue
 */
export async function removeEmbedJob(jobId: string): Promise<void> {
  const path = getJobPath(jobId);
  if (await pathExists(path)) {
    await unlink(path);
  }
}

export interface QueueListResult {
  jobs: EmbedJob[];
  skipped: number;
  errors: Array<{ file: string; error: string }>;
}

/**
 * List all jobs in the queue with error tracking
 *
 * Returns structured data that distinguishes between valid jobs and corrupted files.
 * Callers can display warnings when files are skipped due to corruption.
 */
export async function listEmbedJobsDetailed(): Promise<QueueListResult> {
  await ensureQueueDir();

  const files = (await readdir(getQueueDir())).filter((f) =>
    f.endsWith('.json')
  );
  const jobs: EmbedJob[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    try {
      const data = await readFile(join(getQueueDir(), file), 'utf-8');
      jobs.push(JSON.parse(data));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ file, error: errorMsg });
      console.error(fmt.error(`Failed to read job file ${file}: ${errorMsg}`));
    }
  }

  // Display warning if files were skipped
  if (errors.length > 0) {
    console.warn(
      fmt.warning(
        `WARNING: Skipped ${errors.length} corrupted job file${errors.length > 1 ? 's' : ''}`
      )
    );
    console.warn(
      fmt.dim(
        `  Run 'firecrawl cleanup-queue' to remove corrupted files (if available)`
      )
    );
  }

  return { jobs, skipped: errors.length, errors };
}

/**
 * List all jobs in the queue (legacy compatibility)
 *
 * @deprecated Use listEmbedJobsDetailed() for better error visibility
 */
export async function listEmbedJobs(): Promise<EmbedJob[]> {
  const result = await listEmbedJobsDetailed();
  return result.jobs;
}

/**
 * Get all pending jobs (status: pending, not exceeded max retries)
 */
export async function getPendingJobs(): Promise<EmbedJob[]> {
  const jobs = await listEmbedJobs();
  return jobs
    .filter((job) => job.status === 'pending' && job.retries < job.maxRetries)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
}

/**
 * Get pending jobs that have been stale for at least maxAgeMs
 */
export async function getStalePendingJobs(
  maxAgeMs: number
): Promise<EmbedJob[]> {
  const cutoff = Date.now() - maxAgeMs;
  const jobs = await getPendingJobs();
  return jobs
    .filter((job) => new Date(job.updatedAt).getTime() <= cutoff)
    .sort(
      (a, b) =>
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    );
}

/**
 * Get jobs stuck in processing state longer than maxProcessingMs
 *
 * Returns jobs with status === 'processing' that have been in that state
 * longer than the specified threshold (default 5 minutes). This helps recover
 * from daemon crashes where jobs get stuck in processing state forever.
 */
export async function getStuckProcessingJobs(
  maxProcessingMs: number = 5 * 60 * 1000
): Promise<EmbedJob[]> {
  const cutoff = Date.now() - maxProcessingMs;
  const jobs = await listEmbedJobs();
  return jobs
    .filter(
      (job) =>
        job.status === 'processing' &&
        job.retries < job.maxRetries &&
        new Date(job.updatedAt).getTime() <= cutoff
    )
    .sort(
      (a, b) =>
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    );
}

/**
 * Mark a job as processing
 */
export async function markJobProcessing(jobId: string): Promise<void> {
  const job = await getEmbedJob(jobId);
  if (job) {
    job.status = 'processing';
    await updateEmbedJob(job);
  }
}

/**
 * Mark a job as completed and remove from queue
 */
export async function markJobCompleted(jobId: string): Promise<void> {
  const job = await getEmbedJob(jobId);
  if (job) {
    job.status = 'completed';
    await updateEmbedJob(job);
    // Keep completed jobs for a short time for audit/debugging
    // They can be cleaned up later
  }
}

/**
 * Mark a job as failed and increment retry counter
 */
export async function markJobFailed(
  jobId: string,
  error: string
): Promise<void> {
  const job = await getEmbedJob(jobId);
  if (job) {
    job.status = job.retries + 1 >= job.maxRetries ? 'failed' : 'pending';
    job.retries += 1;
    job.lastError = error;
    await updateEmbedJob(job);
  }
}

/**
 * Re-queue a job as pending without consuming a retry.
 *
 * Used for transient "upstream still running" states where retry budget
 * should not be burned.
 */
export async function markJobPendingNoRetry(
  jobId: string,
  error: string
): Promise<void> {
  const job = await getEmbedJob(jobId);
  if (job) {
    job.status = 'pending';
    job.lastError = error;
    await updateEmbedJob(job);
  }
}

/**
 * Mark a job as permanently failed due to configuration error
 *
 * Sets retries to maxRetries to prevent further retry attempts.
 */
export async function markJobConfigError(
  jobId: string,
  error: string
): Promise<void> {
  const job = await getEmbedJob(jobId);
  if (job) {
    job.status = 'failed';
    job.retries = job.maxRetries;
    job.lastError = `Configuration error: ${error}`;
    await updateEmbedJob(job);
  }
}

/**
 * Mark a job as permanently failed due to an unrecoverable runtime error.
 *
 * Sets retries to maxRetries to prevent retry loops for deterministic failures
 * (e.g., invalid job IDs or deleted upstream crawl jobs).
 */
export async function markJobPermanentFailed(
  jobId: string,
  error: string
): Promise<void> {
  const job = await getEmbedJob(jobId);
  if (job) {
    job.status = 'failed';
    job.retries = job.maxRetries;
    job.lastError = error;
    await updateEmbedJob(job);
  }
}

/**
 * Get queue statistics for monitoring
 */
export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  const jobs = await listEmbedJobs();

  return jobs.reduce(
    (acc, job) => {
      switch (job.status) {
        case 'pending':
          acc.pending++;
          break;
        case 'processing':
          acc.processing++;
          break;
        case 'completed':
          acc.completed++;
          break;
        case 'failed':
          acc.failed++;
          break;
      }
      return acc;
    },
    { pending: 0, processing: 0, completed: 0, failed: 0 }
  );
}

/**
 * Clean up completed and old failed jobs
 */
export async function cleanupOldJobs(
  maxAgeHours: number = 24
): Promise<number> {
  const jobs = await listEmbedJobs();
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  let cleaned = 0;

  for (const job of jobs) {
    const updatedAt = new Date(job.updatedAt).getTime();

    if (
      (job.status === 'completed' || job.status === 'failed') &&
      updatedAt < cutoff
    ) {
      await removeEmbedJob(job.jobId);
      cleaned++;
    }
  }

  return cleaned;
}

function isIrrecoverableError(error: string | undefined): boolean {
  if (!error) return false;
  return isJobNotFoundError(error);
}

/**
 * Remove failed jobs that are known to be unrecoverable.
 *
 * This prevents permanent queue clutter from deterministic failures where retries
 * cannot ever succeed (deleted crawl IDs, invalid IDs).
 */
export async function cleanupIrrecoverableFailedJobs(): Promise<number> {
  const jobs = await listEmbedJobs();
  let cleaned = 0;

  for (const job of jobs) {
    if (
      job.status === 'failed' &&
      job.retries >= job.maxRetries &&
      isIrrecoverableError(job.lastError)
    ) {
      await removeEmbedJob(job.jobId);
      cleaned++;
    }
  }

  return cleaned;
}

export interface EmbedCleanupResult {
  removedFailed: number;
  removedStalePending: number;
  removedStaleProcessing: number;
  removedTotal: number;
}

/**
 * Clear every embedding queue entry regardless of status.
 */
export async function clearEmbedQueue(): Promise<number> {
  const jobs = await listEmbedJobs();
  for (const job of jobs) {
    await removeEmbedJob(job.jobId);
  }
  return jobs.length;
}

/**
 * Cleanup failed and stale/stalled embedding queue entries.
 *
 * - Removes all failed jobs
 * - Removes stale pending jobs older than maxPendingAgeMs
 * - Removes stale processing jobs older than maxProcessingAgeMs
 */
export async function cleanupEmbedQueue(
  maxPendingAgeMs: number = 10 * 60_000,
  maxProcessingAgeMs: number = 5 * 60_000
): Promise<EmbedCleanupResult> {
  const now = Date.now();
  const pendingCutoff = now - maxPendingAgeMs;
  const processingCutoff = now - maxProcessingAgeMs;
  const jobs = await listEmbedJobs();

  let removedFailed = 0;
  let removedStalePending = 0;
  let removedStaleProcessing = 0;

  for (const job of jobs) {
    const updatedAt = new Date(job.updatedAt).getTime();

    if (job.status === 'failed') {
      await removeEmbedJob(job.jobId);
      removedFailed++;
      continue;
    }

    if (job.status === 'pending' && updatedAt <= pendingCutoff) {
      await removeEmbedJob(job.jobId);
      removedStalePending++;
      continue;
    }

    if (job.status === 'processing' && updatedAt <= processingCutoff) {
      await removeEmbedJob(job.jobId);
      removedStaleProcessing++;
    }
  }

  return {
    removedFailed,
    removedStalePending,
    removedStaleProcessing,
    removedTotal: removedFailed + removedStalePending + removedStaleProcessing,
  };
}

/**
 * Update job progress (throttled persistence)
 *
 * Updates progress counters in memory and optionally persists to disk.
 * Used by background embedder to track embedding progress without
 * excessive file I/O operations.
 *
 * @param jobId - Job identifier
 * @param processedDocuments - Number of documents successfully embedded
 * @param failedDocuments - Number of documents that failed embedding
 * @param shouldPersist - If true, writes changes to disk immediately (default: true)
 */
export async function updateJobProgress(
  jobId: string,
  processedDocuments: number,
  failedDocuments: number,
  shouldPersist: boolean = true
): Promise<void> {
  const job = await getEmbedJob(jobId);
  if (!job) return;

  job.processedDocuments = processedDocuments;
  job.failedDocuments = failedDocuments;
  job.progressUpdatedAt = new Date().toISOString();

  if (shouldPersist) {
    await updateEmbedJob(job);
  }
}
