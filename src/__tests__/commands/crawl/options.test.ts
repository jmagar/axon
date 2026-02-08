import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCrawlOptions,
  mergeExcludeExtensions,
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

  afterEach(() => {});

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

  it('should handle exclude paths', () => {
    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      excludePaths: ['/admin', '/api'],
    };

    const result = buildCrawlOptions(options);

    // Should include custom paths plus default binary extensions
    expect(result.excludePaths).toContain('/admin');
    expect(result.excludePaths).toContain('/api');
    expect(result.excludePaths).toContain('\\.exe$');
    expect(result.excludePaths).toContain('\\.pkg$');
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
      pollInterval: 3,
      timeout: 120,
      delay: 500,
      maxConcurrency: 10,
    };

    const result = buildCrawlOptions(options);

    expect(result.limit).toBe(50);
    expect(result.maxDiscoveryDepth).toBe(2);
    expect(result.excludePaths).toContain('/admin');
    expect(result.excludePaths).toContain('\\.exe$'); // Default extensions included
    expect(result.includePaths).toEqual(['/blog']);
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

    expect(result).toContain('/admin');
    expect(result).toContain('/blog/');
  });

  it('should return empty array when defaults are skipped and settings/CLI are empty', () => {
    vi.mocked(loadSettings).mockReturnValue({});

    const result = mergeExcludePaths(undefined, true);

    expect(result).toEqual([]);
  });

  it('should include built-in defaults when settings and CLI are empty', () => {
    vi.mocked(loadSettings).mockReturnValue({});

    const result = mergeExcludePaths(undefined, false);

    expect(result).toContain('/blog/');
    expect(result).toContain('/de/*');
    expect(result).toContain('/fr/*');
  });

  it('should preserve order of defaults first, then CLI', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludePaths: ['/default1', '/default2'],
    });

    const result = mergeExcludePaths(['/cli1', '/cli2'], false);

    // Set preserves insertion order
    expect(result).toEqual(['/default1', '/default2', '/cli1', '/cli2']);
  });

  it('should merge extension patterns with exclude paths', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludePaths: ['/admin'],
    });

    const extensionPatterns = ['\\.pkg$', '\\.exe$'];
    const result = mergeExcludePaths(['/api'], false, extensionPatterns);

    expect(result).toEqual(['/admin', '/api', '\\.pkg$', '\\.exe$']);
  });

  it('should deduplicate extension patterns with paths', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludePaths: ['\\.pkg$', '/admin'],
    });

    const extensionPatterns = ['\\.pkg$', '\\.exe$'];
    const result = mergeExcludePaths(['/api'], false, extensionPatterns);

    expect(result).toEqual(['\\.pkg$', '/admin', '/api', '\\.exe$']);
  });

  it('should handle empty extension patterns', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludePaths: ['/admin'],
    });

    const result = mergeExcludePaths(['/api'], false, []);

    expect(result).toEqual(['/admin', '/api']);
  });

  it('should filter empty strings from extension patterns', () => {
    vi.mocked(loadSettings).mockReturnValue({});

    const extensionPatterns = ['\\.pkg$', '', '  ', '\\.exe$'];
    const result = mergeExcludePaths(undefined, false, extensionPatterns);

    expect(result).toContain('/blog/');
    expect(result).toContain('\\.pkg$');
    expect(result).toContain('\\.exe$');
  });

  it('should escape leading query-string patterns for regex safety', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludePaths: ['?output=print'],
    });

    const result = mergeExcludePaths(undefined, false);

    expect(result).toContain('\\?output=print');
  });
});

