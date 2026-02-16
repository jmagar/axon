/**
 * Integration tests for status command edge cases:
 * - Watch mode with change detection
 * - Service failure handling
 * - Filter combinations
 */

// biome-ignore lint/style/noNonNullAssertion: Test mocks require non-null assertions for TypeScript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeJobStatus } from '../../commands/status/execute';
import { computeChangedKeys } from '../../commands/status/helpers';
import type { IContainer } from '../../container/types';
import type { MockAxonClient } from '../utils/mock-client';
import { createTestContainer } from '../utils/test-container';

const createContainer = (...args: Parameters<typeof createTestContainer>) =>
  createTestContainer(...args);

vi.mock('../../utils/embed-queue', () => ({
  getEmbedJob: vi.fn().mockResolvedValue(null),
  listEmbedJobs: vi.fn().mockResolvedValue([]),
  removeEmbedJob: vi.fn().mockResolvedValue(undefined),
  updateEmbedJob: vi.fn().mockResolvedValue(undefined),
  cleanupOldJobs: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../utils/job-history', () => ({
  getRecentJobIds: vi.fn().mockResolvedValue([]),
  removeJobIds: vi.fn().mockResolvedValue(undefined),
  clearJobHistory: vi.fn().mockResolvedValue(undefined),
}));

