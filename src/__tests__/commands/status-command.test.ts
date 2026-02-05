/**
 * Tests for status command (job status)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStatusCommand,
  handleJobStatusCommand,
} from '../../commands/status';
import type { IContainer } from '../../container/types';
import type { CommandWithContainer } from '../../types/test';
import { resetTeiCache } from '../../utils/embeddings';
import { writeOutput } from '../../utils/output';
import { resetQdrantCache } from '../../utils/qdrant';
import type { MockFirecrawlClient } from '../utils/mock-client';
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
    container = createTestContainer(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetTeiCache();
    resetQdrantCache();
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
      '019c161c-8a80-7051-a438-2ec8707e1bc4',
      { autoPaginate: false }
    );
    expect(mockClient.getBatchScrapeStatus).toHaveBeenCalledWith(
      '019c161c-8a80-7051-a438-2ec8707e1bc5',
      { autoPaginate: false }
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
    expect(parsed.data.embeddings.completed).toBeUndefined();
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
    expect(output).toContain('job-1');
    expect(output).toContain('Boom');

    logSpy.mockRestore();
  });

  it('should list completed embed jobs in human output', async () => {
    const { listEmbedJobs } = await import('../../utils/embed-queue');
    vi.mocked(listEmbedJobs).mockReturnValue([
      {
        id: 'job-1',
        jobId: 'job-1',
        url: 'http://localhost:53002/v2/crawl/job-1',
        status: 'completed',
        retries: 0,
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
    expect(output).toContain('Completed embeds:');
    expect(output).toContain('job-1 https://example.com');

    logSpy.mockRestore();
  });

  it('should list failed, pending, and completed crawls in human output', async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockReturnValue([
      '019c161c-8a80-7051-a438-2ec8707e1bc4',
      '019c161c-8a80-7051-a438-2ec8707e1bc5',
      '019c161c-8a80-7051-a438-2ec8707e1bc6',
    ]);

    mockClient.getCrawlStatus.mockImplementation((id: string) => {
      if (id === '019c161c-8a80-7051-a438-2ec8707e1bc4') {
        return Promise.reject(new Error('Job not found'));
      }
      if (id === '019c161c-8a80-7051-a438-2ec8707e1bc5') {
        return Promise.resolve({
          id,
          status: 'running',
          total: 2,
          completed: 1,
          data: [],
        });
      }
      return Promise.resolve({
        id,
        status: 'completed',
        total: 2,
        completed: 2,
        data: [{ metadata: { sourceURL: 'https://example.com' } }],
      });
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleJobStatusCommand(container, {});

    const output = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Failed crawls:');
    expect(output).toContain('Job not found');
    expect(output).toContain('Pending crawls:');
    expect(output).toContain('running');
    expect(output).toContain('1/2');
    expect(output).toContain('Completed crawls:');
    expect(output).toContain('2/2');
    expect(output).toContain('https://example.com');

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
    expect(output).toContain('Completed crawls:');
    expect(output).toContain('019c161c-8a80-7051-a438-2ec8707e1bc4');
    expect(output).toContain('completed');
    expect(output).toContain('1/1');
    expect(output).toContain('https://example.com');

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

  it('should start active crawl and status lookups in parallel', async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockImplementation((type: string) => {
      if (type === 'crawl') return ['019c161c-8a80-7051-a438-2ec8707e1bc4'];
      return [];
    });

    let resolveActive!: (value: { success: boolean; crawls: [] }) => void;
    let resolveCrawl!: (value: {
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

    resolveActive?.({ success: true, crawls: [] });
    resolveCrawl?.({
      id: '019c161c-8a80-7051-a438-2ec8707e1bc4',
      status: 'completed',
      total: 1,
      completed: 1,
      data: [],
    });

    await run;
  });

  describe('sorting behavior', () => {
    it('should sort completed embeds by updatedAt descending (newest first)', async () => {
      const { listEmbedJobs } = await import('../../utils/embed-queue');
      vi.mocked(listEmbedJobs).mockReturnValue([
        {
          id: 'job-1',
          jobId: 'job-1',
          url: 'https://example.com/1',
          status: 'completed',
          retries: 0,
          maxRetries: 3,
          createdAt: '2026-02-01T10:00:00.000Z',
          updatedAt: '2026-02-01T10:00:00.000Z',
        },
        {
          id: 'job-3',
          jobId: 'job-3',
          url: 'https://example.com/3',
          status: 'completed',
          retries: 0,
          maxRetries: 3,
          createdAt: '2026-02-03T10:00:00.000Z',
          updatedAt: '2026-02-03T10:00:00.000Z',
        },
        {
          id: 'job-2',
          jobId: 'job-2',
          url: 'https://example.com/2',
          status: 'completed',
          retries: 0,
          maxRetries: 3,
          createdAt: '2026-02-02T10:00:00.000Z',
          updatedAt: '2026-02-02T10:00:00.000Z',
        },
      ]);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handleJobStatusCommand(container, {});

      const output = logSpy.mock.calls.map((call) => call[0]).join('\n');
      const completedSection = output.split('Completed embeds:')[1];

      // Verify order: job-3 (newest), job-2, job-1 (oldest)
      expect(completedSection?.indexOf('job-3')).toBeLessThan(
        completedSection?.indexOf('job-2') ?? Infinity
      );
      expect(completedSection?.indexOf('job-2')).toBeLessThan(
        completedSection?.indexOf('job-1') ?? Infinity
      );

      logSpy.mockRestore();
    });

    it('should sort pending embeds by updatedAt descending (newest first)', async () => {
      const { listEmbedJobs } = await import('../../utils/embed-queue');
      vi.mocked(listEmbedJobs).mockReturnValue([
        {
          id: 'job-1',
          jobId: 'job-1',
          url: 'https://example.com/1',
          status: 'pending',
          retries: 0,
          maxRetries: 3,
          createdAt: '2026-02-01T10:00:00.000Z',
          updatedAt: '2026-02-01T10:00:00.000Z',
        },
        {
          id: 'job-2',
          jobId: 'job-2',
          url: 'https://example.com/2',
          status: 'pending',
          retries: 1,
          maxRetries: 3,
          createdAt: '2026-02-02T10:00:00.000Z',
          updatedAt: '2026-02-02T10:00:00.000Z',
        },
      ]);

      await handleJobStatusCommand(container, { json: true });

      const output = vi.mocked(writeOutput).mock.calls[0]?.[0];
      const parsed = JSON.parse(output as string);
      const pending = parsed.data.embeddings.pending;

      expect(pending).toHaveLength(2);
      expect(pending[0].jobId).toBe('job-2'); // newest first
      expect(pending[1].jobId).toBe('job-1'); // oldest last
    });

    it('should sort failed embeds by updatedAt descending (newest first)', async () => {
      const { listEmbedJobs } = await import('../../utils/embed-queue');
      vi.mocked(listEmbedJobs).mockReturnValue([
        {
          id: 'job-1',
          jobId: 'job-1',
          url: 'https://example.com/1',
          status: 'failed',
          retries: 3,
          maxRetries: 3,
          createdAt: '2026-02-01T10:00:00.000Z',
          updatedAt: '2026-02-01T10:00:00.000Z',
          lastError: 'Error 1',
        },
        {
          id: 'job-2',
          jobId: 'job-2',
          url: 'https://example.com/2',
          status: 'failed',
          retries: 3,
          maxRetries: 3,
          createdAt: '2026-02-02T10:00:00.000Z',
          updatedAt: '2026-02-02T10:00:00.000Z',
          lastError: 'Error 2',
        },
      ]);

      await handleJobStatusCommand(container, { json: true });

      const output = vi.mocked(writeOutput).mock.calls[0]?.[0];
      const parsed = JSON.parse(output as string);
      const failed = parsed.data.embeddings.failed;

      expect(failed).toHaveLength(2);
      expect(failed[0].jobId).toBe('job-2'); // newest first
      expect(failed[1].jobId).toBe('job-1'); // oldest last
    });

    it('should sort crawls by ID descending (newest first)', async () => {
      const { getRecentJobIds } = await import('../../utils/job-history');
      vi.mocked(getRecentJobIds).mockImplementation((type: string) => {
        if (type === 'crawl')
          return [
            '019c21d6-909a-74b8-a486-2a0a39a1834d', // oldest
            '019c2443-183b-751b-9bf0-dfd1be25b48f', // newest
            '019c2438-1969-7418-8f42-6d4ceef31eb3', // middle
          ];
        return [];
      });

      mockClient.getCrawlStatus.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          status: 'completed',
          total: 1,
          completed: 1,
          data: [],
        })
      );

      await handleJobStatusCommand(container, { json: true });

      const output = vi.mocked(writeOutput).mock.calls[0]?.[0];
      const parsed = JSON.parse(output as string);
      const crawls = parsed.data.crawls;

      expect(crawls).toHaveLength(3);
      expect(crawls[0].id).toBe('019c2443-183b-751b-9bf0-dfd1be25b48f'); // newest
      expect(crawls[1].id).toBe('019c2438-1969-7418-8f42-6d4ceef31eb3'); // middle
      expect(crawls[2].id).toBe('019c21d6-909a-74b8-a486-2a0a39a1834d'); // oldest
    });

    it('should sort batches by ID descending (newest first)', async () => {
      const { getRecentJobIds } = await import('../../utils/job-history');
      vi.mocked(getRecentJobIds).mockImplementation((type: string) => {
        if (type === 'batch')
          return [
            '019c21d6-909a-74b8-a486-2a0a39a1834d', // oldest
            '019c2443-183b-751b-9bf0-dfd1be25b48f', // newest
          ];
        return [];
      });

      mockClient.getBatchScrapeStatus.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          status: 'completed',
          total: 1,
          completed: 1,
          data: [],
        })
      );

      await handleJobStatusCommand(container, { json: true });

      const output = vi.mocked(writeOutput).mock.calls[0]?.[0];
      const parsed = JSON.parse(output as string);
      const batches = parsed.data.batches;

      expect(batches).toHaveLength(2);
      expect(batches[0].id).toBe('019c2443-183b-751b-9bf0-dfd1be25b48f'); // newest
      expect(batches[1].id).toBe('019c21d6-909a-74b8-a486-2a0a39a1834d'); // oldest
    });

    it('should sort extracts by ID descending (newest first)', async () => {
      const { getRecentJobIds } = await import('../../utils/job-history');
      vi.mocked(getRecentJobIds).mockImplementation((type: string) => {
        if (type === 'extract')
          return [
            '019c21d6-909a-74b8-a486-2a0a39a1834d', // oldest
            '019c2443-183b-751b-9bf0-dfd1be25b48f', // newest
          ];
        return [];
      });

      mockClient.getExtractStatus.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          status: 'completed',
          data: [],
        })
      );

      await handleJobStatusCommand(container, { json: true });

      const output = vi.mocked(writeOutput).mock.calls[0]?.[0];
      const parsed = JSON.parse(output as string);
      const extracts = parsed.data.extracts;

      expect(extracts).toHaveLength(2);
      expect(extracts[0].id).toBe('019c2443-183b-751b-9bf0-dfd1be25b48f'); // newest
      expect(extracts[1].id).toBe('019c21d6-909a-74b8-a486-2a0a39a1834d'); // oldest
    });
  });
});

describe('createStatusCommand', () => {
  it('should call getActiveCrawls when invoked', async () => {
    const { getRecentJobIds } = await import('../../utils/job-history');
    vi.mocked(getRecentJobIds).mockReturnValue([]);
    const activeClient: Partial<MockFirecrawlClient> = {
      getActiveCrawls: vi.fn().mockResolvedValue({ success: true, crawls: [] }),
      getCrawlStatus: vi.fn(),
      getBatchScrapeStatus: vi.fn(),
      getExtractStatus: vi.fn(),
    };
    const testContainer = createTestContainer(activeClient);

    const cmd = createStatusCommand() as CommandWithContainer;
    cmd.exitOverride();
    cmd._container = testContainer;

    await cmd.parseAsync(['node', 'test', '--json'], {
      from: 'node',
    });

    expect(activeClient.getActiveCrawls).toHaveBeenCalledTimes(1);
  });
});
