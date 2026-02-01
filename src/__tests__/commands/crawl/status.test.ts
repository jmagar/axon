import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkCrawlStatus,
  executeCrawlCancel,
  executeCrawlErrors,
} from '../../../commands/crawl/status';

// Mock the client module
vi.mock('../../../utils/client', () => ({
  getClient: vi.fn(),
}));

import { getClient } from '../../../utils/client';

describe('checkCrawlStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await checkCrawlStatus('test-job-123', {});

    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockStatus);
    expect(mockClient.getCrawlStatus).toHaveBeenCalledWith('test-job-123');
  });

  it('should pass apiKey to getClient', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn().mockResolvedValue({
        id: 'test-job',
        status: 'processing',
        total: 10,
        completed: 5,
      }),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    await checkCrawlStatus('test-job', { apiKey: 'test-api-key' });

    expect(getClient).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
  });

  it('should return error on failure', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn().mockRejectedValue(new Error('Network error')),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await checkCrawlStatus('test-job-123', {});

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Failed to check status for job test-job-123: Network error'
    );
  });

  it('should handle unknown errors', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn().mockRejectedValue('String error'),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await checkCrawlStatus('test-job-456', {});

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

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await executeCrawlCancel('test-job-123');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'cancelled' });
    expect(mockClient.cancelCrawl).toHaveBeenCalledWith('test-job-123');
  });

  it('should pass apiKey to getClient when provided', async () => {
    const mockClient = {
      cancelCrawl: vi.fn().mockResolvedValue(true),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    await executeCrawlCancel('test-job', { apiKey: 'test-key' });

    expect(getClient).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  it('should handle cancel failure', async () => {
    const mockClient = {
      cancelCrawl: vi.fn().mockResolvedValue(false),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await executeCrawlCancel('test-job-789');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to cancel job test-job-789');
  });

  it('should return error on exception', async () => {
    const mockClient = {
      cancelCrawl: vi.fn().mockRejectedValue(new Error('API error')),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await executeCrawlCancel('test-job-000');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to cancel job test-job-000: API error');
  });

  it('should handle undefined options', async () => {
    const mockClient = {
      cancelCrawl: vi.fn().mockResolvedValue(true),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await executeCrawlCancel('test-job');

    expect(result.success).toBe(true);
    expect(getClient).toHaveBeenCalledWith({ apiKey: undefined });
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

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await executeCrawlErrors('test-job-123');

    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockErrors);
    expect(mockClient.getCrawlErrors).toHaveBeenCalledWith('test-job-123');
  });

  it('should pass apiKey to getClient when provided', async () => {
    const mockClient = {
      getCrawlErrors: vi.fn().mockResolvedValue([]),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    await executeCrawlErrors('test-job', { apiKey: 'my-key' });

    expect(getClient).toHaveBeenCalledWith({ apiKey: 'my-key' });
  });

  it('should return empty array for no errors', async () => {
    const mockClient = {
      getCrawlErrors: vi.fn().mockResolvedValue([]),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await executeCrawlErrors('test-job');

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('should return error on exception', async () => {
    const mockClient = {
      getCrawlErrors: vi.fn().mockRejectedValue(new Error('Fetch failed')),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await executeCrawlErrors('test-job-111');

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Failed to fetch errors for job test-job-111: Fetch failed'
    );
  });

  it('should handle unknown errors', async () => {
    const mockClient = {
      getCrawlErrors: vi.fn().mockRejectedValue({ message: 'Custom error' }),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await executeCrawlErrors('test-job-222');

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Failed to fetch errors for job test-job-222: Unknown error occurred'
    );
  });

  it('should handle undefined options', async () => {
    const mockClient = {
      getCrawlErrors: vi.fn().mockResolvedValue([]),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await executeCrawlErrors('test-job');

    expect(result.success).toBe(true);
    expect(getClient).toHaveBeenCalledWith({ apiKey: undefined });
  });
});
