/**
 * Tests for URL utilities
 */

import { describe, expect, it } from 'vitest';
import { isUrl, normalizeUrl } from '../../utils/url';

describe('URL Utilities', () => {
  describe('isUrl', () => {
    describe('URLs with protocol', () => {
      it('should return true for valid http URLs', () => {
        expect(isUrl('http://example.com')).toBe(true);
        expect(isUrl('http://www.example.com')).toBe(true);
        expect(isUrl('http://example.com/path')).toBe(true);
        expect(isUrl('http://example.com/path?query=value')).toBe(true);
        expect(isUrl('http://example.com:8080')).toBe(true);
      });

      it('should return true for valid https URLs', () => {
        expect(isUrl('https://example.com')).toBe(true);
        expect(isUrl('https://www.example.com')).toBe(true);
        expect(isUrl('https://example.com/path')).toBe(true);
        expect(isUrl('https://example.com/path?query=value')).toBe(true);
        expect(isUrl('https://api.firecrawl.dev')).toBe(true);
      });

      it('should be case-insensitive for protocol', () => {
        expect(isUrl('HTTP://example.com')).toBe(true);
        expect(isUrl('HTTPS://example.com')).toBe(true);
        expect(isUrl('Http://example.com')).toBe(true);
      });
    });

    describe('URLs without protocol (domain detection)', () => {
      it('should return true for domain-like strings', () => {
        expect(isUrl('example.com')).toBe(true);
        expect(isUrl('www.example.com')).toBe(true);
        expect(isUrl('sub.domain.example.com')).toBe(true);
        expect(isUrl('firecrawl.dev')).toBe(true);
      });

      it('should return true for domains with paths', () => {
        expect(isUrl('example.com/path')).toBe(true);
        expect(isUrl('example.com/path/to/page')).toBe(true);
        expect(isUrl('docs.firecrawl.dev/api')).toBe(true);
      });

      it('should return true for domains with various TLDs', () => {
        expect(isUrl('example.co.uk')).toBe(true);
        expect(isUrl('example.io')).toBe(true);
        expect(isUrl('example.org')).toBe(true);
        expect(isUrl('example.net')).toBe(true);
      });
    });

    describe('Non-URLs', () => {
      it('should return false for plain text without dots', () => {
        expect(isUrl('hello')).toBe(false);
        expect(isUrl('test')).toBe(false);
        expect(isUrl('search query')).toBe(false);
      });

      it('should return false for flags and options', () => {
        expect(isUrl('--help')).toBe(false);
        expect(isUrl('-h')).toBe(false);
        expect(isUrl('--format')).toBe(false);
        expect(isUrl('-o.txt')).toBe(false);
      });

      it('should return false for strings with spaces', () => {
        expect(isUrl('hello world')).toBe(false);
        expect(isUrl('example .com')).toBe(false);
        expect(isUrl('www. example.com')).toBe(false);
      });

      it('should return false for empty string', () => {
        expect(isUrl('')).toBe(false);
      });

      it('should return false for just dots', () => {
        expect(isUrl('.')).toBe(false);
        expect(isUrl('..')).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should handle localhost-like strings', () => {
        // localhost without TLD is not detected as URL without protocol
        expect(isUrl('localhost')).toBe(false);
        expect(isUrl('http://localhost')).toBe(true);
        expect(isUrl('http://localhost:3000')).toBe(true);
      });

      it('should handle subdomains', () => {
        expect(isUrl('api.example.com')).toBe(true);
        expect(isUrl('v2.api.example.com')).toBe(true);
        expect(isUrl('https://api.firecrawl.dev/v2')).toBe(true);
      });
    });
  });

  describe('normalizeUrl', () => {
    it('should add https:// to URLs without protocol', () => {
      expect(normalizeUrl('example.com')).toBe('https://example.com');
      expect(normalizeUrl('www.example.com')).toBe('https://www.example.com');
      expect(normalizeUrl('firecrawl.dev')).toBe('https://firecrawl.dev');
    });

    it('should add https:// to URLs with paths', () => {
      expect(normalizeUrl('example.com/path')).toBe('https://example.com/path');
      expect(normalizeUrl('example.com/path?query=value')).toBe(
        'https://example.com/path?query=value'
      );
    });

    it('should not modify URLs that already have http://', () => {
      expect(normalizeUrl('http://example.com')).toBe('http://example.com');
      expect(normalizeUrl('http://www.example.com/path')).toBe(
        'http://www.example.com/path'
      );
    });

    it('should not modify URLs that already have https://', () => {
      expect(normalizeUrl('https://example.com')).toBe('https://example.com');
      expect(normalizeUrl('https://www.example.com/path')).toBe(
        'https://www.example.com/path'
      );
    });

    it('should be case-insensitive for existing protocols', () => {
      expect(normalizeUrl('HTTP://example.com')).toBe('HTTP://example.com');
      expect(normalizeUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
      expect(normalizeUrl('Http://example.com')).toBe('Http://example.com');
    });

    it('should handle complex URLs', () => {
      expect(normalizeUrl('api.firecrawl.dev/v2/scrape?url=test')).toBe(
        'https://api.firecrawl.dev/v2/scrape?url=test'
      );
      expect(normalizeUrl('example.com:8080/api')).toBe(
        'https://example.com:8080/api'
      );
    });
  });
});
