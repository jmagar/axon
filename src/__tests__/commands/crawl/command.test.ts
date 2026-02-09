import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCrawlCommand } from '../../../commands/crawl/command';
import type { CrawlOptions } from '../../../types/crawl';
import { createTestContainer } from '../../utils/test-container';

// Mock dependencies
vi.mock('../../../utils/command', () => ({
  formatJson: vi.fn(),
  writeCommandOutput: vi.fn(),
}));

vi.mock('../../../utils/output', () => ({
  writeOutput: vi.fn(),
  validateOutputPath: vi.fn((path: string) => path),
}));

vi.mock('../../../utils/job', () => ({
  isJobId: vi.fn(),
}));

vi.mock('../../../utils/job-history', () => ({
  recordJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../commands/crawl/execute', () => ({
  executeCrawl: vi.fn(),
}));

vi.mock('../../../commands/crawl/embed', () => ({
  handleManualEmbedding: vi.fn(),
  handleAsyncEmbedding: vi.fn(),
  handleSyncEmbedding: vi.fn(),
}));

vi.mock('../../../commands/crawl/format', () => ({
  formatCrawlStatus: vi.fn(),
}));

import {
  handleAsyncEmbedding,
  handleManualEmbedding,
  handleSyncEmbedding,
} from '../../../commands/crawl/embed';
import { executeCrawl } from '../../../commands/crawl/execute';
import { formatCrawlStatus } from '../../../commands/crawl/format';
import { formatJson, writeCommandOutput } from '../../../utils/command';
import { isJobId } from '../../../utils/job';
import { recordJob } from '../../../utils/job-history';
import { writeOutput } from '../../../utils/output';

vi.mocked(writeCommandOutput).mockImplementation((content, options) => {
  writeOutput(String(content), options.output, !!options.output);
});

