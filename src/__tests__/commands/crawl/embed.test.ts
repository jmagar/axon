import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachEmbedWebhook,
  handleAsyncEmbedding,
  handleManualEmbedding,
  handleSyncEmbedding,
} from '../../../commands/crawl/embed';
import type { CrawlJobData } from '../../../types/crawl';
import { createTestContainer } from '../../utils/test-container';

const createContainer = (...args: Parameters<typeof createTestContainer>) =>
  createTestContainer(...args);

// Mock dependencies
vi.mock('../../../utils/embedder-webhook', () => ({
  buildEmbedderWebhookConfig: vi.fn(),
}));

vi.mock('../../../utils/job-history', () => ({
  recordJob: vi.fn().mockResolvedValue(undefined),
}));

import { buildEmbedderWebhookConfig } from '../../../utils/embedder-webhook';
import { recordJob } from '../../../utils/job-history';

describe('attachEmbedWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {});

  it('should attach webhook when embedding enabled and not in wait mode', () => {
    const webhookConfig = { url: 'https://webhook.example.com' };
    vi.mocked(buildEmbedderWebhookConfig).mockReturnValue(
      webhookConfig as never
    );

    const options = { limit: 10 };
    const result = attachEmbedWebhook(options, true, false, {});

    expect(result).toEqual({ limit: 10, webhook: webhookConfig });
  });

  it('should not attach webhook when embedding disabled', () => {
    const webhookConfig = { url: 'https://webhook.example.com' };
    vi.mocked(buildEmbedderWebhookConfig).mockReturnValue(
      webhookConfig as never
    );

    const options = { limit: 10 };
    const result = attachEmbedWebhook(options, false, false, {});

    expect(result).toEqual({ limit: 10 });
  });

  it('should not attach webhook in wait mode', () => {
    const webhookConfig = { url: 'https://webhook.example.com' };
    vi.mocked(buildEmbedderWebhookConfig).mockReturnValue(
      webhookConfig as never
    );

    const options = { limit: 10 };
    const result = attachEmbedWebhook(options, true, true, {});

    expect(result).toEqual({ limit: 10 });
  });

  it('should not attach webhook when config is null', () => {
    vi.mocked(buildEmbedderWebhookConfig).mockReturnValue(null);

    const options = { limit: 10 };
    const result = attachEmbedWebhook(options, true, false, {});

    expect(result).toEqual({ limit: 10 });
  });
});

describe('handleAsyncEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should enqueue job and show webhook message when configured', async () => {
    const mockEnqueueEmbedJob = vi.fn().mockResolvedValue(undefined);
    const webhookConfig = { url: 'https://webhook.example.com' };

    vi.mocked(buildEmbedderWebhookConfig).mockReturnValue(
      webhookConfig as never
    );
    vi.doMock('../../../utils/embed-queue', () => ({
      enqueueEmbedJob: mockEnqueueEmbedJob,
    }));

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await handleAsyncEmbedding(
      'job-123',
      'https://example.com',
      { embedderWebhookUrl: 'https://webhook.example.com' },
      'test-key'
    );

    expect(mockEnqueueEmbedJob).toHaveBeenCalledWith(
      'job-123',
      'https://example.com',
      'test-key'
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        'Queued embedding job for background processing: job-123'
      )
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Embeddings will be generated automatically')
    );

    consoleError.mockRestore();
  });

  it('should show setup instructions when webhook not configured', async () => {
    const mockEnqueueEmbedJob = vi.fn().mockResolvedValue(undefined);

    vi.mocked(buildEmbedderWebhookConfig).mockReturnValue(null);
    vi.doMock('../../../utils/embed-queue', () => ({
      enqueueEmbedJob: mockEnqueueEmbedJob,
    }));

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await handleAsyncEmbedding('job-456', 'https://example.com', {});

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Embedder webhook not configured')
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('firecrawl crawl job-456 --embed')
    );

    consoleError.mockRestore();
  });
});

describe('handleSyncEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should embed pages and record job', async () => {
    const crawlJobData: CrawlJobData = {
      id: 'job-123',
      status: 'completed',
      total: 2,
      completed: 2,
      data: [
        {
          markdown: 'Page 1',
          metadata: { sourceURL: 'https://example.com/1' },
        },
        {
          markdown: 'Page 2',
          metadata: { sourceURL: 'https://example.com/2' },
        },
      ],
    };

    const mockAutoEmbed = vi.fn().mockResolvedValue(undefined);
    const container = createTestContainer(undefined, {});
    container.getEmbedPipeline = vi.fn().mockReturnValue({
      autoEmbed: mockAutoEmbed,
    });

    await handleSyncEmbedding(container, crawlJobData);

    expect(recordJob).toHaveBeenCalledWith('crawl', 'job-123');
    expect(mockAutoEmbed).toHaveBeenCalledTimes(2);
    expect(mockAutoEmbed).toHaveBeenCalledWith('Page 1', {
      url: 'https://example.com/1',
      title: undefined,
      sourceCommand: 'crawl',
      contentType: 'markdown',
    });
  });

  it('should skip empty data', async () => {
    const crawlJobData: CrawlJobData = {
      id: 'job-456',
      status: 'completed',
      total: 0,
      completed: 0,
      data: [],
    };

    const container = createTestContainer();

    await handleSyncEmbedding(container, crawlJobData);

    expect(recordJob).toHaveBeenCalledWith('crawl', 'job-456');
  });

  it('should handle missing data array', async () => {
    const crawlJobData: CrawlJobData = {
      id: 'job-789',
      status: 'completed',
      total: 0,
      completed: 0,
      data: [],
    };

    const container = createTestContainer();

    await handleSyncEmbedding(container, crawlJobData);

    expect(recordJob).toHaveBeenCalledWith('crawl', 'job-789');
  });

  it('should work without job ID', async () => {
    const crawlJobData: CrawlJobData = {
      id: undefined as unknown as string,
      status: 'completed',
      total: 1,
      completed: 1,
      data: [{ markdown: 'Page 1', metadata: {} }],
    };

    const mockAutoEmbed = vi.fn().mockResolvedValue(undefined);
    const container = createTestContainer();
    container.getEmbedPipeline = vi.fn().mockReturnValue({
      autoEmbed: mockAutoEmbed,
    });

    await handleSyncEmbedding(container, crawlJobData);

    expect(recordJob).not.toHaveBeenCalled();
    expect(mockAutoEmbed).toHaveBeenCalledTimes(1);
  });
});

