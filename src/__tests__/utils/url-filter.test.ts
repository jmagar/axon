import { describe, expect, it, vi } from 'vitest';
import { filterUrls, matchesPattern } from '../../utils/url-filter';

describe('matchesPattern', () => {
  describe('literal substring matching', () => {
    it('matches simple path patterns', () => {
      expect(matchesPattern('https://example.com/blog/post', 'blog')).toBe(
        true
      );
      expect(matchesPattern('https://example.com/api/users', 'api')).toBe(true);
      expect(matchesPattern('https://example.com/products', 'blog')).toBe(
        false
      );
    });

    it('matches anywhere in the URL', () => {
      expect(matchesPattern('https://example.com/en/about', '/en/')).toBe(true);
      expect(matchesPattern('https://example.com/about/en/', '/en/')).toBe(
        true
      );
      expect(matchesPattern('https://example.com/about', '/en/')).toBe(false);
    });

    it('is case-sensitive for literal patterns', () => {
      expect(matchesPattern('https://example.com/Blog', 'Blog')).toBe(true);
      expect(matchesPattern('https://example.com/blog', 'Blog')).toBe(false);
      expect(matchesPattern('https://example.com/blog', 'blog')).toBe(true);
    });
  });

  describe('regex pattern matching', () => {
    it('matches patterns ending with $', () => {
      expect(matchesPattern('https://example.com/page.pdf', '\\.pdf$')).toBe(
        true
      );
      expect(
        matchesPattern('https://example.com/page.pdf.html', '\\.pdf$')
      ).toBe(false);
      expect(matchesPattern('https://example.com/page.html', '\\.pdf$')).toBe(
        false
      );
    });

    it('matches patterns with backslashes', () => {
      expect(
        matchesPattern('https://example.com/page.exe', '\\.(exe|pkg|dmg)$')
      ).toBe(true);
      expect(
        matchesPattern('https://example.com/page.pkg', '\\.(exe|pkg|dmg)$')
      ).toBe(true);
      expect(
        matchesPattern('https://example.com/page.txt', '\\.(exe|pkg|dmg)$')
      ).toBe(false);
    });

    it('handles complex regex patterns', () => {
      expect(
        matchesPattern(
          'https://example.com/en/page',
          '^https://[^/]+/[a-z]{2}/'
        )
      ).toBe(true);
      expect(
        matchesPattern(
          'https://example.com/eng/page',
          '^https://[^/]+/[a-z]{2}/'
        )
      ).toBe(false);
    });
  });

  describe('glob pattern matching', () => {
    it('matches recursive extension globs', () => {
      expect(
        matchesPattern('https://example.com/docs/file.pdf', '**/*.pdf')
      ).toBe(true);
      expect(matchesPattern('https://example.com/file.txt', '**/*.pdf')).toBe(
        false
      );
    });

    it('matches single-segment wildcards', () => {
      expect(
        matchesPattern('https://example.com/blog/post-1', '/blog/?ost-*')
      ).toBe(true);
      expect(
        matchesPattern('https://example.com/blog/deep/post-1', '/blog/?ost-*')
      ).toBe(false);
    });
  });

  describe('ReDoS protection', () => {
    it('rejects glob patterns with more than 50 wildcards', () => {
      // Create a pattern with 51 wildcards
      const maliciousPattern = '/*'.repeat(51);
      expect(() =>
        matchesPattern('https://example.com/test', maliciousPattern)
      ).toThrow('Glob pattern too complex: 51 wildcards (max 50)');
    });

    it('accepts glob patterns with exactly 50 wildcards', () => {
      // Create a pattern with exactly 50 wildcards
      const validPattern = '/*'.repeat(50);
      expect(() =>
        matchesPattern('https://example.com/test', validPattern)
      ).not.toThrow();
    });

    it('accepts glob patterns with fewer than 50 wildcards', () => {
      const validPattern = '/*'.repeat(25);
      expect(() =>
        matchesPattern('https://example.com/test', validPattern)
      ).not.toThrow();
    });

    it('completes complex glob matching within reasonable time', () => {
      // Test that a pattern with 50 wildcards completes quickly (< 100ms)
      const pattern = '/*'.repeat(50);
      const url = 'https://example.com/' + 'a/'.repeat(100);

      const startTime = performance.now();
      try {
        matchesPattern(url, pattern);
      } catch {
        // Pattern might throw or not match, we only care about timing
      }
      const endTime = performance.now();

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(100);
    });

    it('rejects various malicious wildcard patterns', () => {
      const maliciousPatterns = [
        '*'.repeat(51), // 51 single wildcards
        '**'.repeat(26), // 52 wildcards via double-star
        '*/*'.repeat(26), // 52 wildcards via mixed pattern
      ];

      for (const pattern of maliciousPatterns) {
        expect(() =>
          matchesPattern('https://example.com/test', pattern)
        ).toThrow(/Glob pattern too complex/);
      }
    });

    it('counts both single and double wildcards correctly', () => {
      // Mix of * and ** should count all wildcards
      const pattern = '**/*'.repeat(17) + '**'; // 17*3 + 2 = 53 wildcards
      expect(() => matchesPattern('https://example.com/test', pattern)).toThrow(
        'Glob pattern too complex: 53 wildcards (max 50)'
      );
    });
  });

  describe('edge cases', () => {
    it('throws error on invalid regex patterns', () => {
      // Invalid regex (unmatched parenthesis)
      expect(() =>
        matchesPattern('https://example.com/test', '(invalid')
      ).toThrow(/Invalid exclude pattern.*syntax errors/);
    });

    it('handles special characters in URLs with escaped patterns', () => {
      // These contain regex metacharacters, so they're treated as regex
      // Need to escape them properly
      expect(
        matchesPattern('https://example.com/path?query=1', '\\?query=')
      ).toBe(true);
      expect(matchesPattern('https://example.com/path#anchor', 'anchor')).toBe(
        true
      );
    });

    it('handles empty patterns', () => {
      expect(matchesPattern('https://example.com/test', '')).toBe(true);
    });
  });
});