describe('Status command - Watch mode change detection', () => {
  it('should detect when crawl status changes from scraping to completed', async () => {
    const crawlId = '019c161c-8a80-7051-a438-2ec8707e1bc9';
    const mockClient: Partial<MockAxonClient> = {
      getActiveCrawls: vi.fn().mockResolvedValue({ success: true, crawls: [] }),
      getCrawlStatus: vi.fn(),
      getBatchScrapeStatus: vi.fn(),
      getExtractStatus: vi.fn(),
    };
    const container = createContainer(mockClient);

    const { getRecentJobIds } = await import('../../utils/job-history');
    const { listEmbedJobs } = await import('../../utils/embed-queue');
    vi.mocked(getRecentJobIds).mockImplementation(async (type: string) => {
      if (type === 'crawl') return [crawlId];
      return [];
    });
    vi.mocked(listEmbedJobs).mockResolvedValue([]);

    // First poll: scraping status
    vi.mocked(mockClient.getCrawlStatus)!.mockResolvedValueOnce({
      id: crawlId,
      status: 'scraping',
      total: 100,
      completed: 45,
      data: [],
    });

    const firstData = await executeJobStatus(container, {});
    const firstSnapshot = new Map<string, string>();
    for (const crawl of firstData.crawls) {
      if (crawl.id && crawl.status) {
        firstSnapshot.set(`crawl:${crawl.id}`, crawl.status);
      }
    }

    // Second poll: completed status
    vi.mocked(mockClient.getCrawlStatus)!.mockResolvedValueOnce({
      id: crawlId,
      status: 'completed',
      total: 100,
      completed: 100,
      data: [{ metadata: { sourceURL: 'https://example.com' } }],
    });

    const secondData = await executeJobStatus(container, {});
    const secondSnapshot = new Map<string, string>();
    for (const crawl of secondData.crawls) {
      if (crawl.id && crawl.status) {
        secondSnapshot.set(`crawl:${crawl.id}`, crawl.status);
      }
    }

    // Verify change detection
    const changedKeys = computeChangedKeys(firstSnapshot, secondSnapshot);
    expect(changedKeys.has(`crawl:${crawlId}`)).toBe(true);
    expect(firstSnapshot.get(`crawl:${crawlId}`)).toBe('scraping');
    expect(secondSnapshot.get(`crawl:${crawlId}`)).toBe('completed');
  });

  it('should detect when new embed jobs appear', async () => {
    const mockClient: Partial<MockAxonClient> = {
      getActiveCrawls: vi.fn().mockResolvedValue({ success: true, crawls: [] }),
      getCrawlStatus: vi.fn(),
      getBatchScrapeStatus: vi.fn(),
      getExtractStatus: vi.fn(),
    };
    const container = createContainer(mockClient);

    const { getRecentJobIds } = await import('../../utils/job-history');
    const { listEmbedJobs } = await import('../../utils/embed-queue');
    vi.mocked(getRecentJobIds).mockResolvedValue([]);

    // First poll: no embed jobs
    vi.mocked(listEmbedJobs).mockResolvedValueOnce([]);
    const firstData = await executeJobStatus(container, {});
    const firstSnapshot = new Map<string, string>();
    for (const job of firstData.embeddings.pending) {
      firstSnapshot.set(`embed:${job.jobId}`, 'pending');
    }

    // Second poll: new pending embed job
    vi.mocked(listEmbedJobs).mockResolvedValueOnce([
      {
        id: 'embed-456',
        jobId: 'embed-456',
        url: 'https://example.com',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:01:00.000Z',
      },
    ]);

    const secondData = await executeJobStatus(container, {});
    const secondSnapshot = new Map<string, string>();
    for (const job of secondData.embeddings.pending) {
      secondSnapshot.set(`embed:${job.jobId}`, 'pending');
    }

    // Verify new job detected
    const changedKeys = computeChangedKeys(firstSnapshot, secondSnapshot);
    expect(changedKeys.has('embed:embed-456')).toBe(true);
    expect(firstSnapshot.has('embed:embed-456')).toBe(false);
    expect(secondSnapshot.has('embed:embed-456')).toBe(true);
  });

  it('should detect when jobs are removed', async () => {
    const crawlId = '019c161c-8a80-7051-a438-2ec8707e1bc7';
    const mockClient: Partial<MockAxonClient> = {
      getActiveCrawls: vi.fn().mockResolvedValue({ success: true, crawls: [] }),
      getCrawlStatus: vi.fn(),
      getBatchScrapeStatus: vi.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          status: 'completed',
          total: 0,
          completed: 0,
          data: [],
        })
      ),
      getExtractStatus: vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve({ id, status: 'completed', data: [] })
        ),
    };
    const container = createContainer(mockClient);

    const { getRecentJobIds } = await import('../../utils/job-history');
    const { listEmbedJobs } = await import('../../utils/embed-queue');
    vi.mocked(getRecentJobIds).mockImplementation(async (type: string) => {
      if (type === 'crawl') return [crawlId];
      return [];
    });
    vi.mocked(listEmbedJobs).mockResolvedValue([]);

    // First poll: crawl exists
    vi.mocked(mockClient.getCrawlStatus)!.mockResolvedValueOnce({
      id: crawlId,
      status: 'scraping',
      total: 10,
      completed: 5,
      data: [],
    });

    const firstData = await executeJobStatus(container, {});
    const firstSnapshot = new Map<string, string>();
    for (const crawl of firstData.crawls) {
      if (crawl.id && crawl.status) {
        firstSnapshot.set(`crawl:${crawl.id}`, crawl.status);
      }
    }

    // Second poll: crawl not found (404)
    // Reset the mock and set up for second call
    vi.mocked(mockClient.getCrawlStatus)!.mockReset();
    vi.mocked(mockClient.getCrawlStatus)!.mockRejectedValue(
      new Error('Job not found')
    );

    const secondData = await executeJobStatus(container, {});
    const secondSnapshot = new Map<string, string>();
    for (const crawl of secondData.crawls) {
      if (crawl.id && crawl.status) {
        secondSnapshot.set(`crawl:${crawl.id}`, crawl.status);
      }
    }

    // Verify status change detected (from 'scraping' to 'failed')
    const changedKeys = computeChangedKeys(firstSnapshot, secondSnapshot);
    expect(changedKeys.has(`crawl:${crawlId}`)).toBe(true);
    expect(firstSnapshot.get(`crawl:${crawlId}`)).toBe('scraping');
    expect(secondSnapshot.get(`crawl:${crawlId}`)).toBe('failed');
  });
});

