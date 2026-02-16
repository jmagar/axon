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
import { EmbedJobSchema } from '../schemas/storage';
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

/**
 * Embedding job interface (backward compatibility alias)
 *
 * For new code, prefer importing the discriminated union type from types/embed-job.ts:
 * ```typescript
 * import type { EmbedJob } from '../types/embed-job';
 * ```
 *
 * The discriminated union provides better type safety by ensuring impossible state
 * combinations (e.g., completed jobs with lastError) are caught at compile time.
 */
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
  hardSync?: boolean;
}

function getQueueDir(): string {
  return getEmbedQueueDir();
}

function getLegacyQueueDir(): string {
  const homeDir = homedir();
  return join(homeDir, '.config', 'firecrawl-cli', 'embed-queue');
}

async function migrateLegacyQueueDir(): Promise<void> {
  // Skip migration if user has explicitly overridden the queue dir via env var
  if (process.env.AXON_EMBEDDER_QUEUE_DIR?.trim()) {
    return;
  }

  const legacyDir = getLegacyQueueDir();
  const queueDir = getQueueDir();

  // Skip migration if legacy and new paths are the same (i.e., storages path hasn't changed)
  if (legacyDir === queueDir) {
    return;
  }

  // Skip migration if legacy dir doesn't exist or new dir already exists.
  // This avoids overwriting any existing jobs in the new location.
  if (!(await pathExists(legacyDir)) || (await pathExists(queueDir))) {
    return;
  }

  await mkdir(queueDir, { recursive: true, mode: 0o700 });
  const files = await readdir(legacyDir);
  let migratedCount = 0;
  const failedFiles: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    try {
      const source = join(legacyDir, file);
      const target = join(queueDir, file);
      await copyFile(source, target);
      migratedCount++;
    } catch (error) {
      // CRITICAL-04: Track failed files for summary report
      const errorMsg = error instanceof Error ? error.message : String(error);
      failedFiles.push({ file, error: errorMsg });
      console.error(
        fmt.error(`[Embed Queue] Failed to copy ${file}: ${errorMsg}`)
      );
    }
  }

  // CRITICAL-04: Provide clear summary with failed file list
  if (migratedCount > 0 || failedFiles.length > 0) {
    const summary = `[Embed Queue] Migration complete: ${migratedCount}/${files.length} files migrated`;

    if (failedFiles.length === 0) {
      console.error(fmt.success(summary));
    } else {
      console.error(fmt.warning(`${summary}, ${failedFiles.length} failed`));
      console.error(
        fmt.dim(`[Embed Queue] Migration path: ${legacyDir} → ${queueDir}`)
      );
      console.error(fmt.error('[Embed Queue] Failed files:'));
      for (const { file, error } of failedFiles) {
        console.error(fmt.error(`  - ${file}: ${error}`));
      }
      console.error(
        fmt.warning(
          '[Embed Queue] Manual intervention required: Review and manually copy failed files if needed'
        )
      );
    }
  }
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
 * SEC-13: Validate job ID format to prevent path traversal.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validateJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(
      `Invalid job ID format: "${jobId}". Only alphanumeric characters, hyphens, and underscores are allowed.`
    );
  }
}

/**
 * Get path for a job file
 *
 * SEC-13: Validates job ID against strict pattern to prevent path traversal.
 */
function getJobPath(jobId: string): string {
  validateJobId(jobId);
  return join(getQueueDir(), `${jobId}.json`);
}

/**
 * Add a new embedding job to the queue
 *
 * Creates a new embedding job with 'pending' status. The job will be processed
 * by the background embedder daemon, which handles chunking, embedding, and storage.
 *
 * SEC-02: API keys are no longer persisted in job files on disk.
 * The apiKey parameter is accepted for backward compatibility but
 * is only stored in-memory on the returned EmbedJob object, never
 * written to the JSON file.
 *
 * @param jobId - Unique identifier for this embedding job (typically derived from content hash)
 * @param url - Source URL being embedded (used in error messages and progress tracking)
 * @param apiKey - (Deprecated) API key for the scrape operation; not persisted
 * @returns New EmbedJob with status 'pending' and timestamp
 * @throws Error if queue directory cannot be created or job file cannot be written
 */
