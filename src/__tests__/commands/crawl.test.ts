/**
 * Tests for crawl command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeCrawl, handleCrawlCommand } from '../../commands/crawl';
import { getClient } from '../../utils/client';
import { initializeConfig } from '../../utils/config';
import { setupTest, teardownTest } from '../utils/mock-client';
import { autoEmbed } from '../../utils/embedpipeline';

// Mock the Firecrawl client module
vi.mock('../../utils/client', async () => {
  const actual = await vi.importActual('../../utils/client');
  return {
    ...actual,
    getClient: vi.fn(),
  };
});

// Mock autoEmbed
vi.mock('../../utils/embedpipeline', () => ({
  autoEmbed: vi.fn().mockResolvedValue(undefined),
}));

// Mock writeOutput
vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeCrawl', () => {
  let mockClient: any;

  beforeEach(() => {
    setupTest();
    // Initialize config with test API key
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    // Create mock client
    mockClient = {
      startCrawl: vi.fn(),
      getCrawlStatus: vi.fn(),
      crawl: vi.fn(),
    };

    // Mock getClient to return our mock
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  describe('Start crawl (async)', () => {
    it('should call startCrawl with correct URL and return job ID', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      const result = await executeCrawl({
        urlOrJobId: 'https://example.com',
      });

      expect(mockClient.startCrawl).toHaveBeenCalledTimes(1);
      expect(mockClient.startCrawl).toHaveBeenCalledWith(
        'https://example.com',
        {}
      );
      expect(result).toEqual({
        success: true,
        data: {
          jobId: mockResponse.id,
          url: mockResponse.url,
          status: 'processing',
        },
      });
    });

    it('should include limit option when provided', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      await executeCrawl({
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

      await executeCrawl({
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

      await executeCrawl({
        urlOrJobId: 'https://example.com',
        excludePaths: ['/admin', '/private'],
      });

      expect(mockClient.startCrawl).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          excludePaths: ['/admin', '/private'],
        })
      );
    });

    it('should include includePaths option when provided', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      await executeCrawl({
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

      await executeCrawl({
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

      await executeCrawl({
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

      expect(mockClient.startCrawl).toHaveBeenCalledWith(
        'https://example.com',
        {
          limit: 50,
          maxDiscoveryDepth: 2,
          excludePaths: ['/admin'],
          includePaths: ['/blog'],
          sitemap: 'include',
          ignoreQueryParameters: true,
          crawlEntireDomain: false,
          allowExternalLinks: false,
          allowSubdomains: true,
          delay: 1000,
          maxConcurrency: 5,
        }
      );
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

      const result = await executeCrawl({
        urlOrJobId: '550e8400-e29b-41d4-a716-446655440000',
        status: true,
      });

      expect(mockClient.getCrawlStatus).toHaveBeenCalledTimes(1);
      expect(mockClient.getCrawlStatus).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000'
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

    it('should auto-detect job ID from UUID format', async () => {
      const mockStatus = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'scraping',
        total: 100,
        completed: 45,
      };
      mockClient.getCrawlStatus.mockResolvedValue(mockStatus);

      const result = await executeCrawl({
        urlOrJobId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(mockClient.getCrawlStatus).toHaveBeenCalledTimes(1);
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

      const result = await executeCrawl({
        urlOrJobId: '550e8400-e29b-41d4-a716-446655440000',
        status: true,
      });

      expect(result.success).toBe(true);
      if (result.success && 'data' in result) {
        expect(result.data?.creditsUsed).toBeUndefined();
        expect(result.data?.expiresAt).toBeUndefined();
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

      const result = await executeCrawl({
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

      await executeCrawl({
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

      await executeCrawl({
        urlOrJobId: 'https://example.com',
        wait: true,
        timeout: 300,
      });

      expect(mockClient.crawl).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          timeout: 300000, // Converted to milliseconds
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

      await executeCrawl({
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
          timeout: 600000,
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
      // First call returns scraping status, second returns completed
      mockClient.getCrawlStatus
        .mockResolvedValueOnce(mockScrapingStatus)
        .mockResolvedValueOnce(mockCompletedStatus);

      // Start the async operation
      const crawlPromise = executeCrawl({
        urlOrJobId: 'https://example.com',
        wait: true,
        progress: true,
        pollInterval: 0.001, // Very short interval for testing (1ms)
      });

      // Fast-forward timers to resolve the first setTimeout
      await vi.advanceTimersByTimeAsync(1);

      // Fast-forward again to resolve the second setTimeout
      await vi.advanceTimersByTimeAsync(1);

      const result = await crawlPromise;

      expect(mockClient.startCrawl).toHaveBeenCalledTimes(1);
      expect(mockClient.getCrawlStatus).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      if (result.success && 'data' in result) {
        expect(result.data.status).toBe('completed');
      }
    });
  });

  describe('Error handling', () => {
    it('should return error result when startCrawl fails', async () => {
      const errorMessage = 'API Error: Invalid URL';
      mockClient.startCrawl.mockRejectedValue(new Error(errorMessage));

      const result = await executeCrawl({
        urlOrJobId: 'https://example.com',
      });

      expect(result).toEqual({
        success: false,
        error: errorMessage,
      });
    });

    it('should return error result when getCrawlStatus fails', async () => {
      const errorMessage = 'Job not found';
      mockClient.getCrawlStatus.mockRejectedValue(new Error(errorMessage));

      const result = await executeCrawl({
        urlOrJobId: '550e8400-e29b-41d4-a716-446655440000',
        status: true,
      });

      expect(result).toEqual({
        success: false,
        error: errorMessage,
      });
    });

    it('should return error result when crawl fails', async () => {
      const errorMessage = 'Crawl timeout';
      mockClient.crawl.mockRejectedValue(new Error(errorMessage));

      const result = await executeCrawl({
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      expect(result).toEqual({
        success: false,
        error: errorMessage,
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockClient.startCrawl.mockRejectedValue('String error');

      const result = await executeCrawl({
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error occurred');
    });
  });

  describe('Auto-embed integration', () => {
    beforeEach(() => {
      // Suppress console.error output during tests
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(autoEmbed).mockClear();
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

      await handleCrawlCommand({
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      expect(autoEmbed).toHaveBeenCalledTimes(2);
      expect(autoEmbed).toHaveBeenCalledWith('# Page 1', {
        url: 'https://example.com/page1',
        title: 'Page 1',
        sourceCommand: 'crawl',
        contentType: 'markdown',
      });
      expect(autoEmbed).toHaveBeenCalledWith('# Page 2', {
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

      await handleCrawlCommand({
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      expect(autoEmbed).toHaveBeenCalledTimes(1);
      expect(autoEmbed).toHaveBeenCalledWith('<h1>Page HTML</h1>', {
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

      await handleCrawlCommand({
        urlOrJobId: 'https://example.com',
        wait: true,
        embed: false,
      });

      expect(autoEmbed).not.toHaveBeenCalled();
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

      await handleCrawlCommand({
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      expect(autoEmbed).not.toHaveBeenCalled();
    });

    it('should not embed for async job start (no completed data)', async () => {
      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      await handleCrawlCommand({
        urlOrJobId: 'https://example.com',
      });

      expect(autoEmbed).not.toHaveBeenCalled();
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

      await handleCrawlCommand({
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      expect(autoEmbed).toHaveBeenCalledTimes(1);
      expect(autoEmbed).toHaveBeenCalledWith('# Fallback URL', {
        url: 'https://example.com/fallback',
        title: 'Fallback',
        sourceCommand: 'crawl',
        contentType: 'markdown',
      });
    });

    it('should handle crawl result with nested data structure', async () => {
      const mockCrawlJob = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'completed',
        total: 1,
        completed: 1,
        data: {
          data: [
            {
              markdown: '# Nested Page',
              metadata: {
                sourceURL: 'https://example.com/nested',
                title: 'Nested',
              },
            },
          ],
        },
      };
      mockClient.crawl.mockResolvedValue(mockCrawlJob);

      await handleCrawlCommand({
        urlOrJobId: 'https://example.com',
        wait: true,
      });

      expect(autoEmbed).toHaveBeenCalledTimes(1);
      expect(autoEmbed).toHaveBeenCalledWith('# Nested Page', {
        url: 'https://example.com/nested',
        title: 'Nested',
        sourceCommand: 'crawl',
        contentType: 'markdown',
      });
    });
  });
});