describe('filterUrls', () => {
  const urls = [
    { url: 'https://example.com/' },
    { url: 'https://example.com/about' },
    { url: 'https://example.com/blog/post-1' },
    { url: 'https://example.com/blog/post-2' },
    { url: 'https://example.com/api/users' },
    { url: 'https://example.com/en/home' },
    { url: 'https://example.com/fr/accueil' },
    { url: 'https://example.com/page.pdf' },
  ];

  describe('basic filtering', () => {
    it('filters URLs with single pattern', () => {
      const result = filterUrls(urls, ['/blog/']);

      expect(result.filtered).toHaveLength(6);
      expect(result.stats.total).toBe(8);
      expect(result.stats.excluded).toBe(2);
      expect(result.stats.kept).toBe(6);
      expect(result.excluded).toHaveLength(2);
      expect(result.excluded[0].url).toBe('https://example.com/blog/post-1');
      expect(result.excluded[0].matchedPattern).toBe('/blog/');
    });

    it('filters URLs with multiple patterns', () => {
      const result = filterUrls(urls, ['/blog/', '/api']);

      expect(result.filtered).toHaveLength(5);
      expect(result.stats.excluded).toBe(3);
      expect(result.excluded.map((e) => e.url)).toEqual([
        'https://example.com/blog/post-1',
        'https://example.com/blog/post-2',
        'https://example.com/api/users',
      ]);
    });

    it('filters with regex patterns', () => {
      const result = filterUrls(urls, ['\\.pdf$', '^https://[^/]+/(en|fr)/']);

      expect(result.filtered).toHaveLength(5);
      expect(result.stats.excluded).toBe(3);
      expect(result.excluded.map((e) => e.url)).toEqual([
        'https://example.com/en/home',
        'https://example.com/fr/accueil',
        'https://example.com/page.pdf',
      ]);
    });

    it('filters with glob patterns', () => {
      const result = filterUrls(urls, ['**/*.pdf', '**/blog/*']);

      expect(result.filtered).toHaveLength(5);
      expect(result.stats.excluded).toBe(3);
      expect(result.excluded.map((e) => e.url)).toEqual([
        'https://example.com/blog/post-1',
        'https://example.com/blog/post-2',
        'https://example.com/page.pdf',
      ]);
    });
  });

  describe('edge cases', () => {
    it('returns all URLs when no patterns provided', () => {
      const result = filterUrls(urls, []);

      expect(result.filtered).toHaveLength(8);
      expect(result.stats.excluded).toBe(0);
      expect(result.excluded).toHaveLength(0);
    });

    it('returns empty when all URLs excluded', () => {
      const result = filterUrls(urls, ['^https://']);

      expect(result.filtered).toHaveLength(0);
      expect(result.stats.excluded).toBe(8);
    });

    it('handles empty URL array', () => {
      const result = filterUrls([], ['/blog/']);

      expect(result.filtered).toHaveLength(0);
      expect(result.stats.total).toBe(0);
      expect(result.stats.excluded).toBe(0);
    });

    it('handles URLs with title and description', () => {
      const urlsWithMeta = [
        {
          url: 'https://example.com/blog/post',
          title: 'Blog Post',
          description: 'A post',
        },
        {
          url: 'https://example.com/about',
          title: 'About',
          description: 'About us',
        },
      ];

      const result = filterUrls(urlsWithMeta, ['/blog/']);

      expect(result.filtered).toHaveLength(1);
      expect(result.filtered[0]).toEqual({
        url: 'https://example.com/about',
        title: 'About',
        description: 'About us',
      });
    });

    it('stops on first matching pattern', () => {
      const result = filterUrls(urls, ['/blog/', '/post-']);

      // Should only record '/blog/' as matched pattern, not '/post-'
      expect(result.excluded[0].matchedPattern).toBe('/blog/');
      expect(result.excluded[1].matchedPattern).toBe('/blog/');
    });
  });

  describe('invalid patterns', () => {
    it('throws error on invalid regex pattern', () => {
      expect(() => filterUrls(urls, ['(invalid', '/blog/'])).toThrow(
        /Invalid exclude pattern.*syntax errors/
      );
    });
  });
});
