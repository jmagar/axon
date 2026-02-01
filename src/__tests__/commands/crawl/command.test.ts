import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCrawlCommand } from '../../../commands/crawl/command';
import type { CrawlOptions } from '../../../types/crawl';

// Mock dependencies
vi.mock('../../../utils/command', () => ({
  formatJson: vi.fn(),
}));

vi.mock('../../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

vi.mock('../../../utils/job', () => ({
  isJobId: vi.fn(),
}));

vi.mock('../../../utils/job-history', () => ({
  recordJob: vi.fn(),
}));

vi.mock('../../../commands/crawl/execute', () => ({
  executeCrawl: vi.fn(),
}));

vi.mock('../../../commands/crawl/status', () => ({
  executeCrawlCancel: vi.fn(),
  executeCrawlErrors: vi.fn(),
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
import {
  executeCrawlCancel,
  executeCrawlErrors,
} from '../../../commands/crawl/status';
import { formatJson } from '../../../utils/command';
import { isJobId } from '../../../utils/job';
import { recordJob } from '../../../utils/job-history';
import { writeOutput } from '../../../utils/output';

describe('handleCrawlCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should exit when URL or job ID is missing', async () => {
    const mockExit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const options: CrawlOptions = {
      urlOrJobId: '',
    };

    await handleCrawlCommand(options);

    expect(mockError).toHaveBeenCalledWith('Error: URL or job ID is required.');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('should handle cancel operation successfully', async () => {
    const mockCancelResult = {
      success: true,
      data: { status: 'cancelled' },
    };

    vi.mocked(executeCrawlCancel).mockResolvedValue(mockCancelResult as never);
    vi.mocked(formatJson).mockReturnValue('{"success":true}');

    const options: CrawlOptions = {
      urlOrJobId: 'job-123',
      cancel: true,
    };

    await handleCrawlCommand(options);

    expect(executeCrawlCancel).toHaveBeenCalledWith('job-123', options);
    expect(formatJson).toHaveBeenCalledWith(
      { success: true, data: { status: 'cancelled' } },
      undefined
    );
    expect(writeOutput).toHaveBeenCalledWith(
      '{"success":true}',
      undefined,
      false
    );
  });

  it('should handle cancel operation failure', async () => {
    const mockExit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(executeCrawlCancel).mockResolvedValue({
      success: false,
      error: 'Job not found',
    } as never);

    const options: CrawlOptions = {
      urlOrJobId: 'job-123',
      cancel: true,
    };

    await handleCrawlCommand(options);

    expect(mockError).toHaveBeenCalledWith('Error:', 'Job not found');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('should handle errors operation successfully', async () => {
    const mockErrorsResult = {
      success: true,
      data: [{ url: 'https://example.com/404', error: '404 Not Found' }],
    };

    vi.mocked(executeCrawlErrors).mockResolvedValue(mockErrorsResult as never);
    vi.mocked(formatJson).mockReturnValue('{"success":true}');

    const options: CrawlOptions = {
      urlOrJobId: 'job-456',
      errors: true,
    };

    await handleCrawlCommand(options);

    expect(executeCrawlErrors).toHaveBeenCalledWith('job-456', options);
    expect(formatJson).toHaveBeenCalledWith(
      { success: true, data: mockErrorsResult.data },
      undefined
    );
    expect(writeOutput).toHaveBeenCalledWith(
      '{"success":true}',
      undefined,
      false
    );
  });

  it('should handle manual embedding trigger', async () => {
    vi.mocked(isJobId).mockReturnValue(true);
    vi.mocked(handleManualEmbedding).mockResolvedValue(undefined);

    const options: CrawlOptions = {
      urlOrJobId: 'job-789',
      embed: true,
    };

    await handleCrawlCommand(options);

    expect(isJobId).toHaveBeenCalledWith('job-789');
    expect(handleManualEmbedding).toHaveBeenCalledWith('job-789', undefined);
  });

  it('should handle crawl execution failure', async () => {
    const mockExit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(isJobId).mockReturnValue(false);
    vi.mocked(executeCrawl).mockResolvedValue({
      success: false,
      error: 'Network error',
    } as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
    };

    await handleCrawlCommand(options);

    expect(mockError).toHaveBeenCalledWith('Error:', 'Network error');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('should handle status check result', async () => {
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

    await handleCrawlCommand(options);

    expect(formatCrawlStatus).toHaveBeenCalledWith(mockStatusData);
    expect(writeOutput).toHaveBeenCalledWith(
      'Status: completed',
      undefined,
      false
    );
  });

  it('should handle async job result with auto-embedding', async () => {
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

    await handleCrawlCommand(options);

    expect(handleAsyncEmbedding).toHaveBeenCalledWith(
      'job-222',
      'https://example.com',
      undefined
    );
    expect(recordJob).toHaveBeenCalledWith('crawl', 'job-222');
    expect(formatJson).toHaveBeenCalledWith(
      { success: true, data: mockJobResult },
      undefined
    );
    expect(writeOutput).toHaveBeenCalledWith(
      '{"jobId":"job-222"}',
      undefined,
      false
    );
  });

  it('should handle completed crawl result with auto-embedding', async () => {
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

    await handleCrawlCommand(options);

    expect(handleSyncEmbedding).toHaveBeenCalledWith(mockCrawlData);
    expect(formatJson).toHaveBeenCalledWith(mockCrawlData, undefined);
    expect(writeOutput).toHaveBeenCalledWith(
      '{"data":[...]}',
      undefined,
      false
    );
  });

  it('should skip auto-embedding when embed is false', async () => {
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

    await handleCrawlCommand(options);

    expect(handleAsyncEmbedding).not.toHaveBeenCalled();
    expect(handleSyncEmbedding).not.toHaveBeenCalled();
  });

  it('should write output to file when output path is specified', async () => {
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

    await handleCrawlCommand(options);

    expect(writeOutput).toHaveBeenCalledWith(
      '{"jobId":"job-555"}',
      'output.json',
      true
    );
  });

  it('should use pretty formatting when requested', async () => {
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
    };

    await handleCrawlCommand(options);

    expect(formatJson).toHaveBeenCalledWith(
      { success: true, data: mockJobResult },
      true
    );
  });

  it('should return early when crawl result has no data', async () => {
    vi.mocked(isJobId).mockReturnValue(false);
    vi.mocked(executeCrawl).mockResolvedValue({
      success: true,
      data: null,
    } as never);

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
    };

    await handleCrawlCommand(options);

    expect(handleAsyncEmbedding).not.toHaveBeenCalled();
    expect(handleSyncEmbedding).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it('should pass apiKey to embedding functions', async () => {
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

    await handleCrawlCommand(options);

    expect(handleAsyncEmbedding).toHaveBeenCalledWith(
      'job-777',
      'https://example.com',
      'test-key'
    );
  });
});