describe('Status command - Service failure handling', () => {
  let container: IContainer;

  beforeEach(async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    const { listEmbedJobs, cleanupOldJobs } = await import(
      '../../utils/embed-queue'
    );
    vi.mocked(getRecentJobIds).mockResolvedValue([]);
    vi.mocked(listEmbedJobs).mockResolvedValue([]);
    vi.mocked(cleanupOldJobs).mockResolvedValue(0);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle Axon API 503 errors gracefully', async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockImplementation(async (type: string) => {
      if (type === 'crawl') return ['crawl-1'];
      return [];
    });

    const mockClient: Partial<MockAxonClient> = {
      getActiveCrawls: vi
        .fn()
        .mockRejectedValue(new Error('503 Service Unavailable')),
      getCrawlStatus: vi
        .fn()
        .mockRejectedValue(new Error('503 Service Unavailable')),
      getBatchScrapeStatus: vi.fn(),
      getExtractStatus: vi.fn(),
    };
    container = createContainer(mockClient);

    // Should not throw - errors handled internally
    const data = await executeJobStatus(container, {});

    // Should return empty results instead of throwing
    expect(data.activeCrawls).toBeDefined();
    expect(data.crawls).toBeDefined();
    expect(Array.isArray(data.crawls)).toBe(true);
  });

  it('should handle Qdrant connection refused errors', async () => {
    const { listEmbedJobs } = await import('../../utils/embed-queue');

    // Simulate Qdrant being down
    vi.mocked(listEmbedJobs).mockRejectedValue(
      new Error('ECONNREFUSED: Connection refused')
    );

    const mockClient: Partial<MockAxonClient> = {
      getActiveCrawls: vi.fn().mockResolvedValue({ success: true, crawls: [] }),
      getCrawlStatus: vi.fn(),
      getBatchScrapeStatus: vi.fn(),
      getExtractStatus: vi.fn(),
    };
    container = createContainer(mockClient);

    // Should throw - Qdrant failure is critical
    await expect(executeJobStatus(container, {})).rejects.toThrow(
      'ECONNREFUSED'
    );
  });

  it('should handle partial API failures gracefully', async () => {
    const crawlSuccess = '019c161c-8a80-7051-a438-2ec8707e1bc1';
    const crawlFail = '019c161c-8a80-7051-a438-2ec8707e1bc2';
    const batchFail = '019c161c-8a80-7051-a438-2ec8707e1bc3';

    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockImplementation(async (type: string) => {
      if (type === 'crawl') return [crawlSuccess, crawlFail];
      if (type === 'batch') return [batchFail];
      return [];
    });

    const mockClient: Partial<MockAxonClient> = {
      getActiveCrawls: vi.fn().mockResolvedValue({ success: true, crawls: [] }),
      getCrawlStatus: vi.fn().mockImplementation((id: string) => {
        if (id === crawlSuccess) {
          return Promise.resolve({
            id,
            status: 'completed',
            total: 5,
            completed: 5,
            data: [],
          });
        }
        return Promise.reject(new Error('Timeout'));
      }),
      getBatchScrapeStatus: vi.fn().mockRejectedValue(new Error('Not found')),
      getExtractStatus: vi.fn(),
    };
    container = createContainer(mockClient);

    const data = await executeJobStatus(container, {});

    // Should return successful results
    expect(data.crawls.some((c) => c.id === crawlSuccess)).toBe(true);
    // Failed requests should not appear in results (they get status: 'failed' with error field)
    const failedCrawl = data.crawls.find((c) => c.id === crawlFail);
    if (failedCrawl) {
      expect(failedCrawl.status).toBe('failed');
    }
  });

  it('should retry transient API failures', async () => {
    const crawlId = '019c161c-8a80-7051-a438-2ec8707e1bc4';

    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockImplementation(async (type: string) => {
      if (type === 'crawl') return [crawlId];
      return [];
    });

    let attemptCount = 0;
    const mockClient: Partial<MockAxonClient> = {
      getActiveCrawls: vi.fn().mockResolvedValue({ success: true, crawls: [] }),
      getCrawlStatus: vi.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          // Fail first 2 attempts
          return Promise.reject(new Error('Network timeout'));
        }
        // Succeed on 3rd attempt
        return Promise.resolve({
          id: crawlId,
          status: 'completed',
          total: 1,
          completed: 1,
          data: [],
        });
      }),
      getBatchScrapeStatus: vi.fn(),
      getExtractStatus: vi.fn(),
    };
    container = createContainer(mockClient);

    const data = await executeJobStatus(container, {});

    // Should have retried and eventually succeeded
    expect(attemptCount).toBeGreaterThanOrEqual(3);
    expect(data.crawls.some((c) => c.id === crawlId)).toBe(true);
  });
});

