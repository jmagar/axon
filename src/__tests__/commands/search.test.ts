/**
 * Tests for search command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeSearch, handleSearchCommand } from '../../commands/search';
import type { IContainer } from '../../container/types';
import type { MockFirecrawlClient } from '../utils/mock-client';

type SearchMockClient = MockFirecrawlClient &
  Required<Pick<MockFirecrawlClient, 'search'>>;

// Mock autoEmbed to track calls
const mockAutoEmbed = vi.fn().mockResolvedValue(undefined);

// Mock the output module to prevent console output in tests
vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeSearch', () => {
  let mockClient: SearchMockClient;
  let mockContainer: IContainer;

  beforeEach(() => {
    // Create mock client
    mockClient = {
      scrape: vi.fn(),
      search: vi.fn(),
    };

    // Create mock container
    mockContainer = {
      config: {
        apiKey: 'test-api-key',
        apiUrl: 'https://api.firecrawl.dev',
        teiUrl: 'http://localhost:53001',
        qdrantUrl: 'http://localhost:53002',
        collectionName: 'firecrawl',
      },
      getFirecrawlClient: vi.fn().mockReturnValue(mockClient),
      getEmbedPipeline: vi.fn().mockReturnValue({
        autoEmbed: mockAutoEmbed,
      }),
      getHttpClient: vi.fn(),
      getTeiService: vi.fn(),
      getQdrantService: vi.fn(),
      dispose: vi.fn(),
    } as unknown as IContainer;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('API call generation', () => {
    it('should call search with correct query and default options', async () => {
      const mockResponse = {
        web: [
          { url: 'https://example.com', title: 'Example', description: 'Test' },
        ],
      };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'test query',
      });

      expect(mockClient.search).toHaveBeenCalledTimes(1);
      expect(mockClient.search).toHaveBeenCalledWith('test query', {
        limit: undefined,
      });
    });

    it('should include limit option when provided', async () => {
      const mockResponse = { web: [] };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'AI news',
        limit: 10,
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'AI news',
        expect.objectContaining({
          limit: 10,
        })
      );
    });

    it('should include sources option when provided', async () => {
      const mockResponse = { web: [], images: [], news: [] };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'test query',
        sources: ['web', 'images', 'news'],
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          sources: [{ type: 'web' }, { type: 'images' }, { type: 'news' }],
        })
      );
    });

    it('should include single source correctly', async () => {
      const mockResponse = { news: [] };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'tech news',
        sources: ['news'],
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'tech news',
        expect.objectContaining({
          sources: [{ type: 'news' }],
        })
      );
    });

    it('should include categories option when provided', async () => {
      const mockResponse = { web: [] };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'web scraping python',
        categories: ['github'],
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'web scraping python',
        expect.objectContaining({
          categories: [{ type: 'github' }],
        })
      );
    });

    it('should include multiple categories correctly', async () => {
      const mockResponse = { web: [] };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'transformer architecture',
        categories: ['research', 'pdf'],
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'transformer architecture',
        expect.objectContaining({
          categories: [{ type: 'research' }, { type: 'pdf' }],
        })
      );
    });

    it('should include tbs (time-based search) option when provided', async () => {
      const mockResponse = { web: [] };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'AI announcements',
        tbs: 'qdr:d', // Past day
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'AI announcements',
        expect.objectContaining({
          tbs: 'qdr:d',
        })
      );
    });

    it('should include location option when provided', async () => {
      const mockResponse = { web: [] };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'restaurants',
        location: 'San Francisco,California,United States',
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'restaurants',
        expect.objectContaining({
          location: 'San Francisco,California,United States',
        })
      );
    });

    it('should include country option when provided', async () => {
      const mockResponse = { web: [] };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'local news',
        country: 'DE',
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'local news',
        expect.objectContaining({
          country: 'DE',
        })
      );
    });

    it('should include timeout option when provided', async () => {
      const mockResponse = { web: [] };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'test query',
        timeout: 30000,
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          timeout: 30000,
        })
      );
    });

    it('should include ignoreInvalidUrls option when provided', async () => {
      const mockResponse = { web: [] };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'test query',
        ignoreInvalidUrls: true,
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          ignoreInvalidURLs: true,
        })
      );
    });

    it('should include scrape options when scrape is enabled', async () => {
      const mockResponse = {
        web: [{ url: 'https://example.com', markdown: '# Test' }],
      };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'firecrawl tutorials',
        scrape: true,
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'firecrawl tutorials',
        expect.objectContaining({
          scrapeOptions: {
            formats: [{ type: 'markdown' }],
          },
        })
      );
    });

    it('should include custom scrape formats when provided', async () => {
      const mockResponse = {
        web: [{ url: 'https://example.com', markdown: '# Test', links: [] }],
      };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'API docs',
        scrape: true,
        scrapeFormats: ['markdown', 'links'],
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'API docs',
        expect.objectContaining({
          scrapeOptions: {
            formats: [{ type: 'markdown' }, { type: 'links' }],
          },
        })
      );
    });

    it('should include onlyMainContent in scrape options when provided', async () => {
      const mockResponse = {
        web: [{ url: 'https://example.com', markdown: '# Test' }],
      };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'test query',
        scrape: true,
        onlyMainContent: true,
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          scrapeOptions: {
            formats: [{ type: 'markdown' }],
            onlyMainContent: true,
          },
        })
      );
    });

    it('should combine all options correctly', async () => {
      const mockResponse = {
        web: [{ url: 'https://example.com', markdown: '# Test' }],
        news: [{ url: 'https://news.example.com', title: 'News' }],
      };
      mockClient.search.mockResolvedValue(mockResponse);

      await executeSearch(mockContainer, {
        query: 'comprehensive test',
        limit: 20,
        sources: ['web', 'news'],
        categories: ['github'],
        tbs: 'qdr:w',
        location: 'Germany',
        country: 'DE',
        timeout: 60000,
        scrape: true,
        scrapeFormats: ['markdown', 'links'],
        onlyMainContent: true,
      });

      expect(mockClient.search).toHaveBeenCalledWith('comprehensive test', {
        limit: 20,
        sources: [{ type: 'web' }, { type: 'news' }],
        categories: [{ type: 'github' }],
        tbs: 'qdr:w',
        location: 'Germany',
        country: 'DE',
        timeout: 60000,
        scrapeOptions: {
          formats: [{ type: 'markdown' }, { type: 'links' }],
          onlyMainContent: true,
        },
      });
    });
  });

  describe('Response handling', () => {
    it('should return success result with web results', async () => {
      const mockResponse = {
        web: [
          {
            url: 'https://example.com',
            title: 'Example',
            description: 'Test description',
          },
          {
            url: 'https://example2.com',
            title: 'Example 2',
            description: 'Another test',
          },
        ],
      };
      mockClient.search.mockResolvedValue(mockResponse);

      const result = await executeSearch(mockContainer, {
        query: 'test query',
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        web: mockResponse.web,
      });
    });

    it('should return success result with image results', async () => {
      const mockResponse = {
        images: [
          {
            imageUrl: 'https://example.com/image.jpg',
            url: 'https://example.com',
            title: 'Image 1',
            imageWidth: 800,
            imageHeight: 600,
          },
        ],
      };
      mockClient.search.mockResolvedValue(mockResponse);

      const result = await executeSearch(mockContainer, {
        query: 'landscapes',
        sources: ['images'],
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        images: mockResponse.images,
      });
    });

    it('should return success result with news results', async () => {
      const mockResponse = {
        news: [
          {
            url: 'https://news.example.com',
            title: 'Breaking News',
            snippet: 'Something happened',
            date: '2024-01-15',
          },
        ],
      };
      mockClient.search.mockResolvedValue(mockResponse);

      const result = await executeSearch(mockContainer, {
        query: 'tech news',
        sources: ['news'],
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        news: mockResponse.news,
      });
    });

    it('should handle combined results from multiple sources', async () => {
      const mockResponse = {
        web: [{ url: 'https://example.com', title: 'Web Result' }],
        images: [
          {
            imageUrl: 'https://example.com/img.jpg',
            url: 'https://example.com',
          },
        ],
        news: [{ url: 'https://news.example.com', title: 'News' }],
      };
      mockClient.search.mockResolvedValue(mockResponse);

      const result = await executeSearch(mockContainer, {
        query: 'machine learning',
        sources: ['web', 'images', 'news'],
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        web: mockResponse.web,
        images: mockResponse.images,
        news: mockResponse.news,
      });
    });

    it('should handle response with scraped content', async () => {
      const mockResponse = {
        web: [
          {
            url: 'https://example.com',
            title: 'Example',
            markdown: '# Page Content\n\nThis is the content.',
          },
        ],
      };
      mockClient.search.mockResolvedValue(mockResponse);

      const result = await executeSearch(mockContainer, {
        query: 'test',
        scrape: true,
      });

      expect(result.success).toBe(true);
      expect(result.data?.web?.[0].markdown).toBe(
        '# Page Content\n\nThis is the content.'
      );
    });

    it('should handle nested data response format', async () => {
      const mockResponse = {
        data: {
          web: [{ url: 'https://example.com', title: 'Test' }],
        },
      };
      mockClient.search.mockResolvedValue(mockResponse);

      const result = await executeSearch(mockContainer, {
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.data?.web).toEqual([
        { url: 'https://example.com', title: 'Test' },
      ]);
    });

    it('should handle array response format (legacy)', async () => {
      const mockResponse = [
        { url: 'https://example.com', title: 'Test 1' },
        { url: 'https://example2.com', title: 'Test 2' },
      ];
      mockClient.search.mockResolvedValue(mockResponse);

      const result = await executeSearch(mockContainer, {
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.data?.web).toEqual(mockResponse);
    });

    it('should include warning in result when present', async () => {
      const mockResponse = {
        web: [{ url: 'https://example.com', title: 'Test' }],
        warning: 'Some warning message',
      };
      mockClient.search.mockResolvedValue(mockResponse);

      const result = await executeSearch(mockContainer, {
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.warning).toBe('Some warning message');
    });

    it('should include id in result when present', async () => {
      const mockResponse = {
        web: [{ url: 'https://example.com', title: 'Test' }],
        id: 'search-123',
      };
      mockClient.search.mockResolvedValue(mockResponse);

      const result = await executeSearch(mockContainer, {
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe('search-123');
    });

    it('should include creditsUsed in result when present', async () => {
      const mockResponse = {
        web: [{ url: 'https://example.com', title: 'Test' }],
        creditsUsed: 5,
      };
      mockClient.search.mockResolvedValue(mockResponse);

      const result = await executeSearch(mockContainer, {
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.creditsUsed).toBe(5);
    });

    it('should handle empty results', async () => {
      const mockResponse = {};
      mockClient.search.mockResolvedValue(mockResponse);

      const result = await executeSearch(mockContainer, {
        query: 'nonexistent content xyz123',
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });

    it('should return error result when search fails', async () => {
      const errorMessage = 'API Error: Rate limit exceeded';
      mockClient.search.mockRejectedValue(new Error(errorMessage));

      const result = await executeSearch(mockContainer, {
        query: 'test query',
      });

      expect(result).toEqual({
        success: false,
        error: errorMessage,
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockClient.search.mockRejectedValue('String error');

      const result = await executeSearch(mockContainer, {
        query: 'test query',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error occurred');
    });
  });

  describe('Time-based search parameters', () => {
    it('should support qdr:h for past hour', async () => {
      mockClient.search.mockResolvedValue({ web: [] });

      await executeSearch(mockContainer, {
        query: 'breaking news',
        tbs: 'qdr:h',
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'breaking news',
        expect.objectContaining({ tbs: 'qdr:h' })
      );
    });

    it('should support qdr:d for past day', async () => {
      mockClient.search.mockResolvedValue({ web: [] });

      await executeSearch(mockContainer, {
        query: 'AI announcements',
        tbs: 'qdr:d',
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'AI announcements',
        expect.objectContaining({ tbs: 'qdr:d' })
      );
    });

    it('should support qdr:w for past week', async () => {
      mockClient.search.mockResolvedValue({ web: [] });

      await executeSearch(mockContainer, {
        query: 'tech news',
        tbs: 'qdr:w',
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'tech news',
        expect.objectContaining({ tbs: 'qdr:w' })
      );
    });

    it('should support qdr:m for past month', async () => {
      mockClient.search.mockResolvedValue({ web: [] });

      await executeSearch(mockContainer, {
        query: 'startup funding',
        tbs: 'qdr:m',
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'startup funding',
        expect.objectContaining({ tbs: 'qdr:m' })
      );
    });

    it('should support qdr:y for past year', async () => {
      mockClient.search.mockResolvedValue({ web: [] });

      await executeSearch(mockContainer, {
        query: 'yearly review',
        tbs: 'qdr:y',
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        'yearly review',
        expect.objectContaining({ tbs: 'qdr:y' })
      );
    });
  });

  describe('Type safety', () => {
    it('should accept valid source types', async () => {
      const sourceList: Array<'web' | 'images' | 'news'> = [
        'web',
        'images',
        'news',
      ];
      mockClient.search.mockResolvedValue({ web: [], images: [], news: [] });

      for (const source of sourceList) {
        const result = await executeSearch(mockContainer, {
          query: 'test',
          sources: [source],
        });
        expect(result.success).toBe(true);
      }
    });

    it('should accept valid category types', async () => {
      const categoryList: Array<'github' | 'research' | 'pdf'> = [
        'github',
        'research',
        'pdf',
      ];
      mockClient.search.mockResolvedValue({ web: [] });

      for (const category of categoryList) {
        const result = await executeSearch(mockContainer, {
          query: 'test',
          categories: [category],
        });
        expect(result.success).toBe(true);
      }
    });

    it('should accept valid scrape format types', async () => {
      const formatList: Array<'markdown' | 'html' | 'rawHtml' | 'links'> = [
        'markdown',
        'html',
        'rawHtml',
        'links',
      ];

      for (const format of formatList) {
        mockClient.search.mockResolvedValue({
          web: [{ url: 'https://example.com' }],
        });
        const result = await executeSearch(mockContainer, {
          query: 'test',
          scrape: true,
          scrapeFormats: [format],
        });
        expect(result.success).toBe(true);
      }
    });
  });
});

describe('handleSearchCommand auto-embed', () => {
  let mockClient: SearchMockClient;
  let mockContainer: IContainer;

  beforeEach(() => {
    // Create mock client
    mockClient = {
      scrape: vi.fn(),
      search: vi.fn(),
    };

    // Create mock container
    mockContainer = {
      config: {
        apiKey: 'test-api-key',
        apiUrl: 'https://api.firecrawl.dev',
        teiUrl: 'http://localhost:53001',
        qdrantUrl: 'http://localhost:53002',
        collectionName: 'firecrawl',
      },
      getFirecrawlClient: vi.fn().mockReturnValue(mockClient),
      getEmbedPipeline: vi.fn().mockReturnValue({
        autoEmbed: mockAutoEmbed,
      }),
      getHttpClient: vi.fn(),
      getTeiService: vi.fn(),
      getQdrantService: vi.fn(),
      dispose: vi.fn(),
    } as unknown as IContainer;

    mockAutoEmbed.mockResolvedValue(undefined);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call autoEmbed for each scraped web result when scrape is true', async () => {
    const mockResponse = {
      web: [
        {
          url: 'https://example.com',
          title: 'Example Page',
          markdown: '# Example Content',
        },
        {
          url: 'https://example2.com',
          title: 'Another Page',
          markdown: '# Another Content',
        },
      ],
    };
    mockClient.search.mockResolvedValue(mockResponse);

    await handleSearchCommand(mockContainer, {
      query: 'test query',
      scrape: true,
    });

    expect(mockAutoEmbed).toHaveBeenCalledTimes(2);
    expect(mockAutoEmbed).toHaveBeenCalledWith('# Example Content', {
      url: 'https://example.com',
      title: 'Example Page',
      sourceCommand: 'search',
      contentType: 'markdown',
    });
    expect(mockAutoEmbed).toHaveBeenCalledWith('# Another Content', {
      url: 'https://example2.com',
      title: 'Another Page',
      sourceCommand: 'search',
      contentType: 'markdown',
    });
  });

  it('should skip autoEmbed when scrape is false (snippets only)', async () => {
    const mockResponse = {
      web: [
        {
          url: 'https://example.com',
          title: 'Example',
          description: 'A snippet',
        },
      ],
    };
    mockClient.search.mockResolvedValue(mockResponse);

    await handleSearchCommand(mockContainer, {
      query: 'test query',
      scrape: false,
    });

    expect(mockAutoEmbed).not.toHaveBeenCalled();
  });

  it('should skip autoEmbed when scrape is undefined (default non-scrape search)', async () => {
    const mockResponse = {
      web: [
        {
          url: 'https://example.com',
          title: 'Example',
          description: 'A snippet',
        },
      ],
    };
    mockClient.search.mockResolvedValue(mockResponse);

    await handleSearchCommand(mockContainer, {
      query: 'test query',
    });

    expect(mockAutoEmbed).not.toHaveBeenCalled();
  });

  it('should skip autoEmbed when embed is explicitly false', async () => {
    const mockResponse = {
      web: [
        {
          url: 'https://example.com',
          title: 'Example',
          markdown: '# Content',
        },
      ],
    };
    mockClient.search.mockResolvedValue(mockResponse);

    await handleSearchCommand(mockContainer, {
      query: 'test query',
      scrape: true,
      embed: false,
    });

    expect(mockAutoEmbed).not.toHaveBeenCalled();
  });

  it('should use html content when markdown is not available', async () => {
    const mockResponse = {
      web: [
        {
          url: 'https://example.com',
          title: 'HTML Page',
          html: '<h1>HTML Content</h1>',
        },
      ],
    };
    mockClient.search.mockResolvedValue(mockResponse);

    await handleSearchCommand(mockContainer, {
      query: 'test query',
      scrape: true,
    });

    expect(mockAutoEmbed).toHaveBeenCalledTimes(1);
    expect(mockAutoEmbed).toHaveBeenCalledWith('<h1>HTML Content</h1>', {
      url: 'https://example.com',
      title: 'HTML Page',
      sourceCommand: 'search',
      contentType: 'html',
    });
  });

  it('should skip items without markdown or html content', async () => {
    const mockResponse = {
      web: [
        {
          url: 'https://example.com',
          title: 'No Content',
          description: 'Just a snippet',
        },
        {
          url: 'https://example2.com',
          title: 'Has Content',
          markdown: '# Real Content',
        },
      ],
    };
    mockClient.search.mockResolvedValue(mockResponse);

    await handleSearchCommand(mockContainer, {
      query: 'test query',
      scrape: true,
    });

    expect(mockAutoEmbed).toHaveBeenCalledTimes(1);
    expect(mockAutoEmbed).toHaveBeenCalledWith('# Real Content', {
      url: 'https://example2.com',
      title: 'Has Content',
      sourceCommand: 'search',
      contentType: 'markdown',
    });
  });

  it('should not call autoEmbed when search fails', async () => {
    mockClient.search.mockRejectedValue(new Error('API error'));

    try {
      await handleSearchCommand(mockContainer, {
        query: 'test query',
        scrape: true,
      });
    } catch {
      // process.exit mock throws
    }

    expect(mockAutoEmbed).not.toHaveBeenCalled();
  });

  it('should not call autoEmbed when no results are returned', async () => {
    const mockResponse = {};
    mockClient.search.mockResolvedValue(mockResponse);

    await handleSearchCommand(mockContainer, {
      query: 'test query',
      scrape: true,
    });

    expect(mockAutoEmbed).not.toHaveBeenCalled();
  });
});
