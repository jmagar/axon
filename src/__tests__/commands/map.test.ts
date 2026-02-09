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
import { DEFAULT_USER_AGENT } from '../../utils/defaults';
import type { MockFirecrawlClient } from '../utils/mock-client';
import { createTestContainer } from '../utils/test-container';

const createContainer = (...args: Parameters<typeof createTestContainer>) =>
  createTestContainer(...args);

// Mock output utility to prevent side effects
vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));

// Mock the settings module to return empty settings
vi.mock('../../utils/settings', () => ({
  loadSettings: vi.fn(() => ({
    defaultExcludePaths: [],
    defaultExcludeExtensions: [],
  })),
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

function createMockCrawlJob(urls: string[]) {
  return {
    id: 'crawl-job-1',
    status: 'completed',
    total: urls.length,
    completed: urls.length,
    data: urls.map((url) => ({
      metadata: { sourceURL: url },
    })),
  };
}

describe('executeMap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

    it('should fallback to crawl discovery on ReadTheDocs when map returns empty', async () => {
      const mockClient = createMockMapClient([]);
      mockClient.crawl = vi
        .fn()
        .mockResolvedValue(
          createMockCrawlJob([
            'https://fail2ban.readthedocs.io/en/latest/',
            'https://fail2ban.readthedocs.io/en/latest/filters.html',
          ])
        ) as Mock;
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://fail2ban.readthedocs.io/en/latest/',
        sitemap: 'skip',
      });

      expect(mockClient.map).toHaveBeenCalledTimes(1);
      expect(mockClient.crawl).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.data?.links).toEqual([
        { url: 'https://fail2ban.readthedocs.io/en/latest/' },
        {
          url: 'https://fail2ban.readthedocs.io/en/latest/filters.html',
        },
      ]);
    });

    it('should not fallback to crawl discovery on non-ReadTheDocs hosts', async () => {
      const mockClient = createMockMapClient([]);
      mockClient.crawl = vi
        .fn()
        .mockResolvedValue(createMockCrawlJob([])) as Mock;
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com/docs',
        sitemap: 'skip',
      });

      expect(mockClient.map).toHaveBeenCalledTimes(1);
      expect(mockClient.crawl).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data?.links).toEqual([]);
    });

    it('should use /en/latest/ for ReadTheDocs root fallback', async () => {
      // Map returns empty for root URL, triggering fallback to /en/latest/
      const mockClient = createMockMapClient([]);
      mockClient.crawl = vi
        .fn()
        .mockResolvedValue(
          createMockCrawlJob([
            'https://fail2ban.readthedocs.io/en/latest/',
            'https://fail2ban.readthedocs.io/en/latest/filters.html',
          ])
        ) as Mock;
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://fail2ban.readthedocs.io',
        sitemap: 'skip',
      });

      expect(mockClient.map).toHaveBeenCalledTimes(1);
      expect(mockClient.crawl).toHaveBeenCalledTimes(1);
      expect(mockClient.crawl).toHaveBeenCalledWith(
        'https://fail2ban.readthedocs.io/en/latest/',
        expect.objectContaining({ sitemap: 'skip' })
      );
      expect(result.success).toBe(true);
      expect(result.data?.links).toEqual([
        { url: 'https://fail2ban.readthedocs.io/en/latest/' },
        {
          url: 'https://fail2ban.readthedocs.io/en/latest/filters.html',
        },
      ]);
    });
  });

  describe('HTTP path (with User-Agent)', () => {
    it('should use HTTP client when User-Agent is configured', async () => {
      const mockHttpClient = {
        fetchWithTimeout: vi.fn()({ links: [] }),
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

      expect(mockHttpClient.fetchWithRetry).toHaveBeenCalledTimes(1);
      const [url, options] = mockHttpClient.fetchWithRetry.mock.calls[0];
      expect(url).toBe('https://api.firecrawl.dev/v2/map');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-api-key');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['User-Agent']).toBe(DEFAULT_USER_AGENT);
    });

    it('should include custom User-Agent as HTTP header', async () => {
      const mockHttpClient = {
        fetchWithTimeout: vi.fn()({ links: [] }),
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

      const [, options] = mockHttpClient.fetchWithRetry.mock.calls[0];
      expect(options.headers['User-Agent']).toBe('custom-bot/1.0');
    });

    it('should include all options in HTTP request body', async () => {
      const mockHttpClient = {
        fetchWithTimeout: vi.fn()({ links: [] }),
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

      const [, fetchOptions] = mockHttpClient.fetchWithRetry.mock.calls[0];
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
        fetchWithTimeout: vi.fn(),
        fetchWithRetry: mockFetchResponse(
          { error: 'API Error: Invalid URL' },
          false,
          400
        ),
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
        fetchWithTimeout: vi.fn(),
        fetchWithRetry: vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: vi.fn().mockRejectedValue(new Error('not json')),
        }),
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
        fetchWithTimeout: vi.fn(),
        fetchWithRetry: vi.fn().mockRejectedValue(new Error('Network error')),
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

    it('should explicitly send ignoreQueryParameters: false in HTTP body when noFiltering is true', async () => {
      const mockHttpClient = {
        fetchWithTimeout: vi.fn()({ links: [] }),
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
        ignoreQueryParameters: true, // Try to set this
        noFiltering: true, // Should override and send false to API
      });

      const [, fetchOptions] = mockHttpClient.fetchWithRetry.mock.calls[0];
      const body = JSON.parse(fetchOptions.body);
      expect(body.ignoreQueryParameters).toBe(false);
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

  describe('Client-side URL filtering', () => {
    it('should apply default exclude patterns by default', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/',
        'https://example.com/about',
        'https://example.com/blog/post',
        'https://example.com/de/home',
        'https://example.com/fr/accueil',
        'https://example.com/wp-admin/login',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Default patterns should exclude language routes, blog paths, wp-admin
        const urls = result.data.links.map((link) => link.url);
        expect(urls).toContain('https://example.com/');
        expect(urls).toContain('https://example.com/about');
        expect(urls).not.toContain('https://example.com/blog/post');
        expect(urls).not.toContain('https://example.com/de/home');
        expect(urls).not.toContain('https://example.com/fr/accueil');
        expect(urls).not.toContain('https://example.com/wp-admin/login');
      }
    });

    it('should filter with custom exclude paths', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/',
        'https://example.com/about',
        'https://example.com/api/users',
        'https://example.com/admin/dashboard',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
        excludePaths: ['/api', '/admin'],
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        const urls = result.data.links.map((link) => link.url);
        expect(urls).toContain('https://example.com/');
        expect(urls).toContain('https://example.com/about');
        expect(urls).not.toContain('https://example.com/api/users');
        expect(urls).not.toContain('https://example.com/admin/dashboard');
      }
    });

    it('should filter with exclude extensions', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/page.html',
        'https://example.com/document.pdf',
        'https://example.com/archive.zip',
        'https://example.com/installer.exe',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
        excludeExtensions: ['.pdf', '.zip', '.exe'],
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        const urls = result.data.links.map((link) => link.url);
        expect(urls).toContain('https://example.com/page.html');
        expect(urls).not.toContain('https://example.com/document.pdf');
        expect(urls).not.toContain('https://example.com/archive.zip');
        expect(urls).not.toContain('https://example.com/installer.exe');
      }
    });

    it('should skip default excludes when noDefaultExcludes is true', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/en/home',
        'https://example.com/fr/accueil',
        'https://example.com/blog/post',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
        noDefaultExcludes: true,
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Without defaults, all URLs should be kept
        expect(result.data.links).toHaveLength(3);
        const urls = result.data.links.map((link) => link.url);
        expect(urls).toContain('https://example.com/en/home');
        expect(urls).toContain('https://example.com/fr/accueil');
        expect(urls).toContain('https://example.com/blog/post');
      }
    });

    it('should apply defaults when noDefaultExcludes is false', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/',
        'https://example.com/blog/post',
        'https://example.com/fr/accueil',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
        noDefaultExcludes: false, // Explicitly false (should apply defaults)
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // With defaults, blog and language routes should be filtered
        const urls = result.data.links.map((link) => link.url);
        expect(urls).toContain('https://example.com/');
        expect(urls).not.toContain('https://example.com/blog/post');
        expect(urls).not.toContain('https://example.com/fr/accueil');
      }
    });

    it('should apply defaults when noDefaultExcludes is undefined', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/',
        'https://example.com/blog/post',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
        // noDefaultExcludes not specified - should default to false (apply defaults)
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        const urls = result.data.links.map((link) => link.url);
        expect(urls).toContain('https://example.com/');
        expect(urls).not.toContain('https://example.com/blog/post');
      }
    });

    it('should bypass all filtering when noFiltering is true', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/',
        'https://example.com/blog/post',
        'https://example.com/de/home',
        'https://example.com/api/users',
        'https://example.com/file.pdf',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
        excludePaths: ['/api'], // Custom excludes
        excludeExtensions: ['.pdf'], // Extension excludes
        noFiltering: true, // Should override all excludes
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // With --no-filtering, ALL URLs should be kept (no filtering applied)
        expect(result.data.links).toHaveLength(5);
        const urls = result.data.links.map((link) => link.url);
        expect(urls).toContain('https://example.com/');
        expect(urls).toContain('https://example.com/blog/post');
        expect(urls).toContain('https://example.com/de/home');
        expect(urls).toContain('https://example.com/api/users');
        expect(urls).toContain('https://example.com/file.pdf');
      }
    });

    it('should not attach filter stats when noFiltering is true', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/blog/post',
        'https://example.com/de/home',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
        noFiltering: true,
      });

      expect(result.success).toBe(true);
      // No filter stats should be attached when filtering is disabled
      expect(result.filterStats).toBeUndefined();
    });

    it('should override noDefaultExcludes when noFiltering is true', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/blog/post',
        'https://example.com/api/users',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
        noDefaultExcludes: false, // Try to apply defaults
        excludePaths: ['/api'], // Try to apply custom excludes
        noFiltering: true, // Should override everything
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // noFiltering should override all other exclude options
        expect(result.data.links).toHaveLength(2);
      }
    });

    it('should explicitly send ignoreQueryParameters: false when noFiltering is true', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/page?id=1',
        'https://example.com/page?id=2',
      ]);
      const container = createContainer(mockClient);

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
        ignoreQueryParameters: true, // Try to set this
        noFiltering: true, // Should override and send false to API
      });

      // Verify SDK was called with explicit false
      expect(mockClient.map).toHaveBeenCalledWith('https://example.com', {
        ignoreQueryParameters: false,
      });
      expect(mockClient.map).toHaveBeenCalledTimes(1);
    });

    it('should send ignoreQueryParameters when noFiltering is false', async () => {
      const mockClient = createMockMapClient(['https://example.com/page']);
      const container = createContainer(mockClient);

      await executeMap(container, {
        urlOrJobId: 'https://example.com',
        ignoreQueryParameters: true,
        noFiltering: false, // Should allow ignoreQueryParameters to be sent
      });

      // Verify SDK was called WITH ignoreQueryParameters
      expect(mockClient.map).toHaveBeenCalledWith('https://example.com', {
        ignoreQueryParameters: true,
      });
    });

    it('should attach filter stats when URLs are excluded', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/',
        'https://example.com/blog/post',
        'https://example.com/en/home',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(true);
      expect(result.filterStats).toBeDefined();
      expect(result.filterStats?.total).toBe(3);
      expect(result.filterStats?.excluded).toBeGreaterThan(0);
      expect(result.filterStats?.kept).toBeLessThan(3);
    });

    it('should include excludedUrls when verbose is true', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/',
        'https://example.com/blog/post',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
        verbose: true,
      });

      expect(result.success).toBe(true);
      expect(result.excludedUrls).toBeDefined();
      expect(Array.isArray(result.excludedUrls)).toBe(true);
    });

    it('should not include excludedUrls when verbose is false', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/',
        'https://example.com/blog/post',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
        verbose: false,
      });

      expect(result.success).toBe(true);
      expect(result.excludedUrls).toBeUndefined();
    });

    it('should not attach filter stats when no URLs are excluded', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/',
        'https://example.com/about',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
        noDefaultExcludes: true,
      });

      expect(result.success).toBe(true);
      expect(result.filterStats).toBeUndefined();
    });

    it('should handle empty results after filtering', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/blog/post-1',
        'https://example.com/blog/post-2',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.links).toHaveLength(0);
      }
    });

    it('should preserve URL metadata during filtering', async () => {
      const mockClient = createMockMapClient([
        {
          url: 'https://example.com/about',
          title: 'About Us',
          description: 'Learn about us',
        },
        {
          url: 'https://example.com/blog/post',
          title: 'Blog Post',
          description: 'A blog post',
        },
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.links).toHaveLength(1);
        expect(result.data.links[0]).toEqual({
          url: 'https://example.com/about',
          title: 'About Us',
          description: 'Learn about us',
        });
      }
    });

    it('should combine custom excludes with defaults', async () => {
      const mockClient = createMockMapClient([
        'https://example.com/',
        'https://example.com/api/users',
        'https://example.com/blog/post',
        'https://example.com/de/home',
      ]);
      const container = createContainer(mockClient);

      const result = await executeMap(container, {
        urlOrJobId: 'https://example.com',
        excludePaths: ['/api'],
      });

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        const urls = result.data.links.map((link) => link.url);
        expect(urls).toContain('https://example.com/');
        // Custom exclude
        expect(urls).not.toContain('https://example.com/api/users');
        // Default excludes (blog, language routes)
        expect(urls).not.toContain('https://example.com/blog/post');
        expect(urls).not.toContain('https://example.com/de/home');
      }
    });
  });
});
