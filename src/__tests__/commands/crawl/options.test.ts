import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCrawlOptions,
  mergeExcludePaths,
} from '../../../commands/crawl/options';
import type { CrawlOptions } from '../../../types/crawl';

// Mock the settings module
vi.mock('../../../utils/settings', () => ({
  loadSettings: vi.fn(),
}));

import { loadSettings } from '../../../utils/settings';

describe('buildCrawlOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadSettings).mockReturnValue({});
  });

  it('should build basic crawl options', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      limit: 100,
      maxDepth: 3,
    };

    const result = buildCrawlOptions(options);

    expect(result.limit).toBe(100);
    expect(result.maxDiscoveryDepth).toBe(3);
  });

  it('should map maxDepth to maxDiscoveryDepth', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      maxDepth: 5,
    };

    const result = buildCrawlOptions(options);

    expect(result.maxDiscoveryDepth).toBe(5);
    expect('maxDepth' in result).toBe(false);
  });

  it('should handle all boolean options', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      ignoreQueryParameters: true,
      crawlEntireDomain: true,
      allowExternalLinks: true,
      allowSubdomains: true,
    };

    const result = buildCrawlOptions(options);

    expect(result.ignoreQueryParameters).toBe(true);
    expect(result.crawlEntireDomain).toBe(true);
    expect(result.allowExternalLinks).toBe(true);
    expect(result.allowSubdomains).toBe(true);
  });

  it('should handle delay and maxConcurrency', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      delay: 1000,
      maxConcurrency: 5,
    };

    const result = buildCrawlOptions(options);

    expect(result.delay).toBe(1000);
    expect(result.maxConcurrency).toBe(5);
  });

  it('should convert scrapeTimeout to nested milliseconds', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      scrapeTimeout: 15,
    };

    const result = buildCrawlOptions(options);

    expect(result.scrapeOptions).toBeDefined();
    expect(result.scrapeOptions?.timeout).toBe(15000);
  });

  it('should handle exclude paths', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      excludePaths: ['/admin', '/api'],
    };

    const result = buildCrawlOptions(options);

    expect(result.excludePaths).toEqual(['/admin', '/api']);
  });

  it('should handle include paths', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      includePaths: ['/blog', '/docs'],
    };

    const result = buildCrawlOptions(options);

    expect(result.includePaths).toEqual(['/blog', '/docs']);
  });

  it('should skip empty include paths', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      includePaths: [],
    };

    const result = buildCrawlOptions(options);

    expect(result.includePaths).toBeUndefined();
  });

  it('should convert pollInterval to milliseconds', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      pollInterval: 10,
    };

    const result = buildCrawlOptions(options);

    expect(result.pollInterval).toBe(10000);
  });

  it('should set default pollInterval for wait mode', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      wait: true,
    };

    const result = buildCrawlOptions(options);

    expect(result.pollInterval).toBe(5000);
  });

  it('should set default pollInterval for progress mode', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      progress: true,
    };

    const result = buildCrawlOptions(options);

    expect(result.pollInterval).toBe(5000);
  });

  it('should not set default pollInterval for async mode', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
    };

    const result = buildCrawlOptions(options);

    expect(result.pollInterval).toBeUndefined();
  });

  it('should convert timeout to crawlTimeout in milliseconds', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      timeout: 60,
    };

    const result = buildCrawlOptions(options);

    expect(result.crawlTimeout).toBe(60000);
  });

  it('should handle sitemap option', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      sitemap: 'include',
    };

    const result = buildCrawlOptions(options);

    expect(result.sitemap).toBe('include');
  });

  it('should skip undefined options', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      limit: undefined,
      maxDepth: undefined,
    };

    const result = buildCrawlOptions(options);

    expect(result.limit).toBeUndefined();
    expect(result.maxDiscoveryDepth).toBeUndefined();
  });

  it('should handle complex combined options', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      limit: 50,
      maxDepth: 2,
      excludePaths: ['/admin'],
      includePaths: ['/blog'],
      scrapeTimeout: 20,
      pollInterval: 3,
      timeout: 120,
      delay: 500,
      maxConcurrency: 10,
    };

    const result = buildCrawlOptions(options);

    expect(result.limit).toBe(50);
    expect(result.maxDiscoveryDepth).toBe(2);
    expect(result.excludePaths).toEqual(['/admin']);
    expect(result.includePaths).toEqual(['/blog']);
    expect(result.scrapeOptions?.timeout).toBe(20000);
    expect(result.pollInterval).toBe(3000);
    expect(result.crawlTimeout).toBe(120000);
    expect(result.delay).toBe(500);
    expect(result.maxConcurrency).toBe(10);
  });
});

describe('mergeExcludePaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should merge CLI excludes with defaults', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludePaths: ['/login', '/logout'],
    });

    const result = mergeExcludePaths(['/admin', '/api'], false);

    expect(result).toEqual(['/login', '/logout', '/admin', '/api']);
  });

  it('should deduplicate merged paths', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludePaths: ['/admin', '/logout'],
    });

    const result = mergeExcludePaths(['/admin', '/api'], false);

    expect(result).toEqual(['/admin', '/logout', '/api']);
  });

  it('should skip defaults when requested', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludePaths: ['/login', '/logout'],
    });

    const result = mergeExcludePaths(['/admin'], true);

    expect(result).toEqual(['/admin']);
  });

  it('should handle undefined CLI excludes', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludePaths: ['/login', '/logout'],
    });

    const result = mergeExcludePaths(undefined, false);

    expect(result).toEqual(['/login', '/logout']);
  });

  it('should handle missing default excludes', () => {
    vi.mocked(loadSettings).mockReturnValue({});

    const result = mergeExcludePaths(['/admin'], false);

    expect(result).toEqual(['/admin']);
  });

  it('should return empty array when both are empty', () => {
    vi.mocked(loadSettings).mockReturnValue({});

    const result = mergeExcludePaths(undefined, true);

    expect(result).toEqual([]);
  });

  it('should preserve order of defaults first, then CLI', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludePaths: ['/default1', '/default2'],
    });

    const result = mergeExcludePaths(['/cli1', '/cli2'], false);

    // Set preserves insertion order
    expect(result).toEqual(['/default1', '/default2', '/cli1', '/cli2']);
  });
});
