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
import { getClient } from '../../utils/client';
import { initializeConfig } from '../../utils/config';
import { writeOutput } from '../../utils/output';
import {
  type MockFirecrawlClient,
  setupTest,
  teardownTest,
} from '../utils/mock-client';

// autoEmbed is mocked below via mockAutoEmbed

// Mock the Firecrawl client module
vi.mock('../../utils/client', async () => {
  const actual = await vi.importActual('../../utils/client');
  return {
    ...actual,
    getClient: vi.fn(),
  };
});

// Mock embedpipeline - mock autoEmbed and provide implementations for batch functions
// Use vi.hoisted to ensure mockAutoEmbed is defined before vi.mock runs (vi.mock is hoisted)
const { mockAutoEmbed } = vi.hoisted(() => ({
  mockAutoEmbed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/embedpipeline', () => ({
  autoEmbed: mockAutoEmbed,
  // Re-implement batchEmbed to call the mockAutoEmbed
  batchEmbed: vi.fn().mockImplementation(
    async (
      items: Array<{
        content: string;
        metadata: {
          url: string;
          title?: string;
          sourceCommand: string;
          contentType?: string;
        };
      }>
    ) => {
      for (const item of items) {
        await mockAutoEmbed(item.content, item.metadata);
      }
    }
  ),
  // Re-implement createEmbedItems to match real behavior
  createEmbedItems: vi.fn().mockImplementation(
    (
      pages: Array<{
        markdown?: string;
        html?: string;
        url?: string;
        title?: string;
        metadata?: { sourceURL?: string; url?: string; title?: string };
      }>,
      sourceCommand: string
    ) => {
      return pages
        .filter((page) => page.markdown || page.html)
        .map((page) => ({
          content: page.markdown || page.html || '',
          metadata: {
            url:
              page.url || page.metadata?.sourceURL || page.metadata?.url || '',
            title: page.title || page.metadata?.title,
            sourceCommand,
            contentType: page.markdown ? 'markdown' : 'html',
          },
        }));
    }
  ),
}));

// Mock settings to avoid reading real user settings from disk
vi.mock('../../utils/settings', () => ({
  loadSettings: vi.fn().mockReturnValue({}),
}));

