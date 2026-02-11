import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkCrawlStatus,
  executeCrawlCancel,
  executeCrawlCleanup,
  executeCrawlClear,
  executeCrawlErrors,
} from '../../../commands/crawl/status';
import { createTestContainer } from '../../utils/test-container';

vi.mock('../../../utils/job-history', () => ({
  getRecentJobIds: vi.fn(),
  removeJobIds: vi.fn(),
  clearJobTypeHistory: vi.fn(),
}));

import {
  clearJobTypeHistory,
  getRecentJobIds,
  removeJobIds,
} from '../../../utils/job-history';

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

describe('executeCrawlClear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should clear local crawl history and cancel active crawls', async () => {
    vi.mocked(getRecentJobIds).mockResolvedValue(['job-1', 'job-2']);
    vi.mocked(clearJobTypeHistory).mockResolvedValue(undefined);

    const mockClient = {
      getActiveCrawls: vi.fn().mockResolvedValue({
        crawls: [{ id: 'active-1', url: 'https://a.com' }],
      }),
      cancelCrawl: vi.fn().mockResolvedValue(true),
    };
    const container = createContainer(mockClient);

    const result = await executeCrawlClear(container);

    expect(result.success).toBe(true);
    expect(mockClient.cancelCrawl).toHaveBeenCalledWith('active-1');
    expect(clearJobTypeHistory).toHaveBeenCalledWith('crawl');
    expect(result.data).toEqual({
      clearedHistory: 2,
      cancelledActive: 1,
    });
  });
});

describe('executeCrawlCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should remove failed, stale, and not-found crawl jobs from history', async () => {
    vi.mocked(getRecentJobIds).mockResolvedValue([
      'job-failed',
      'job-stale',
      'job-missing',
      'job-ok',
    ]);
    vi.mocked(removeJobIds).mockResolvedValue(undefined);

    const mockClient = {
      getCrawlStatus: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'job-failed') {
          return { id, status: 'failed', total: 100, completed: 10 };
        }
        if (id === 'job-stale') {
          return { id, status: 'scraping', total: 20, completed: 20 };
        }
        if (id === 'job-ok') {
          return { id, status: 'scraping', total: 100, completed: 50 };
        }
        throw new Error('Job not found');
      }),
    };
    const container = createContainer(mockClient);

    const result = await executeCrawlCleanup(container);

    expect(result.success).toBe(true);
    expect(removeJobIds).toHaveBeenCalledWith('crawl', [
      'job-failed',
      'job-stale',
      'job-missing',
    ]);
    expect(result.data).toEqual({
      scanned: 4,
      removedFailed: 1,
      removedStale: 1,
      removedNotFound: 1,
      removedTotal: 3,
    });
  });

  it('should handle empty job list gracefully', async () => {
    vi.mocked(getRecentJobIds).mockResolvedValue([]);
    vi.mocked(removeJobIds).mockResolvedValue(undefined);

    const mockClient = {
      getCrawlStatus: vi.fn(),
    };
    const container = createContainer(mockClient);

    const result = await executeCrawlCleanup(container);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      scanned: 0,
      removedFailed: 0,
      removedStale: 0,
      removedNotFound: 0,
      removedTotal: 0,
    });
    expect(mockClient.getCrawlStatus).not.toHaveBeenCalled();
    expect(removeJobIds).toHaveBeenCalledWith('crawl', []);
  });

  it('should return error when getRecentJobIds throws', async () => {
    vi.mocked(getRecentJobIds).mockRejectedValue(
      new Error('File system error')
    );

    const mockClient = {
      getCrawlStatus: vi.fn(),
    };
    const container = createContainer(mockClient);

    const result = await executeCrawlCleanup(container);

    expect(result.success).toBe(false);
    expect(result.error).toContain('File system error');
  });

  it('should treat cancelled and error statuses as failed', async () => {
    vi.mocked(getRecentJobIds).mockResolvedValue([
      'job-cancelled',
      'job-error',
    ]);
    vi.mocked(removeJobIds).mockResolvedValue(undefined);

    const mockClient = {
      getCrawlStatus: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'job-cancelled') {
          return { id, status: 'cancelled', total: 10, completed: 3 };
        }
        return { id, status: 'error', total: 5, completed: 0 };
      }),
    };
    const container = createContainer(mockClient);

    const result = await executeCrawlCleanup(container);

    expect(result.success).toBe(true);
    expect(result.data?.removedFailed).toBe(2);
    expect(result.data?.removedTotal).toBe(2);
  });
});

describe('executeCrawlClear - edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle empty crawl history', async () => {
    vi.mocked(getRecentJobIds).mockResolvedValue([]);
    vi.mocked(clearJobTypeHistory).mockResolvedValue(undefined);

    const mockClient = {
      getActiveCrawls: vi.fn().mockResolvedValue({ crawls: [] }),
      cancelCrawl: vi.fn(),
    };
    const container = createContainer(mockClient);

    const result = await executeCrawlClear(container);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      clearedHistory: 0,
      cancelledActive: 0,
    });
    expect(mockClient.cancelCrawl).not.toHaveBeenCalled();
  });

  it('should continue clearing history when getActiveCrawls fails', async () => {
    vi.mocked(getRecentJobIds).mockResolvedValue(['job-1']);
    vi.mocked(clearJobTypeHistory).mockResolvedValue(undefined);

    const mockClient = {
      getActiveCrawls: vi.fn().mockRejectedValue(new Error('API unavailable')),
      cancelCrawl: vi.fn(),
    };
    const container = createContainer(mockClient);

    const result = await executeCrawlClear(container);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      clearedHistory: 1,
      cancelledActive: 0,
    });
    expect(clearJobTypeHistory).toHaveBeenCalledWith('crawl');
  });
});
