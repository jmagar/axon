import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCrawl } from '../../../commands/crawl/execute';
import type { CrawlOptions } from '../../../types/crawl';
import { createTestContainer } from '../../utils/test-container';

const createContainer = (...args: Parameters<typeof createTestContainer>) =>
  createTestContainer(...args);

vi.mock('../../../commands/crawl/status', () => ({
  checkCrawlStatus: vi.fn(),
}));

vi.mock('../../../commands/crawl/options', () => ({
  buildCrawlOptions: vi.fn(),
}));

vi.mock('../../../commands/crawl/embed', () => ({
  attachEmbedWebhook: vi.fn(),
}));

vi.mock('../../../commands/crawl/polling', () => ({
  pollCrawlProgress: vi.fn(),
}));

import { attachEmbedWebhook } from '../../../commands/crawl/embed';
import { buildCrawlOptions } from '../../../commands/crawl/options';
import { pollCrawlProgress } from '../../../commands/crawl/polling';
import { checkCrawlStatus } from '../../../commands/crawl/status';

describe('executeCrawl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return error when URL is missing', async () => {
    const container = createTestContainer();
    const options: CrawlOptions = {
      urlOrJobId: '',
    };

    const result = await executeCrawl(container, options);

    expect(result.success).toBe(false);
    expect(result.error).toBe('URL is required');
  });

  it('should check status when status flag is set', async () => {
    const container = createTestContainer();
    const mockStatusResult = {
      success: true,
      data: { id: 'job-123', status: 'completed', total: 10, completed: 10 },
    };

    vi.mocked(checkCrawlStatus).mockResolvedValue(mockStatusResult as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      status: true,
    };

    const result = await executeCrawl(container, options);

    expect(checkCrawlStatus).toHaveBeenCalledWith(
      expect.any(Object),
      'https://example.com'
    );
    expect(result).toEqual(mockStatusResult);
  });

  it('should start async crawl and return job ID', async () => {
    const mockClient = {
      scrape: vi.fn(),
      startCrawl: vi.fn().mockResolvedValue({
        id: 'job-789',
        url: 'https://example.com',
      }),
    };

    const container = createContainer(mockClient);
    vi.mocked(buildCrawlOptions).mockReturnValue({ limit: 10 } as never);
    vi.mocked(attachEmbedWebhook).mockReturnValue({ limit: 10 } as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      limit: 10,
    };

    const result = await executeCrawl(container, options);

    expect(buildCrawlOptions).toHaveBeenCalledWith(options);
    expect(attachEmbedWebhook).toHaveBeenCalledWith(
      { limit: 10 },
      true,
      false,
      container.config
    );
    expect(mockClient.startCrawl).toHaveBeenCalledWith('https://example.com', {
      limit: 10,
    });
    expect(result).toEqual({
      success: true,
      data: {
        jobId: 'job-789',
        url: 'https://example.com',
        status: 'processing',
      },
    });
  });

  it('should use wait mode without progress', async () => {
    const mockCrawlJob = {
      id: 'job-111',
      status: 'completed',
      total: 5,
      completed: 5,
      data: [{ markdown: 'Page 1' }],
    };

    const mockClient = {
      scrape: vi.fn(),
      crawl: vi.fn().mockResolvedValue(mockCrawlJob),
    };

    const container = createContainer(mockClient);
    vi.mocked(buildCrawlOptions).mockReturnValue({
      limit: 5,
      pollInterval: 5000,
    } as never);
    vi.mocked(attachEmbedWebhook).mockReturnValue({
      limit: 5,
      pollInterval: 5000,
    } as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      wait: true,
      limit: 5,
    };

    const result = await executeCrawl(container, options);

    expect(buildCrawlOptions).toHaveBeenCalledWith(options);
    expect(attachEmbedWebhook).toHaveBeenCalledWith(
      { limit: 5, pollInterval: 5000 },
      true,
      true,
      container.config
    );
    expect(mockClient.crawl).toHaveBeenCalledWith('https://example.com', {
      limit: 5,
      pollInterval: 5000,
    });
    expect(result).toEqual({
      success: true,
      data: mockCrawlJob,
    });
  });

  it('should use wait mode with progress', async () => {
    const mockCrawlJob = {
      id: 'job-222',
      status: 'completed',
      total: 8,
      completed: 8,
      data: [{ markdown: 'Page 1' }],
    };

    const mockClient = {
      scrape: vi.fn(),
      startCrawl: vi.fn().mockResolvedValue({
        id: 'job-222',
        url: 'https://example.com',
      }),
    };

    const container = createContainer(mockClient);
    vi.mocked(buildCrawlOptions).mockReturnValue({
      limit: 8,
      pollInterval: 3000,
      crawlTimeout: 60000,
    } as never);
    vi.mocked(attachEmbedWebhook).mockReturnValue({
      limit: 8,
      pollInterval: 3000,
      crawlTimeout: 60000,
    } as never);
    vi.mocked(pollCrawlProgress).mockResolvedValue(mockCrawlJob as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      progress: true,
      limit: 8,
      pollInterval: 3,
      timeout: 60,
    };

    const result = await executeCrawl(container, options);

    expect(buildCrawlOptions).toHaveBeenCalledWith(options);
    expect(attachEmbedWebhook).toHaveBeenCalledWith(
      { limit: 8, pollInterval: 3000, crawlTimeout: 60000 },
      true,
      true,
      container.config
    );
    expect(mockClient.startCrawl).toHaveBeenCalledWith('https://example.com', {
      limit: 8,
      pollInterval: 3000,
      crawlTimeout: 60000,
    });
    expect(pollCrawlProgress).toHaveBeenCalledWith(
      expect.any(Object),
      'job-222',
      {
        apiKey: undefined,
        pollInterval: 3000,
        timeout: 60000,
      }
    );
    expect(result).toEqual({
      success: true,
      data: mockCrawlJob,
    });
  });

  it('should disable embedding when embed is false', async () => {
    const mockClient = {
      scrape: vi.fn(),
      startCrawl: vi.fn().mockResolvedValue({
        id: 'job-333',
        url: 'https://example.com',
      }),
    };

    const container = createContainer(mockClient);
    vi.mocked(buildCrawlOptions).mockReturnValue({ limit: 10 } as never);
    vi.mocked(attachEmbedWebhook).mockReturnValue({ limit: 10 } as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      embed: false,
    };

    await executeCrawl(container, options);

    expect(attachEmbedWebhook).toHaveBeenCalledWith(
      { limit: 10 },
      false,
      false,
      container.config
    );
  });

  it('should handle API errors', async () => {
    const mockClient = {
      scrape: vi.fn(),
      startCrawl: vi
        .fn()
        .mockRejectedValue(new Error('API Error: Rate limit exceeded')),
    };

    const container = createContainer(mockClient);
    vi.mocked(buildCrawlOptions).mockReturnValue({ limit: 10 } as never);
    vi.mocked(attachEmbedWebhook).mockReturnValue({ limit: 10 } as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
    };

    const result = await executeCrawl(container, options);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Crawl operation failed: API Error: Rate limit exceeded'
    );
  });

  it('should handle unknown errors', async () => {
    const mockClient = {
      scrape: vi.fn(),
      startCrawl: vi.fn().mockRejectedValue('String error'),
    };

    const container = createContainer(mockClient);
    vi.mocked(buildCrawlOptions).mockReturnValue({ limit: 10 } as never);
    vi.mocked(attachEmbedWebhook).mockReturnValue({ limit: 10 } as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
    };

    const result = await executeCrawl(container, options);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Crawl operation failed: Unknown error occurred');
  });

  it('should pass apiKey to getClient', async () => {
    const mockClient = {
      scrape: vi.fn(),
      startCrawl: vi.fn().mockResolvedValue({
        id: 'job-444',
        url: 'https://example.com',
      }),
    };

    const container = createContainer(mockClient, {
      apiKey: 'test-api-key',
    });
    vi.mocked(buildCrawlOptions).mockReturnValue({ limit: 10 } as never);
    vi.mocked(attachEmbedWebhook).mockReturnValue({ limit: 10 } as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      apiKey: 'test-api-key',
    };

    await executeCrawl(container, options);

    expect(container.config.apiKey).toBe('test-api-key');
  });

  it('should use default pollInterval when not provided in wait mode', async () => {
    const mockCrawlJob = {
      id: 'job-555',
      status: 'completed',
      total: 3,
      completed: 3,
      data: [],
    };

    const mockClient = {
      scrape: vi.fn(),
      startCrawl: vi.fn().mockResolvedValue({
        id: 'job-555',
        url: 'https://example.com',
      }),
    };

    const container = createContainer(mockClient);
    vi.mocked(buildCrawlOptions).mockReturnValue({ limit: 3 } as never);
    vi.mocked(attachEmbedWebhook).mockReturnValue({ limit: 3 } as never);
    vi.mocked(pollCrawlProgress).mockResolvedValue(mockCrawlJob as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      progress: true,
      limit: 3,
    };

    await executeCrawl(container, options);

    expect(pollCrawlProgress).toHaveBeenCalledWith(
      expect.any(Object),
      'job-555',
      {
        apiKey: undefined,
        pollInterval: 5000,
        timeout: undefined,
      }
    );
  });
});
