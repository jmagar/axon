/**
 * Tests for batch command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBatchCommand, executeBatch } from '../../commands/batch';
import type { IContainer } from '../../container/types';
import type { CommandWithContainer } from '../../types/test';
import { writeOutput } from '../../utils/output';
import type { MockFirecrawlClient } from '../utils/mock-client';
import { createTestContainer } from '../utils/test-container';

const createContainer = (...args: Parameters<typeof createTestContainer>) =>
  createTestContainer(...args);

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeBatch', () => {
  let mockClient: Partial<MockFirecrawlClient>;
  let container: IContainer;

  beforeEach(() => {
    mockClient = {
      startBatchScrape: vi.fn(),
      batchScrape: vi.fn(),
      getBatchScrapeStatus: vi.fn(),
      getBatchScrapeErrors: vi.fn(),
      cancelBatchScrape: vi.fn(),
    };

    container = createContainer(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should start batch scrape when wait is false', async () => {
    mockClient.startBatchScrape?.mockResolvedValue({
      id: 'batch-1',
      url: 'https://api.firecrawl.dev/v2/batch/scrape/batch-1',
    });

    const result = await executeBatch(container, {
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
    mockClient.batchScrape?.mockResolvedValue({
      id: 'batch-1',
      status: 'completed',
      completed: 2,
      total: 2,
      data: [],
    });

    const result = await executeBatch(container, {
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
});

describe('createBatchCommand', () => {
  it('should define the batch command', () => {
    const cmd = createBatchCommand();
    expect(cmd.name()).toBe('batch');
  });

  it('should write output when executing', async () => {
    const testMockClient: Partial<MockFirecrawlClient> = {
      startBatchScrape: vi.fn().mockResolvedValue({ id: 'batch-1', url: 'u' }),
      batchScrape: vi.fn(),
      getBatchScrapeStatus: vi.fn(),
      getBatchScrapeErrors: vi.fn(),
      cancelBatchScrape: vi.fn(),
    };
    const testContainer = createTestContainer(testMockClient);

    const cmd = createBatchCommand() as unknown as CommandWithContainer;
    cmd.exitOverride();
    cmd._container = testContainer;

    await cmd.parseAsync(['node', 'test', 'https://a.com'], { from: 'node' });

    expect(writeOutput).toHaveBeenCalled();
  });
});

describe('batch status subcommand', () => {
  let mockClient: Partial<MockFirecrawlClient>;
  let container: IContainer;

  beforeEach(() => {
    mockClient = {
      startBatchScrape: vi.fn(),
      batchScrape: vi.fn(),
      getBatchScrapeStatus: vi.fn(),
      getBatchScrapeErrors: vi.fn(),
      cancelBatchScrape: vi.fn(),
    };

    container = createContainer(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should have status subcommand', () => {
    const cmd = createBatchCommand();
    const statusCmd = cmd.commands.find((c) => c.name() === 'status');
    expect(statusCmd).toBeDefined();
  });

  it('should require job-id argument', async () => {
    const cmd = createBatchCommand() as unknown as CommandWithContainer;
    cmd.exitOverride();
    cmd._container = container;

    await expect(
      cmd.parseAsync(['node', 'test', 'status'], { from: 'node' })
    ).rejects.toThrow();
  });

  it('should call SDK getBatchScrapeStatus with job-id', async () => {
    mockClient.getBatchScrapeStatus?.mockResolvedValue({
      id: 'batch-1',
      status: 'scraping',
      completed: 1,
      total: 2,
      data: [],
    });

    const cmd = createBatchCommand() as unknown as CommandWithContainer;
    cmd.exitOverride();
    cmd._container = container;

    await cmd.parseAsync(['node', 'test', 'status', 'batch-1'], {
      from: 'node',
    });

    expect(mockClient.getBatchScrapeStatus).toHaveBeenCalledWith('batch-1');
    expect(writeOutput).toHaveBeenCalled();
  });
});

describe('batch cancel subcommand', () => {
  let mockClient: Partial<MockFirecrawlClient>;
  let container: IContainer;

  beforeEach(() => {
    mockClient = {
      startBatchScrape: vi.fn(),
      batchScrape: vi.fn(),
      getBatchScrapeStatus: vi.fn(),
      getBatchScrapeErrors: vi.fn(),
      cancelBatchScrape: vi.fn(),
    };

    container = createContainer(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should have cancel subcommand', () => {
    const cmd = createBatchCommand();
    const cancelCmd = cmd.commands.find((c) => c.name() === 'cancel');
    expect(cancelCmd).toBeDefined();
  });

  it('should call SDK cancelBatchScrape', async () => {
    mockClient.cancelBatchScrape?.mockResolvedValue(true);

    const cmd = createBatchCommand() as unknown as CommandWithContainer;
    cmd.exitOverride();
    cmd._container = container;

    await cmd.parseAsync(['node', 'test', 'cancel', 'batch-1'], {
      from: 'node',
    });

    expect(mockClient.cancelBatchScrape).toHaveBeenCalledWith('batch-1');
    expect(writeOutput).toHaveBeenCalled();
  });

  it('should handle cancel failure', async () => {
    mockClient.cancelBatchScrape?.mockResolvedValue(false);

    const cmd = createBatchCommand() as unknown as CommandWithContainer;
    cmd.exitOverride();
    cmd._container = container;

    await expect(
      cmd.parseAsync(['node', 'test', 'cancel', 'batch-1'], { from: 'node' })
    ).rejects.toThrow();
  });
});

describe('batch errors subcommand', () => {
  let mockClient: Partial<MockFirecrawlClient>;
  let container: IContainer;

  beforeEach(() => {
    mockClient = {
      startBatchScrape: vi.fn(),
      batchScrape: vi.fn(),
      getBatchScrapeStatus: vi.fn(),
      getBatchScrapeErrors: vi.fn(),
      cancelBatchScrape: vi.fn(),
    };

    container = createContainer(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should have errors subcommand', () => {
    const cmd = createBatchCommand();
    const errorsCmd = cmd.commands.find((c) => c.name() === 'errors');
    expect(errorsCmd).toBeDefined();
  });

  it('should call SDK getBatchScrapeErrors', async () => {
    mockClient.getBatchScrapeErrors?.mockResolvedValue({
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

    const cmd = createBatchCommand() as unknown as CommandWithContainer;
    cmd.exitOverride();
    cmd._container = container;

    await cmd.parseAsync(['node', 'test', 'errors', 'batch-1'], {
      from: 'node',
    });

    expect(mockClient.getBatchScrapeErrors).toHaveBeenCalledWith('batch-1');
    expect(writeOutput).toHaveBeenCalled();
  });
});
