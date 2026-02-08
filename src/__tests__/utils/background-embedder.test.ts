/**
 * Tests for background embedder stale job processing and daemon detection
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IContainer } from '../../container/types';

vi.mock('../../utils/embed-queue', () => ({
  getStalePendingJobs: vi.fn().mockResolvedValue([]),
  getStuckProcessingJobs: vi.fn().mockResolvedValue([]),
  markJobProcessing: vi.fn().mockResolvedValue(undefined),
  markJobCompleted: vi.fn().mockResolvedValue(undefined),
  markJobFailed: vi.fn().mockResolvedValue(undefined),
  markJobConfigError: vi.fn().mockResolvedValue(undefined),
  updateEmbedJob: vi.fn().mockResolvedValue(undefined),
  cleanupOldJobs: vi.fn().mockResolvedValue(0),
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

function createMockContainer(options?: {
  config?: {
    apiKey?: string;
    teiUrl?: string;
    qdrantUrl?: string;
  };
  firecrawlClient?: unknown;
  embedPipeline?: unknown;
}): IContainer {
  const hasConfig = options?.config;
  return {
    config: {
      apiKey:
        hasConfig && 'apiKey' in hasConfig ? hasConfig.apiKey : 'test-key',
      teiUrl:
        hasConfig && 'teiUrl' in hasConfig
          ? hasConfig.teiUrl
          : 'http://tei:8080',
      qdrantUrl:
        hasConfig && 'qdrantUrl' in hasConfig
          ? hasConfig.qdrantUrl
          : 'http://qdrant:6333',
    },
    getFirecrawlClient: vi.fn().mockReturnValue(options?.firecrawlClient),
    getHttpClient: vi.fn(),
    getTeiService: vi.fn(),
    getQdrantService: vi.fn(),
    getEmbedPipeline: vi.fn().mockReturnValue(options?.embedPipeline),
    dispose: vi.fn(),
  };
}

describe('processStaleJobsOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should recover stuck processing jobs before processing stale jobs', async () => {
    const { getStalePendingJobs, getStuckProcessingJobs, updateEmbedJob } =
      await import('../../utils/embed-queue');
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

    consoleErrorSpy.mockRestore();
  });

  it('should process stale pending jobs', async () => {
    const { getStalePendingJobs, markJobProcessing, markJobCompleted } =
      await import('../../utils/embed-queue');
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
      firecrawlClient: mockClient,
      embedPipeline: mockEmbedPipeline,
    });

    vi.mocked(createDaemonContainer).mockReturnValue(mockContainer);

    const { processStaleJobsOnce } = await import(
      '../../utils/background-embedder'
    );

    const processed = await processStaleJobsOnce(mockContainer, 60_000);

    expect(processed).toBe(1);
    expect(markJobProcessing).toHaveBeenCalledWith('job-1');
    expect(markJobCompleted).toHaveBeenCalledWith('job-1');
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
      firecrawlClient: mockClient,
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
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('should return true when daemon returns 404 (server running but no health endpoint)', async () => {
    // Mock 404 response (server is running but endpoint doesn't exist)
    global.fetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
    });

    const { isEmbedderRunning } = await import(
      '../../utils/background-embedder'
    );

    const result = await isEmbedderRunning();

    expect(result).toBe(true);
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