describe('Status command - Filter combinations', () => {
  const crawl1 = '019c161c-8a80-7051-a438-2ec8707e1bc1';
  const crawl2 = '019c161c-8a80-7051-a438-2ec8707e1bc2';
  const crawl3 = '019c161c-8a80-7051-a438-2ec8707e1bc3';
  const batch1 = '019c161c-8a80-7051-a438-2ec8707e1bb1';

  const mockClient = {
    getActiveCrawls: vi.fn().mockResolvedValue({ success: true, crawls: [] }),
    getCrawlStatus: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({
        id,
        status: 'completed',
        total: 1,
        completed: 1,
        data: [],
      })
    ),
    getBatchScrapeStatus: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({
        id,
        status: 'completed',
        total: 1,
        completed: 1,
        data: [],
      })
    ),
    getExtractStatus: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({
        id,
        status: 'completed',
        data: [],
      })
    ),
  };
  let container: IContainer;

  beforeEach(async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    const { listEmbedJobs, cleanupOldJobs } = await import(
      '../../utils/embed-queue'
    );
    vi.mocked(getRecentJobIds).mockResolvedValue([]);
    vi.mocked(listEmbedJobs).mockResolvedValue([]);
    vi.mocked(cleanupOldJobs).mockResolvedValue(0);
    container = createContainer(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should apply crawl and batch filters together', async () => {
    await executeJobStatus(container, {
      crawl: crawl1,
      batch: batch1,
    });

    // Should call both APIs with the specified IDs
    expect(mockClient.getCrawlStatus).toHaveBeenCalledWith(crawl1, {
      autoPaginate: false,
    });
    expect(mockClient.getBatchScrapeStatus).toHaveBeenCalledWith(batch1, {
      autoPaginate: false,
    });
  });

  it('should handle comma-separated crawl IDs', async () => {
    await executeJobStatus(container, {
      crawl: `${crawl1},${crawl2},${crawl3}`,
    });

    // Should call getCrawlStatus 3 times
    expect(mockClient.getCrawlStatus).toHaveBeenCalledTimes(3);
    expect(mockClient.getCrawlStatus).toHaveBeenCalledWith(crawl1, {
      autoPaginate: false,
    });
    expect(mockClient.getCrawlStatus).toHaveBeenCalledWith(crawl2, {
      autoPaginate: false,
    });
    expect(mockClient.getCrawlStatus).toHaveBeenCalledWith(crawl3, {
      autoPaginate: false,
    });
  });

  it('should filter embed queue by specific job ID', async () => {
    const { listEmbedJobs } = await import('../../utils/embed-queue');
    vi.mocked(listEmbedJobs).mockResolvedValue([
      {
        id: 'embed-1',
        jobId: 'embed-1',
        url: 'https://example.com/1',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:01:00.000Z',
      },
      {
        id: 'embed-2',
        jobId: 'embed-2',
        url: 'https://example.com/2',
        status: 'completed',
        retries: 0,
        maxRetries: 3,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:02:00.000Z',
      },
    ]);

    const data = await executeJobStatus(container, {
      embed: 'embed-1', // Filter by specific ID
    });

    // Should return the specific embed job
    expect(data.embeddings.job?.jobId).toBe('embed-1');
  });

  it('should show all embeds when embed=true', async () => {
    const { listEmbedJobs } = await import('../../utils/embed-queue');
    vi.mocked(listEmbedJobs).mockResolvedValue([
      {
        id: 'embed-1',
        jobId: 'embed-1',
        url: 'https://example.com/1',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:01:00.000Z',
      },
      {
        id: 'embed-2',
        jobId: 'embed-2',
        url: 'https://example.com/2',
        status: 'failed',
        retries: 3,
        maxRetries: 3,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:02:00.000Z',
        lastError: 'Test error',
      },
    ]);

    const data = await executeJobStatus(container, {
      embed: true, // Show all
    });

    // Should include all embeds
    expect(data.embeddings.pending.length).toBeGreaterThan(0);
    expect(data.embeddings.failed.length).toBeGreaterThan(0);
  });

  it('should ignore whitespace and empty values in comma-separated filters', async () => {
    await executeJobStatus(container, {
      crawl: `${crawl1}, ,${crawl2},  , ${crawl3}`,
    });

    // Should only call with valid IDs (no empty strings)
    expect(mockClient.getCrawlStatus).toHaveBeenCalledTimes(3);
  });

  it('should filter out invalid job IDs', async () => {
    await executeJobStatus(container, {
      crawl: 'not-a-uuid,also-invalid', // Invalid UUIDs
    });

    // Should not call getCrawlStatus with invalid IDs
    expect(mockClient.getCrawlStatus).not.toHaveBeenCalled();
  });
});
