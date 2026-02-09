/**
 * Tests for crawl command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCrawlCommand,
  executeCrawl,
  executeCrawlCancel,
  executeCrawlErrors,
  handleCrawlCommand,
} from '../../commands/crawl';
import { writeOutput } from '../../utils/output';
import type { MockFirecrawlClient } from '../utils/mock-client';
import { createTestContainer } from '../utils/test-container';

const createContainer = (...args: Parameters<typeof createTestContainer>) =>
  createTestContainer(...args);

// No longer need to mock the client module since we use containers.
// Use vi.hoisted to ensure mockAutoEmbed is defined before test modules run.
const { mockAutoEmbed } = vi.hoisted(() => ({
  mockAutoEmbed: vi.fn().mockResolvedValue(undefined),
}));

// Mock settings to avoid reading real user settings from disk
vi.mock('../../utils/settings', () => ({
  loadSettings: vi.fn().mockReturnValue({}),
}));

vi.mock('../../utils/embed-queue', () => ({
  enqueueEmbedJob: vi.fn().mockResolvedValue({
    id: 'mock-job',
    jobId: 'mock-job',
    url: 'https://example.com',
    status: 'pending',
    retries: 0,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  getEmbedJob: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../utils/background-embedder', () => ({
  processEmbedQueue: vi.fn().mockResolvedValue(undefined),
}));

// Mock writeOutput
vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeCrawl', () => {
  type CrawlMockClient = MockFirecrawlClient &
    Required<
      Pick<MockFirecrawlClient, 'startCrawl' | 'getCrawlStatus' | 'crawl'>
    >;

  let mockClient: CrawlMockClient;

  beforeEach(() => {
    // Create mock client
    mockClient = {
      scrape: vi.fn(),
      startCrawl: vi.fn(),
      getCrawlStatus: vi.fn(),
      crawl: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Start crawl (async)', () => {
    it('should call startCrawl with correct URL and return job ID', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);
      const container = createContainer(mockClient);

      const result = await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(mockClient.startCrawl).toHaveBeenCalledTimes(1);
      // Now includes default binary extensions (regex patterns like \.exe$)
      const call = mockClient.startCrawl.mock.calls[0];
      expect(call[0]).toBe('https://example.com');
      expect(call[1].excludePaths).toBeDefined();
      expect(call[1].excludePaths.length).toBeGreaterThan(20); // Should have 24 default extensions
      expect(call[1].excludePaths).toContain('\\.exe$');
      expect(call[1].excludePaths).toContain('\\.pkg$');
      expect(result).toEqual({
        success: true,
        data: {
          jobId: mockResponse.id,
          url: mockResponse.url,
          status: 'processing',
        },
      });
    });

    it('should include webhook config when embedder webhook URL is set', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);
      const container = createContainer(mockClient, {
        embedderWebhookUrl: 'https://example.com/embedder',
        embedderWebhookSecret: 'test-secret',
      });

      await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(mockClient.startCrawl).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          webhook: {
            url: 'https://example.com/embedder',
            headers: { 'x-firecrawl-embedder-secret': 'test-secret' },
            events: ['completed', 'failed'],
          },
        })
      );
    });

    it('should include limit option when provided', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      const container = createContainer(mockClient);
      await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        limit: 100,
      });

      expect(mockClient.startCrawl).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          limit: 100,
        })
      );
    });

    it('should include maxDepth option when provided', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      const container = createContainer(mockClient);
      await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        maxDepth: 3,
      });

      expect(mockClient.startCrawl).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          maxDiscoveryDepth: 3,
        })
      );
    });

    it('should include excludePaths option when provided', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      const container = createContainer(mockClient);
      await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        excludePaths: ['/admin', '/private'],
      });

      // Now includes custom paths + default binary extensions
      const call = mockClient.startCrawl.mock.calls[0];
      expect(call[0]).toBe('https://example.com');
      expect(call[1].excludePaths).toContain('/admin');
      expect(call[1].excludePaths).toContain('/private');
      expect(call[1].excludePaths).toContain('\\.exe$'); // Binary extension
      expect(call[1].excludePaths).toContain('\\.pkg$'); // Binary extension
    });

    it('should include includePaths option when provided', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      const container = createContainer(mockClient);
      await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        includePaths: ['/blog', '/docs'],
      });

      expect(mockClient.startCrawl).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          includePaths: ['/blog', '/docs'],
        })
      );
    });

    it('should include sitemap option when provided', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      const container = createContainer(mockClient);
      await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        sitemap: 'skip',
      });

      expect(mockClient.startCrawl).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          sitemap: 'skip',
        })
      );
    });

    it('should combine all options correctly', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      const container = createContainer(mockClient);
      await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        limit: 50,
        maxDepth: 2,
        excludePaths: ['/admin'],
        includePaths: ['/blog'],
        sitemap: 'include',
        ignoreQueryParameters: true,
        crawlEntireDomain: false,
        allowExternalLinks: false,
        allowSubdomains: true,
        delay: 1000,
        maxConcurrency: 5,
      });

      // Now includes custom paths + default binary extensions
      const call = mockClient.startCrawl.mock.calls[0];
      expect(call[0]).toBe('https://example.com');
      expect(call[1]).toMatchObject({
        limit: 50,
        maxDiscoveryDepth: 2,
        includePaths: ['/blog'],
        sitemap: 'include',
        ignoreQueryParameters: true,
        crawlEntireDomain: false,
        allowExternalLinks: false,
        allowSubdomains: true,
        delay: 1000,
        maxConcurrency: 5,
      });
      // Verify excludePaths includes custom path and extensions
      expect(call[1].excludePaths).toContain('/admin');
      expect(call[1].excludePaths).toContain('\\.exe$'); // Binary extension
      expect(call[1].excludePaths).toContain('\\.pkg$'); // Binary extension
    });
  });

  describe('Check crawl status', () => {
    it('should check status when status flag is set', async () => {
      const mockStatus = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        total: 100,
        completed: 100,
        creditsUsed: 50,
        expiresAt: '2024-12-31T23:59:59Z',
      };
      mockClient.getCrawlStatus.mockResolvedValue(mockStatus);

      const container = createContainer(mockClient);
      const result = await executeCrawl(container, {
        urlOrJobId: '550e8400-e29b-41d4-a716-446655440000',
        status: true,
      });

      expect(mockClient.getCrawlStatus).toHaveBeenCalledTimes(1);
      expect(mockClient.getCrawlStatus).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
        { autoPaginate: false }
      );
      expect(result).toEqual({
        success: true,
        data: {
          id: mockStatus.id,
          status: mockStatus.status,
          total: mockStatus.total,
          completed: mockStatus.completed,
          creditsUsed: mockStatus.creditsUsed,
          expiresAt: mockStatus.expiresAt,
        },
      });
    });

    it('should not auto-detect job ID without status flag', async () => {
      mockClient.startCrawl.mockResolvedValue({
        id: 'new-crawl-job',
        url: '550e8400-e29b-41d4-a716-446655440000',
      });

      const container = createContainer(mockClient);
      const result = await executeCrawl(container, {
        urlOrJobId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(mockClient.getCrawlStatus).not.toHaveBeenCalled();
      expect(mockClient.startCrawl).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it('should handle status check with missing optional fields', async () => {
      const mockStatus = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'scraping',
        total: 100,
        completed: 45,
      };
      mockClient.getCrawlStatus.mockResolvedValue(mockStatus);

      const container = createContainer(mockClient);
      const result = await executeCrawl(container, {
        urlOrJobId: '550e8400-e29b-41d4-a716-446655440000',
        status: true,
      });

      expect(result.success).toBe(true);
      if (result.success && result.data && 'id' in result.data) {
        // Type narrow to CrawlStatusData which has creditsUsed and expiresAt
        expect(result.data.creditsUsed).toBeUndefined();
        expect(result.data.expiresAt).toBeUndefined();
      }
    });
  });

  describe('Wait mode (synchronous crawl)', () => {
    it('should use crawl method with wait when wait flag is set', async () => {
      const mockCrawlJob = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        total: 100,
        completed: 100,
        data: [{ markdown: '# Page 1' }],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      const container = createContainer(mockClient);
      const result = await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      expect(mockClient.crawl).toHaveBeenCalledTimes(1);
      expect(mockClient.crawl).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          pollInterval: 5000, // Default poll interval
        })
      );
      expect(result).toEqual({
        success: true,
        data: mockCrawlJob,
      });
    });

    it('should include custom pollInterval when provided', async () => {
      const mockCrawlJob = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        total: 100,
        completed: 100,
        data: [],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      const container = createContainer(mockClient);
      await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
        pollInterval: 10,
      });

      expect(mockClient.crawl).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          pollInterval: 10000, // Converted to milliseconds
        })
      );
    });

    it('should include timeout when provided', async () => {
      const mockCrawlJob = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        total: 100,
        completed: 100,
        data: [],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      const container = createContainer(mockClient);
      await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
        timeout: 300,
      });

      expect(mockClient.crawl).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          crawlTimeout: 300000, // Converted to milliseconds (SDK uses crawlTimeout)
        })
      );
    });

    it('should combine wait options with crawl options', async () => {
      const mockCrawlJob = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        total: 50,
        completed: 50,
        data: [],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      const container = createContainer(mockClient);
      await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
        pollInterval: 5,
        timeout: 600,
        limit: 50,
        maxDepth: 2,
      });

      expect(mockClient.crawl).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          pollInterval: 5000,
          crawlTimeout: 600000, // SDK uses crawlTimeout for overall job timeout
          limit: 50,
          maxDiscoveryDepth: 2,
        })
      );
    });
  });

  describe('Progress mode', () => {
    beforeEach(() => {
      // Mock process.stderr.write to avoid console output during tests
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      // Use fake timers to avoid actual waiting
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it('should use custom polling with progress when progress flag is set', async () => {
      const jobId = '550e8400-e29b-41d4-a716-446655440000';
      const mockStartResponse = {
        id: jobId,
        url: 'https://example.com',
      };
      const mockScrapingStatus = {
        id: jobId,
        status: 'scraping',
        total: 100,
        completed: 50,
        data: [],
      };
      const mockCompletedStatus = {
        id: jobId,
        status: 'completed',
        total: 100,
        completed: 100,
        data: [],
      };

      mockClient.startCrawl.mockResolvedValue(mockStartResponse);
      // First call returns scraping status, second returns completed, third is finalFetcher
      mockClient.getCrawlStatus
        .mockResolvedValueOnce(mockScrapingStatus)
        .mockResolvedValueOnce(mockCompletedStatus)
        .mockResolvedValueOnce(mockCompletedStatus);

      const container = createContainer(mockClient);
      // Start the async operation
      const crawlPromise = executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
        progress: true,
        pollInterval: 0.1, // 100ms - minimum valid interval
      });

      // Fast-forward timers to resolve the first setTimeout
      await vi.advanceTimersByTimeAsync(100);

      // Fast-forward again to resolve the second setTimeout
      await vi.advanceTimersByTimeAsync(100);

      const result = await crawlPromise;

      expect(mockClient.startCrawl).toHaveBeenCalledTimes(1);
      expect(mockClient.getCrawlStatus).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(true);
      if (result.success && result.data && 'status' in result.data) {
        expect(result.data.status).toBe('completed');
      }
    });

    it('should automatically enable wait when progress flag is set', async () => {
      const jobId = '550e8400-e29b-41d4-a716-446655440000';
      const mockStartResponse = {
        id: jobId,
        url: 'https://example.com',
      };
      const mockCompletedStatus = {
        id: jobId,
        status: 'completed',
        total: 100,
        completed: 100,
        data: [],
      };

      mockClient.startCrawl.mockResolvedValue(mockStartResponse);
      // First call returns completed, second is finalFetcher
      mockClient.getCrawlStatus
        .mockResolvedValueOnce(mockCompletedStatus)
        .mockResolvedValueOnce(mockCompletedStatus);

      const container = createContainer(mockClient);
      // Start with progress but without explicit wait
      const crawlPromise = executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        progress: true,
        pollInterval: 0.1, // 100ms - minimum valid interval
      });

      // Fast-forward timers to resolve the setTimeout
      await vi.advanceTimersByTimeAsync(100);

      const result = await crawlPromise;

      // Should use wait mode because progress implies wait
      expect(mockClient.startCrawl).toHaveBeenCalledTimes(1);
      expect(mockClient.getCrawlStatus).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      if (result.success && result.data && 'status' in result.data) {
        expect(result.data.status).toBe('completed');
      }
    });
  });

  describe('Error handling', () => {
    it('should return error result when startCrawl fails', async () => {
      const errorMessage = 'API Error: Invalid URL';
      mockClient.startCrawl.mockRejectedValue(new Error(errorMessage));

      const container = createContainer(mockClient);
      const result = await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result).toEqual({
        success: false,
        error: `Crawl operation failed: ${errorMessage}`,
      });
    });

    it('should return error result when getCrawlStatus fails', async () => {
      const errorMessage = 'Job not found';
      mockClient.getCrawlStatus.mockRejectedValue(new Error(errorMessage));

      const container = createContainer(mockClient);
      const result = await executeCrawl(container, {
        urlOrJobId: '550e8400-e29b-41d4-a716-446655440000',
        status: true,
      });

      expect(result).toEqual({
        success: false,
        error: `Failed to check status for job 550e8400-e29b-41d4-a716-446655440000: ${errorMessage}`,
      });
    });

    it('should return error result when crawl fails', async () => {
      const errorMessage = 'Crawl timeout';
      mockClient.crawl.mockRejectedValue(new Error(errorMessage));

      const container = createContainer(mockClient);
      const result = await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      expect(result).toEqual({
        success: false,
        error: `Crawl operation failed: ${errorMessage}`,
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockClient.startCrawl.mockRejectedValue('String error');

      const container = createContainer(mockClient);
      const result = await executeCrawl(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Crawl operation failed: Unknown error occurred'
      );
    });
  });

  describe('Auto-embed integration', () => {
    beforeEach(() => {
      // Suppress console.error output during tests
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockAutoEmbed.mockClear();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should call autoEmbed for each crawled page with markdown', async () => {
      const mockCrawlJob = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        total: 2,
        completed: 2,
        data: [
          {
            markdown: '# Page 1',
            metadata: {
              sourceURL: 'https://example.com/page1',
              title: 'Page 1',
            },
          },
          {
            markdown: '# Page 2',
            metadata: {
              sourceURL: 'https://example.com/page2',
              title: 'Page 2',
            },
          },
        ],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      const container = createContainer(mockClient, { mockAutoEmbed });
      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      expect(mockAutoEmbed).toHaveBeenCalledTimes(2);
      expect(mockAutoEmbed).toHaveBeenCalledWith('# Page 1', {
        url: 'https://example.com/page1',
        title: 'Page 1',
        sourceCommand: 'crawl',
        contentType: 'markdown',
      });
      expect(mockAutoEmbed).toHaveBeenCalledWith('# Page 2', {
        url: 'https://example.com/page2',
        title: 'Page 2',
        sourceCommand: 'crawl',
        contentType: 'markdown',
      });
    });

    it('should call autoEmbed with html when page has no markdown', async () => {
      const mockCrawlJob = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        total: 1,
        completed: 1,
        data: [
          {
            html: '<h1>Page HTML</h1>',
            metadata: {
              sourceURL: 'https://example.com/htmlpage',
              title: 'HTML Page',
            },
          },
        ],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      const container = createContainer(mockClient, { mockAutoEmbed });
      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      expect(mockAutoEmbed).toHaveBeenCalledTimes(1);
      expect(mockAutoEmbed).toHaveBeenCalledWith('<h1>Page HTML</h1>', {
        url: 'https://example.com/htmlpage',
        title: 'HTML Page',
        sourceCommand: 'crawl',
        contentType: 'html',
      });
    });

    it('should skip autoEmbed when embed is false', async () => {
      const mockCrawlJob = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        total: 1,
        completed: 1,
        data: [
          {
            markdown: '# Page 1',
            metadata: {
              sourceURL: 'https://example.com/page1',
              title: 'Page 1',
            },
          },
        ],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      const container = createContainer(mockClient);
      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
        embed: false,
      });

      expect(mockAutoEmbed).not.toHaveBeenCalled();
    });

    it('should skip autoEmbed for pages without markdown or html', async () => {
      const mockCrawlJob = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        total: 1,
        completed: 1,
        data: [
          {
            metadata: {
              sourceURL: 'https://example.com/empty',
              title: 'Empty Page',
            },
          },
        ],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      const container = createContainer(mockClient);
      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      expect(mockAutoEmbed).not.toHaveBeenCalled();
    });

    it('should queue embedding for async job start instead of blocking', async () => {
      const { enqueueEmbedJob } = await import('../../utils/embed-queue');
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'http://localhost:53002/v2/crawl/550e8400-e29b-41d4-a716-446655440000',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      const container = createContainer(mockClient);
      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
      });

      // Async jobs now queue for background processing, not inline embedding
      expect(mockAutoEmbed).not.toHaveBeenCalled();
      expect(enqueueEmbedJob).toHaveBeenCalledWith(
        mockResponse.id,
        'https://example.com',
        undefined
      );
    });

    it('should not embed when crawl fails after polling', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      // Mock getCrawlStatus to return failed status
      mockClient.getCrawlStatus.mockResolvedValue({
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'failed',
        total: 0,
        completed: 0,
      });

      const container = createContainer(mockClient);
      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
        embed: true,
        pollInterval: 0.01,
      });

      expect(mockAutoEmbed).not.toHaveBeenCalled();
    });

    it('should skip embedding when embed is explicitly false for async job', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      const container = createContainer(mockClient);
      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
        embed: false,
      });

      // Should NOT call getCrawlStatus since embed is disabled
      expect(mockClient.getCrawlStatus).not.toHaveBeenCalled();
      expect(mockAutoEmbed).not.toHaveBeenCalled();
    });

    it('should use metadata.url as fallback when sourceURL is missing', async () => {
      const mockCrawlJob = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        total: 1,
        completed: 1,
        data: [
          {
            markdown: '# Fallback URL',
            metadata: {
              url: 'https://example.com/fallback',
              title: 'Fallback',
            },
          },
        ],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      const container = createContainer(mockClient, { mockAutoEmbed });
      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      expect(mockAutoEmbed).toHaveBeenCalledTimes(1);
      expect(mockAutoEmbed).toHaveBeenCalledWith('# Fallback URL', {
        url: 'https://example.com/fallback',
        title: 'Fallback',
        sourceCommand: 'crawl',
        contentType: 'markdown',
      });
    });

    it('should handle crawl result with multiple pages', async () => {
      const mockCrawlJob = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        total: 2,
        completed: 2,
        data: [
          {
            markdown: '# Page 1',
            metadata: {
              sourceURL: 'https://example.com/page1',
              title: 'Page 1',
            },
          },
          {
            markdown: '# Page 2',
            metadata: {
              sourceURL: 'https://example.com/page2',
              title: 'Page 2',
            },
          },
        ],
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      const container = createContainer(mockClient, { mockAutoEmbed });
      await handleCrawlCommand(container, {
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      // autoEmbed is called for each page via batchEmbed
      expect(mockAutoEmbed).toHaveBeenCalledTimes(2);
      expect(mockAutoEmbed).toHaveBeenNthCalledWith(1, '# Page 1', {
        url: 'https://example.com/page1',
        title: 'Page 1',
        sourceCommand: 'crawl',
        contentType: 'markdown',
      });
      expect(mockAutoEmbed).toHaveBeenNthCalledWith(2, '# Page 2', {
        url: 'https://example.com/page2',
        title: 'Page 2',
        sourceCommand: 'crawl',
        contentType: 'markdown',
      });
    });
  });
});

describe('executeCrawlCancel', () => {
  type CrawlCancelMock = MockFirecrawlClient &
    Required<Pick<MockFirecrawlClient, 'cancelCrawl'>>;

  let mockClient: CrawlCancelMock;

  beforeEach(() => {
    mockClient = { scrape: vi.fn(), cancelCrawl: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should cancel crawl and return status', async () => {
    const container = createContainer(mockClient);
    mockClient.cancelCrawl.mockResolvedValue(true);

    const result = await executeCrawlCancel(container, 'job-123');

    expect(mockClient.cancelCrawl).toHaveBeenCalledWith('job-123');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'cancelled' });
  });

  it('should return error when cancel fails', async () => {
    const container = createContainer(mockClient);
    mockClient.cancelCrawl.mockRejectedValue(new Error('Cancel failed'));

    const result = await executeCrawlCancel(container, 'job-123');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to cancel job job-123: Cancel failed');
  });
});

describe('executeCrawlErrors', () => {
  type CrawlErrorsMock = MockFirecrawlClient &
    Required<Pick<MockFirecrawlClient, 'getCrawlErrors'>>;

  let mockClient: CrawlErrorsMock;

  beforeEach(() => {
    mockClient = { scrape: vi.fn(), getCrawlErrors: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return crawl errors and robotsBlocked', async () => {
    const container = createContainer(mockClient);
    mockClient.getCrawlErrors.mockResolvedValue({
      errors: [
        {
          id: 'err-1',
          url: 'https://a.com',
          error: 'timeout',
          timestamp: '2024-01-01',
          code: 'TIMEOUT',
        },
      ],
      robotsBlocked: ['https://b.com/robots'],
    });

    const result = await executeCrawlErrors(container, 'job-123');

    expect(mockClient.getCrawlErrors).toHaveBeenCalledWith('job-123');
    expect(result.success).toBe(true);
    expect(result.data?.errors.length).toBe(1);
    expect(result.data?.robotsBlocked.length).toBe(1);
  });
});

describe('createCrawlCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {});

  describe('status subcommand', () => {
    it('should exist as a subcommand', () => {
      const cmd = createCrawlCommand();
      const statusCmd = cmd.commands.find((c) => c.name() === 'status');
      expect(statusCmd).toBeDefined();
    });

    it('should require job-id argument', async () => {
      const cmd = createCrawlCommand();
      const statusCmd = cmd.commands.find((c) => c.name() === 'status');
      expect(statusCmd).toBeDefined();

      statusCmd?.exitOverride();
      await expect(
        statusCmd?.parseAsync(['node', 'test'], { from: 'node' })
      ).rejects.toThrow();
    });

    it('should call checkCrawlStatus and format output', async () => {
      const mockClient: Partial<MockFirecrawlClient> = {
        getCrawlStatus: vi.fn().mockResolvedValue({
          id: 'job-123',
          status: 'completed',
          total: 100,
          completed: 100,
          creditsUsed: 50,
          expiresAt: '2026-02-15T00:00:00Z',
        }),
      };
      const container = createContainer(mockClient);

      const cmd = createCrawlCommand();
      cmd._container = container;

      await cmd.parseAsync(['node', 'test', 'status', 'job-123'], {
        from: 'node',
      });

      expect(mockClient.getCrawlStatus).toHaveBeenCalledWith('job-123', {
        autoPaginate: false,
      });
      expect(writeOutput).toHaveBeenCalled();
    });

    it('should format output correctly', async () => {
      const mockClient: Partial<MockFirecrawlClient> = {
        getCrawlStatus: vi.fn().mockResolvedValue({
          id: 'job-123',
          status: 'completed',
          total: 100,
          completed: 100,
        }),
      };
      const container = createContainer(mockClient);

      const cmd = createCrawlCommand();
      cmd._container = container;

      await cmd.parseAsync(['node', 'test', 'status', 'job-123'], {
        from: 'node',
      });

      expect(writeOutput).toHaveBeenCalledWith(
        expect.stringContaining('Job ID: job-123'),
        undefined,
        false
      );
    });
  });

  describe('cancel subcommand', () => {
    it('should exist as a subcommand', () => {
      const cmd = createCrawlCommand();
      const cancelCmd = cmd.commands.find((c) => c.name() === 'cancel');
      expect(cancelCmd).toBeDefined();
    });

    it('should call executeCrawlCancel with job-id', async () => {
      const mockClient: Partial<MockFirecrawlClient> = {
        cancelCrawl: vi.fn().mockResolvedValue(true),
      };
      const container = createContainer(mockClient);

      const cmd = createCrawlCommand();
      cmd._container = container;

      await cmd.parseAsync(['node', 'test', 'cancel', 'job-456'], {
        from: 'node',
      });

      expect(mockClient.cancelCrawl).toHaveBeenCalledWith('job-456');
      expect(writeOutput).toHaveBeenCalled();
    });

    it('should handle failure gracefully', async () => {
      const mockClient: Partial<MockFirecrawlClient> = {
        cancelCrawl: vi.fn().mockRejectedValue(new Error('Cancel failed')),
      };
      const container = createContainer(mockClient);
      process.exitCode = 0; // Reset exit code before test

      const cmd = createCrawlCommand();
      cmd._container = container;

      await cmd.parseAsync(['node', 'test', 'cancel', 'job-456'], {
        from: 'node',
      });

      expect(process.exitCode).toBe(1);
      process.exitCode = 0; // Clean up after test
    });
  });

  describe('errors subcommand', () => {
    it('should exist as a subcommand', () => {
      const cmd = createCrawlCommand();
      const errorsCmd = cmd.commands.find((c) => c.name() === 'errors');
      expect(errorsCmd).toBeDefined();
    });

    it('should call executeCrawlErrors with job-id', async () => {
      const mockClient: Partial<MockFirecrawlClient> = {
        getCrawlErrors: vi.fn().mockResolvedValue({
          errors: [],
          robotsBlocked: [],
        }),
      };
      const container = createContainer(mockClient);

      const cmd = createCrawlCommand();
      cmd._container = container;

      await cmd.parseAsync(['node', 'test', 'errors', 'job-789'], {
        from: 'node',
      });

      expect(mockClient.getCrawlErrors).toHaveBeenCalledWith('job-789');
      expect(writeOutput).toHaveBeenCalled();
    });
  });

  it('should reject job ID on primary crawl action', async () => {
    const jobId = '550e8400-e29b-41d4-a716-446655440000';
    const mockClient: Partial<MockFirecrawlClient> = {
      scrape: vi.fn(),
      getCrawlStatus: vi.fn(),
    };
    const container = createContainer(mockClient);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = 0; // Reset exit code before test

    const cmd = createCrawlCommand();
    cmd._container = container;

    await cmd.parseAsync(['node', 'test', jobId], {
      from: 'node',
    });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Job IDs are not accepted here. Use "firecrawl crawl status <job-id>" instead.'
      )
    );
    expect(process.exitCode).toBe(1);
    expect(mockClient.getCrawlStatus).not.toHaveBeenCalled();

    process.exitCode = 0; // Clean up after test
    errorSpy.mockRestore();
  });

  it('should preserve raw job ID for manual embedding action', async () => {
    const jobId = '550e8400-e29b-41d4-a716-446655440000';
    const mockClient: Partial<MockFirecrawlClient> = {
      scrape: vi.fn(),
      getCrawlStatus: vi.fn().mockResolvedValue({
        id: jobId,
        status: 'completed',
        total: 1,
        completed: 1,
        data: [],
      }),
    };
    const container = createContainer(mockClient);

    const cmd = createCrawlCommand();
    cmd._container = container;

    await cmd.parseAsync(['node', 'test', jobId, '--embed'], {
      from: 'node',
    });

    expect(mockClient.getCrawlStatus).toHaveBeenCalledWith(jobId, {
      autoPaginate: false,
    });
  });
});