describe('handleCrawlCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {});

  it('should exit when URL or job ID is missing', async () => {
    const container = createTestContainer();
    process.exitCode = 0; // Reset exit code before test
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const options: CrawlOptions = {
      urlOrJobId: '',
    };

    await handleCrawlCommand(container, options);

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('URL or job ID is required')
    );
    expect(process.exitCode).toBe(1);

    process.exitCode = 0; // Clean up after test
    mockError.mockRestore();
  });

  it('should handle manual embedding trigger', async () => {
    const container = createTestContainer();
    vi.mocked(isJobId).mockReturnValue(true);
    vi.mocked(handleManualEmbedding).mockResolvedValue(undefined);

    const options: CrawlOptions = {
      urlOrJobId: 'job-789',
      embed: true,
    };

    await handleCrawlCommand(container, options);

    expect(isJobId).toHaveBeenCalledWith('job-789');
    expect(handleManualEmbedding).toHaveBeenCalledWith(
      expect.any(Object),
      'job-789',
      undefined
    );
  });

  it('should handle crawl execution failure', async () => {
    const container = createTestContainer();
    process.exitCode = 0; // Reset exit code before test
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(isJobId).mockReturnValue(false);
    vi.mocked(executeCrawl).mockResolvedValue({
      success: false,
      error: 'Network error',
    } as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
    };

    await handleCrawlCommand(container, options);

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('Network error')
    );
    expect(process.exitCode).toBe(1);

    process.exitCode = 0; // Clean up after test
    mockError.mockRestore();
  });

  it('should handle status check result', async () => {
    const container = createTestContainer();
    const mockStatusData = {
      id: 'job-111',
      status: 'completed' as const,
      total: 10,
      completed: 10,
      creditsUsed: 20,
      expiresAt: '2026-02-15T10:00:00Z',
    };

    vi.mocked(isJobId).mockReturnValue(true);
    vi.mocked(executeCrawl).mockResolvedValue({
      success: true,
      data: mockStatusData,
    } as never);
    vi.mocked(formatCrawlStatus).mockReturnValue('Status: completed');

    const options: CrawlOptions = {
      urlOrJobId: 'job-111',
      pretty: true,
    };

    await handleCrawlCommand(container, options);

    expect(formatCrawlStatus).toHaveBeenCalledWith(mockStatusData);
    expect(writeOutput).toHaveBeenCalledWith(
      'Status: completed',
      undefined,
      false
    );
  });

  it('should handle async job result with auto-embedding', async () => {
    const container = createTestContainer();
    const mockJobResult = {
      jobId: 'job-222',
      url: 'https://example.com',
      status: 'processing',
    };

    vi.mocked(isJobId).mockReturnValue(false);
    vi.mocked(executeCrawl).mockResolvedValue({
      success: true,
      data: mockJobResult,
    } as never);
    vi.mocked(formatJson).mockReturnValue('{"jobId":"job-222"}');

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
    };

    await handleCrawlCommand(container, options);

    expect(handleAsyncEmbedding).toHaveBeenCalledWith(
      'job-222',
      'https://example.com',
      container.config,
      undefined
    );
    expect(recordJob).toHaveBeenCalledWith('crawl', 'job-222');
    expect(writeOutput).toHaveBeenCalledWith(
      expect.stringContaining('Job ID:'),
      undefined,
      false
    );
  });

  it('should handle completed crawl result with auto-embedding', async () => {
    const container = createTestContainer();
    const mockCrawlData = {
      id: 'job-333',
      status: 'completed' as const,
      total: 5,
      completed: 5,
      data: [{ markdown: 'Page 1', metadata: {} }],
    };

    vi.mocked(isJobId).mockReturnValue(false);
    vi.mocked(executeCrawl).mockResolvedValue({
      success: true,
      data: mockCrawlData,
    } as never);
    vi.mocked(formatJson).mockReturnValue('{"data":[...]}');

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      wait: true,
    };

    await handleCrawlCommand(container, options);

    expect(handleSyncEmbedding).toHaveBeenCalledWith(
      expect.any(Object),
      mockCrawlData
    );
    expect(formatJson).toHaveBeenCalledWith(mockCrawlData, undefined);
    expect(writeOutput).toHaveBeenCalledWith(
      '{"data":[...]}',
      undefined,
      false
    );
  });

  it('should skip auto-embedding when embed is false', async () => {
    const container = createTestContainer();
    const mockJobResult = {
      jobId: 'job-444',
      url: 'https://example.com',
      status: 'processing',
    };

    vi.mocked(isJobId).mockReturnValue(false);
    vi.mocked(executeCrawl).mockResolvedValue({
      success: true,
      data: mockJobResult,
    } as never);
    vi.mocked(formatJson).mockReturnValue('{"jobId":"job-444"}');

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      embed: false,
    };

    await handleCrawlCommand(container, options);

    expect(handleAsyncEmbedding).not.toHaveBeenCalled();
    expect(handleSyncEmbedding).not.toHaveBeenCalled();
  });

  it('should write output to file when output path is specified', async () => {
    const container = createTestContainer();
    const mockJobResult = {
      jobId: 'job-555',
      url: 'https://example.com',
      status: 'processing',
    };

    vi.mocked(isJobId).mockReturnValue(false);
    vi.mocked(executeCrawl).mockResolvedValue({
      success: true,
      data: mockJobResult,
    } as never);
    vi.mocked(formatJson).mockReturnValue('{"jobId":"job-555"}');

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      output: 'output.json',
    };

    await handleCrawlCommand(container, options);

    expect(writeOutput).toHaveBeenCalledWith(
      '{"jobId":"job-555"}',
      'output.json',
      true
    );
  });

  it('should use pretty formatting when requested', async () => {
    const container = createTestContainer();
    const mockJobResult = {
      jobId: 'job-666',
      url: 'https://example.com',
      status: 'processing',
    };

    vi.mocked(isJobId).mockReturnValue(false);
    vi.mocked(executeCrawl).mockResolvedValue({
      success: true,
      data: mockJobResult,
    } as never);
    vi.mocked(formatJson).mockReturnValue('{\n  "jobId": "job-666"\n}');

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      pretty: true,
      output: 'pretty-output.json',
    };

    await handleCrawlCommand(container, options);

    expect(formatJson).toHaveBeenCalledWith(
      { success: true, data: mockJobResult },
      true
    );
    expect(writeOutput).toHaveBeenCalledWith(
      '{\n  "jobId": "job-666"\n}',
      'pretty-output.json',
      true
    );
  });

  it('should return early when crawl result has no data', async () => {
    const container = createTestContainer();
    vi.mocked(isJobId).mockReturnValue(false);
    vi.mocked(executeCrawl).mockResolvedValue({
      success: true,
      data: null,
    } as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
    };

    await handleCrawlCommand(container, options);

    expect(handleAsyncEmbedding).not.toHaveBeenCalled();
    expect(handleSyncEmbedding).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it('should pass apiKey to embedding functions', async () => {
    const container = createTestContainer(undefined, { apiKey: 'test-key' });
    const mockJobResult = {
      jobId: 'job-777',
      url: 'https://example.com',
      status: 'processing',
    };

    vi.mocked(isJobId).mockReturnValue(false);
    vi.mocked(executeCrawl).mockResolvedValue({
      success: true,
      data: mockJobResult,
    } as never);
    vi.mocked(formatJson).mockReturnValue('{"jobId":"job-777"}');

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      apiKey: 'test-key',
    };

    await handleCrawlCommand(container, options);

    expect(handleAsyncEmbedding).toHaveBeenCalledWith(
      'job-777',
      'https://example.com',
      container.config,
      'test-key'
    );
  });
});
