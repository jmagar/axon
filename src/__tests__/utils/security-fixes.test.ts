/**
 * Security fix verification tests
 *
 * Tests for SEC-01 through SEC-06, SEC-13, SEC-14, SEC-18 remediation.
 * Each describe block maps to a specific security finding from the audit.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('SEC-02: API keys stripped from job files on disk', () => {
  let queueDir: string;

  beforeEach(() => {
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-sec02-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(queueDir, { recursive: true, force: true });
    delete process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
    vi.resetModules();
  });

  it('should not persist apiKey to disk when enqueuing', async () => {
    const { enqueueEmbedJob } = await import('../../utils/embed-queue');
    const job = await enqueueEmbedJob(
      'test-job-1',
      'https://example.com',
      'secret-api-key-123'
    );

    // In-memory object should have the key
    expect(job.apiKey).toBe('secret-api-key-123');

    // File on disk should NOT have the key
    const filePath = join(queueDir, 'test-job-1.json');
    const fileContent = readFileSync(filePath, 'utf-8');
    expect(fileContent).not.toContain('secret-api-key-123');
    expect(fileContent).not.toContain('"apiKey"');

    const parsed = JSON.parse(fileContent);
    expect(parsed.apiKey).toBeUndefined();
    expect(parsed.jobId).toBe('test-job-1');
    expect(parsed.url).toBe('https://example.com');
  });

  it('should not persist apiKey when updating a job', async () => {
    const { enqueueEmbedJob, updateEmbedJob, getEmbedJob } = await import(
      '../../utils/embed-queue'
    );
    const job = await enqueueEmbedJob(
      'test-job-2',
      'https://example.com',
      'my-secret-key'
    );

    // Update with apiKey still in memory
    job.status = 'processing';
    await updateEmbedJob(job);

    const filePath = join(queueDir, 'test-job-2.json');
    const fileContent = readFileSync(filePath, 'utf-8');
    expect(fileContent).not.toContain('my-secret-key');
    expect(fileContent).not.toContain('"apiKey"');
  });
});

describe('SEC-04: SSRF URL safety checks', () => {
  it('should block private IP ranges', async () => {
    const { checkUrlSafety } = await import('../../utils/url');

    // RFC 1918 private ranges
    expect(checkUrlSafety('http://10.0.0.1/')).not.toBeNull();
    expect(checkUrlSafety('http://172.16.0.1/')).not.toBeNull();
    expect(checkUrlSafety('http://172.31.255.255/')).not.toBeNull();
    expect(checkUrlSafety('http://192.168.1.1/')).not.toBeNull();

    // Loopback
    expect(checkUrlSafety('http://127.0.0.1/')).not.toBeNull();
    expect(checkUrlSafety('http://127.0.0.1:53379/')).not.toBeNull();

    // Link-local
    expect(checkUrlSafety('http://169.254.169.254/')).not.toBeNull();
    expect(
      checkUrlSafety('http://169.254.169.254/latest/meta-data/')
    ).not.toBeNull();

    // Localhost
    expect(checkUrlSafety('http://localhost/')).not.toBeNull();
    expect(checkUrlSafety('http://localhost:8080/')).not.toBeNull();

    // Cloud metadata
    expect(checkUrlSafety('http://metadata.google.internal/')).not.toBeNull();
  });

  it('should allow public URLs', async () => {
    const { checkUrlSafety } = await import('../../utils/url');

    expect(checkUrlSafety('https://example.com')).toBeNull();
    expect(checkUrlSafety('https://docs.firecrawl.dev')).toBeNull();
    expect(checkUrlSafety('http://8.8.8.8/')).toBeNull();
    expect(checkUrlSafety('https://github.com/repo')).toBeNull();
  });

  it('should reject invalid URLs', async () => {
    const { checkUrlSafety } = await import('../../utils/url');

    expect(checkUrlSafety('not-a-url')).not.toBeNull();
    expect(checkUrlSafety('')).not.toBeNull();
  });

  it('should not block 172.x outside 16-31 range', async () => {
    const { checkUrlSafety } = await import('../../utils/url');

    // 172.15.x.x and 172.32.x.x are NOT private
    expect(checkUrlSafety('http://172.15.0.1/')).toBeNull();
    expect(checkUrlSafety('http://172.32.0.1/')).toBeNull();
  });
});

describe('SEC-05: Zod schema validation for embed job files', () => {
  let queueDir: string;

  beforeEach(() => {
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-sec05-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(queueDir, { recursive: true, force: true });
    delete process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
    vi.resetModules();
  });

  it('should reject job files with invalid status', async () => {
    const invalidJob = {
      id: 'bad-job',
      jobId: 'bad-job',
      url: 'https://example.com',
      status: 'INVALID_STATUS',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(queueDir, 'bad-job.json'),
      JSON.stringify(invalidJob, null, 2)
    );

    const { getEmbedJobDetailed } = await import('../../utils/embed-queue');
    const result = await getEmbedJobDetailed('bad-job');
    expect(result.status).toBe('corrupted');
    expect(result.job).toBeNull();
  });

  it('should reject job files with negative retries', async () => {
    const invalidJob = {
      id: 'neg-retry',
      jobId: 'neg-retry',
      url: 'https://example.com',
      status: 'pending',
      retries: -1,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(queueDir, 'neg-retry.json'),
      JSON.stringify(invalidJob, null, 2)
    );

    const { getEmbedJobDetailed } = await import('../../utils/embed-queue');
    const result = await getEmbedJobDetailed('neg-retry');
    expect(result.status).toBe('corrupted');
  });

  it('should reject job files with unknown fields (strict mode)', async () => {
    const invalidJob = {
      id: 'extra-fields',
      jobId: 'extra-fields',
      url: 'https://example.com',
      status: 'pending',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      __proto_pollution__: 'evil',
    };
    writeFileSync(
      join(queueDir, 'extra-fields.json'),
      JSON.stringify(invalidJob, null, 2)
    );

    const { getEmbedJobDetailed } = await import('../../utils/embed-queue');
    const result = await getEmbedJobDetailed('extra-fields');
    expect(result.status).toBe('corrupted');
  });

  it('should accept valid job files', async () => {
    const validJob = {
      id: 'good-job',
      jobId: 'good-job',
      url: 'https://example.com',
      status: 'pending',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(queueDir, 'good-job.json'),
      JSON.stringify(validJob, null, 2)
    );

    const { getEmbedJobDetailed } = await import('../../utils/embed-queue');
    const result = await getEmbedJobDetailed('good-job');
    expect(result.status).toBe('found');
    expect(result.job).not.toBeNull();
    expect(result.job?.jobId).toBe('good-job');
  });

  it('should filter out invalid jobs during list', async () => {
    const validJob = {
      id: 'valid',
      jobId: 'valid',
      url: 'https://example.com',
      status: 'pending',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const invalidJob = {
      id: 'invalid',
      jobId: 'invalid',
      url: 'not-valid',
      status: 'BOGUS',
      retries: 'not-a-number',
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    writeFileSync(
      join(queueDir, 'valid.json'),
      JSON.stringify(validJob, null, 2)
    );
    writeFileSync(
      join(queueDir, 'invalid.json'),
      JSON.stringify(invalidJob, null, 2)
    );

    const { listEmbedJobsDetailed } = await import('../../utils/embed-queue');
    const result = await listEmbedJobsDetailed();
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].jobId).toBe('valid');
    expect(result.errors).toHaveLength(1);
  });
});

describe('SEC-06: Qdrant collection name validation', () => {
  it('should accept valid collection names', async () => {
    const { validateCollectionName } = await import('../../commands/shared');

    expect(validateCollectionName('firecrawl')).toBe('firecrawl');
    expect(validateCollectionName('my-collection')).toBe('my-collection');
    expect(validateCollectionName('test_collection_v2')).toBe(
      'test_collection_v2'
    );
    expect(validateCollectionName('Collection123')).toBe('Collection123');
  });

  it('should reject collection names with path traversal', async () => {
    const { validateCollectionName } = await import('../../commands/shared');

    expect(() => validateCollectionName('../admin')).toThrow(
      'Invalid collection name'
    );
    expect(() => validateCollectionName('test/../admin')).toThrow(
      'Invalid collection name'
    );
    expect(() => validateCollectionName('test/../../admin')).toThrow(
      'Invalid collection name'
    );
  });

  it('should reject collection names with special characters', async () => {
    const { validateCollectionName } = await import('../../commands/shared');

    expect(() => validateCollectionName('test collection')).toThrow(
      'Invalid collection name'
    );
    expect(() => validateCollectionName('test;drop')).toThrow(
      'Invalid collection name'
    );
    expect(() => validateCollectionName('test?force=true')).toThrow(
      'Invalid collection name'
    );
    expect(() => validateCollectionName('')).toThrow('Invalid collection name');
  });

  it('should reject overly long collection names', async () => {
    const { validateCollectionName } = await import('../../commands/shared');

    const longName = 'a'.repeat(129);
    expect(() => validateCollectionName(longName)).toThrow('too long');
  });

  it('resolveCollectionName should validate', async () => {
    const { resolveCollectionName } = await import('../../commands/shared');

    // Should work with valid names
    const container = {
      config: { qdrantCollection: 'my-collection' },
    } as any;
    expect(resolveCollectionName(container)).toBe('my-collection');

    // Should throw with invalid names
    const badContainer = {
      config: { qdrantCollection: '../evil' },
    } as any;
    expect(() => resolveCollectionName(badContainer)).toThrow(
      'Invalid collection name'
    );
  });
});

describe('SEC-13: Job ID path traversal prevention', () => {
  let queueDir: string;

  beforeEach(() => {
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-sec13-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(queueDir, { recursive: true, force: true });
    delete process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
    vi.resetModules();
  });

  it('should reject job IDs with path traversal sequences', async () => {
    const { enqueueEmbedJob } = await import('../../utils/embed-queue');

    await expect(
      enqueueEmbedJob('../../etc/passwd', 'https://example.com')
    ).rejects.toThrow('Invalid job ID format');

    await expect(
      enqueueEmbedJob('../secret', 'https://example.com')
    ).rejects.toThrow('Invalid job ID format');
  });

  it('should reject job IDs with slashes', async () => {
    const { enqueueEmbedJob } = await import('../../utils/embed-queue');

    await expect(
      enqueueEmbedJob('job/subdir', 'https://example.com')
    ).rejects.toThrow('Invalid job ID format');
  });

  it('should accept valid UUID-format job IDs', async () => {
    const { enqueueEmbedJob } = await import('../../utils/embed-queue');

    const job = await enqueueEmbedJob(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'https://example.com'
    );
    expect(job.jobId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('should accept alphanumeric with hyphens and underscores', async () => {
    const { enqueueEmbedJob } = await import('../../utils/embed-queue');

    const job = await enqueueEmbedJob('job_123-abc', 'https://example.com');
    expect(job.jobId).toBe('job_123-abc');
  });

  it('should reject job IDs with null bytes', async () => {
    const { getEmbedJobDetailed } = await import('../../utils/embed-queue');

    await expect(getEmbedJobDetailed('job\0evil')).rejects.toThrow(
      'Invalid job ID format'
    );
  });
});

describe('SEC-01: Webhook server authentication', () => {
  it('should export generateWebhookSecret', async () => {
    const { generateWebhookSecret } = await import(
      '../../utils/background-embedder'
    );

    const secret = generateWebhookSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBe(64); // 32 bytes = 64 hex chars
  });

  it('should generate unique secrets each call', async () => {
    const { generateWebhookSecret } = await import(
      '../../utils/background-embedder'
    );

    const secret1 = generateWebhookSecret();
    const secret2 = generateWebhookSecret();
    expect(secret1).not.toBe(secret2);
  });
});

describe('SEC-03: File locking for job mutations', () => {
  let queueDir: string;

  beforeEach(() => {
    queueDir = mkdtempSync(join(tmpdir(), 'firecrawl-sec03-'));
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR = queueDir;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(queueDir, { recursive: true, force: true });
    delete process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
    vi.resetModules();
  });

  it('markJobCompleted should persist status correctly', async () => {
    const validJob = {
      id: 'lock-test',
      jobId: 'lock-test',
      url: 'https://example.com',
      status: 'processing',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(queueDir, 'lock-test.json'),
      JSON.stringify(validJob, null, 2)
    );

    const { markJobCompleted, getEmbedJob } = await import(
      '../../utils/embed-queue'
    );
    await markJobCompleted('lock-test');

    const updated = await getEmbedJob('lock-test');
    expect(updated?.status).toBe('completed');
  });

  it('markJobFailed should increment retries', async () => {
    const validJob = {
      id: 'fail-test',
      jobId: 'fail-test',
      url: 'https://example.com',
      status: 'processing',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(queueDir, 'fail-test.json'),
      JSON.stringify(validJob, null, 2)
    );

    const { markJobFailed, getEmbedJob } = await import(
      '../../utils/embed-queue'
    );
    await markJobFailed('fail-test', 'test error');

    const updated = await getEmbedJob('fail-test');
    expect(updated?.retries).toBe(1);
    expect(updated?.lastError).toBe('test error');
    // With retries=1 < maxRetries=3, should go back to pending
    expect(updated?.status).toBe('pending');
  });

  it('markJobPendingNoRetry should not increment retries', async () => {
    const validJob = {
      id: 'nretry-test',
      jobId: 'nretry-test',
      url: 'https://example.com',
      status: 'processing',
      retries: 1,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(queueDir, 'nretry-test.json'),
      JSON.stringify(validJob, null, 2)
    );

    const { markJobPendingNoRetry, getEmbedJob } = await import(
      '../../utils/embed-queue'
    );
    await markJobPendingNoRetry('nretry-test', 'still running');

    const updated = await getEmbedJob('nretry-test');
    expect(updated?.retries).toBe(1); // NOT incremented
    expect(updated?.status).toBe('pending');
    expect(updated?.lastError).toBe('still running');
  });

  it('markJobConfigError should set retries to maxRetries', async () => {
    const validJob = {
      id: 'config-err',
      jobId: 'config-err',
      url: 'https://example.com',
      status: 'processing',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(queueDir, 'config-err.json'),
      JSON.stringify(validJob, null, 2)
    );

    const { markJobConfigError, getEmbedJob } = await import(
      '../../utils/embed-queue'
    );
    await markJobConfigError('config-err', 'TEI not configured');

    const updated = await getEmbedJob('config-err');
    expect(updated?.retries).toBe(3);
    expect(updated?.status).toBe('failed');
    expect(updated?.lastError).toContain('Configuration error');
  });

  it('markJobPermanentFailed should set retries to maxRetries', async () => {
    const validJob = {
      id: 'perm-fail',
      jobId: 'perm-fail',
      url: 'https://example.com',
      status: 'processing',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(queueDir, 'perm-fail.json'),
      JSON.stringify(validJob, null, 2)
    );

    const { markJobPermanentFailed, getEmbedJob } = await import(
      '../../utils/embed-queue'
    );
    await markJobPermanentFailed('perm-fail', 'Job not found');

    const updated = await getEmbedJob('perm-fail');
    expect(updated?.retries).toBe(3);
    expect(updated?.status).toBe('failed');
    expect(updated?.lastError).toBe('Job not found');
  });

  it('should handle non-existent job gracefully in mutations', async () => {
    const { markJobCompleted } = await import('../../utils/embed-queue');

    // Should not throw for non-existent job
    await expect(markJobCompleted('nonexistent-job')).resolves.toBeUndefined();
  });
});
