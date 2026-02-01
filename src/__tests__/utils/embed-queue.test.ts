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