vi.mock('../../utils/embed-queue', () => ({
  enqueueEmbedJob: vi.fn().mockReturnValue({
    id: 'mock-job',
    jobId: 'mock-job',
    url: 'https://example.com',
    status: 'pending',
    retries: 0,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  getEmbedJob: vi.fn().mockReturnValue(null),
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
    setupTest();
    // Initialize config with test API key
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    // Create mock client
    mockClient = {
      scrape: vi.fn(),
      startCrawl: vi.fn(),
      getCrawlStatus: vi.fn(),
      crawl: vi.fn(),
    };

    // Mock getClient to return our mock
    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );
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

    it('should include webhook config when embedder webhook URL is set', async () => {
      const originalUrl = process.env.FIRECRAWL_EMBEDDER_WEBHOOK_URL;
      const originalSecret = process.env.FIRECRAWL_EMBEDDER_WEBHOOK_SECRET;
      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_URL =
        'https://example.com/embedder';
      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_SECRET = 'test-secret';
      initializeConfig();

      const mockResponse = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        url: 'https://example.com',
      };
      mockClient.startCrawl.mockResolvedValue(mockResponse);

      await executeCrawl({
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

      if (originalUrl === undefined) {
        delete process.env.FIRECRAWL_EMBEDDER_WEBHOOK_URL;
      } else {
        process.env.FIRECRAWL_EMBEDDER_WEBHOOK_URL = originalUrl;
      }
      if (originalSecret === undefined) {
        delete process.env.FIRECRAWL_EMBEDDER_WEBHOOK_SECRET;
      } else {
        process.env.FIRECRAWL_EMBEDDER_WEBHOOK_SECRET = originalSecret;
      }
      initializeConfig();
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
      mockClient.getCrawlStatus.mockResolvedValueOnce(mockCompletedStatus);

      // Start with progress but without explicit wait
      const crawlPromise = executeCrawl({
        urlOrJobId: 'https://example.com',
        progress: true,
        pollInterval: 0.001, // Very short interval for testing (1ms)
      });

      // Fast-forward timers to resolve the setTimeout
      await vi.advanceTimersByTimeAsync(1);

      const result = await crawlPromise;

      // Should use wait mode because progress implies wait
      expect(mockClient.startCrawl).toHaveBeenCalledTimes(1);
      expect(mockClient.getCrawlStatus).toHaveBeenCalledTimes(1);
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

      const result = await executeCrawl({
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

      const result = await executeCrawl({
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

      const result = await executeCrawl({
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

      const result = await executeCrawl({
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

      await handleCrawlCommand({
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

      await handleCrawlCommand({
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

      await handleCrawlCommand({
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

      await handleCrawlCommand({
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

      await handleCrawlCommand({
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

      await handleCrawlCommand({
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

      await handleCrawlCommand({
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

      await handleCrawlCommand({
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

      await handleCrawlCommand({
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
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    mockClient = { scrape: vi.fn(), cancelCrawl: vi.fn() };
    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  it('should cancel crawl and return status', async () => {
    mockClient.cancelCrawl.mockResolvedValue(true);

    const result = await executeCrawlCancel('job-123');

    expect(mockClient.cancelCrawl).toHaveBeenCalledWith('job-123');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'cancelled' });
  });

  it('should return error when cancel fails', async () => {
    mockClient.cancelCrawl.mockRejectedValue(new Error('Cancel failed'));

    const result = await executeCrawlCancel('job-123');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to cancel job job-123: Cancel failed');
  });
});

describe('handleCrawlCommand cancel mode', () => {
  it('should write cancel output and exit without crawling', async () => {
    const mockClient = {
      scrape: vi.fn(),
      cancelCrawl: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );

    await handleCrawlCommand({ urlOrJobId: 'job-123', cancel: true });

    expect(mockClient.cancelCrawl).toHaveBeenCalledWith('job-123');
    expect(writeOutput).toHaveBeenCalled();
  });
});

describe('executeCrawlErrors', () => {
  type CrawlErrorsMock = MockFirecrawlClient &
    Required<Pick<MockFirecrawlClient, 'getCrawlErrors'>>;

  let mockClient: CrawlErrorsMock;

  beforeEach(() => {
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    mockClient = { scrape: vi.fn(), getCrawlErrors: vi.fn() };
    vi.mocked(getClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getClient>
    );
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  it('should return crawl errors and robotsBlocked', async () => {
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

    const result = await executeCrawlErrors('job-123');

    expect(mockClient.getCrawlErrors).toHaveBeenCalledWith('job-123');
    expect(result.success).toBe(true);
    expect(result.data?.errors.length).toBe(1);
    expect(result.data?.robotsBlocked.length).toBe(1);
  });
});

describe('createCrawlCommand', () => {
  it('should not normalize job id for --cancel', async () => {
    const cancelClient = {
      cancelCrawl: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(getClient).mockReturnValue(
      cancelClient as unknown as ReturnType<typeof getClient>
    );
    const cmd = createCrawlCommand();
    cmd.exitOverride();

    const jobId = '550e8400-e29b-41d4-a716-446655440000';
    await cmd.parseAsync(['node', 'test', jobId, '--cancel'], {
      from: 'node',
    });

    expect(cancelClient.cancelCrawl).toHaveBeenCalledWith(jobId);
  });

  it('should not normalize job id for --errors', async () => {
    const errorsClient = {
      getCrawlErrors: vi.fn().mockResolvedValue({
        errors: [],
        robotsBlocked: [],
      }),
    };
    vi.mocked(getClient).mockReturnValue(
      errorsClient as unknown as ReturnType<typeof getClient>
    );
    const cmd = createCrawlCommand();
    cmd.exitOverride();

    const jobId = '550e8400-e29b-41d4-a716-446655440000';
    await cmd.parseAsync(['node', 'test', jobId, '--errors'], {
      from: 'node',
    });

    expect(errorsClient.getCrawlErrors).toHaveBeenCalledWith(jobId);
  });

  it('should require job id for --cancel', async () => {
    const cmd = createCrawlCommand();
    cmd.exitOverride();

    await expect(
      cmd.parseAsync(['node', 'test', 'https://example.com', '--cancel'], {
        from: 'node',
      })
    ).rejects.toThrow();
  });

  it('should require job id for --errors', async () => {
    const cmd = createCrawlCommand();
    cmd.exitOverride();

    await expect(
      cmd.parseAsync(['node', 'test', 'https://example.com', '--errors'], {
        from: 'node',
      })
    ).rejects.toThrow();
  });

  it('should default scrapeTimeout to 15 seconds when not provided', async () => {
    const cmd = createCrawlCommand();
    const actionSpy = vi.fn();
    cmd.action(actionSpy);

    await cmd.parseAsync(['node', 'test', 'https://example.com'], {
      from: 'node',
    });

    const [urlOrJobId, options] = actionSpy.mock.calls[0] ?? [];
    expect(urlOrJobId).toBe('https://example.com');
    expect(options).toEqual(expect.objectContaining({ scrapeTimeout: 15 }));
  });
});