describe('mergeExcludeExtensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use built-in defaults when no settings exist', () => {
    vi.mocked(loadSettings).mockReturnValue({});

    const result = mergeExcludeExtensions(undefined, false);

    // Should return DEFAULT_EXCLUDE_EXTENSIONS (24 extensions)
    expect(result.length).toBeGreaterThan(20);
    expect(result).toContain('.exe');
    expect(result).toContain('.pkg');
    expect(result).toContain('.dmg');
  });

  it('should prefer user settings over built-in defaults', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludeExtensions: ['.custom', '.test'],
    });

    const result = mergeExcludeExtensions(undefined, false);

    expect(result).toEqual(['.custom', '.test']);
  });

  it('should skip all defaults when requested', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludeExtensions: ['.custom'],
    });

    const result = mergeExcludeExtensions(undefined, true);

    expect(result).toEqual([]);
  });

  it('should handle undefined CLI extensions', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludeExtensions: ['.exe', '.pkg'],
    });

    const result = mergeExcludeExtensions(undefined, false);

    expect(result).toEqual(['.exe', '.pkg']);
  });

  it('should merge CLI extensions with defaults', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludeExtensions: ['.exe', '.pkg'],
    });

    const result = mergeExcludeExtensions(['.dmg', '.zip'], false);

    expect(result).toEqual(['.exe', '.pkg', '.dmg', '.zip']);
  });

  it('should deduplicate extensions', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludeExtensions: ['.exe', '.pkg'],
    });

    const result = mergeExcludeExtensions(['.exe', '.dmg'], false);

    expect(result).toEqual(['.exe', '.pkg', '.dmg']);
  });

  it('should filter empty strings', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludeExtensions: ['.exe', '', '.pkg'],
    });

    const result = mergeExcludeExtensions(['', '.dmg', '  '], false);

    expect(result).toEqual(['.exe', '.pkg', '.dmg']);
  });

  it('should return empty array when settings and CLI are empty and skipDefaults is true', () => {
    vi.mocked(loadSettings).mockReturnValue({});

    const result = mergeExcludeExtensions(undefined, true);

    expect(result).toEqual([]);
  });
});

describe('buildCrawlOptions with extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {});

  it('should include default binary extensions in excludePaths', () => {
    vi.mocked(loadSettings).mockReturnValue({});

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
    };

    const result = buildCrawlOptions(options);

    // Should have extension patterns converted to wildcard paths
    expect(result.excludePaths).toBeDefined();
    expect(result.excludePaths?.length).toBeGreaterThan(20);
    expect(result.excludePaths).toContain('\\.exe$');
    expect(result.excludePaths).toContain('\\.pkg$');
    expect(result.excludePaths).toContain('\\.dmg$');
    expect(result.excludePaths).toContain('/blog/');
  });

  it('should combine extensions with custom exclude paths', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludeExtensions: ['.exe', '.pkg'],
    });

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      excludePaths: ['/admin', '/api'],
    };

    const result = buildCrawlOptions(options);

    expect(result.excludePaths).toContain('/admin');
    expect(result.excludePaths).toContain('/api');
    expect(result.excludePaths).toContain('\\.exe$');
    expect(result.excludePaths).toContain('\\.pkg$');
  });

  it('should combine extensions with default exclude paths from settings', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludePaths: ['/login', '/logout'],
      defaultExcludeExtensions: ['.exe', '.pkg'],
    });

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
    };

    const result = buildCrawlOptions(options);

    expect(result.excludePaths).toContain('/login');
    expect(result.excludePaths).toContain('/logout');
    expect(result.excludePaths).toContain('\\.exe$');
    expect(result.excludePaths).toContain('\\.pkg$');
  });

  it('should skip extensions when noDefaultExcludes is true', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludeExtensions: ['.exe', '.pkg'],
    });

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      noDefaultExcludes: true,
    };

    const result = buildCrawlOptions(options);

    expect(result.excludePaths).toBeUndefined();
  });

  it('should deduplicate paths and extension patterns', () => {
    vi.mocked(loadSettings).mockReturnValue({
      defaultExcludePaths: ['\\.exe$', '/admin'],
      defaultExcludeExtensions: ['.exe', '.pkg'],
    });

    const options: CrawlOptions = {
      urlOrJobId: 'https://example.com',
      excludePaths: ['/admin'],
    };

    const result = buildCrawlOptions(options);

    // Should have deduplicated \\.exe$ and /admin
    const exeCount = result.excludePaths?.filter((p) => p === '\\.exe$').length;
    const adminCount = result.excludePaths?.filter(
      (p) => p === '/admin'
    ).length;
    expect(exeCount).toBe(1);
    expect(adminCount).toBe(1);
  });
});
