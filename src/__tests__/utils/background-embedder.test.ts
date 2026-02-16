/**
 * Tests for background embedder stale job processing and daemon detection
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IContainer } from '../../container/types';
import { getDefaultSettings } from '../../utils/default-settings';

vi.mock('../../utils/embed-queue', () => ({
  getStalePendingJobs: vi.fn().mockResolvedValue([]),
  getStuckProcessingJobs: vi.fn().mockResolvedValue([]),
  markJobProcessing: vi.fn().mockResolvedValue(undefined),
  markJobCompleted: vi.fn().mockResolvedValue(undefined),
  markJobFailed: vi.fn().mockResolvedValue(undefined),
  markJobPendingNoRetry: vi.fn().mockResolvedValue(undefined),
  markJobPermanentFailed: vi.fn().mockResolvedValue(undefined),
  markJobConfigError: vi.fn().mockResolvedValue(undefined),
  updateEmbedJob: vi.fn().mockResolvedValue(undefined),
  cleanupOldJobs: vi.fn().mockResolvedValue(0),
  cleanupIrrecoverableFailedJobs: vi.fn().mockResolvedValue(0),
  getQueueStats: vi.fn().mockResolvedValue({
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  }),
}));

vi.mock('../../container/utils/embed-helpers', () => ({
  createEmbedItems: vi.fn().mockReturnValue([
    {
      content: 'hello',
      metadata: { url: 'https://example.com', sourceCommand: 'crawl' },
    },
  ]),
}));

vi.mock('../../container/DaemonContainerFactory', () => ({
  createDaemonContainer: vi.fn(),
}));

vi.mock('../../utils/crawl-reconciliation', () => ({
  collectCrawlPageUrls: vi.fn().mockReturnValue(['https://example.com']),
  getDomainFromUrl: vi.fn().mockReturnValue('example.com'),
  reconcileCrawlDomainState: vi.fn().mockResolvedValue({
    urlsToDelete: [],
    trackedBefore: 0,
    trackedAfter: 0,
    seen: 1,
  }),
}));

function createMockContainer(options?: {
  config?: {
    apiKey?: string;
    teiUrl?: string;
    qdrantUrl?: string;
  };
  axonClient?: unknown;
  embedPipeline?: unknown;
}): IContainer {
  const hasConfig = options?.config;
  return {
    config: {
      apiKey:
        hasConfig && 'apiKey' in hasConfig ? hasConfig.apiKey : 'test-key',
      apiUrl: 'http://api.test',
      teiUrl:
        hasConfig && 'teiUrl' in hasConfig
          ? hasConfig.teiUrl
          : 'http://tei:8080',
      qdrantUrl:
        hasConfig && 'qdrantUrl' in hasConfig
          ? hasConfig.qdrantUrl
          : 'http://qdrant:6333',
      qdrantCollection: 'test_collection',
      settings: getDefaultSettings(),
    },
    getAxonClient: vi.fn().mockReturnValue(options?.axonClient),
    getHttpClient: vi.fn(),
    getTeiService: vi.fn(),
    getQdrantService: vi.fn().mockReturnValue({
      deleteByUrlAndSourceCommand: vi.fn().mockResolvedValue(undefined),
    }),
    getEmbedPipeline: vi.fn().mockReturnValue(options?.embedPipeline),
    dispose: vi.fn(),
  } as IContainer;
}

describe('processStaleJobsOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should recover stuck processing jobs before processing stale jobs', async () => {
    const {
      getStalePendingJobs,
      getStuckProcessingJobs,
      updateEmbedJob,
      cleanupIrrecoverableFailedJobs,
    } = await import('../../utils/embed-queue');
    const { createDaemonContainer } = await import(
      '../../container/DaemonContainerFactory'
    );

    const stuckJob = {
      id: 'job-stuck',
      jobId: 'job-stuck',
      url: 'https://example.com/stuck',
      status: 'processing' as const,
      retries: 0,
      maxRetries: 3,
      createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    };

    vi.mocked(getStuckProcessingJobs).mockResolvedValue([stuckJob]);
    vi.mocked(getStalePendingJobs).mockResolvedValue([]);

    const mockContainer = createMockContainer();

    vi.mocked(createDaemonContainer).mockReturnValue(mockContainer);

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { processStaleJobsOnce } = await import(
      '../../utils/background-embedder'
    );

    await processStaleJobsOnce(mockContainer, 5 * 60_000);

    expect(getStuckProcessingJobs).toHaveBeenCalledWith(5 * 60_000);
    expect(updateEmbedJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-stuck',
        status: 'pending',
      })
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Recovering 1 stuck processing jobs')
    );
    expect(cleanupIrrecoverableFailedJobs).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should process stale pending jobs', async () => {
    const {
      getStalePendingJobs,
      markJobProcessing,
      markJobCompleted,
      updateEmbedJob,
      cleanupIrrecoverableFailedJobs,
    } = await import('../../utils/embed-queue');
    const { createDaemonContainer } = await import(
      '../../container/DaemonContainerFactory'
    );

    vi.mocked(getStalePendingJobs).mockResolvedValue([
      {
        id: 'job-1',
        jobId: 'job-1',
        url: 'https://example.com',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockClient = {
      getCrawlStatus: vi.fn().mockResolvedValue({
        status: 'completed',
        data: [
          {
            markdown: 'hello',
            metadata: { sourceURL: 'https://example.com' },
          },
        ],
      }),
    };

    const mockEmbedPipeline = {
      batchEmbed: vi.fn().mockResolvedValue({
        succeeded: 1,
        failed: 0,
        errors: [],
      }),
      autoEmbed: vi.fn(),
    };

    const mockContainer = createMockContainer({
      axonClient: mockClient,
      embedPipeline: mockEmbedPipeline,
    });

    vi.mocked(createDaemonContainer).mockReturnValue(mockContainer);

    const { processStaleJobsOnce } = await import(
      '../../utils/background-embedder'
    );

    const processed = await processStaleJobsOnce(mockContainer, 60_000);

    expect(processed).toBe(1);
    expect(markJobProcessing).toHaveBeenCalledWith('job-1');
    expect(updateEmbedJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        status: 'processing',
      })
    );
    expect(markJobCompleted).toHaveBeenCalledWith('job-1');
    expect(cleanupIrrecoverableFailedJobs).toHaveBeenCalled();
  });

  it('should mark permanent failures without retry backoff for invalid job errors', async () => {
    const {
      getStalePendingJobs,
      markJobPermanentFailed,
      markJobFailed,
      cleanupIrrecoverableFailedJobs,
    } = await import('../../utils/embed-queue');
    const { createDaemonContainer } = await import(
      '../../container/DaemonContainerFactory'
    );

    vi.mocked(getStalePendingJobs).mockResolvedValue([
      {
        id: 'job-invalid',
        jobId: 'job-invalid',
        url: 'https://example.com',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockClient = {
      getCrawlStatus: vi.fn().mockRejectedValue(new Error('Job not found')),
    };
    vi.mocked(createDaemonContainer).mockReturnValue(
      createMockContainer({ axonClient: mockClient })
    );

    const { processStaleJobsOnce } = await import(
      '../../utils/background-embedder'
    );
    await processStaleJobsOnce(createMockContainer(), 60_000);

    expect(markJobPermanentFailed).toHaveBeenCalledWith(
      'job-invalid',
      expect.stringContaining('Job not found')
    );
    expect(markJobFailed).not.toHaveBeenCalled();
    expect(cleanupIrrecoverableFailedJobs).toHaveBeenCalled();
  });

  it('should defer crawl-still-running jobs without consuming retries', async () => {
    const {
      getStalePendingJobs,
      markJobPendingNoRetry,
      markJobFailed,
      markJobPermanentFailed,
      cleanupIrrecoverableFailedJobs,
    } = await import('../../utils/embed-queue');
    const { createDaemonContainer } = await import(
      '../../container/DaemonContainerFactory'
    );

    vi.mocked(getStalePendingJobs).mockResolvedValue([
      {
        id: 'job-still-running',
        jobId: 'job-still-running',
        url: 'https://example.com',
        status: 'pending',
        retries: 1,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockClient = {
      getCrawlStatus: vi.fn().mockResolvedValue({
        status: 'scraping',
        total: 100,
        completed: 20,
      }),
    };

    vi.mocked(createDaemonContainer).mockReturnValue(
      createMockContainer({ axonClient: mockClient })
    );

    const { processStaleJobsOnce } = await import(
      '../../utils/background-embedder'
    );
    await processStaleJobsOnce(createMockContainer(), 60_000);

    expect(markJobPendingNoRetry).toHaveBeenCalledWith(
      'job-still-running',
      'Crawl still scraping'
    );
    expect(markJobFailed).not.toHaveBeenCalled();
    expect(markJobPermanentFailed).not.toHaveBeenCalled();
    expect(cleanupIrrecoverableFailedJobs).toHaveBeenCalled();
  });
});

describe('processEmbedJob - configuration errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should immediately fail job with config error when TEI_URL is missing', async () => {
    const { getStalePendingJobs, markJobConfigError } = await import(
      '../../utils/embed-queue'
    );
    const { createDaemonContainer } = await import(
      '../../container/DaemonContainerFactory'
    );

    vi.mocked(getStalePendingJobs).mockResolvedValue([
      {
        id: 'job-1',
        jobId: 'job-1',
        url: 'https://example.com',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockContainer = createMockContainer({
      config: { teiUrl: undefined }, // Missing TEI_URL
    });

    vi.mocked(createDaemonContainer).mockReturnValue(mockContainer);

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { processStaleJobsOnce } = await import(
      '../../utils/background-embedder'
    );

    await processStaleJobsOnce(mockContainer, 60_000);

    expect(markJobConfigError).toHaveBeenCalledWith(
      'job-1',
      expect.stringContaining('TEI_URL')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CONFIGURATION ERROR')
    );

    consoleErrorSpy.mockRestore();
  });

  it('should immediately fail job with config error when QDRANT_URL is missing', async () => {
    const { getStalePendingJobs, markJobConfigError } = await import(
      '../../utils/embed-queue'
    );
    const { createDaemonContainer } = await import(
      '../../container/DaemonContainerFactory'
    );

    vi.mocked(getStalePendingJobs).mockResolvedValue([
      {
        id: 'job-1',
        jobId: 'job-1',
        url: 'https://example.com',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockContainer = createMockContainer({
      config: { qdrantUrl: undefined }, // Missing QDRANT_URL
    });

    vi.mocked(createDaemonContainer).mockReturnValue(mockContainer);

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { processStaleJobsOnce } = await import(
      '../../utils/background-embedder'
    );

    await processStaleJobsOnce(mockContainer, 60_000);

    expect(markJobConfigError).toHaveBeenCalledWith(
      'job-1',
      expect.stringContaining('QDRANT_URL')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CONFIGURATION ERROR')
    );

    consoleErrorSpy.mockRestore();
  });

  it('should list both missing configs in error message', async () => {
    const { getStalePendingJobs, markJobConfigError } = await import(
      '../../utils/embed-queue'
    );
    const { createDaemonContainer } = await import(
      '../../container/DaemonContainerFactory'
    );

    vi.mocked(getStalePendingJobs).mockResolvedValue([
      {
        id: 'job-1',
        jobId: 'job-1',
        url: 'https://example.com',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockContainer = createMockContainer({
      config: {
        teiUrl: undefined, // Missing both
        qdrantUrl: undefined,
      },
    });

    vi.mocked(createDaemonContainer).mockReturnValue(mockContainer);

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { processStaleJobsOnce } = await import(
      '../../utils/background-embedder'
    );

    await processStaleJobsOnce(mockContainer, 60_000);

    expect(markJobConfigError).toHaveBeenCalledWith(
      'job-1',
      expect.stringMatching(/TEI_URL.*QDRANT_URL/)
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CONFIGURATION ERROR')
    );

    consoleErrorSpy.mockRestore();
  });
});

describe('processEmbedJob - success logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs result.succeeded count, not pages.length', async () => {
    const { getStalePendingJobs } = await import('../../utils/embed-queue');
    const { createDaemonContainer } = await import(
      '../../container/DaemonContainerFactory'
    );

    vi.mocked(getStalePendingJobs).mockResolvedValue([
      {
        id: 'job-1',
        jobId: 'job-1',
        url: 'https://example.com',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const mockClient = {
      getCrawlStatus: vi.fn().mockResolvedValue({
        status: 'completed',
        data: [{ markdown: 'a' }, { markdown: 'b' }, { markdown: 'c' }, {}, {}], // 5 pages, 2 empty
      }),
    };

    // Mock pipeline.batchEmbed returns succeeded=3 (simulating 2 filtered pages)
    const mockEmbedPipeline = {
      batchEmbed: vi.fn().mockResolvedValue({
        succeeded: 3,
        failed: 0,
        errors: [],
      }),
      autoEmbed: vi.fn(),
    };

    const mockContainer = createMockContainer({
      config: { apiKey: 'test' },
      axonClient: mockClient,
      embedPipeline: mockEmbedPipeline,
    });

    vi.mocked(createDaemonContainer).mockReturnValue(mockContainer);

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { processStaleJobsOnce } = await import(
      '../../utils/background-embedder'
    );
    await processStaleJobsOnce(mockContainer, 60_000);

    // Should log "3 pages" (result.succeeded), not "5 pages" (pages.length)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Successfully embedded 3 pages')
    );

    consoleErrorSpy.mockRestore();
  });
});

describe('isEmbedderRunning', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should return true when daemon responds to health check', async () => {
    // Mock successful health check response
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
    });

    const { isEmbedderRunning } = await import(
      '../../utils/background-embedder'
    );

    const result = await isEmbedderRunning();

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/http:\/\/localhost:\d+\/health/),
      expect.objectContaining({
        method: 'GET',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('should return false when daemon returns 404 (health endpoint not found)', async () => {
    // Mock 404 response (health endpoint doesn't exist, daemon is unhealthy)
    global.fetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
    });

    const { isEmbedderRunning } = await import(
      '../../utils/background-embedder'
    );

    const result = await isEmbedderRunning();

    expect(result).toBe(false);
  });

  it('should return false when daemon is not running (connection refused)', async () => {
    // Mock connection refused error
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));

    const { isEmbedderRunning } = await import(
      '../../utils/background-embedder'
    );

    const result = await isEmbedderRunning();

    expect(result).toBe(false);
  });

  it('should return false when daemon health check times out', async () => {
    // Mock timeout error
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error('The operation was aborted'));

    const { isEmbedderRunning } = await import(
      '../../utils/background-embedder'
    );

    const result = await isEmbedderRunning();

    expect(result).toBe(false);
  });

  it('should handle network errors gracefully', async () => {
    // Mock network error
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { isEmbedderRunning } = await import(
      '../../utils/background-embedder'
    );

    const result = await isEmbedderRunning();

    expect(result).toBe(false);
  });
});

describe('resolveEmbedderBindAddress', () => {
  it('uses explicit AXON_EMBEDDER_BIND_ADDRESS=0.0.0.0 override', async () => {
    const { resolveEmbedderBindAddress } = await import(
      '../../utils/background-embedder'
    );
    const result = resolveEmbedderBindAddress(
      { AXON_EMBEDDER_BIND_ADDRESS: '0.0.0.0' },
      false
    );
    expect(result).toBe('0.0.0.0');
  });

  it('uses explicit AXON_EMBEDDER_BIND_ADDRESS=127.0.0.1 override', async () => {
    const { resolveEmbedderBindAddress } = await import(
      '../../utils/background-embedder'
    );
    const result = resolveEmbedderBindAddress(
      { AXON_EMBEDDER_BIND_ADDRESS: '127.0.0.1' },
      true
    );
    expect(result).toBe('127.0.0.1');
  });

  it('defaults to 0.0.0.0 when running in container', async () => {
    const { resolveEmbedderBindAddress } = await import(
      '../../utils/background-embedder'
    );
    const result = resolveEmbedderBindAddress({}, true);
    expect(result).toBe('0.0.0.0');
  });

  it('defaults to 127.0.0.1 when not running in container', async () => {
    const { resolveEmbedderBindAddress } = await import(
      '../../utils/background-embedder'
    );
    const result = resolveEmbedderBindAddress({}, false);
    expect(result).toBe('127.0.0.1');
  });
});

describe('startup config logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logEmbedderConfig logs TEI_URL and QDRANT_URL values', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { logEmbedderConfig } = await import(
      '../../utils/background-embedder'
    );

    logEmbedderConfig({
      teiUrl: 'http://tei:8080',
      qdrantUrl: 'http://qdrant:6333',
      qdrantCollection: 'test_collection',
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('TEI_URL: http://tei:8080')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('QDRANT_URL: http://qdrant:6333')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('QDRANT_COLLECTION: test_collection')
    );

    consoleErrorSpy.mockRestore();
  });

  it('logEmbedderConfig shows (not configured) for missing values', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { logEmbedderConfig } = await import(
      '../../utils/background-embedder'
    );

    logEmbedderConfig({});

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('TEI_URL: (not configured)')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('QDRANT_URL: (not configured)')
    );

    consoleErrorSpy.mockRestore();
  });
});
