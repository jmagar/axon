import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkCrawlStatus,
  executeCrawlCancel,
  executeCrawlErrors,
} from '../../../commands/crawl/status';
import { createTestContainer } from '../../utils/test-container';

const createContainer = (...args: Parameters<typeof createTestContainer>) =>
  createTestContainer(...args);

describe('checkCrawlStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {});

  it('should return successful status result', async () => {
    const mockStatus = {
      id: 'test-job-123',
      status: 'completed',
      total: 50,
      completed: 50,
      creditsUsed: 100,
      expiresAt: '2026-02-15T10:30:00.000Z',
    };

    const mockClient = {
      getCrawlStatus: vi.fn().mockResolvedValue(mockStatus),
    };

    const container = createContainer(mockClient);

    const result = await checkCrawlStatus(container, 'test-job-123');

    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockStatus);
    expect(mockClient.getCrawlStatus).toHaveBeenCalledWith('test-job-123', {
      autoPaginate: false,
    });
  });

  it('should use container client', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn().mockResolvedValue({
        id: 'test-job',
        status: 'processing',
        total: 10,
        completed: 5,
      }),
    };

    const container = createContainer(mockClient, {
      apiKey: 'test-api-key',
    });

    await checkCrawlStatus(container, 'test-job');

    expect(mockClient.getCrawlStatus).toHaveBeenCalledWith('test-job', {
      autoPaginate: false,
    });
  });

  it('should return error on failure', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn().mockRejectedValue(new Error('Network error')),
    };

    const container = createContainer(mockClient);

    const result = await checkCrawlStatus(container, 'test-job-123');

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Failed to check status for job test-job-123: Network error'
    );
  });

  it('should handle unknown errors', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn().mockRejectedValue('String error'),
    };

    const container = createContainer(mockClient);

    const result = await checkCrawlStatus(container, 'test-job-456');

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Failed to check status for job test-job-456: Unknown error occurred'
    );
  });
});

describe('executeCrawlCancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return successful cancel result', async () => {
    const mockClient = {
      cancelCrawl: vi.fn().mockResolvedValue(true),
    };

    const container = createContainer(mockClient);

    const result = await executeCrawlCancel(container, 'test-job-123');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'cancelled' });
    expect(mockClient.cancelCrawl).toHaveBeenCalledWith('test-job-123');
  });

  it('should use container client with provided API key', async () => {
    const mockClient = {
      cancelCrawl: vi.fn().mockResolvedValue(true),
    };

    const container = createContainer(mockClient, { apiKey: 'test-key' });

    await executeCrawlCancel(container, 'test-job');

    expect(mockClient.cancelCrawl).toHaveBeenCalledWith('test-job');
  });

  it('should handle cancel failure', async () => {
    const mockClient = {
      cancelCrawl: vi.fn().mockResolvedValue(false),
    };

    const container = createContainer(mockClient);

    const result = await executeCrawlCancel(container, 'test-job-789');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to cancel job test-job-789');
  });

  it('should return error on exception', async () => {
    const mockClient = {
      cancelCrawl: vi.fn().mockRejectedValue(new Error('API error')),
    };

    const container = createContainer(mockClient);

    const result = await executeCrawlCancel(container, 'test-job-000');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to cancel job test-job-000: API error');
  });

  it('should work with default container', async () => {
    const mockClient = {
      cancelCrawl: vi.fn().mockResolvedValue(true),
    };

    const container = createContainer(mockClient);

    const result = await executeCrawlCancel(container, 'test-job');

    expect(result.success).toBe(true);
  });
});

describe('executeCrawlErrors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return crawl errors', async () => {
    const mockErrors = [
      { url: 'https://example.com/page1', error: '404 Not Found' },
      { url: 'https://example.com/page2', error: '500 Server Error' },
    ];

    const mockClient = {
      getCrawlErrors: vi.fn().mockResolvedValue(mockErrors),
    };

    const container = createContainer(mockClient);

    const result = await executeCrawlErrors(container, 'test-job-123');

    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockErrors);
    expect(mockClient.getCrawlErrors).toHaveBeenCalledWith('test-job-123');
  });

  it('should use container client with API key', async () => {
    const mockClient = {
      getCrawlErrors: vi.fn().mockResolvedValue([]),
    };

    const container = createContainer(mockClient, { apiKey: 'my-key' });

    await executeCrawlErrors(container, 'test-job');

    expect(mockClient.getCrawlErrors).toHaveBeenCalledWith('test-job');
  });

  it('should return empty array for no errors', async () => {
    const mockClient = {
      getCrawlErrors: vi.fn().mockResolvedValue([]),
    };

    const container = createContainer(mockClient);

    const result = await executeCrawlErrors(container, 'test-job');

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('should return error on exception', async () => {
    const mockClient = {
      getCrawlErrors: vi.fn().mockRejectedValue(new Error('Fetch failed')),
    };

    const container = createContainer(mockClient);

    const result = await executeCrawlErrors(container, 'test-job-111');

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Failed to fetch errors for job test-job-111: Fetch failed'
    );
  });

  it('should handle unknown errors', async () => {
    const mockClient = {
      getCrawlErrors: vi.fn().mockRejectedValue({ message: 'Custom error' }),
    };

    const container = createContainer(mockClient);

    const result = await executeCrawlErrors(container, 'test-job-222');

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Failed to fetch errors for job test-job-222: Unknown error occurred'
    );
  });

  it('should work with default container', async () => {
    const mockClient = {
      getCrawlErrors: vi.fn().mockResolvedValue([]),
    };

    const container = createContainer(mockClient);

    const result = await executeCrawlErrors(container, 'test-job');

    expect(result.success).toBe(true);
  });
});
