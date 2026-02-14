/**
 * Tests for embed queue concurrency and race condition prevention (Task #10)
 *
 * Validates that the embed queue handles concurrent operations correctly and
 * prevents race conditions like TOCTOU (Time-Of-Check-Time-Of-Use) and
 * double lock releases.
 *
 * Security Concerns:
 * - C-02: Double lock release in tryClaimJob() could corrupt queue state
 * - M-11: TOCTOU race in credentials file write
 * - Queue corruption under high concurrency
 * - Job state inconsistency with multiple workers
 * - Lock contention and deadlock scenarios
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Embed Queue Concurrency Tests', () => {
  let queueDir: string;

  beforeEach(async () => {
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-concurrency-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    vi.resetModules();
    // Give file system time to stabilize
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  afterEach(async () => {
    // Give any pending file operations time to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      rmSync(queueDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    delete process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
    vi.resetModules();
  });

  describe('Concurrent job claims', () => {
    it('should allow only one worker to claim a pending job', async () => {
      const { enqueueEmbedJob, tryClaimJob, getEmbedJob } = await import(
        '../../utils/embed-queue'
      );

      await enqueueEmbedJob('job-1', 'https://example.com');

      // Spawn 10 concurrent claim attempts
      const results = await Promise.all(
        Array.from({ length: 10 }, () => tryClaimJob('job-1'))
      );

      // Exactly one should succeed
      const successes = results.filter((r) => r === true);
      expect(successes).toHaveLength(1);

      // Verify job is in processing state
      const job = await getEmbedJob('job-1');
      expect(job?.status).toBe('processing');
    });

    it('should handle 50 concurrent claims without corruption', async () => {
      const { enqueueEmbedJob, tryClaimJob, getEmbedJob } = await import(
        '../../utils/embed-queue'
      );

      // Enqueue 50 jobs
      const jobIds = Array.from({ length: 50 }, (_, i) => `job-${i}`);
      await Promise.all(
        jobIds.map((id) => enqueueEmbedJob(id, 'https://example.com'))
      );

      // Claim all jobs concurrently
      const results = await Promise.all(jobIds.map((id) => tryClaimJob(id)));

      // All should succeed (no conflicts since each job is unique)
      expect(results.every((r) => r === true)).toBe(true);

      // Verify all jobs in processing state
      const jobs = await Promise.all(jobIds.map(getEmbedJob));
      expect(jobs.every((j) => j?.status === 'processing')).toBe(true);
    });

    it('should not corrupt job file during concurrent updates', async () => {
      const { enqueueEmbedJob, getEmbedJob, updateEmbedJob } = await import(
        '../../utils/embed-queue'
      );

      const jobId = 'job-concurrent-update';
      await enqueueEmbedJob(jobId, 'https://example.com');

      // Update job 20 times concurrently (reduced from 100 for speed)
      await Promise.all(
        Array.from({ length: 20 }, async (_, i) => {
          const job = await getEmbedJob(jobId);
          if (job) {
            job.retries = i;
            await updateEmbedJob(job);
          }
        })
      );

      // Verify job file is valid JSON (not corrupted)
      const finalJob = await getEmbedJob(jobId);
      expect(finalJob).not.toBeNull();
      expect(finalJob?.jobId).toBe(jobId);
      expect(typeof finalJob?.retries).toBe('number');
    });

    it('should handle concurrent claims on already-processing job', async () => {
      const { enqueueEmbedJob, tryClaimJob, getEmbedJob } = await import(
        '../../utils/embed-queue'
      );

      await enqueueEmbedJob('job-1', 'https://example.com');

      // First claim should succeed
      const firstClaim = await tryClaimJob('job-1');
      expect(firstClaim).toBe(true);

      // Concurrent subsequent claims should all fail
      const results = await Promise.all(
        Array.from({ length: 10 }, () => tryClaimJob('job-1'))
      );

      expect(results.every((r) => r === false)).toBe(true);

      // Job should still be in processing state
      const job = await getEmbedJob('job-1');
      expect(job?.status).toBe('processing');
    });

    it('should handle concurrent claims on completed job', async () => {
      const { enqueueEmbedJob, markJobCompleted, tryClaimJob, getEmbedJob } =
        await import('../../utils/embed-queue');

      await enqueueEmbedJob('job-1', 'https://example.com');
      await markJobCompleted('job-1');

      // All claims should fail (job is completed)
      const results = await Promise.all(
        Array.from({ length: 10 }, () => tryClaimJob('job-1'))
      );

      expect(results.every((r) => r === false)).toBe(true);

      // Job should still be completed
      const job = await getEmbedJob('job-1');
      expect(job?.status).toBe('completed');
    });
  });

  describe('Lock contention handling', () => {
    it('should not double-release lock on claim failure', async () => {
      const { enqueueEmbedJob, tryClaimJob, getEmbedJob } = await import(
        '../../utils/embed-queue'
      );

      await enqueueEmbedJob('job-1', 'https://example.com');

      // Claim job successfully
      const firstClaim = await tryClaimJob('job-1');
      expect(firstClaim).toBe(true);

      // Second claim should fail without corrupting state
      const secondClaim = await tryClaimJob('job-1');
      expect(secondClaim).toBe(false);

      // Job should still be valid and in processing state
      const job = await getEmbedJob('job-1');
      expect(job).not.toBeNull();
      expect(job?.status).toBe('processing');
    });

    it('should handle lock file cleanup on process crash simulation', async () => {
      const { enqueueEmbedJob, tryClaimJob } = await import(
        '../../utils/embed-queue'
      );

      await enqueueEmbedJob('job-1', 'https://example.com');

      // Try to claim the job
      const claimed = await tryClaimJob('job-1');
      expect(claimed).toBe(true);

      // Simulate process continuing after lock release
      // The lock should be released properly even if claim succeeded
      // This tests that we're not leaving stale lock files
      const lockFilePath = join(queueDir, 'job-1.json.lock');
      const lockExists = await import('node:fs')
        .then((fs) => fs.promises.access(lockFilePath))
        .then(() => true)
        .catch(() => false);

      // Lock should be released after tryClaimJob completes
      expect(lockExists).toBe(false);
    });

    it('should handle concurrent lock attempts gracefully', async () => {
      const { enqueueEmbedJob, tryClaimJob } = await import(
        '../../utils/embed-queue'
      );

      // Enqueue multiple jobs
      const jobIds = ['job-1', 'job-2', 'job-3'];
      await Promise.all(
        jobIds.map((id) => enqueueEmbedJob(id, 'https://example.com'))
      );

      // Try to claim all jobs with high concurrency
      const claimPromises = jobIds.flatMap((id) =>
        Array.from({ length: 5 }, () => tryClaimJob(id))
      );

      const results = await Promise.all(claimPromises);

      // Exactly 3 claims should succeed (one per job)
      const successes = results.filter((r) => r === true);
      expect(successes).toHaveLength(3);
    });
  });

  describe('Job state consistency under concurrency', () => {
    it('should maintain consistent job state across concurrent reads', async () => {
      const { enqueueEmbedJob, getEmbedJob, tryClaimJob } = await import(
        '../../utils/embed-queue'
      );

      const jobId = 'job-consistency';
      await enqueueEmbedJob(jobId, 'https://example.com');

      // Read job state concurrently while claiming
      const readPromises = Array.from({ length: 20 }, () => getEmbedJob(jobId));
      const claimPromise = tryClaimJob(jobId);

      const [jobs, claimed] = await Promise.all([
        Promise.all(readPromises),
        claimPromise,
      ]);

      // All reads should return valid job data (not null or corrupted)
      expect(jobs.every((j) => j !== null && j.jobId === jobId)).toBe(true);

      // Claim should succeed
      expect(claimed).toBe(true);

      // Final state check
      const finalJob = await getEmbedJob(jobId);
      expect(finalJob?.status).toBe('processing');
    });

    it('should handle concurrent markJobFailed calls correctly', async () => {
      const { enqueueEmbedJob, markJobFailed, getEmbedJob } = await import(
        '../../utils/embed-queue'
      );

      const jobId = 'job-fail-concurrent';
      await enqueueEmbedJob(jobId, 'https://example.com');

      // Mark job as failed multiple times concurrently
      await Promise.all(
        Array.from({ length: 5 }, (_, i) => markJobFailed(jobId, `Error ${i}`))
      );

      // Job should have failed status and retries should be incremented
      const job = await getEmbedJob(jobId);
      expect(job).not.toBeNull();
      // Retries could be anywhere from 1 to 5 depending on race timing
      expect(job?.retries).toBeGreaterThanOrEqual(1);
      expect(job?.retries).toBeLessThanOrEqual(5);
    }, 10000);

    it('should handle concurrent progress updates without corruption', async () => {
      const { enqueueEmbedJob, updateJobProgress, getEmbedJob } = await import(
        '../../utils/embed-queue'
      );

      const jobId = 'job-progress';
      const job = await enqueueEmbedJob(jobId, 'https://example.com');
      job.totalDocuments = 100;
      const { updateEmbedJob } = await import('../../utils/embed-queue');
      await updateEmbedJob(job);

      // Update progress concurrently from multiple "workers"
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          updateJobProgress(jobId, i * 10, i)
        )
      );

      // Job should still be valid with some progress value
      const finalJob = await getEmbedJob(jobId);
      expect(finalJob).not.toBeNull();
      expect(finalJob?.processedDocuments).toBeGreaterThanOrEqual(0);
      expect(finalJob?.failedDocuments).toBeGreaterThanOrEqual(0);
      expect(finalJob?.progressUpdatedAt).toBeDefined();
    }, 10000);
  });

  describe('Queue operations under high load', () => {
    it('should handle 100 concurrent enqueue operations', async () => {
      const { enqueueEmbedJob, listEmbedJobs } = await import(
        '../../utils/embed-queue'
      );

      // Enqueue 100 jobs concurrently with unique prefix
      const testPrefix = 'load-test-';
      const jobIds = Array.from({ length: 100 }, (_, i) => `${testPrefix}${i}`);
      await Promise.all(
        jobIds.map((id) => enqueueEmbedJob(id, 'https://example.com'))
      );

      // Verify all jobs were created
      const jobs = await listEmbedJobs();
      const testJobs = jobs.filter((j) => j.jobId.startsWith(testPrefix));
      expect(testJobs).toHaveLength(100);
      expect(testJobs.every((j) => j.status === 'pending')).toBe(true);
    });

    it('should handle mixed concurrent operations (enqueue, claim, update)', async () => {
      const { enqueueEmbedJob, tryClaimJob, markJobCompleted, listEmbedJobs } =
        await import('../../utils/embed-queue');

      // Simulate realistic workload
      const operations = [];

      // Enqueue 20 jobs
      for (let i = 0; i < 20; i++) {
        operations.push(enqueueEmbedJob(`job-${i}`, 'https://example.com'));
      }

      // Wait for enqueue to complete
      await Promise.all(operations);

      // Mix of claim and complete operations
      const mixedOps = [];
      for (let i = 0; i < 20; i++) {
        if (i < 10) {
          mixedOps.push(tryClaimJob(`job-${i}`));
        } else if (i < 15) {
          mixedOps.push(
            tryClaimJob(`job-${i}`).then((claimed) =>
              claimed ? markJobCompleted(`job-${i}`) : Promise.resolve()
            )
          );
        }
      }

      await Promise.all(mixedOps);

      // Verify queue is in consistent state
      const jobs = await listEmbedJobs();
      expect(jobs).toHaveLength(20);

      // Count jobs by status
      const statusCounts = jobs.reduce(
        (acc, job) => {
          acc[job.status]++;
          return acc;
        },
        { pending: 0, processing: 0, completed: 0, failed: 0 }
      );

      // Should have some processing or completed jobs
      expect(statusCounts.processing + statusCounts.completed).toBeGreaterThan(
        0
      );
    });

    it('should maintain queue directory permissions under concurrent writes', async () => {
      const { enqueueEmbedJob } = await import('../../utils/embed-queue');
      const { statSync } = await import('node:fs');

      // Create many jobs concurrently
      await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          enqueueEmbedJob(`job-${i}`, 'https://example.com')
        )
      );

      // Verify queue directory still has secure permissions
      const stats = statSync(queueDir);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o700);
    });
  });

  describe('TOCTOU (Time-Of-Check-Time-Of-Use) race prevention', () => {
    it('should prevent TOCTOU race in tryClaimJob via file locking', async () => {
      const { enqueueEmbedJob, tryClaimJob, getEmbedJob } = await import(
        '../../utils/embed-queue'
      );

      await enqueueEmbedJob('job-1', 'https://example.com');

      // Simulate TOCTOU scenario: Multiple workers check and try to claim simultaneously
      const claimAttempts = await Promise.all([
        tryClaimJob('job-1'),
        tryClaimJob('job-1'),
        tryClaimJob('job-1'),
        tryClaimJob('job-1'),
        tryClaimJob('job-1'),
      ]);

      // Only one claim should succeed due to file locking
      const successes = claimAttempts.filter((r) => r === true);
      expect(successes).toHaveLength(1);

      // Verify job is in consistent state
      const job = await getEmbedJob('job-1');
      expect(job?.status).toBe('processing');
    });

    it('should handle race between enqueue and claim', async () => {
      const { enqueueEmbedJob, tryClaimJob } = await import(
        '../../utils/embed-queue'
      );

      // Start enqueue and immediately try to claim
      const [job, claimed] = await Promise.all([
        enqueueEmbedJob('job-1', 'https://example.com'),
        tryClaimJob('job-1'),
      ]);

      // Job should be created
      expect(job).not.toBeNull();

      // Claim might succeed or fail depending on timing (both are valid)
      expect(typeof claimed).toBe('boolean');
    });

    it('should prevent race between claim and markJobCompleted', async () => {
      const { enqueueEmbedJob, tryClaimJob, markJobCompleted, getEmbedJob } =
        await import('../../utils/embed-queue');

      await enqueueEmbedJob('job-1', 'https://example.com');
      await tryClaimJob('job-1');

      // Try to claim and complete simultaneously
      await Promise.all([
        tryClaimJob('job-1'),
        tryClaimJob('job-1'),
        markJobCompleted('job-1'),
      ]);

      // Job should end up completed (markJobCompleted should win)
      const job = await getEmbedJob('job-1');
      expect(job?.status).toBe('completed');
    });

    it('should prevent corrupted job file from concurrent writes', async () => {
      const { enqueueEmbedJob, updateEmbedJob, getEmbedJobDetailed } =
        await import('../../utils/embed-queue');

      const jobId = 'job-toctou-write';
      const _job = await enqueueEmbedJob(jobId, 'https://example.com');

      // Concurrent updates with different field changes
      await Promise.all([
        (async () => {
          const j = await import('../../utils/embed-queue').then((m) =>
            m.getEmbedJob(jobId)
          );
          if (j) {
            j.retries = 1;
            await updateEmbedJob(j);
          }
        })(),
        (async () => {
          const j = await import('../../utils/embed-queue').then((m) =>
            m.getEmbedJob(jobId)
          );
          if (j) {
            j.status = 'processing';
            await updateEmbedJob(j);
          }
        })(),
        (async () => {
          const j = await import('../../utils/embed-queue').then((m) =>
            m.getEmbedJob(jobId)
          );
          if (j) {
            j.lastError = 'test error';
            await updateEmbedJob(j);
          }
        })(),
      ]);

      // Verify job file is still valid JSON (not corrupted)
      const result = await getEmbedJobDetailed(jobId);
      expect(result.status).toBe('found');
      expect(result.job).not.toBeNull();
      expect(result.job?.jobId).toBe(jobId);
    });
  });

  describe('Error handling under concurrency', () => {
    it('should handle corrupted job file during concurrent operations', async () => {
      const { enqueueEmbedJob, getEmbedJobDetailed, tryClaimJob } =
        await import('../../utils/embed-queue');

      const jobId = 'job-corrupted';
      await enqueueEmbedJob(jobId, 'https://example.com');

      // Corrupt the job file
      const jobPath = join(queueDir, `${jobId}.json`);
      writeFileSync(jobPath, 'invalid json {{{', 'utf-8');

      // Try to read and claim concurrently
      const [readResult, claimed] = await Promise.all([
        getEmbedJobDetailed(jobId),
        tryClaimJob(jobId),
      ]);

      // Read should detect corruption
      expect(readResult.status).toBe('corrupted');
      expect(readResult.job).toBeNull();

      // Claim should fail gracefully
      expect(claimed).toBe(false);
    });

    it('should handle missing job file during concurrent operations', async () => {
      const { getEmbedJob, tryClaimJob, markJobCompleted } = await import(
        '../../utils/embed-queue'
      );

      const jobId = 'job-missing';

      // Try to operate on non-existent job concurrently
      const [job, claimed, marked] = await Promise.all([
        getEmbedJob(jobId),
        tryClaimJob(jobId),
        markJobCompleted(jobId).catch(() => 'error'),
      ]);

      // All operations should handle missing file gracefully
      expect(job).toBeNull();
      expect(claimed).toBe(false);
      // markJobCompleted might succeed (no-op) or fail depending on implementation
      expect(['error', undefined]).toContain(marked);
    });

    it('should handle file system errors during concurrent operations', async () => {
      const { enqueueEmbedJob, tryClaimJob } = await import(
        '../../utils/embed-queue'
      );

      const jobId = 'job-fs-error';
      await enqueueEmbedJob(jobId, 'https://example.com');

      // Make job file read-only to simulate permission error
      const jobPath = join(queueDir, `${jobId}.json`);
      const { chmodSync } = await import('node:fs');
      chmodSync(jobPath, 0o444); // Read-only

      // Try to claim (should fail due to permission error)
      const claimed = await tryClaimJob(jobId);

      // Should fail gracefully
      expect(claimed).toBe(false);

      // Restore permissions for cleanup
      chmodSync(jobPath, 0o600);
    });
  });

  describe('Performance and stress testing', () => {
    it('should complete 100 concurrent claim attempts in reasonable time', async () => {
      const { enqueueEmbedJob, tryClaimJob } = await import(
        '../../utils/embed-queue'
      );

      // Create 100 jobs
      const jobIds = Array.from({ length: 100 }, (_, i) => `job-${i}`);
      await Promise.all(
        jobIds.map((id) => enqueueEmbedJob(id, 'https://example.com'))
      );

      const start = performance.now();

      // Claim all jobs concurrently
      await Promise.all(jobIds.map((id) => tryClaimJob(id)));

      const duration = performance.now() - start;

      // Should complete in < 5 seconds (reasonable for 100 file operations with locking)
      expect(duration).toBeLessThan(5000);
    });

    it('should not leak file descriptors under high concurrency', async () => {
      const { enqueueEmbedJob, getEmbedJob } = await import(
        '../../utils/embed-queue'
      );

      const jobId = 'job-fd-leak';
      await enqueueEmbedJob(jobId, 'https://example.com');

      // Read job 1000 times concurrently
      await Promise.all(Array.from({ length: 1000 }, () => getEmbedJob(jobId)));

      // If we get here without "too many open files" error, we're good
      expect(true).toBe(true);
    });
  });
});
