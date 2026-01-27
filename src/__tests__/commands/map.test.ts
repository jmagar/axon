/**
 * Tests for map command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeMap, handleMapCommand } from '../../commands/map';
import { getClient } from '../../utils/client';
import { initializeConfig } from '../../utils/config';
import { setupTest, teardownTest } from '../utils/mock-client';
import * as notebooklm from '../../utils/notebooklm';

// Mock the Firecrawl client module
vi.mock('../../utils/client', async () => {
  const actual = await vi.importActual('../../utils/client');
  return {
    ...actual,
    getClient: vi.fn(),
  };
});

// Mock NotebookLM integration
vi.mock('../../utils/notebooklm', () => ({
  addUrlsToNotebook: vi.fn(),
}));

// Mock output utility to prevent side effects
vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

describe('executeMap', () => {
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
      map: vi.fn(),
    };

    // Mock getClient to return our mock
    vi.mocked(getClient).mockReturnValue(mockClient as any);
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  describe('API call generation', () => {
    it('should call map with correct URL and default options', async () => {
      const mockResponse = {
        links: [
          { url: 'https://example.com/page1', title: 'Page 1' },
          { url: 'https://example.com/page2', title: 'Page 2' },
        ],
      };
      mockClient.map.mockResolvedValue(mockResponse);

      await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(mockClient.map).toHaveBeenCalledTimes(1);
      expect(mockClient.map).toHaveBeenCalledWith('https://example.com', {});
    });

    it('should include limit option when provided', async () => {
      const mockResponse = {
        links: [{ url: 'https://example.com/page1' }],
      };
      mockClient.map.mockResolvedValue(mockResponse);

      await executeMap({
        urlOrJobId: 'https://example.com',
        limit: 50,
      });

      expect(mockClient.map).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          limit: 50,
        })
      );
    });

    it('should include search option when provided', async () => {
      const mockResponse = {
        links: [{ url: 'https://example.com/blog' }],
      };
      mockClient.map.mockResolvedValue(mockResponse);

      await executeMap({
        urlOrJobId: 'https://example.com',
        search: 'blog',
      });

      expect(mockClient.map).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          search: 'blog',
        })
      );
    });

    it('should include sitemap option when provided', async () => {
      const mockResponse = {
        links: [{ url: 'https://example.com/page1' }],
      };
      mockClient.map.mockResolvedValue(mockResponse);

      await executeMap({
        urlOrJobId: 'https://example.com',
        sitemap: 'only',
      });

      expect(mockClient.map).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          sitemap: 'only',
        })
      );
    });

    it('should include includeSubdomains option when provided', async () => {
      const mockResponse = {
        links: [{ url: 'https://sub.example.com/page1' }],
      };
      mockClient.map.mockResolvedValue(mockResponse);

      await executeMap({
        urlOrJobId: 'https://example.com',
        includeSubdomains: true,
      });

      expect(mockClient.map).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          includeSubdomains: true,
        })
      );
    });

    it('should include ignoreQueryParameters option when provided', async () => {
      const mockResponse = {
        links: [{ url: 'https://example.com/page1' }],
      };
      mockClient.map.mockResolvedValue(mockResponse);

      await executeMap({
        urlOrJobId: 'https://example.com',
        ignoreQueryParameters: true,
      });

      expect(mockClient.map).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          ignoreQueryParameters: true,
        })
      );
    });

    it('should include timeout option when provided', async () => {
      const mockResponse = {
        links: [{ url: 'https://example.com/page1' }],
      };
      mockClient.map.mockResolvedValue(mockResponse);

      await executeMap({
        urlOrJobId: 'https://example.com',
        timeout: 60,
      });

      expect(mockClient.map).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          timeout: 60000, // Converted to milliseconds
        })
      );
    });

    it('should combine all options correctly', async () => {
      const mockResponse = {
        links: [
          { url: 'https://example.com/blog/post1' },
          { url: 'https://example.com/blog/post2' },
        ],
      };
      mockClient.map.mockResolvedValue(mockResponse);

      await executeMap({
        urlOrJobId: 'https://example.com',
        limit: 100,
        search: 'blog',
        sitemap: 'include',
        includeSubdomains: true,
        ignoreQueryParameters: true,
        timeout: 120,
      });

      expect(mockClient.map).toHaveBeenCalledWith('https://example.com', {
        limit: 100,
        search: 'blog',
        sitemap: 'include',
        includeSubdomains: true,
        ignoreQueryParameters: true,
        timeout: 120000,
      });
    });
  });

  describe('Response handling', () => {
    it('should return success result with mapped links', async () => {
      const mockResponse = {
        links: [
          {
            url: 'https://example.com/page1',
            title: 'Page 1',
            description: 'Description 1',
          },
          {
            url: 'https://example.com/page2',
            title: 'Page 2',
            description: 'Description 2',
          },
        ],
      };
      mockClient.map.mockResolvedValue(mockResponse);

      const result = await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(result).toEqual({
        success: true,
        data: {
          links: [
            {
              url: 'https://example.com/page1',
              title: 'Page 1',
              description: 'Description 1',
            },
            {
              url: 'https://example.com/page2',
              title: 'Page 2',
              description: 'Description 2',
            },
          ],
        },
      });
    });

    it('should handle links without title or description', async () => {
      const mockResponse = {
        links: [
          { url: 'https://example.com/page1' },
          {
            url: 'https://example.com/page2',
            title: 'Page 2',
          },
        ],
      };
      mockClient.map.mockResolvedValue(mockResponse);

      const result = await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.links).toHaveLength(2);
        expect(result.data.links[0]).toEqual({
          url: 'https://example.com/page1',
          title: undefined,
          description: undefined,
        });
        expect(result.data.links[1]).toEqual({
          url: 'https://example.com/page2',
          title: 'Page 2',
          description: undefined,
        });
      }
    });

    it('should handle empty links array', async () => {
      const mockResponse = {
        links: [],
      };
      mockClient.map.mockResolvedValue(mockResponse);

      const result = await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.links).toEqual([]);
      }
    });

    it('should return error result when map fails', async () => {
      const errorMessage = 'API Error: Invalid URL';
      mockClient.map.mockRejectedValue(new Error(errorMessage));

      const result = await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(result).toEqual({
        success: false,
        error: errorMessage,
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockClient.map.mockRejectedValue('String error');

      const result = await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error occurred');
    });
  });

  describe('Data transformation', () => {
    it('should transform links to expected format', async () => {
      const mockResponse = {
        links: [
          {
            url: 'https://example.com/page1',
            title: 'Page 1',
            description: 'Description 1',
            otherField: 'should be ignored',
          },
        ],
      };
      mockClient.map.mockResolvedValue(mockResponse);

      const result = await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.links[0]).toEqual({
          url: 'https://example.com/page1',
          title: 'Page 1',
          description: 'Description 1',
        });
        expect(result.data.links[0]).not.toHaveProperty('otherField');
      }
    });
  });
});

describe('handleMapCommand with notebook integration', () => {
  let mockClient: any;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    mockClient = {
      map: vi.fn(),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as any);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    teardownTest();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('should call addUrlsToNotebook when notebook option is provided', async () => {
    const mockResponse = {
      links: [
        { url: 'https://example.com/page1' },
        { url: 'https://example.com/page2' },
      ],
    };
    mockClient.map.mockResolvedValue(mockResponse);

    const mockNotebookResult = {
      notebook_id: 'abc123',
      notebook_title: 'Test Notebook',
      added: 2,
      failed: 0,
      errors: [],
    };
    vi.mocked(notebooklm.addUrlsToNotebook).mockResolvedValue(
      mockNotebookResult
    );

    await handleMapCommand({
      urlOrJobId: 'https://example.com',
      notebook: 'Test Notebook',
    });

    expect(notebooklm.addUrlsToNotebook).toHaveBeenCalledWith('Test Notebook', [
      'https://example.com/page1',
      'https://example.com/page2',
    ]);
  });

  it('should not call addUrlsToNotebook when notebook option is not provided', async () => {
    const mockResponse = {
      links: [{ url: 'https://example.com/page1' }],
    };
    mockClient.map.mockResolvedValue(mockResponse);

    await handleMapCommand({
      urlOrJobId: 'https://example.com',
    });

    expect(notebooklm.addUrlsToNotebook).not.toHaveBeenCalled();
  });

  it('should continue map command even if notebook integration fails', async () => {
    const mockResponse = {
      links: [{ url: 'https://example.com/page1' }],
    };
    mockClient.map.mockResolvedValue(mockResponse);

    vi.mocked(notebooklm.addUrlsToNotebook).mockResolvedValue(null);

    // Should not throw
    await handleMapCommand({
      urlOrJobId: 'https://example.com',
      notebook: 'Test Notebook',
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('NotebookLM')
    );
  });

  it('should skip notebook integration when map returns no URLs', async () => {
    const mockResponse = {
      links: [],
    };
    mockClient.map.mockResolvedValue(mockResponse);

    await handleMapCommand({
      urlOrJobId: 'https://empty.com',
      notebook: 'Test Notebook',
    });

    expect(notebooklm.addUrlsToNotebook).not.toHaveBeenCalled();
  });

  it('should truncate to 300 URLs and warn when limit exceeded', async () => {
    const links = Array.from({ length: 350 }, (_, i) => ({
      url: `https://example.com/page${i}`,
    }));

    const mockResponse = { links };
    mockClient.map.mockResolvedValue(mockResponse);

    const mockNotebookResult = {
      notebook_id: 'abc123',
      notebook_title: 'Test Notebook',
      added: 300,
      failed: 0,
      errors: [],
    };
    vi.mocked(notebooklm.addUrlsToNotebook).mockResolvedValue(
      mockNotebookResult
    );

    await handleMapCommand({
      urlOrJobId: 'https://example.com',
      notebook: 'Test Notebook',
    });

    // Should only pass first 300 URLs
    const calledUrls = vi.mocked(notebooklm.addUrlsToNotebook).mock.calls[0][1];
    expect(calledUrls.length).toBe(300);
    expect(calledUrls[0]).toBe('https://example.com/page0');
    expect(calledUrls[299]).toBe('https://example.com/page299');

    // Should log warning
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Truncating to 300')
    );
  });
});
