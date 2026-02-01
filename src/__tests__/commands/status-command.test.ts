/**
 * Tests for status command (job status)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStatusCommand,
  handleJobStatusCommand,
} from '../../commands/status';
import type { IContainer } from '../../container/types';
import { writeOutput } from '../../utils/output';
import { createTestContainer } from '../utils/test-container';

vi.mock('../../utils/embed-queue', () => ({
  getEmbedJob: vi.fn(),
  listEmbedJobs: vi.fn().mockReturnValue([]),
  removeEmbedJob: vi.fn(),
  updateEmbedJob: vi.fn(),
}));

vi.mock('../../utils/job-history', () => ({
  getRecentJobIds: vi.fn().mockReturnValue([]),
  removeJobIds: vi.fn(),
}));

vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('handleJobStatusCommand', () => {
  const mockClient = {
    getActiveCrawls: vi.fn().mockResolvedValue({ success: true, crawls: [] }),
    getCrawlStatus: vi.fn().mockResolvedValue({
      id: 'job-1',
      status: 'completed',
      total: 1,
      completed: 1,
      data: [],
    }),
    getBatchScrapeStatus: vi.fn().mockResolvedValue({
      id: 'batch-1',
      status: 'completed',
      total: 1,
      completed: 1,
      data: [],
    }),
    getExtractStatus: vi.fn().mockResolvedValue({
      id: 'extract-1',
      status: 'completed',
      data: [],
    }),
  };
  let container: IContainer;

  beforeEach(async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    const { listEmbedJobs } = await import('../../utils/embed-queue');
    vi.mocked(getRecentJobIds).mockReturnValue([]);
    vi.mocked(listEmbedJobs).mockReturnValue([]);
    container = createTestContainer(mockClient as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should write JSON output when json flag is set', async () => {
    await handleJobStatusCommand(container, {
      crawl: 'job-1',
      batch: 'batch-1',
      extract: 'extract-1',
      json: true,
    });

    expect(writeOutput).toHaveBeenCalledTimes(1);
  });

  it('should use recent job IDs when none provided', async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockImplementation((type: string) => {
      if (type === 'crawl') return ['019c161c-8a80-7051-a438-2ec8707e1bc4'];
      if (type === 'batch') return ['019c161c-8a80-7051-a438-2ec8707e1bc5'];
      if (type === 'extract') return ['019c161c-8a80-7051-a438-2ec8707e1bc6'];
      return [];
    });

    await handleJobStatusCommand(container, { json: true });

    expect(mockClient.getCrawlStatus).toHaveBeenCalledWith(
      '019c161c-8a80-7051-a438-2ec8707e1bc4'
    );
    expect(mockClient.getBatchScrapeStatus).toHaveBeenCalledWith(
      '019c161c-8a80-7051-a438-2ec8707e1bc5'
    );
    expect(mockClient.getExtractStatus).toHaveBeenCalledWith(
      '019c161c-8a80-7051-a438-2ec8707e1bc6'
    );
  });

  it('should ignore invalid recent job IDs', async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockImplementation((type: string) => {
      if (type === 'crawl') return ['not-a-uuid'];
      if (type === 'batch') return ['still-not-a-uuid'];
      if (type === 'extract') return ['bad-id'];
      return [];
    });

    await handleJobStatusCommand(container, { json: true });

    expect(mockClient.getCrawlStatus).not.toHaveBeenCalled();
    expect(mockClient.getBatchScrapeStatus).not.toHaveBeenCalled();
    expect(mockClient.getExtractStatus).not.toHaveBeenCalled();
  });

  it('should not throw when status lookups fail', async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockImplementation((type: string) => {
      if (type === 'crawl') return ['019c161c-8a80-7051-a438-2ec8707e1bc4'];
      return [];
    });

    mockClient.getCrawlStatus.mockRejectedValue(new Error('Job not found'));

    await handleJobStatusCommand(container, { json: true });

    expect(writeOutput).toHaveBeenCalledTimes(1);
  });

  it('should prune job IDs that return not found', async () => {
    const { getRecentJobIds, removeJobIds } = await import(
      '../../utils/job-history'
    );
    vi.mocked(getRecentJobIds).mockImplementation((type: string) => {
      if (type === 'crawl') return ['019c161c-8a80-7051-a438-2ec8707e1bc4'];
      if (type === 'batch') return ['019c161c-8a80-7051-a438-2ec8707e1bc5'];
      if (type === 'extract') return ['019c161c-8a80-7051-a438-2ec8707e1bc6'];
      return [];
    });

    mockClient.getCrawlStatus.mockRejectedValue(new Error('Job not found'));
    mockClient.getBatchScrapeStatus.mockRejectedValue(
      new Error('Invalid job ID format')
    );
    mockClient.getExtractStatus.mockRejectedValue(new Error('Job not found'));

    await handleJobStatusCommand(container, { json: true });

    expect(removeJobIds).toHaveBeenCalledWith('crawl', [
      '019c161c-8a80-7051-a438-2ec8707e1bc4',
    ]);
    expect(removeJobIds).toHaveBeenCalledWith('batch', [
      '019c161c-8a80-7051-a438-2ec8707e1bc5',
    ]);
    expect(removeJobIds).toHaveBeenCalledWith('extract', [
      '019c161c-8a80-7051-a438-2ec8707e1bc6',
    ]);
  });

  it('should include pending embed jobs in JSON output', async () => {
    const { listEmbedJobs } = await import('../../utils/embed-queue');
    vi.mocked(listEmbedJobs).mockReturnValue([
      {
        id: 'job-1',
        jobId: 'job-1',
        url: 'https://example.com',
        status: 'pending',
        retries: 1,
        maxRetries: 3,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:01:00.000Z',
      },
      {
        id: 'job-2',
        jobId: 'job-2',
        url: 'https://example.com/2',
        status: 'completed',
        retries: 0,
        maxRetries: 3,
        createdAt: '2026-02-01T00:02:00.000Z',
        updatedAt: '2026-02-01T00:03:00.000Z',
      },
    ]);

    await handleJobStatusCommand(container, { json: true });

    const output = vi.mocked(writeOutput).mock.calls[0]?.[0];
    const parsed = JSON.parse(output as string);
    expect(parsed.data.embeddings.pending).toEqual([
      {
        jobId: 'job-1',
        url: 'https://example.com',
        retries: 1,
        maxRetries: 3,
        updatedAt: '2026-02-01T00:01:00.000Z',
      },
    ]);
  });

  it('should list pending embed jobs in human output', async () => {
    const { listEmbedJobs } = await import('../../utils/embed-queue');
    vi.mocked(listEmbedJobs).mockReturnValue([
      {
        id: 'job-1',
        jobId: 'job-1',
        url: 'http://localhost:53002/v2/crawl/job-1',
        status: 'pending',
        retries: 2,
        maxRetries: 3,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:01:00.000Z',
      },
    ]);
    mockClient.getActiveCrawls.mockResolvedValue({
      success: true,
      crawls: [{ id: 'job-1', teamId: 'team', url: 'https://example.com' }],
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleJobStatusCommand(container, {});

    const output = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Pending embeds:');
    expect(output).toContain('job-1 (2/3) https://example.com');

    logSpy.mockRestore();
  });

  it('should list failed embed jobs in human output', async () => {
    const { listEmbedJobs } = await import('../../utils/embed-queue');
    vi.mocked(listEmbedJobs).mockReturnValue([
      {
        id: 'job-1',
        jobId: 'job-1',
        url: 'https://example.com',
        status: 'failed',
        retries: 3,
        maxRetries: 3,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:01:00.000Z',
        lastError: 'Boom',
      },
    ]);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleJobStatusCommand(container, {});

    const output = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Failed embeds:');
    expect(output).toContain('job-1: Boom');

    logSpy.mockRestore();
  });

  it('should include crawl URL in status output when available', async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockReturnValue([
      '019c161c-8a80-7051-a438-2ec8707e1bc4',
    ]);

    mockClient.getCrawlStatus.mockResolvedValue({
      id: '019c161c-8a80-7051-a438-2ec8707e1bc4',
      status: 'completed',
      total: 1,
      completed: 1,
      data: [{ metadata: { sourceURL: 'https://example.com' } }],
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleJobStatusCommand(container, {});

    const output = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain(
      '019c161c-8a80-7051-a438-2ec8707e1bc4: completed (1/1) https://example.com'
    );

    logSpy.mockRestore();
  });

  it('should include crawl URL in JSON output when available', async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockReturnValue([
      '019c161c-8a80-7051-a438-2ec8707e1bc4',
    ]);

    mockClient.getCrawlStatus.mockResolvedValue({
      id: '019c161c-8a80-7051-a438-2ec8707e1bc4',
      status: 'completed',
      total: 1,
      completed: 1,
      data: [{ metadata: { sourceURL: 'https://example.com' } }],
    });

    await handleJobStatusCommand(container, { json: true });

    const output = vi.mocked(writeOutput).mock.calls[0]?.[0];
    const parsed = JSON.parse(output as string);
    expect(parsed.data.crawls[0].url).toBe('https://example.com');
  });

  it('should cancel embed job when requested', async () => {
    const { getEmbedJob, removeEmbedJob } = await import(
      '../../utils/embed-queue'
    );
    vi.mocked(getEmbedJob).mockReturnValue({
      id: 'job-1',
      jobId: 'job-1',
      url: 'https://example.com',
      status: 'pending',
      retries: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await handleJobStatusCommand(container, {
      cancelEmbed: 'job-1',
      json: true,
    });

    expect(removeEmbedJob).toHaveBeenCalledWith('job-1');
    const output = vi.mocked(writeOutput).mock.calls[0]?.[0];
    const parsed = JSON.parse(output as string);
    expect(parsed.cancelledEmbedJobId).toBe('job-1');
    expect(parsed.cancelledEmbedJobFound).toBe(true);
  });

  it('should start active crawl and status lookups in parallel', async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockImplementation((type: string) => {
      if (type === 'crawl') return ['019c161c-8a80-7051-a438-2ec8707e1bc4'];
      return [];
    });

    let resolveActive: (value: { success: boolean; crawls: [] }) => void;
    let resolveCrawl: (value: {
      id: string;
      status: string;
      total: number;
      completed: number;
      data: [];
    }) => void;

    const activePromise = new Promise<{ success: boolean; crawls: [] }>(
      (resolve) => {
        resolveActive = resolve;
      }
    );
    const crawlPromise = new Promise<{
      id: string;
      status: string;
      total: number;
      completed: number;
      data: [];
    }>((resolve) => {
      resolveCrawl = resolve;
    });

    mockClient.getActiveCrawls.mockReturnValue(activePromise);
    mockClient.getCrawlStatus.mockReturnValue(crawlPromise);

    const run = handleJobStatusCommand(container, { json: true });

    await Promise.resolve();

    expect(mockClient.getActiveCrawls).toHaveBeenCalledTimes(1);
    expect(mockClient.getCrawlStatus).toHaveBeenCalledTimes(1);

    resolveActive!({ success: true, crawls: [] });
    resolveCrawl!({
      id: '019c161c-8a80-7051-a438-2ec8707e1bc4',
      status: 'completed',
      total: 1,
      completed: 1,
      data: [],
    });

    await run;
  });
});

describe('createStatusCommand', () => {
  it('should call getActiveCrawls when invoked', async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockReturnValue([]);
    const activeClient = {
      getActiveCrawls: vi.fn().mockResolvedValue({ success: true, crawls: [] }),
      getCrawlStatus: vi.fn(),
      getBatchScrapeStatus: vi.fn(),
      getExtractStatus: vi.fn(),
    };
    const testContainer = createTestContainer(activeClient as any);

    const cmd = createStatusCommand();
    cmd.exitOverride();
    (cmd as any)._container = testContainer;

    await cmd.parseAsync(['node', 'test', '--json'], {
      from: 'node',
    });

    expect(activeClient.getActiveCrawls).toHaveBeenCalledTimes(1);
  });
});