export async function enqueueEmbedJob(
  jobId: string,
  url: string,
  apiKey?: string,
  options?: {
    hardSync?: boolean;
  }
): Promise<EmbedJob> {
  await ensureQueueDir();

  const maxRetries = getSettings().embedding.maxRetries;

  // Validate retry count invariant: retries must be non-negative and <= maxRetries
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error(`Invalid maxRetries from settings: ${maxRetries}`);
  }

  const job: EmbedJob = {
    id: jobId,
    jobId,
    url,
    status: 'pending',
    retries: 0,
    maxRetries,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    apiKey,
    hardSync: options?.hardSync,
  };

  // SEC-02: Strip apiKey before persisting to disk
  await writeSecureFile(
    getJobPath(jobId),
    JSON.stringify(stripSensitiveFields(job), null, 2)
  );
  return job;
}

/**
 * Strip sensitive fields (e.g., API keys) before writing job data to disk.
 * Returns a shallow copy without the apiKey field.
 */
function stripSensitiveFields(job: EmbedJob): Omit<EmbedJob, 'apiKey'> {
  const { apiKey: _, ...safe } = job;
  return safe;
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
 * Prefer this over the deprecated getEmbedJob() which masks both error conditions.
 *
 * @param jobId - The embedding job identifier to retrieve
 * @returns JobReadResult with job data (or null) and detailed status:
 *   - status 'found': job exists and is valid; check result.job
 *   - status 'not_found': job file doesn't exist; result.job is null
 *   - status 'corrupted': job file exists but fails schema validation; result.job is null, result.error explains why
 * @throws Never throws; all errors are captured in the result object
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
    const raw = JSON.parse(data);
    // SEC-05: Validate parsed JSON against schema
    const result = EmbedJobSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      console.error(
        fmt.error(`Job ${jobId} failed schema validation: ${issues}`)
      );
      console.warn(
        fmt.warning(`Job file may be corrupted. Consider removing: ${path}`)
      );
      return {
        job: null,
        status: 'corrupted',
        error: `Schema validation failed: ${issues}`,
      };
    }

    const job = result.data;

    // Validate numeric invariants: retry counts and document counts must be non-negative
    if (!Number.isInteger(job.retries) || job.retries < 0) {
      return {
        job: null,
        status: 'corrupted',
        error: `Invalid retries count: ${job.retries}`,
      };
    }
    if (!Number.isInteger(job.maxRetries) || job.maxRetries < 0) {
      return {
        job: null,
        status: 'corrupted',
        error: `Invalid maxRetries count: ${job.maxRetries}`,
      };
    }
    if (job.retries > job.maxRetries) {
      return {
        job: null,
        status: 'corrupted',
        error: `Invalid state: retries (${job.retries}) exceeds maxRetries (${job.maxRetries})`,
      };
    }

    // Validate document counts if present
    if (
      job.totalDocuments !== undefined ||
      job.processedDocuments !== undefined ||
      job.failedDocuments !== undefined
    ) {
      if (
        job.totalDocuments !== undefined &&
        (!Number.isInteger(job.totalDocuments) || job.totalDocuments < 0)
      ) {
        return {
          job: null,
          status: 'corrupted',
          error: `Invalid totalDocuments: ${job.totalDocuments}`,
        };
      }
      if (
        job.processedDocuments !== undefined &&
        (!Number.isInteger(job.processedDocuments) ||
          job.processedDocuments < 0)
      ) {
        return {
          job: null,
          status: 'corrupted',
          error: `Invalid processedDocuments: ${job.processedDocuments}`,
        };
      }
      if (
        job.failedDocuments !== undefined &&
        (!Number.isInteger(job.failedDocuments) || job.failedDocuments < 0)
      ) {
        return {
          job: null,
          status: 'corrupted',
          error: `Invalid failedDocuments: ${job.failedDocuments}`,
        };
      }
      // Ensure processed + failed doesn't exceed total
      if (
        job.totalDocuments !== undefined &&
        job.processedDocuments !== undefined &&
        job.failedDocuments !== undefined &&
        job.processedDocuments + job.failedDocuments > job.totalDocuments
      ) {
        return {
          job: null,
          status: 'corrupted',
          error: `Invalid state: processedDocuments (${job.processedDocuments}) + failedDocuments (${job.failedDocuments}) > totalDocuments (${job.totalDocuments})`,
        };
      }
    }

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
 * @deprecated Use getEmbedJobDetailed() instead. This function masks corruption and missing files.
 * The new function returns detailed status info: `{ job, status, error }` where status is either
 * 'ok', 'not_found', or 'corrupted', allowing proper error handling in callers.
 *
 * Migration: Replace `getEmbedJob(id)` with `const { job } = await getEmbedJobDetailed(id)`
 */
