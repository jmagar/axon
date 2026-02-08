/**
 * Tests for scrape command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createScrapeCommand,
  executeScrape,
  handleScrapeCommand,
} from '../../commands/scrape';
import type { IContainer, IQdrantService } from '../../container/types';
import type { MockFirecrawlClient } from '../utils/mock-client';
import { createTestContainer } from '../utils/test-container';

// Mock the output module to prevent console output in tests
vi.mock('../../utils/output', () => ({
  handleScrapeOutput: vi.fn(),
}));

describe('executeScrape', () => {
  let mockClient: MockFirecrawlClient;
  let mockContainer: IContainer;

  beforeEach(() => {
    // Create mock client
    mockClient = {
      scrape: vi.fn(),
    };

    // Create mock container
    mockContainer = {
      config: {
        apiKey: 'test-api-key',
        apiUrl: 'https://api.firecrawl.dev',
        teiUrl: 'http://localhost:8080',
        qdrantUrl: 'http://localhost:6333',
        qdrantCollection: 'test_collection',
      },
      getFirecrawlClient: vi.fn().mockReturnValue(mockClient),
      getEmbedPipeline: vi.fn().mockReturnValue({
        autoEmbed: vi.fn().mockResolvedValue(undefined),
      }),
      getTeiService: vi.fn(),
      getQdrantService: vi.fn(),
      getHttpClient: vi.fn(),
    } as unknown as IContainer;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('API call generation', () => {
    it('should call scrape with correct URL and default markdown format', async () => {
      const mockResponse = { markdown: '# Test Content' };
      mockClient.scrape.mockResolvedValue(mockResponse);

      await executeScrape(mockContainer, {
        url: 'https://example.com',
      });

      expect(mockClient.scrape).toHaveBeenCalledTimes(1);
      expect(mockClient.scrape).toHaveBeenCalledWith('https://example.com', {
        formats: ['markdown'],
      });
    });

    it('should call scrape with specified format', async () => {
      const mockResponse = { html: '<html>...</html>' };
      mockClient.scrape.mockResolvedValue(mockResponse);

      await executeScrape(mockContainer, {
        url: 'https://example.com',
        formats: ['html'],
      });

      expect(mockClient.scrape).toHaveBeenCalledWith('https://example.com', {
        formats: ['html'],
      });
    });

    it('should include screenshot format when screenshot option is true', async () => {
      const mockResponse = {
        markdown: '# Test',
        screenshot: 'base64image...',
      };
      mockClient.scrape.mockResolvedValue(mockResponse);

      await executeScrape(mockContainer, {
        url: 'https://example.com',
        screenshot: true,
      });

      expect(mockClient.scrape).toHaveBeenCalledWith('https://example.com', {
        formats: ['screenshot'],
      });
    });

    it('should include screenshot format alongside other formats', async () => {
      const mockResponse = {
        markdown: '# Test',
        screenshot: 'base64image...',
      };
      mockClient.scrape.mockResolvedValue(mockResponse);

      await executeScrape(mockContainer, {
        url: 'https://example.com',
        formats: ['markdown'],
        screenshot: true,
      });

      expect(mockClient.scrape).toHaveBeenCalledWith('https://example.com', {
        formats: ['markdown', 'screenshot'],
      });
    });

    it('should include onlyMainContent parameter when provided', async () => {
      const mockResponse = { markdown: '# Test' };
      mockClient.scrape.mockResolvedValue(mockResponse);

      await executeScrape(mockContainer, {
        url: 'https://example.com',
        onlyMainContent: true,
      });

      expect(mockClient.scrape).toHaveBeenCalledWith('https://example.com', {
        formats: ['markdown'],
        onlyMainContent: true,
      });
    });

    it('should include waitFor parameter when provided', async () => {
      const mockResponse = { markdown: '# Test' };
      mockClient.scrape.mockResolvedValue(mockResponse);

      await executeScrape(mockContainer, {
        url: 'https://example.com',
        waitFor: 2000,
      });

      expect(mockClient.scrape).toHaveBeenCalledWith('https://example.com', {
        formats: ['markdown'],
        waitFor: 2000,
      });
    });

    it('should include includeTags parameter when provided', async () => {
      const mockResponse = { markdown: '# Test' };
      mockClient.scrape.mockResolvedValue(mockResponse);

      await executeScrape(mockContainer, {
        url: 'https://example.com',
        includeTags: ['article', 'main'],
      });

      expect(mockClient.scrape).toHaveBeenCalledWith('https://example.com', {
        formats: ['markdown'],
        includeTags: ['article', 'main'],
      });
    });

    it('should include excludeTags parameter when provided', async () => {
      const mockResponse = { markdown: '# Test' };
      mockClient.scrape.mockResolvedValue(mockResponse);

      await executeScrape(mockContainer, {
        url: 'https://example.com',
        excludeTags: ['nav', 'footer'],
      });

      expect(mockClient.scrape).toHaveBeenCalledWith('https://example.com', {
        formats: ['markdown'],
        excludeTags: ['nav', 'footer'],
      });
    });

    it('should combine all parameters correctly', async () => {
      const mockResponse = { markdown: '# Test', screenshot: 'base64...' };
      mockClient.scrape.mockResolvedValue(mockResponse);

      await executeScrape(mockContainer, {
        url: 'https://example.com',
        formats: ['markdown'],
        screenshot: true,
        onlyMainContent: true,
        waitFor: 3000,
        includeTags: ['article'],
        excludeTags: ['nav'],
      });

      expect(mockClient.scrape).toHaveBeenCalledWith('https://example.com', {
        formats: ['markdown', 'screenshot'],
        onlyMainContent: true,
        waitFor: 3000,
        includeTags: ['article'],
        excludeTags: ['nav'],
      });
    });
  });

  describe('Response handling', () => {
    it('should return success result with data when scrape succeeds', async () => {
      const mockResponse = {
        markdown: '# Test Content',
        url: 'https://example.com',
      };
      mockClient.scrape.mockResolvedValue(mockResponse);

      const result = await executeScrape(mockContainer, {
        url: 'https://example.com',
      });

      expect(result).toEqual({
        success: true,
        data: mockResponse,
      });
    });

    it('should handle complex response data', async () => {
      const mockResponse = {
        markdown: '# Test',
        html: '<html>...</html>',
        screenshot: 'base64image...',
        metadata: {
          title: 'Test Page',
          description: 'Test description',
        },
      };
      mockClient.scrape.mockResolvedValue(mockResponse);

      const result = await executeScrape(mockContainer, {
        url: 'https://example.com',
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse);
    });

    it('should return error result when scrape fails', async () => {
      const errorMessage = 'API Error: Invalid URL';
      mockClient.scrape.mockRejectedValue(new Error(errorMessage));

      const result = await executeScrape(mockContainer, {
        url: 'https://example.com',
      });

      expect(result).toEqual({
        success: false,
        error: errorMessage,
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockClient.scrape.mockRejectedValue('String error');

      const result = await executeScrape(mockContainer, {
        url: 'https://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error occurred');
    });
  });

  describe('Type safety', () => {
    it('should accept valid ScrapeFormat types', async () => {
      const formatList: Array<'markdown' | 'html' | 'rawHtml' | 'links'> = [
        'markdown',
        'html',
        'rawHtml',
        'links',
      ];

      for (const format of formatList) {
        mockClient.scrape.mockResolvedValue({ [format]: 'test' });
        const result = await executeScrape(mockContainer, {
          url: 'https://example.com',
          formats: [format],
        });
        expect(result.success).toBe(true);
      }
    });

    it('should accept multiple formats', async () => {
      mockClient.scrape.mockResolvedValue({
        markdown: '# Test',
        links: ['http://a.com'],
        images: ['http://img.com/a.png'],
      });

      const result = await executeScrape(mockContainer, {
        url: 'https://example.com',
        formats: ['markdown', 'links', 'images'],
      });

      expect(result.success).toBe(true);
      expect(mockClient.scrape).toHaveBeenCalledWith('https://example.com', {
        formats: ['markdown', 'links', 'images'],
      });
    });
  });
});

describe('createScrapeCommand', () => {
  it('should default timeout to 15 seconds when not provided', async () => {
    const cmd = createScrapeCommand();
    const actionSpy = vi.fn();
    cmd.action(actionSpy);

    await cmd.parseAsync(['node', 'test', 'https://example.com'], {
      from: 'node',
    });

    const [url, formats, options] = actionSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://example.com');
    expect(formats).toEqual([]);
    expect(options).toEqual(expect.objectContaining({ timeout: 15 }));
  });
});

describe('handleScrapeCommand auto-embed', () => {
  let mockClient: MockFirecrawlClient;
  let mockContainer: IContainer;
  let mockAutoEmbed: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockClient = {
      scrape: vi.fn(),
    };

    mockAutoEmbed = vi.fn().mockResolvedValue(undefined);

    mockContainer = {
      config: {
        apiKey: 'test-api-key',
        apiUrl: 'https://api.firecrawl.dev',
        teiUrl: 'http://localhost:8080',
        qdrantUrl: 'http://localhost:6333',
        qdrantCollection: 'test_collection',
      },
      getFirecrawlClient: vi.fn().mockReturnValue(mockClient),
      getEmbedPipeline: vi.fn().mockReturnValue({
        autoEmbed: mockAutoEmbed,
      }),
      getTeiService: vi.fn(),
      getQdrantService: vi.fn(),
      getHttpClient: vi.fn(),
    } as unknown as IContainer;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call autoEmbed when embed is not false and scrape succeeds', async () => {
    const mockResponse = {
      markdown: '# Test Content',
      metadata: { title: 'Test Page' },
    };
    mockClient.scrape.mockResolvedValue(mockResponse);

    await handleScrapeCommand(mockContainer, {
      url: 'https://example.com',
      formats: ['markdown'],
    });

    expect(mockAutoEmbed).toHaveBeenCalledTimes(1);
    expect(mockAutoEmbed).toHaveBeenCalledWith('# Test Content', {
      url: 'https://example.com',
      title: 'Test Page',
      sourceCommand: 'scrape',
      contentType: 'markdown',
    });
  });

  it('should skip autoEmbed when embed is false', async () => {
    const mockResponse = {
      markdown: '# Test Content',
      metadata: { title: 'Test Page' },
    };
    mockClient.scrape.mockResolvedValue(mockResponse);

    await handleScrapeCommand(mockContainer, {
      url: 'https://example.com',
      formats: ['markdown'],
      embed: false,
    });

    expect(mockAutoEmbed).not.toHaveBeenCalled();
  });

  it('should skip autoEmbed when scrape fails', async () => {
    mockClient.scrape.mockRejectedValue(new Error('Scrape failed'));

    await handleScrapeCommand(mockContainer, {
      url: 'https://example.com',
      formats: ['markdown'],
    });

    expect(mockAutoEmbed).not.toHaveBeenCalled();
  });

  it('should call autoEmbed when embed is undefined (default on)', async () => {
    const mockResponse = {
      markdown: '# Default embed',
      metadata: { title: 'Default' },
    };
    mockClient.scrape.mockResolvedValue(mockResponse);

    await handleScrapeCommand(mockContainer, {
      url: 'https://example.com',
    });

    expect(mockAutoEmbed).toHaveBeenCalledTimes(1);
  });

  it('should use html content when markdown is not available', async () => {
    const mockResponse = {
      html: '<h1>HTML Content</h1>',
      metadata: { title: 'HTML Page' },
    };
    mockClient.scrape.mockResolvedValue(mockResponse);

    await handleScrapeCommand(mockContainer, {
      url: 'https://example.com',
      formats: ['html'],
    });

    expect(mockAutoEmbed).toHaveBeenCalledWith('<h1>HTML Content</h1>', {
      url: 'https://example.com',
      title: 'HTML Page',
      sourceCommand: 'scrape',
      contentType: 'html',
    });
  });

  it('should use rawHtml as fallback content', async () => {
    const mockResponse = {
      rawHtml: '<html><body>Raw</body></html>',
      metadata: {},
    };
    mockClient.scrape.mockResolvedValue(mockResponse);

    await handleScrapeCommand(mockContainer, {
      url: 'https://example.com',
      formats: ['rawHtml'],
    });

    expect(mockAutoEmbed).toHaveBeenCalledWith(
      '<html><body>Raw</body></html>',
      expect.objectContaining({
        url: 'https://example.com',
        sourceCommand: 'scrape',
      })
    );
  });
});

describe('executeScrape --remove', () => {
  let container: IContainer;
  let mockQdrantService: IQdrantService;

  beforeEach(() => {
    mockQdrantService = {
      ensureCollection: vi.fn().mockResolvedValue(undefined),
      deleteByUrl: vi.fn().mockResolvedValue(undefined),
      deleteByDomain: vi.fn().mockResolvedValue(undefined),
      countByDomain: vi.fn().mockResolvedValue(42),
      upsertPoints: vi.fn().mockResolvedValue(undefined),
      queryPoints: vi.fn().mockResolvedValue([]),
      scrollByUrl: vi.fn().mockResolvedValue([]),
      getCollectionInfo: vi.fn().mockResolvedValue({
        status: 'green',
        vectorsCount: 0,
        pointsCount: 0,
        segmentsCount: 1,
        config: { dimension: 1024, distance: 'Cosine' },
      }),
      scrollAll: vi.fn().mockResolvedValue([]),
      countPoints: vi.fn().mockResolvedValue(0),
      countByUrl: vi.fn().mockResolvedValue(0),
      deleteAll: vi.fn().mockResolvedValue(undefined),
    };

    container = createTestContainer(undefined, {
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });
    vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should delete by domain when --remove is set', async () => {
    const result = await executeScrape(container, {
      url: 'https://docs.firecrawl.dev/some/path',
      remove: true,
    });

    expect(mockQdrantService.countByDomain).toHaveBeenCalledWith(
      'test_col',
      'docs.firecrawl.dev'
    );
    expect(mockQdrantService.deleteByDomain).toHaveBeenCalledWith(
      'test_col',
      'docs.firecrawl.dev'
    );
    expect(result.success).toBe(true);
    expect(result.removed).toBe(42);
  });

  it('should not call Firecrawl API when --remove is set', async () => {
    const mockClient = { scrape: vi.fn() };
    container = createTestContainer(mockClient, {
      qdrantUrl: 'http://localhost:53333',
    });
    vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService);

    await executeScrape(container, {
      url: 'https://example.com',
      remove: true,
    });

    expect(mockClient.scrape).not.toHaveBeenCalled();
  });

  it('should fail when QDRANT_URL not configured', async () => {
    container = createTestContainer(undefined, { qdrantUrl: undefined });

    const result = await executeScrape(container, {
      url: 'https://example.com',
      remove: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('QDRANT_URL');
  });

  it('should report 0 when no documents found', async () => {
    mockQdrantService.countByDomain = vi.fn().mockResolvedValue(0);

    const result = await executeScrape(container, {
      url: 'https://example.com',
      remove: true,
    });

    expect(result.success).toBe(true);
    expect(result.removed).toBe(0);
  });

  it('should extract domain from URL correctly', async () => {
    await executeScrape(container, {
      url: 'https://api.example.com/v1/endpoint?query=test',
      remove: true,
    });

    expect(mockQdrantService.countByDomain).toHaveBeenCalledWith(
      'test_col',
      'api.example.com'
    );
    expect(mockQdrantService.deleteByDomain).toHaveBeenCalledWith(
      'test_col',
      'api.example.com'
    );
  });

  it('should fail gracefully for malformed URL', async () => {
    const result = await executeScrape(container, {
      url: 'not-a-valid-url',
      remove: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid URL');
    expect(mockQdrantService.deleteByDomain).not.toHaveBeenCalled();
  });
});
