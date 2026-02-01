import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pollCrawlProgress } from '../../../commands/crawl/polling';

// Mock dependencies
vi.mock('../../../utils/client', () => ({
  getClient: vi.fn(),
}));

vi.mock('../../../utils/polling', () => ({
  pollWithProgress: vi.fn(),
}));

import { getClient } from '../../../utils/client';
import { pollWithProgress } from '../../../utils/polling';

describe('pollCrawlProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should poll for crawl status with progress', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn(),
    };

    const mockResult = {
      id: 'job-123',
      status: 'completed',
      total: 50,
      completed: 50,
      data: [],
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);
    vi.mocked(pollWithProgress).mockResolvedValue(mockResult as never);

    const result = await pollCrawlProgress('job-123', {
      pollInterval: 5000,
      timeout: 60000,
    });

    expect(result).toEqual(mockResult);
    expect(pollWithProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-123',
        pollInterval: 5000,
        timeout: 60000,
        showProgress: true,
      })
    );
  });

  it('should pass apiKey to getClient', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn(),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);
    vi.mocked(pollWithProgress).mockResolvedValue({} as never);

    await pollCrawlProgress('job-123', {
      apiKey: 'test-key',
      pollInterval: 5000,
    });

    expect(getClient).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  it('should use statusFetcher that calls getCrawlStatus', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn().mockResolvedValue({
        id: 'job-123',
        status: 'processing',
        total: 100,
        completed: 50,
      }),
    };

    let capturedStatusFetcher: ((id: string) => Promise<unknown>) | undefined;

    vi.mocked(getClient).mockReturnValue(mockClient as never);
    vi.mocked(pollWithProgress).mockImplementation(async (config) => {
      capturedStatusFetcher = config.statusFetcher;
      return {} as never;
    });

    await pollCrawlProgress('job-123', {
      pollInterval: 5000,
    });

    expect(capturedStatusFetcher).toBeDefined();

    // Call the statusFetcher to verify it works
    await capturedStatusFetcher!('job-123');
    expect(mockClient.getCrawlStatus).toHaveBeenCalledWith('job-123');
  });

  it('should configure isComplete to check for terminal states', async () => {
    let capturedIsComplete:
      | ((status: {
          status: string;
          total: number;
          completed: number;
        }) => boolean)
      | undefined;

    vi.mocked(getClient).mockReturnValue({ getCrawlStatus: vi.fn() } as never);
    vi.mocked(pollWithProgress).mockImplementation(async (config) => {
      capturedIsComplete = config.isComplete;
      return {} as never;
    });

    await pollCrawlProgress('job-123', {
      pollInterval: 5000,
    });

    expect(capturedIsComplete).toBeDefined();

    // Test various completion scenarios
    expect(
      capturedIsComplete!({ status: 'completed', total: 10, completed: 10 })
    ).toBe(true);
    expect(
      capturedIsComplete!({ status: 'failed', total: 10, completed: 5 })
    ).toBe(true);
    expect(
      capturedIsComplete!({ status: 'cancelled', total: 10, completed: 3 })
    ).toBe(true);
    expect(
      capturedIsComplete!({ status: 'processing', total: 10, completed: 10 })
    ).toBe(true);
    expect(
      capturedIsComplete!({ status: 'processing', total: 10, completed: 5 })
    ).toBe(false);
  });

  it('should configure formatProgress correctly', async () => {
    let capturedFormatProgress:
      | ((status: {
          status: string;
          total: number;
          completed: number;
        }) => string)
      | undefined;

    vi.mocked(getClient).mockReturnValue({ getCrawlStatus: vi.fn() } as never);
    vi.mocked(pollWithProgress).mockImplementation(async (config) => {
      capturedFormatProgress = config.formatProgress;
      return {} as never;
    });

    await pollCrawlProgress('job-123', {
      pollInterval: 5000,
    });

    expect(capturedFormatProgress).toBeDefined();

    const progressText = capturedFormatProgress!({
      status: 'processing',
      total: 100,
      completed: 50,
    });

    expect(progressText).toBe('Progress: 50/100 pages (processing)');
  });

  it('should work without timeout', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn(),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);
    vi.mocked(pollWithProgress).mockResolvedValue({} as never);

    await pollCrawlProgress('job-123', {
      pollInterval: 5000,
    });

    expect(pollWithProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: undefined,
      })
    );
  });

  it('should work without apiKey', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn(),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);
    vi.mocked(pollWithProgress).mockResolvedValue({} as never);

    await pollCrawlProgress('job-123', {
      pollInterval: 5000,
    });

    expect(getClient).toHaveBeenCalledWith({ apiKey: undefined });
  });

  it('should propagate errors from pollWithProgress', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn(),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as never);
    vi.mocked(pollWithProgress).mockRejectedValue(
      new Error('Timeout after 60 seconds')
    );

    await expect(
      pollCrawlProgress('job-123', {
        pollInterval: 5000,
        timeout: 60000,
      })
    ).rejects.toThrow('Timeout after 60 seconds');
  });
});