export async function getEmbedJob(jobId: string): Promise<EmbedJob | null> {
  const result = await getEmbedJobDetailed(jobId);
  return result.job;
}

/**
 * Update a job in the queue
 *
 * SEC-02: Strips API keys before writing to disk.
 * SEC-03: Uses file locking to prevent concurrent write corruption.
 *
 * If the lock cannot be acquired after retries, the update is silently skipped.
 * This is safe because:
 * 1. Each concurrent update is working with stale data anyway (read before lock)
 * 2. The last writer wins, which is acceptable for most job state transitions
 * 3. Critical state transitions (claim, complete, fail) use withJobLock() which
 *    reads fresh data after acquiring the lock
 */
export async function updateEmbedJob(job: EmbedJob): Promise<void> {
  await ensureQueueDir();
  const jobPath = getJobPath(job.jobId);

  let release: (() => void) | undefined;
  try {
    // Acquire lock before writing to prevent concurrent corruption
    // Use retries: 0 for fast fail under high concurrency - this prevents
    // lock retry backoff from causing cascading delays when many writers
    // are competing. Some updates may be skipped, which is acceptable since:
    // - Each update is working with stale data (read before lock)
    // - Critical state transitions use withJobLock() which reads under lock
    release = await lockfile.lock(jobPath, { retries: 0, stale: 60000 });

    job.updatedAt = new Date().toISOString();
    // SEC-02: Never persist API keys to disk
    await writeSecureFile(
      jobPath,
      JSON.stringify(stripSensitiveFields(job), null, 2)
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Don't throw - just log and return. Lock contention is expected under high concurrency.
    // The caller can check job state afterwards if they need to verify the update succeeded.
    if (errorMsg.includes('Lock file is already being held')) {
      // Normal lock contention - skip update silently
      return;
    }

    // Log other errors but still don't throw (backward compatibility)
    console.error(fmt.error(`Failed to update job ${job.jobId}: ${errorMsg}`));
  } finally {
    if (release) {
      try {
        await release();
      } catch (releaseError) {
        const releaseMsg =
          releaseError instanceof Error
            ? releaseError.message
            : String(releaseError);
        const isPermanent =
          releaseMsg.includes('ENOENT') || releaseMsg.includes('EACCES');
        const errorType = isPermanent ? 'PERMANENT' : 'TRANSIENT';

        console.error(
          fmt.error(
            `[${errorType}] Failed to release lock for job ${job.jobId}: ${releaseMsg}`
          )
        );

        if (isPermanent) {
          console.warn(
            fmt.warning(
              `Manual cleanup may be required. Lock file: ${jobPath}.lock`
            )
          );
        }
      }
    }
  }
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
    const raw = JSON.parse(data);
    // SEC-05: Validate job data under lock
    const parsed = EmbedJobSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(
        fmt.error(`Job ${jobId} failed schema validation during claim`)
      );
      return false;
    }
    const job = parsed.data;

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

        // Distinguish between transient and permanent lock errors
        const isPermanent =
          releaseMsg.includes('ENOENT') || releaseMsg.includes('EACCES');
        const errorType = isPermanent ? 'PERMANENT' : 'TRANSIENT';

        console.error(
          fmt.error(
            `[${errorType}] Failed to release lock for job ${jobId}: ${releaseMsg}`
          )
        );

        if (isPermanent) {
          console.warn(
            fmt.warning(
              `Manual cleanup may be required. Lock file: ${jobPath}.lock`
            )
          );
        }
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
      const raw = JSON.parse(data);
      // SEC-05: Validate each job file against schema
      const result = EmbedJobSchema.safeParse(raw);
      if (result.success) {
        jobs.push(result.data);
      } else {
        const issues = result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join(', ');
        errors.push({ file, error: `Schema validation: ${issues}` });
        console.error(
          fmt.error(`Job file ${file} failed validation: ${issues}`)
        );
      }
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
    console.warn(fmt.error('Corrupted files:'));
    for (const { file, error } of errors) {
      console.warn(fmt.dim(`  - ${file}: ${error}`));
    }
    console.warn(
      fmt.dim(
        `  Run 'axon cleanup-queue' to remove corrupted files (if available)`
      )
    );
  }

  return { jobs, skipped: errors.length, errors };
}

