import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pollCrawlProgress } from '../../../commands/crawl/polling';
import { createTestContainer } from '../../utils/test-container';

const createContainer = (...args: Parameters<typeof createTestContainer>) =>
  createTestContainer(...args);

// Mock dependencies
vi.mock('../../../utils/polling', () => ({
  pollWithProgress: vi.fn(),
}));

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

    const container = createContainer(mockClient);
    vi.mocked(pollWithProgress).mockResolvedValue(mockResult as never);

    const result = await pollCrawlProgress(container, 'job-123', {
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

  it('should use container client', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn(),
    };

    const container = createContainer(mockClient, { apiKey: 'test-key' });
    vi.mocked(pollWithProgress).mockResolvedValue({} as never);

    await pollCrawlProgress(container, 'job-123', {
      pollInterval: 5000,
    });

    expect(pollWithProgress).toHaveBeenCalled();
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

    const container = createContainer(mockClient);
    vi.mocked(pollWithProgress).mockImplementation(async (config) => {
      capturedStatusFetcher = config.statusFetcher;
      return {} as never;
    });

    await pollCrawlProgress(container, 'job-123', {
      pollInterval: 5000,
    });

    expect(capturedStatusFetcher).toBeDefined();

    // Call the statusFetcher to verify it works (should use noPagination)
    await capturedStatusFetcher?.('job-123');
    expect(mockClient.getCrawlStatus).toHaveBeenCalledWith('job-123', {
      autoPaginate: false,
    });
  });

  it('should configure isComplete to check for terminal states', async () => {
    let capturedIsComplete:
      | ((status: {
          status: string;
          total: number;
          completed: number;
        }) => boolean)
      | undefined;

    const mockClient = { getCrawlStatus: vi.fn() };
    const container = createContainer(mockClient);
    vi.mocked(pollWithProgress).mockImplementation(async (config) => {
      capturedIsComplete = config.isComplete;
      return {} as never;
    });

    await pollCrawlProgress(container, 'job-123', {
      pollInterval: 5000,
    });

    expect(capturedIsComplete).toBeDefined();

    // Test various completion scenarios
    expect(
      capturedIsComplete?.({ status: 'completed', total: 10, completed: 10 })
    ).toBe(true);
    expect(
      capturedIsComplete?.({ status: 'failed', total: 10, completed: 5 })
    ).toBe(true);
    expect(
      capturedIsComplete?.({ status: 'cancelled', total: 10, completed: 3 })
    ).toBe(true);
    expect(
      capturedIsComplete?.({ status: 'processing', total: 10, completed: 10 })
    ).toBe(true);
    expect(
      capturedIsComplete?.({ status: 'processing', total: 10, completed: 5 })
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

    const mockClient = { getCrawlStatus: vi.fn() };
    const container = createContainer(mockClient);
    vi.mocked(pollWithProgress).mockImplementation(async (config) => {
      capturedFormatProgress = config.formatProgress;
      return {} as never;
    });

    await pollCrawlProgress(container, 'job-123', {
      pollInterval: 5000,
    });

    expect(capturedFormatProgress).toBeDefined();

    const progressText = capturedFormatProgress?.({
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

    const container = createContainer(mockClient);
    vi.mocked(pollWithProgress).mockResolvedValue({} as never);

    await pollCrawlProgress(container, 'job-123', {
      pollInterval: 5000,
    });

    expect(pollWithProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: undefined,
      })
    );
  });

  it('should work with default container config', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn(),
    };

    const container = createContainer(mockClient);
    vi.mocked(pollWithProgress).mockResolvedValue({} as never);

    await pollCrawlProgress(container, 'job-123', {
      pollInterval: 5000,
    });

    expect(pollWithProgress).toHaveBeenCalled();
  });

  it('should propagate errors from pollWithProgress', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn(),
    };

    const container = createContainer(mockClient);
    vi.mocked(pollWithProgress).mockRejectedValue(
      new Error('Timeout after 60 seconds')
    );

    await expect(
      pollCrawlProgress(container, 'job-123', {
        pollInterval: 5000,
        timeout: 60000,
      })
    ).rejects.toThrow('Timeout after 60 seconds');
  });

  it('should throw error for invalid pollInterval (< 100ms)', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn(),
    };

    const container = createContainer(mockClient);

    await expect(
      pollCrawlProgress(container, 'job-123', {
        pollInterval: 50,
      })
    ).rejects.toThrow('Invalid pollInterval: 50. Must be >= 100ms');
  });

  it('should throw error for zero pollInterval', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn(),
    };

    const container = createContainer(mockClient);

    await expect(
      pollCrawlProgress(container, 'job-123', {
        pollInterval: 0,
      })
    ).rejects.toThrow('Invalid pollInterval: 0. Must be >= 100ms');
  });

  it('should throw error for negative pollInterval', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn(),
    };

    const container = createContainer(mockClient);

    await expect(
      pollCrawlProgress(container, 'job-123', {
        pollInterval: -1000,
      })
    ).rejects.toThrow('Invalid pollInterval: -1000. Must be >= 100ms');
  });

  it('should throw error for non-finite pollInterval', async () => {
    const mockClient = {
      getCrawlStatus: vi.fn(),
    };

    const container = createContainer(mockClient);

    await expect(
      pollCrawlProgress(container, 'job-123', {
        pollInterval: Number.NaN,
      })
    ).rejects.toThrow('Invalid pollInterval: NaN. Must be >= 100ms');
  });
});
