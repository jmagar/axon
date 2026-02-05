/**
 * Tests for embed queue helpers
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('getStalePendingJobs', () => {
  let queueDir: string;

  beforeEach(() => {
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(queueDir, { recursive: true, force: true });
    delete process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
    vi.resetModules();
  });

  it('should return only stale pending jobs', async () => {
    const now = Date.now();
    const staleJob = {
      id: 'job-stale',
      jobId: 'job-stale',
      url: 'https://example.com',
      status: 'pending',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date(now - 10 * 60_000).toISOString(),
      updatedAt: new Date(now - 10 * 60_000).toISOString(),
    };
    const freshJob = {
      id: 'job-fresh',
      jobId: 'job-fresh',
      url: 'https://example.com',
      status: 'pending',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date(now - 1 * 60_000).toISOString(),
      updatedAt: new Date(now - 1 * 60_000).toISOString(),
    };
    const processingJob = {
      id: 'job-processing',
      jobId: 'job-processing',
      url: 'https://example.com',
      status: 'processing',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date(now - 20 * 60_000).toISOString(),
      updatedAt: new Date(now - 20 * 60_000).toISOString(),
    };

    writeFileSync(
      join(queueDir, `${staleJob.jobId}.json`),
      JSON.stringify(staleJob, null, 2)
    );
    writeFileSync(
      join(queueDir, `${freshJob.jobId}.json`),
      JSON.stringify(freshJob, null, 2)
    );
    writeFileSync(
      join(queueDir, `${processingJob.jobId}.json`),
      JSON.stringify(processingJob, null, 2)
    );

    const { getStalePendingJobs } = await import('../../utils/embed-queue');
    const stale = getStalePendingJobs(5 * 60_000);

    expect(stale).toHaveLength(1);
    expect(stale[0].jobId).toBe('job-stale');
  });
});

describe('getStuckProcessingJobs', () => {
  let queueDir: string;

  beforeEach(() => {
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(queueDir, { recursive: true, force: true });
    delete process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
    vi.resetModules();
  });

  it('should return jobs stuck in processing state', async () => {
    const now = Date.now();
    const stuckJob = {
      id: 'job-stuck',
      jobId: 'job-stuck',
      url: 'https://example.com',
      status: 'processing',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date(now - 10 * 60_000).toISOString(),
      updatedAt: new Date(now - 10 * 60_000).toISOString(),
    };
    const recentProcessingJob = {
      id: 'job-recent',
      jobId: 'job-recent',
      url: 'https://example.com',
      status: 'processing',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date(now - 1 * 60_000).toISOString(),
      updatedAt: new Date(now - 1 * 60_000).toISOString(),
    };
    const pendingJob = {
      id: 'job-pending',
      jobId: 'job-pending',
      url: 'https://example.com',
      status: 'pending',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date(now - 20 * 60_000).toISOString(),
      updatedAt: new Date(now - 20 * 60_000).toISOString(),
    };

    writeFileSync(
      join(queueDir, `${stuckJob.jobId}.json`),
      JSON.stringify(stuckJob, null, 2)
    );
    writeFileSync(
      join(queueDir, `${recentProcessingJob.jobId}.json`),
      JSON.stringify(recentProcessingJob, null, 2)
    );
    writeFileSync(
      join(queueDir, `${pendingJob.jobId}.json`),
      JSON.stringify(pendingJob, null, 2)
    );

    const { getStuckProcessingJobs } = await import('../../utils/embed-queue');
    const stuck = getStuckProcessingJobs(5 * 60_000);

    expect(stuck).toHaveLength(1);
    expect(stuck[0].jobId).toBe('job-stuck');
    expect(stuck[0].status).toBe('processing');
  });

  it('should respect the time threshold', async () => {
    const now = Date.now();
    const processingJob1 = {
      id: 'job-1',
      jobId: 'job-1',
      url: 'https://example.com',
      status: 'processing',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date(now - 3 * 60_000).toISOString(),
      updatedAt: new Date(now - 3 * 60_000).toISOString(),
    };
    const processingJob2 = {
      id: 'job-2',
      jobId: 'job-2',
      url: 'https://example.com',
      status: 'processing',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date(now - 6 * 60_000).toISOString(),
      updatedAt: new Date(now - 6 * 60_000).toISOString(),
    };

    writeFileSync(
      join(queueDir, `${processingJob1.jobId}.json`),
      JSON.stringify(processingJob1, null, 2)
    );
    writeFileSync(
      join(queueDir, `${processingJob2.jobId}.json`),
      JSON.stringify(processingJob2, null, 2)
    );

    const { getStuckProcessingJobs } = await import('../../utils/embed-queue');
    const stuck = getStuckProcessingJobs(5 * 60_000);

    expect(stuck).toHaveLength(1);
    expect(stuck[0].jobId).toBe('job-2');
  });

  it('should not return jobs that have exceeded max retries', async () => {
    const now = Date.now();
    const exhaustedJob = {
      id: 'job-exhausted',
      jobId: 'job-exhausted',
      url: 'https://example.com',
      status: 'processing',
      retries: 3,
      maxRetries: 3,
      createdAt: new Date(now - 10 * 60_000).toISOString(),
      updatedAt: new Date(now - 10 * 60_000).toISOString(),
    };

    writeFileSync(
      join(queueDir, `${exhaustedJob.jobId}.json`),
      JSON.stringify(exhaustedJob, null, 2)
    );

    const { getStuckProcessingJobs } = await import('../../utils/embed-queue');
    const stuck = getStuckProcessingJobs(5 * 60_000);

    expect(stuck).toHaveLength(0);
  });
});

describe('markJobConfigError', () => {
  let queueDir: string;

  beforeEach(() => {
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(queueDir, { recursive: true, force: true });
    delete process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
    vi.resetModules();
  });

  it('should mark job as failed with maxRetries to prevent retrying', async () => {
    const { enqueueEmbedJob, markJobConfigError, getEmbedJob } = await import(
      '../../utils/embed-queue'
    );

    enqueueEmbedJob('job-config-error', 'https://example.com');

    markJobConfigError('job-config-error', 'TEI_URL not configured');

    const job = getEmbedJob('job-config-error');

    expect(job).not.toBeNull();
    expect(job?.status).toBe('failed');
    expect(job?.retries).toBe(job?.maxRetries);
    expect(job?.lastError).toContain('Configuration error');
    expect(job?.lastError).toContain('TEI_URL not configured');
  });

  it('should not retry jobs marked with config error', async () => {
    const { enqueueEmbedJob, markJobConfigError, getPendingJobs } =
      await import('../../utils/embed-queue');

    enqueueEmbedJob('job-1', 'https://example.com');

    markJobConfigError('job-1', 'QDRANT_URL not configured');

    const pending = getPendingJobs();

    expect(pending).toHaveLength(0);
  });
});

describe('tryClaimJob', () => {
  let queueDir: string;

  beforeEach(() => {
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(queueDir, { recursive: true, force: true });
    delete process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
    vi.resetModules();
  });

  it('should claim a pending job and mark it as processing', async () => {
    const { enqueueEmbedJob, tryClaimJob, getEmbedJob } = await import(
      '../../utils/embed-queue'
    );

    enqueueEmbedJob('job-claim-test', 'https://example.com');

    const claimed = tryClaimJob('job-claim-test');

    expect(claimed).toBe(true);
    const job = getEmbedJob('job-claim-test');
    expect(job?.status).toBe('processing');
  });

  it('should return false for non-existent job', async () => {
    const { tryClaimJob } = await import('../../utils/embed-queue');

    const claimed = tryClaimJob('non-existent-job');

    expect(claimed).toBe(false);
  });

  it('should return false for already processing job', async () => {
    const now = Date.now();
    const processingJob = {
      id: 'job-processing',
      jobId: 'job-processing',
      url: 'https://example.com',
      status: 'processing',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };

    writeFileSync(
      join(queueDir, `${processingJob.jobId}.json`),
      JSON.stringify(processingJob, null, 2)
    );

    const { tryClaimJob } = await import('../../utils/embed-queue');
    const claimed = tryClaimJob('job-processing');

    expect(claimed).toBe(false);
  });

  it('should return false for completed job', async () => {
    const now = Date.now();
    const completedJob = {
      id: 'job-completed',
      jobId: 'job-completed',
      url: 'https://example.com',
      status: 'completed',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };

    writeFileSync(
      join(queueDir, `${completedJob.jobId}.json`),
      JSON.stringify(completedJob, null, 2)
    );

    const { tryClaimJob } = await import('../../utils/embed-queue');
    const claimed = tryClaimJob('job-completed');

    expect(claimed).toBe(false);
  });

  it('should return false for failed job', async () => {
    const now = Date.now();
    const failedJob = {
      id: 'job-failed',
      jobId: 'job-failed',
      url: 'https://example.com',
      status: 'failed',
      retries: 3,
      maxRetries: 3,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };

    writeFileSync(
      join(queueDir, `${failedJob.jobId}.json`),
      JSON.stringify(failedJob, null, 2)
    );

    const { tryClaimJob } = await import('../../utils/embed-queue');
    const claimed = tryClaimJob('job-failed');

    expect(claimed).toBe(false);
  });

  it('should update the updatedAt timestamp when claiming', async () => {
    const { enqueueEmbedJob, tryClaimJob, getEmbedJob } = await import(
      '../../utils/embed-queue'
    );

    enqueueEmbedJob('job-timestamp-test', 'https://example.com');
    const before = getEmbedJob('job-timestamp-test');
    const beforeTime = new Date(before!.updatedAt).getTime();

    // Small delay to ensure timestamp changes
    await new Promise((resolve) => setTimeout(resolve, 10));

    tryClaimJob('job-timestamp-test');
    const after = getEmbedJob('job-timestamp-test');
    const afterTime = new Date(after!.updatedAt).getTime();

    expect(afterTime).toBeGreaterThanOrEqual(beforeTime);
  });
});

describe('secure file permissions', () => {
  let queueDir: string;

  beforeEach(() => {
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(queueDir, { recursive: true, force: true });
    delete process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
    vi.resetModules();
  });

  it('should create queue directory with secure permissions', async () => {
    const { statSync } = await import('node:fs');
    const { enqueueEmbedJob } = await import('../../utils/embed-queue');

    enqueueEmbedJob('job-perms-test', 'https://example.com');

    const stats = statSync(queueDir);
    // On Unix, 0o700 is owner read/write/execute only
    // mode includes file type bits, so we mask with 0o777
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('should create job files with secure permissions', async () => {
    const { statSync } = await import('node:fs');
    const { enqueueEmbedJob } = await import('../../utils/embed-queue');

    enqueueEmbedJob('job-file-perms', 'https://example.com');

    const jobPath = join(queueDir, 'job-file-perms.json');
    const stats = statSync(jobPath);
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('getQueueStats', () => {
  let queueDir: string;

  beforeEach(() => {
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-queue-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(queueDir, { recursive: true, force: true });
    delete process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
    vi.resetModules();
  });

  it('should return stats for all job statuses', async () => {
    const now = Date.now();
    const jobs = [
      {
        id: 'job-pending-1',
        jobId: 'job-pending-1',
        url: 'https://example.com/1',
        status: 'pending' as const,
        retries: 0,
        maxRetries: 3,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      },
      {
        id: 'job-pending-2',
        jobId: 'job-pending-2',
        url: 'https://example.com/2',
        status: 'pending' as const,
        retries: 1,
        maxRetries: 3,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      },
      {
        id: 'job-processing',
        jobId: 'job-processing',
        url: 'https://example.com/3',
        status: 'processing' as const,
        retries: 0,
        maxRetries: 3,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      },
      {
        id: 'job-completed',
        jobId: 'job-completed',
        url: 'https://example.com/4',
        status: 'completed' as const,
        retries: 0,
        maxRetries: 3,
        createdAt: new Date(now - 1000).toISOString(),
        updatedAt: new Date(now).toISOString(),
      },
      {
        id: 'job-failed',
        jobId: 'job-failed',
        url: 'https://example.com/5',
        status: 'failed' as const,
        retries: 3,
        maxRetries: 3,
        createdAt: new Date(now - 2000).toISOString(),
        updatedAt: new Date(now - 1000).toISOString(),
        lastError: 'Test error',
      },
    ];

    for (const job of jobs) {
      writeFileSync(
        join(queueDir, `${job.jobId}.json`),
        JSON.stringify(job, null, 2)
      );
    }

    const { getQueueStats } = await import('../../utils/embed-queue');
    const stats = getQueueStats();

    expect(stats.pending).toBe(2);
    expect(stats.processing).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it('should return zero stats for empty queue', async () => {
    const { getQueueStats } = await import('../../utils/embed-queue');
    const stats = getQueueStats();

    expect(stats.pending).toBe(0);
    expect(stats.processing).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
  });
});
