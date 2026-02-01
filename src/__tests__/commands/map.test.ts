/**
 * Tests for map command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeMap } from '../../commands/map';
import {
  DEFAULT_USER_AGENT,
  initializeConfig,
  resetConfig,
} from '../../utils/config';

// Mock output utility to prevent side effects
vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

/**
 * Helper to create a mock fetch response
 */
function mockFetchResponse(data: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
  });
}

describe('executeMap', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetConfig();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    // Default fetch mock returning empty links
    fetchSpy = mockFetchResponse({ links: [] });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConfig();
  });

  describe('API call generation', () => {
    it('should call /v1/map with correct URL and default options', async () => {
      fetchSpy = mockFetchResponse({
        links: ['https://example.com/page1', 'https://example.com/page2'],
      });
      vi.stubGlobal('fetch', fetchSpy);

      await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.firecrawl.dev/v1/map');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-api-key');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.url).toBe('https://example.com');
    });

    it('should include default User-Agent as HTTP header when configured', async () => {
      // Reset and initialize with default User-Agent
      resetConfig();
      initializeConfig({
        apiKey: 'test-api-key',
        apiUrl: 'https://api.firecrawl.dev',
        userAgent: DEFAULT_USER_AGENT,
      });

      fetchSpy = mockFetchResponse({ links: [] });
      vi.stubGlobal('fetch', fetchSpy);

      await executeMap({
        urlOrJobId: 'https://example.com',
      });

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers['User-Agent']).toBe(DEFAULT_USER_AGENT);
    });

    it('should include custom User-Agent as HTTP header when configured', async () => {
      resetConfig();
      initializeConfig({
        apiKey: 'test-api-key',
        apiUrl: 'https://api.firecrawl.dev',
        userAgent: 'custom-bot/1.0',
      });

      fetchSpy = mockFetchResponse({ links: [] });
      vi.stubGlobal('fetch', fetchSpy);

      await executeMap({
        urlOrJobId: 'https://example.com',
      });

      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers['User-Agent']).toBe('custom-bot/1.0');
    });

    it('should always include default User-Agent header', async () => {
      // Default config always includes DEFAULT_USER_AGENT
      fetchSpy = mockFetchResponse({ links: [] });
      vi.stubGlobal('fetch', fetchSpy);

      await executeMap({
        urlOrJobId: 'https://example.com',
      });

      const [, options] = fetchSpy.mock.calls[0];
      // User-Agent is always set (defaults to DEFAULT_USER_AGENT in config)
      expect(options.headers['User-Agent']).toBe(DEFAULT_USER_AGENT);
    });

    it('should include limit option when provided', async () => {
      fetchSpy = mockFetchResponse({ links: ['https://example.com/page1'] });
      vi.stubGlobal('fetch', fetchSpy);

      await executeMap({
        urlOrJobId: 'https://example.com',
        limit: 50,
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.limit).toBe(50);
    });

    it('should include search option when provided', async () => {
      fetchSpy = mockFetchResponse({ links: ['https://example.com/blog'] });
      vi.stubGlobal('fetch', fetchSpy);

      await executeMap({
        urlOrJobId: 'https://example.com',
        search: 'blog',
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.search).toBe('blog');
    });

    it('should include includeSubdomains option when provided', async () => {
      fetchSpy = mockFetchResponse({
        links: ['https://sub.example.com/page1'],
      });
      vi.stubGlobal('fetch', fetchSpy);

      await executeMap({
        urlOrJobId: 'https://example.com',
        includeSubdomains: true,
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.includeSubdomains).toBe(true);
    });

    it('should include ignoreQueryParameters option when provided', async () => {
      fetchSpy = mockFetchResponse({ links: ['https://example.com/page1'] });
      vi.stubGlobal('fetch', fetchSpy);

      await executeMap({
        urlOrJobId: 'https://example.com',
        ignoreQueryParameters: true,
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.ignoreQueryParameters).toBe(true);
    });

    it('should include timeout option converted to milliseconds', async () => {
      fetchSpy = mockFetchResponse({ links: ['https://example.com/page1'] });
      vi.stubGlobal('fetch', fetchSpy);

      await executeMap({
        urlOrJobId: 'https://example.com',
        timeout: 60,
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.timeout).toBe(60000);
    });

    it('should combine all options correctly', async () => {
      // Configure User-Agent for this test
      resetConfig();
      initializeConfig({
        apiKey: 'test-api-key',
        apiUrl: 'https://api.firecrawl.dev',
        userAgent: DEFAULT_USER_AGENT,
      });

      fetchSpy = mockFetchResponse({
        links: [
          'https://example.com/blog/post1',
          'https://example.com/blog/post2',
        ],
      });
      vi.stubGlobal('fetch', fetchSpy);

      await executeMap({
        urlOrJobId: 'https://example.com',
        limit: 100,
        search: 'blog',
        includeSubdomains: true,
        ignoreQueryParameters: true,
        timeout: 120,
      });

      const [, fetchOptions] = fetchSpy.mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      expect(body.url).toBe('https://example.com');
      expect(body.limit).toBe(100);
      expect(body.search).toBe('blog');
      expect(body.includeSubdomains).toBe(true);
      expect(body.ignoreQueryParameters).toBe(true);
      expect(body.timeout).toBe(120000);
      // User-Agent is sent as HTTP header, not in body
      expect(fetchOptions.headers['User-Agent']).toBe(DEFAULT_USER_AGENT);
    });
  });

  describe('Response handling', () => {
    it('should return success result with mapped links (string format)', async () => {
      fetchSpy = mockFetchResponse({
        links: ['https://example.com/page1', 'https://example.com/page2'],
      });
      vi.stubGlobal('fetch', fetchSpy);

      const result = await executeMap({
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
      fetchSpy = mockFetchResponse({
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
      });
      vi.stubGlobal('fetch', fetchSpy);

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
      fetchSpy = mockFetchResponse({
        links: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2', title: 'Page 2' },
        ],
      });
      vi.stubGlobal('fetch', fetchSpy);

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
      fetchSpy = mockFetchResponse({ links: [] });
      vi.stubGlobal('fetch', fetchSpy);

      const result = await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.links).toEqual([]);
      }
    });

    it('should return error result when API returns non-OK status', async () => {
      fetchSpy = mockFetchResponse(
        { error: 'API Error: Invalid URL' },
        false,
        400
      );
      vi.stubGlobal('fetch', fetchSpy);

      const result = await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(result).toEqual({
        success: false,
        error: 'API Error: Invalid URL',
      });
    });

    it('should handle non-JSON error responses', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: vi.fn().mockRejectedValue(new Error('not json')),
        })
      );

      const result = await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('API request failed with status 500');
    });

    it('should handle fetch rejection', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('Network error'))
      );

      const result = await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should handle non-Error exceptions', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('String error'));

      const result = await executeMap({
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error occurred');
    });
  });

  describe('Data transformation', () => {
    it('should transform object links to expected format', async () => {
      fetchSpy = mockFetchResponse({
        links: [
          {
            url: 'https://example.com/page1',
            title: 'Page 1',
            description: 'Description 1',
            otherField: 'should be ignored',
          },
        ],
      });
      vi.stubGlobal('fetch', fetchSpy);

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

    it('should normalize string links to objects', async () => {
      fetchSpy = mockFetchResponse({
        links: ['https://example.com/page1', 'https://example.com/page2'],
      });
      vi.stubGlobal('fetch', fetchSpy);

      const result = await executeMap({
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
