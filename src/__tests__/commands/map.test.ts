/**
 * Tests for map command
 *
 * The map command uses two paths:
 * 1. SDK path: When no User-Agent is configured, uses client.map() for better retry logic
 * 2. HTTP path: When User-Agent IS configured, uses direct HTTP (SDK limitation)
 */

import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeMap } from '../../commands/map';
import { DEFAULT_USER_AGENT } from '../../utils/config';
import { resetTeiCache } from '../../utils/embeddings';
import { resetQdrantCache } from '../../utils/qdrant';
import type { MockFirecrawlClient } from '../utils/mock-client';
import { createTestContainer } from '../utils/test-container';

const createContainer = (...args: Parameters<typeof createTestContainer>) =>
  createTestContainer(...args);

// Mock output utility to prevent side effects
vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

/**
 * Helper to create a mock fetch response for HTTP client
 */
function mockFetchResponse(data: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
  });
}

/**
 * Helper to create a mock SDK map client that satisfies MockFirecrawlClient
 */
function createMockMapClient(
  links: unknown[] = []
): Partial<MockFirecrawlClient> {
  return {
    scrape: vi.fn() as Mock,
    map: vi.fn().mockResolvedValue({ links }) as Mock,
  };
}

describe('executeMap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetTeiCache();
    resetQdrantCache();
  });

  describe('SDK path (no User-Agent)', () => {
    it('should use SDK map method when no User-Agent is configured', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/page1',
        'https://example.com/page2',
      ]);
      const container = createContainer(mockClient);

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(mockClient.map).toHaveBeenCalledTimes(1);
      expect(mockClient.map).toHaveBeenCalledWith('https://example.com', {});
    });

    it('should pass limit option to SDK', async () => {
      const mockClient = createMockMapClient([]);
      const container = createContainer(mockClient);

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
        limit: 50,
      });

      expect(mockClient.map).toHaveBeenCalledWith('https://example.com', {
        limit: 50,
      });
    });

    it('should pass search option to SDK', async () => {
      const mockClient = createMockMapClient([]);
      const container = createContainer(mockClient);

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
        search: 'blog',
      });

      expect(mockClient.map).toHaveBeenCalledWith('https://example.com', {
        search: 'blog',
      });
    });

    it('should pass includeSubdomains option to SDK', async () => {
      const mockClient = createMockMapClient([]);
      const container = createContainer(mockClient);

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
        includeSubdomains: true,
      });

      expect(mockClient.map).toHaveBeenCalledWith('https://example.com', {
        includeSubdomains: true,
      });
    });

    it('should pass ignoreQueryParameters option to SDK', async () => {
      const mockClient = createMockMapClient([]);
      const container = createContainer(mockClient);

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
        ignoreQueryParameters: true,
      });

      expect(mockClient.map).toHaveBeenCalledWith('https://example.com', {
        ignoreQueryParameters: true,
      });
    });

    it('should convert timeout to milliseconds for SDK', async () => {
      const mockClient = createMockMapClient([]);
      const container = createContainer(mockClient);

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
        timeout: 60,
      });

      expect(mockClient.map).toHaveBeenCalledWith('https://example.com', {
        timeout: 60000,
      });
    });

    it('should pass sitemap option to SDK', async () => {
      const mockClient = createMockMapClient([]);
      const container = createContainer(mockClient);

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
        sitemap: 'only',
      });

      expect(mockClient.map).toHaveBeenCalledWith('https://example.com', {
        sitemap: 'only',
      });
    });

    it('should combine all options for SDK', async () => {
      const mockClient = createMockMapClient([]);
      const container = createContainer(mockClient);

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
        limit: 100,
        search: 'blog',
        includeSubdomains: true,
        ignoreQueryParameters: true,
        timeout: 120,
        sitemap: 'include',
      });

      expect(mockClient.map).toHaveBeenCalledWith('https://example.com', {
        limit: 100,
        search: 'blog',
        includeSubdomains: true,
        ignoreQueryParameters: true,
        timeout: 120000,
        sitemap: 'include',
      });
    });
  });

  describe('HTTP path (with User-Agent)', () => {
    it('should use HTTP client when User-Agent is configured', async () => {
      const mockHttpClient = {
        fetchWithTimeout: mockFetchResponse({ links: [] }),
        fetchWithRetry: vi.fn(),
      };
      const container = createTestContainer(undefined, {
        userAgent: DEFAULT_USER_AGENT,
      });
      // Override the http client
      (container.getHttpClient as ReturnType<typeof vi.fn>).mockReturnValue(
        mockHttpClient
      );

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(mockHttpClient.fetchWithTimeout).toHaveBeenCalledTimes(1);
      const [url, options] = mockHttpClient.fetchWithTimeout.mock.calls[0];
      expect(url).toBe('https://api.firecrawl.dev/v1/map');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-api-key');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['User-Agent']).toBe(DEFAULT_USER_AGENT);
    });

    it('should include custom User-Agent as HTTP header', async () => {
      const mockHttpClient = {
        fetchWithTimeout: mockFetchResponse({ links: [] }),
        fetchWithRetry: vi.fn(),
      };
      const container = createTestContainer(undefined, {
        userAgent: 'custom-bot/1.0',
      });
      (container.getHttpClient as ReturnType<typeof vi.fn>).mockReturnValue(
        mockHttpClient
      );

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      const [, options] = mockHttpClient.fetchWithTimeout.mock.calls[0];
      expect(options.headers['User-Agent']).toBe('custom-bot/1.0');
    });

    it('should include all options in HTTP request body', async () => {
      const mockHttpClient = {
        fetchWithTimeout: mockFetchResponse({ links: [] }),
        fetchWithRetry: vi.fn(),
      };
      const container = createTestContainer(undefined, {
        userAgent: DEFAULT_USER_AGENT,
      });
      (container.getHttpClient as ReturnType<typeof vi.fn>).mockReturnValue(
        mockHttpClient
      );

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
        limit: 100,
        search: 'blog',
        includeSubdomains: true,
        ignoreQueryParameters: true,
        timeout: 120,
        sitemap: 'include',
      });

      const [, fetchOptions] = mockHttpClient.fetchWithTimeout.mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      expect(body.url).toBe('https://example.com');
      expect(body.limit).toBe(100);
      expect(body.search).toBe('blog');
      expect(body.includeSubdomains).toBe(true);
      expect(body.ignoreQueryParameters).toBe(true);
      expect(body.timeout).toBe(120000);
      expect(body.sitemap).toBe('include');
    });

    it('should return error when API returns non-OK status', async () => {
      const mockHttpClient = {
        fetchWithTimeout: mockFetchResponse(
          { error: 'API Error: Invalid URL' },
          false,
          400
        ),
        fetchWithRetry: vi.fn(),
      };
      const container = createTestContainer(undefined, {
        userAgent: DEFAULT_USER_AGENT,
      });
      (container.getHttpClient as ReturnType<typeof vi.fn>).mockReturnValue(
        mockHttpClient
      );

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result).toEqual({
        success: false,
        error: 'API Error: Invalid URL',
      });
    });

    it('should handle non-JSON error responses', async () => {
      const mockHttpClient = {
        fetchWithTimeout: vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: vi.fn().mockRejectedValue(new Error('not json')),
        }),
        fetchWithRetry: vi.fn(),
      };
      const container = createTestContainer(undefined, {
        userAgent: DEFAULT_USER_AGENT,
      });
      (container.getHttpClient as ReturnType<typeof vi.fn>).mockReturnValue(
        mockHttpClient
      );

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('API request failed with status 500');
    });

    it('should handle fetch rejection', async () => {
      const mockHttpClient = {
        fetchWithTimeout: vi.fn().mockRejectedValue(new Error('Network error')),
        fetchWithRetry: vi.fn(),
      };
      const container = createTestContainer(undefined, {
        userAgent: DEFAULT_USER_AGENT,
      });
      (container.getHttpClient as ReturnType<typeof vi.fn>).mockReturnValue(
        mockHttpClient
      );

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('Response handling (SDK path)', () => {
    it('should return success result with mapped links (string format)', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/page1',
        'https://example.com/page2',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result).toEqual({
        success: true,
        data: {
          links: [
            {
              url: 'https://example.com/page1',
              title: undefined,
              description: undefined,
            },
            {
              url: 'https://example.com/page2',
              title: undefined,
              description: undefined,
            },
          ],
        },
      });
    });

    it('should return success result with mapped links (object format)', async () => {
      const mockClient = createMockMapClient([
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
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
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
      const mockClient = createMockMapClient([
        { url: 'https://example.com/page1' },
        { url: 'https://example.com/page2', title: 'Page 2' },
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
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
      const mockClient = createMockMapClient([]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.links).toEqual([]);
      }
    });

    it('should handle SDK rejection', async () => {
      const mockClient = {
        map: vi.fn().mockRejectedValue(new Error('SDK error')),
      };
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('SDK error');
    });

    it('should handle non-Error exceptions from SDK', async () => {
      const mockClient = {
        map: vi.fn().mockRejectedValue('String error'),
      };
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error occurred');
    });
  });

  describe('Data transformation', () => {
    it('should transform object links to expected format', async () => {
      const mockClient = createMockMapClient([
        {
          url: 'https://example.com/page1',
          title: 'Page 1',
          description: 'Description 1',
          otherField: 'should be ignored',
        },
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
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

    it('should normalize string links to objects', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/page1',
        'https://example.com/page2',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.links[0]).toEqual({
          url: 'https://example.com/page1',
          title: undefined,
          description: undefined,
        });
      }
    });
  });
});