/**
 * List all jobs in the queue (legacy compatibility)
 *
 * @deprecated Use listEmbedJobsDetailed() instead. This function silently skips corrupted jobs.
 * The new function returns `{ jobs, skipped, errors }` allowing you to audit and handle
 * data corruption issues instead of silently ignoring them.
 *
 * Migration: Replace `listEmbedJobs()` with `const { jobs } = await listEmbedJobsDetailed()`
 */
export async function listEmbedJobs(): Promise<EmbedJob[]> {
  const result = await listEmbedJobsDetailed();
  return result.jobs;
}

/**
 * Get all pending jobs eligible for processing
 *
 * Returns jobs with status 'pending' that have not yet exceeded their maxRetries limit.
 * Jobs are sorted by creation time (FIFO), ensuring older jobs are processed first.
 *
 * @returns Array of pending jobs sorted chronologically; empty if no pending jobs exist
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
 * Get pending jobs that haven't been updated for at least maxAgeMs
 *
 * A stale job is one with status 'pending' that hasn't been touched in a while,
 * suggesting the background embedder may have crashed or stalled processing it.
 * This is used for recovery logic: restart processing on stale jobs.
 *
 * @param maxAgeMs - Minimum age (in milliseconds) for a job to be considered stale.
 *                   Example: 5 * 60 * 1000 for 5 minutes
 * @returns Array of pending jobs with updatedAt older than (now - maxAgeMs), sorted by age (oldest first)
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
 * Returns jobs with status 'processing' that haven't been updated in longer than
 * the specified threshold. This detects daemon crashes where a job is locked in
 * processing state but the worker dies before completing it.
 *
 * Recovery: Reset these jobs to 'pending' so they can be retried.
 *
 * @param maxProcessingMs - Maximum time (in milliseconds) a job should stay in 'processing'.
 *                          Defaults to 5 minutes (300000ms). Increase if embeddings are legitimately slow.
 * @returns Array of processing jobs older than maxProcessingMs, sorted by update time (oldest first)
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
 * SEC-03: File locking wrapper for job mutations.
 *
 * Acquires a file lock before reading/modifying a job, preventing
 * TOCTOU race conditions between concurrent processes (webhook callbacks,
 * polling cycles). Follows the pattern established by tryClaimJob().
 */