describe('handleManualEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should enqueue and process job when not already queued', async () => {
    const mockProcessEmbedQueue = vi.fn();
    const mockEnqueueEmbedJob = vi.fn().mockResolvedValue(undefined);
    const mockGetEmbedJob = vi.fn().mockResolvedValue(null);

    const mockClient = {
      getCrawlStatus: vi.fn().mockResolvedValue({
        status: 'completed',
        data: [{ metadata: { sourceURL: 'https://example.com' } }],
      }),
    };

    const container = createContainer(mockClient);

    vi.doMock('../../../utils/background-embedder', () => ({
      processEmbedQueue: mockProcessEmbedQueue,
    }));
    vi.doMock('../../../utils/embed-queue', () => ({
      enqueueEmbedJob: mockEnqueueEmbedJob,
      getEmbedJob: mockGetEmbedJob,
    }));

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await handleManualEmbedding(container, 'job-123', 'test-key');

    expect(mockClient.getCrawlStatus).toHaveBeenCalledWith('job-123', {
      autoPaginate: false,
    });
    expect(mockEnqueueEmbedJob).toHaveBeenCalledWith(
      'job-123',
      'https://example.com',
      'test-key'
    );
    expect(mockProcessEmbedQueue).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Processing embedding queue for job job-123')
    );

    consoleError.mockRestore();
  });

  it('should skip enqueueing if job already exists', async () => {
    const mockProcessEmbedQueue = vi.fn();
    const mockEnqueueEmbedJob = vi.fn().mockResolvedValue(undefined);
    const mockGetEmbedJob = vi.fn().mockResolvedValue({ jobId: 'job-123' });

    const container = createTestContainer();

    vi.doMock('../../../utils/background-embedder', () => ({
      processEmbedQueue: mockProcessEmbedQueue,
    }));
    vi.doMock('../../../utils/embed-queue', () => ({
      enqueueEmbedJob: mockEnqueueEmbedJob,
      getEmbedJob: mockGetEmbedJob,
    }));

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await handleManualEmbedding(container, 'job-123');

    expect(mockEnqueueEmbedJob).not.toHaveBeenCalled();
    expect(mockProcessEmbedQueue).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it('should return early if job not completed', async () => {
    const mockProcessEmbedQueue = vi.fn();
    const mockGetEmbedJob = vi.fn().mockResolvedValue(null);

    const mockClient = {
      getCrawlStatus: vi.fn().mockResolvedValue({
        status: 'processing',
        data: [],
      }),
    };

    const container = createContainer(mockClient);

    vi.doMock('../../../utils/background-embedder', () => ({
      processEmbedQueue: mockProcessEmbedQueue,
    }));
    vi.doMock('../../../utils/embed-queue', () => ({
      enqueueEmbedJob: vi.fn().mockResolvedValue(undefined),
      getEmbedJob: mockGetEmbedJob,
    }));

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await handleManualEmbedding(container, 'job-123');

    expect(consoleError).toHaveBeenCalledWith(
      '! Crawl job-123 is processing, cannot embed yet'
    );
    expect(mockProcessEmbedQueue).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it('should use job ID as fallback URL', async () => {
    const mockProcessEmbedQueue = vi.fn();
    const mockEnqueueEmbedJob = vi.fn().mockResolvedValue(undefined);
    const mockGetEmbedJob = vi.fn().mockResolvedValue(null);

    const mockClient = {
      getCrawlStatus: vi.fn().mockResolvedValue({
        status: 'completed',
        data: [], // No pages with sourceURL
      }),
    };

    const container = createContainer(mockClient);

    vi.doMock('../../../utils/background-embedder', () => ({
      processEmbedQueue: mockProcessEmbedQueue,
    }));
    vi.doMock('../../../utils/embed-queue', () => ({
      enqueueEmbedJob: mockEnqueueEmbedJob,
      getEmbedJob: mockGetEmbedJob,
    }));

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await handleManualEmbedding(container, 'job-456');

    expect(mockEnqueueEmbedJob).toHaveBeenCalledWith(
      'job-456',
      'job-456',
      undefined
    );

    consoleError.mockRestore();
  });
});
