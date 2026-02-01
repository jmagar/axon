/**
 * Tests for batch command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBatchCommand, executeBatch } from '../../commands/batch';
import { getClient } from '../../utils/client';
import { initializeConfig } from '../../utils/config';
import { writeOutput } from '../../utils/output';
import { setupTest, teardownTest } from '../utils/mock-client';

vi.mock('../../utils/client', async () => {
  const actual = await vi.importActual('../../utils/client');
  return { ...actual, getClient: vi.fn() };
});

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeBatch', () => {
  let mockClient: {
    startBatchScrape: ReturnType<typeof vi.fn>;
    batchScrape: ReturnType<typeof vi.fn>;
    getBatchScrapeStatus: ReturnType<typeof vi.fn>;
    getBatchScrapeErrors: ReturnType<typeof vi.fn>;
    cancelBatchScrape: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    mockClient = {
      startBatchScrape: vi.fn(),
      batchScrape: vi.fn(),
      getBatchScrapeStatus: vi.fn(),
      getBatchScrapeErrors: vi.fn(),
      cancelBatchScrape: vi.fn(),
    };

    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  it('should start batch scrape when wait is false', async () => {
    mockClient.startBatchScrape.mockResolvedValue({
      id: 'batch-1',
      url: 'https://api.firecrawl.dev/v2/batch/scrape/batch-1',
    });

    const result = await executeBatch({
      urls: ['https://a.com', 'https://b.com'],
      wait: false,
    });

    expect(mockClient.startBatchScrape).toHaveBeenCalledWith(
      ['https://a.com', 'https://b.com'],
      expect.any(Object)
    );
    expect(result.success).toBe(true);
    expect((result.data as { id: string } | undefined)?.id).toBe('batch-1');
  });

  it('should wait batch scrape when wait is true', async () => {
    mockClient.batchScrape.mockResolvedValue({
      id: 'batch-1',
      status: 'completed',
      completed: 2,
      total: 2,
      data: [],
    });

    const result = await executeBatch({
      urls: ['https://a.com'],
      wait: true,
      pollInterval: 2,
      timeout: 60,
    });

    expect(mockClient.batchScrape).toHaveBeenCalledWith(
      ['https://a.com'],
      expect.objectContaining({ pollInterval: 2, timeout: 60 })
    );
    expect(result.success).toBe(true);
    expect((result.data as { status: string } | undefined)?.status).toBe(
      'completed'
    );
  });

  it('should get batch status by job id', async () => {
    mockClient.getBatchScrapeStatus.mockResolvedValue({
      id: 'batch-1',
      status: 'scraping',
      completed: 1,
      total: 2,
      data: [],
    });

    const result = await executeBatch({ jobId: 'batch-1', status: true });

    expect(mockClient.getBatchScrapeStatus).toHaveBeenCalledWith('batch-1');
    expect(result.success).toBe(true);
  });

  it('should cancel batch scrape job', async () => {
    mockClient.cancelBatchScrape.mockResolvedValue(true);

    const result = await executeBatch({ jobId: 'batch-1', cancel: true });

    expect(mockClient.cancelBatchScrape).toHaveBeenCalledWith('batch-1');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ success: true, message: 'cancelled' });
  });

  it('should get batch scrape errors', async () => {
    mockClient.getBatchScrapeErrors.mockResolvedValue({
      errors: [
        {
          id: 'err-1',
          url: 'https://a.com',
          error: 'blocked',
          code: 'BLOCKED',
        },
      ],
      robotsBlocked: ['https://b.com/robots'],
    });

    const result = await executeBatch({ jobId: 'batch-1', errors: true });

    expect(mockClient.getBatchScrapeErrors).toHaveBeenCalledWith('batch-1');
    expect(result.success).toBe(true);
    expect(
      (result.data as { errors?: unknown[] } | undefined)?.errors?.length
    ).toBe(1);
  });
});

describe('createBatchCommand', () => {
  it('should define the batch command', () => {
    const cmd = createBatchCommand();
    expect(cmd.name()).toBe('batch');
  });

  it('should require job id for --status', async () => {
    const cmd = createBatchCommand();
    cmd.exitOverride();

    await expect(
      cmd.parseAsync(['node', 'test', '--status'], { from: 'node' })
    ).rejects.toThrow();
  });

  it('should require job id for --cancel', async () => {
    const cmd = createBatchCommand();
    cmd.exitOverride();

    await expect(
      cmd.parseAsync(['node', 'test', '--cancel'], { from: 'node' })
    ).rejects.toThrow();
  });

  it('should require job id for --errors', async () => {
    const cmd = createBatchCommand();
    cmd.exitOverride();

    await expect(
      cmd.parseAsync(['node', 'test', '--errors'], { from: 'node' })
    ).rejects.toThrow();
  });

  it('should write output when executing', async () => {
    const mockClient = {
      startBatchScrape: vi.fn().mockResolvedValue({ id: 'batch-1', url: 'u' }),
      batchScrape: vi.fn(),
      getBatchScrapeStatus: vi.fn(),
      getBatchScrapeErrors: vi.fn(),
      cancelBatchScrape: vi.fn(),
    };
    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );

    const cmd = createBatchCommand();
    cmd.exitOverride();

    await cmd.parseAsync(['node', 'test', 'https://a.com'], { from: 'node' });

    expect(writeOutput).toHaveBeenCalled();
  });
});