async function withJobLock(
  jobId: string,
  mutate: (job: EmbedJob) => void
): Promise<void> {
  const jobPath = getJobPath(jobId);
  if (!(await pathExists(jobPath))) return;

  let release: (() => void) | undefined;
  try {
    release = await lockfile.lock(jobPath, { retries: 2, stale: 60000 });

    const data = await readFile(jobPath, 'utf-8');
    const raw = JSON.parse(data);
    // SEC-05: Validate parsed JSON against schema
    const parsed = EmbedJobSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(
        fmt.error(`Job ${jobId} failed schema validation during lock update`)
      );
      return;
    }
    const job = parsed.data;

    mutate(job);

    job.updatedAt = new Date().toISOString();
    // SEC-02: Strip sensitive fields when persisting
    await writeSecureFile(
      jobPath,
      JSON.stringify(stripSensitiveFields(job), null, 2)
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(fmt.error(`Failed to update job ${jobId}: ${errorMsg}`));
  } finally {
    if (release) {
      try {
        await release();
      } catch (releaseError) {
        const releaseMsg =
          releaseError instanceof Error
            ? releaseError.message
            : String(releaseError);

        // Distinguish between transient and permanent lock errors
        const isPermanent =
          releaseMsg.includes('ENOENT') || releaseMsg.includes('EACCES');
        const errorType = isPermanent ? 'PERMANENT' : 'TRANSIENT';

        console.error(
          fmt.error(
            `[${errorType}] Failed to release lock for job ${jobId}: ${releaseMsg}`
          )
        );

        if (isPermanent) {
          console.warn(
            fmt.warning(
              `Manual cleanup may be required. Lock file: ${jobPath}.lock`
            )
          );
        }
      }
    }
  }
}

/**
 * Mark a job as processing
 */
export async function markJobProcessing(jobId: string): Promise<void> {
  await withJobLock(jobId, (job) => {
    job.status = 'processing';
  });
}

/**
 * Mark a job as completed and remove from queue
 */
export async function markJobCompleted(jobId: string): Promise<void> {
  await withJobLock(jobId, (job) => {
    job.status = 'completed';
  });
  // Keep completed jobs for a short time for audit/debugging
  // They can be cleaned up later
}

/**
 * Mark a job as failed and increment retry counter
 */
export async function markJobFailed(
  jobId: string,
  error: string
): Promise<void> {
  await withJobLock(jobId, (job) => {
    job.status = job.retries + 1 >= job.maxRetries ? 'failed' : 'pending';
    job.retries += 1;
    job.lastError = error;
  });
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
  await withJobLock(jobId, (job) => {
    job.status = 'pending';
    job.lastError = error;
  });
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
  await withJobLock(jobId, (job) => {
    job.status = 'failed';
    job.retries = job.maxRetries;
    job.lastError = `Configuration error: ${error}`;
  });
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
  await withJobLock(jobId, (job) => {
    job.status = 'failed';
    job.retries = job.maxRetries;
    job.lastError = error;
  });
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
 *
 * Removes job files for completed and failed jobs that haven't been updated in maxAgeHours.
 * This prevents the queue directory from growing unbounded over time.
 *
 * @param maxAgeHours - Minimum age (in hours) for job files to be eligible for cleanup.
 *                      Defaults to 24 hours. Completed/failed jobs older than this are deleted.
 * @returns Number of job files deleted
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
 * Identifies and deletes jobs that have exhausted retries AND failed with an error
 * that indicates they can never succeed (e.g., "crawl not found"). This prevents
 * permanent queue clutter from deterministic failures like deleted crawls or invalid IDs.
 *
 * Uses isJobNotFoundError() to detect unrecoverable errors; can be extended with
 * additional error patterns as needed.
 *
 * @returns Number of unrecoverable job files deleted
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
 * This is the user-triggered cleanup (via `axon embed cleanup`).
 * Unlike `cleanupOldJobs` (background/automatic), this aggressively
 * removes all failed jobs regardless of age since the user explicitly
 * requested cleanup.
 *
 * - Removes all failed jobs (terminal state, no age gate)
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
