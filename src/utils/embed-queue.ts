/**
 * Embedding queue for resilient, async embedding operations
 *
 * Persists embedding jobs to disk so they survive process interruptions.
 * Supports background processing with retries and exponential backoff.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import * as lockfile from 'proper-lockfile';
import { fmt } from './theme';

/**
 * Write file with secure permissions (owner-only read/write)
 */
function writeSecureFile(filePath: string, data: string): void {
  writeFileSync(filePath, data, { mode: 0o600 });
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
}

function resolveQueueDir(): string {
  const configuredDir = process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
  if (configuredDir) {
    return configuredDir.startsWith('/')
      ? configuredDir
      : join(process.cwd(), configuredDir);
  }

  return join(
    process.env.HOME ?? process.env.USERPROFILE ?? '.',
    '.config',
    'firecrawl-cli',
    'embed-queue'
  );
}

const QUEUE_DIR = resolveQueueDir();
const MAX_RETRIES = 3;

/**
 * Ensure queue directory exists with secure permissions
 */
function ensureQueueDir(): void {
  if (!existsSync(QUEUE_DIR)) {
    mkdirSync(QUEUE_DIR, { recursive: true, mode: 0o700 });
  } else {
    try {
      chmodSync(QUEUE_DIR, 0o700);
    } catch {
      // Ignore errors on Windows
    }
  }
}

/**
 * Get path for a job file
 */
function getJobPath(jobId: string): string {
  return join(QUEUE_DIR, `${jobId}.json`);
}

/**
 * Add a new embedding job to the queue
 */
export function enqueueEmbedJob(
  jobId: string,
  url: string,
  apiKey?: string
): EmbedJob {
  ensureQueueDir();

  const job: EmbedJob = {
    id: jobId,
    jobId,
    url,
    status: 'pending',
    retries: 0,
    maxRetries: MAX_RETRIES,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    apiKey,
  };

  writeSecureFile(getJobPath(jobId), JSON.stringify(job, null, 2));
  return job;
}

/**
 * Get a job from the queue
 */
export function getEmbedJob(jobId: string): EmbedJob | null {
  const path = getJobPath(jobId);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const data = readFileSync(path, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(
      fmt.error(
        `Failed to read job ${jobId}: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return null;
  }
}

/**
 * Update a job in the queue
 */
export function updateEmbedJob(job: EmbedJob): void {
  ensureQueueDir();
  job.updatedAt = new Date().toISOString();
  writeSecureFile(getJobPath(job.jobId), JSON.stringify(job, null, 2));
}

/**
 * Atomically claim a job for processing using file locking.
 * Only succeeds if job is in 'pending' status.
 * @returns true if job was successfully claimed, false otherwise
 */
export function tryClaimJob(jobId: string): boolean {
  const jobPath = getJobPath(jobId);
  if (!existsSync(jobPath)) return false;

  let release: (() => void) | undefined;
  try {
    release = lockfile.lockSync(jobPath, { retries: 0, stale: 60000 });
    const job = getEmbedJob(jobId);
    if (!job || job.status !== 'pending') {
      release();
      return false;
    }
    job.status = 'processing';
    job.updatedAt = new Date().toISOString();
    writeSecureFile(jobPath, JSON.stringify(job, null, 2));
    release();
    return true;
  } catch {
    if (release) {
      try {
        release();
      } catch {
        // Ignore release errors
      }
    }
    return false;
  }
}

/**
 * Remove a job from the queue
 */
export function removeEmbedJob(jobId: string): void {
  const path = getJobPath(jobId);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

/**
 * List all jobs in the queue
 */
export function listEmbedJobs(): EmbedJob[] {
  ensureQueueDir();

  const files = readdirSync(QUEUE_DIR).filter((f) => f.endsWith('.json'));
  const jobs: EmbedJob[] = [];

  for (const file of files) {
    try {
      const data = readFileSync(join(QUEUE_DIR, file), 'utf-8');
      jobs.push(JSON.parse(data));
    } catch (error) {
      console.error(
        fmt.error(
          `Failed to read job file ${file}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  return jobs;
}

/**
 * Get all pending jobs (status: pending, not exceeded max retries)
 */
export function getPendingJobs(): EmbedJob[] {
  return listEmbedJobs()
    .filter((job) => job.status === 'pending' && job.retries < job.maxRetries)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
}

/**
 * Get pending jobs that have been stale for at least maxAgeMs
 */
export function getStalePendingJobs(maxAgeMs: number): EmbedJob[] {
  const cutoff = Date.now() - maxAgeMs;
  return getPendingJobs()
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
export function getStuckProcessingJobs(
  maxProcessingMs: number = 5 * 60 * 1000
): EmbedJob[] {
  const cutoff = Date.now() - maxProcessingMs;
  return listEmbedJobs()
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
export function markJobProcessing(jobId: string): void {
  const job = getEmbedJob(jobId);
  if (job) {
    job.status = 'processing';
    updateEmbedJob(job);
  }
}

/**
 * Mark a job as completed and remove from queue
 */
export function markJobCompleted(jobId: string): void {
  const job = getEmbedJob(jobId);
  if (job) {
    job.status = 'completed';
    updateEmbedJob(job);
    // Keep completed jobs for a short time for audit/debugging
    // They can be cleaned up later
  }
}

/**
 * Mark a job as failed and increment retry counter
 */
export function markJobFailed(jobId: string, error: string): void {
  const job = getEmbedJob(jobId);
  if (job) {
    job.status = job.retries + 1 >= job.maxRetries ? 'failed' : 'pending';
    job.retries += 1;
    job.lastError = error;
    updateEmbedJob(job);
  }
}

/**
 * Mark a job as permanently failed due to configuration error
 *
 * Sets retries to maxRetries to prevent further retry attempts.
 */
export function markJobConfigError(jobId: string, error: string): void {
  const job = getEmbedJob(jobId);
  if (job) {
    job.status = 'failed';
    job.retries = job.maxRetries;
    job.lastError = `Configuration error: ${error}`;
    updateEmbedJob(job);
  }
}

/**
 * Get queue statistics for monitoring
 */
export function getQueueStats(): {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
} {
  const jobs = listEmbedJobs();

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
export function cleanupOldJobs(maxAgeHours: number = 24): number {
  const jobs = listEmbedJobs();
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  let cleaned = 0;

  for (const job of jobs) {
    const updatedAt = new Date(job.updatedAt).getTime();

    if (
      (job.status === 'completed' || job.status === 'failed') &&
      updatedAt < cutoff
    ) {
      removeEmbedJob(job.jobId);
      cleaned++;
    }
  }

  return cleaned;
}
