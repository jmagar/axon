/**
 * Tests for API key scrubbing utility
 */

import { describe, expect, it } from 'vitest';
import {
  maskApiKey,
  sanitizeUrlCredentials,
  scrubApiKeys,
  scrubErrorApiKeys,
  scrubHeaderApiKeys,
  scrubObjectApiKeys,
  scrubUrlApiKeys,
} from '../../utils/api-key-scrubber';

describe('API Key Scrubber', () => {
  describe('maskApiKey', () => {
    it('should mask short keys (< 8 chars) completely', () => {
      expect(maskApiKey('abc123')).toBe('******');
      expect(maskApiKey('key')).toBe('***');
    });

    it('should mask medium keys (8-15 chars) with asterisks', () => {
      expect(maskApiKey('abcdef1234')).toBe('********');
      expect(maskApiKey('test-key-123')).toBe('********');
    });

    it('should show prefix and suffix for long keys (16+ chars)', () => {
      const key = 'fc-1234567890abcdef1234567890';
      const masked = maskApiKey(key);
      expect(masked).toBe('fc-123...7890');
      expect(masked).toContain('fc-123');
      expect(masked).toContain('7890');
    });

    it('should handle empty or invalid input', () => {
      expect(maskApiKey('')).toBe('INVALID_KEY');
      expect(maskApiKey(null as unknown as string)).toBe('INVALID_KEY');
      expect(maskApiKey(undefined as unknown as string)).toBe('INVALID_KEY');
    });
  });

  describe('scrubApiKeys', () => {
    it('should scrub Firecrawl API keys', () => {
      const text = 'Using API key: fc-abcdef1234567890abcdefghij123456';
      const scrubbed = scrubApiKeys(text);
      expect(scrubbed).toBe('Using API key: [REDACTED]');
      expect(scrubbed).not.toContain('fc-abcdef');
    });

    it('should scrub API keys in key=value format', () => {
      const text = 'Connect with api_key=supersecret123456789012345';
      const scrubbed = scrubApiKeys(text);
      expect(scrubbed).toBe('Connect with api_key=[REDACTED]');
      expect(scrubbed).not.toContain('supersecret');
    });

    it('should scrub Bearer tokens', () => {
      const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const scrubbed = scrubApiKeys(text);
      expect(scrubbed).toBe('Authorization: Bearer [REDACTED]');
    });

    it('should scrub multiple keys in same text', () => {
      const text =
        'Keys: fc-abc123def456ghi789xyz012345 and api_key=secret123456789012';
      const scrubbed = scrubApiKeys(text);
      expect(scrubbed).not.toContain('fc-abc123');
      expect(scrubbed).not.toContain('secret123456');
      expect(scrubbed).toContain('[REDACTED]');
    });

    it('should use custom replacement text', () => {
      const text = 'API key: fc-1234567890abcdef1234567890';
      const scrubbed = scrubApiKeys(text, '***HIDDEN***');
      expect(scrubbed).toBe('API key: ***HIDDEN***');
    });

    it('should not modify text without API keys', () => {
      const text = 'This is a normal log message with no secrets';
      const scrubbed = scrubApiKeys(text);
      expect(scrubbed).toBe(text);
    });

    it('should handle empty or invalid input', () => {
      expect(scrubApiKeys('')).toBe('');
      expect(scrubApiKeys(null as unknown as string)).toBe(
        null as unknown as string
      );
    });

    it('should scrub long alphanumeric strings (potential keys)', () => {
      const text = 'Token: abcdef1234567890abcdef1234567890ghijklmnopq';
      const scrubbed = scrubApiKeys(text);
      expect(scrubbed).toContain('[REDACTED]');
    });
  });

  describe('scrubErrorApiKeys', () => {
    it('should scrub API keys from error message', () => {
      const error = new Error(
        'Failed to authenticate with key: fc-abc123def456ghi789xyz012345'
      );
      const scrubbed = scrubErrorApiKeys(error);

      expect(scrubbed.message).not.toContain('fc-abc123');
      expect(scrubbed.message).toContain('[REDACTED]');
    });

    it('should scrub API keys from stack trace', () => {
      const error = new Error('Auth failed');
      error.stack = `Error: Auth failed with fc-abc123def456ghi789xyz012345\n    at login (auth.ts:10)`;

      const scrubbed = scrubErrorApiKeys(error);

      expect(scrubbed.stack).not.toContain('fc-abc123');
      expect(scrubbed.stack).toContain('[REDACTED]');
    });

    it('should preserve error name', () => {
      const error = new TypeError(
        'Invalid key: fc-abc123def456ghi789xyz012345'
      );
      const scrubbed = scrubErrorApiKeys(error);

      expect(scrubbed.name).toBe('TypeError');
    });

    it('should handle errors with cause', () => {
      const cause = new Error('Root cause: fc-abc123def456ghi789xyz012345');
      const error = new Error('Wrapped error', { cause });

      const scrubbed = scrubErrorApiKeys(error);

      expect((scrubbed.cause as Error).message).not.toContain('fc-abc123');
    });

    it('should not modify original error', () => {
      const originalMessage = 'Error with fc-abc123def456ghi789xyz012345';
      const error = new Error(originalMessage);

      scrubErrorApiKeys(error);

      expect(error.message).toBe(originalMessage);
    });
  });

  describe('scrubUrlApiKeys', () => {
    it('should scrub API keys from query parameters', () => {
      const url = 'https://api.example.com/data?api_key=supersecret123456789';
      const scrubbed = scrubUrlApiKeys(url);

      expect(scrubbed).not.toContain('supersecret');
      expect(scrubbed).toContain('api_key=REDACTED');
    });

    it('should scrub API keys from URL path', () => {
      const url =
        'https://api.example.com/auth/fc-abc123def456ghi789xyz012345/verify';
      const scrubbed = scrubUrlApiKeys(url);

      expect(scrubbed).not.toContain('fc-abc123');
      expect(scrubbed).toContain('REDACTED');
    });

    it('should scrub multiple sensitive parameters', () => {
      const url =
        'https://api.example.com?api_key=key123456789012345&token=tok123456789012345';
      const scrubbed = scrubUrlApiKeys(url);

      expect(scrubbed).toContain('api_key=REDACTED');
      expect(scrubbed).toContain('token=REDACTED');
    });

    it('should preserve non-sensitive parameters', () => {
      const url = 'https://api.example.com?page=1&limit=10&api_key=secret123';
      const scrubbed = scrubUrlApiKeys(url);

      expect(scrubbed).toContain('page=1');
      expect(scrubbed).toContain('limit=10');
    });

    it('should handle malformed URLs gracefully', () => {
      const url = 'not-a-valid-url with fc-abc123def456ghi789xyz012345';
      const scrubbed = scrubUrlApiKeys(url);

      expect(scrubbed).not.toContain('fc-abc123');
      expect(scrubbed).toContain('REDACTED');
    });

    it('should scrub URL fragments', () => {
      const url =
        'https://api.example.com#token=fc-abc123def456ghi789xyz012345012345';
      const scrubbed = scrubUrlApiKeys(url);

      expect(scrubbed).not.toContain('fc-abc123');
      expect(scrubbed).toContain('REDACTED');
    });
  });

  describe('scrubHeaderApiKeys', () => {
    it('should scrub Authorization header', () => {
      const headers = {
        Authorization: 'Bearer fc-abc123def456ghi789xyz012345',
      };

      const scrubbed = scrubHeaderApiKeys(headers);

      expect(scrubbed.Authorization).toBe('[REDACTED]');
    });

    it('should scrub api-key header', () => {
      const headers = {
        'x-api-key': 'supersecret123456789',
        'Content-Type': 'application/json',
      };

      const scrubbed = scrubHeaderApiKeys(headers);

      expect(scrubbed['x-api-key']).toBe('[REDACTED]');
      expect(scrubbed['Content-Type']).toBe('application/json');
    });

    it('should handle array header values', () => {
      const headers = {
        Authorization: ['Bearer token1', 'Bearer token2'],
      };

      const scrubbed = scrubHeaderApiKeys(headers);

      expect(scrubbed.Authorization).toEqual(['[REDACTED]', '[REDACTED]']);
    });

    it('should scrub keys in non-sensitive header values', () => {
      const headers = {
        'User-Agent': 'MyApp/1.0 (key: fc-abc123def456ghi789xyz012345)',
      };

      const scrubbed = scrubHeaderApiKeys(headers);

      expect(scrubbed['User-Agent']).not.toContain('fc-abc123');
      expect(scrubbed['User-Agent']).toContain('[REDACTED]');
    });
  });

  describe('scrubObjectApiKeys', () => {
    it('should scrub API key properties', () => {
      const obj = {
        apiKey: 'fc-abc123def456ghi789xyz012345',
        username: 'user123',
      };

      const scrubbed = scrubObjectApiKeys(obj);

      expect(scrubbed.apiKey).toBe('[REDACTED]');
      expect(scrubbed.username).toBe('user123');
    });

    it('should scrub nested objects', () => {
      const obj = {
        config: {
          api_key: 'supersecret',
          timeout: 5000,
        },
        data: 'normal data',
      };

      const scrubbed = scrubObjectApiKeys(obj);

      expect(scrubbed.config.api_key).toBe('[REDACTED]');
      expect(scrubbed.config.timeout).toBe(5000);
    });

    it('should scrub keys in string values', () => {
      const obj = {
        message: 'Error with key: fc-abc123def456ghi789xyz012345',
        status: 'failed',
      };

      const scrubbed = scrubObjectApiKeys(obj);

      expect(scrubbed.message).not.toContain('fc-abc123');
      expect(scrubbed.message).toContain('[REDACTED]');
    });

    it('should handle arrays', () => {
      const obj = {
        keys: [
          'fc-abc123def456ghi789xyz012345',
          'fc-def456ghi789abc123xyz987654',
        ],
      };

      const scrubbed = scrubObjectApiKeys(obj);

      expect(scrubbed.keys).toEqual(['[REDACTED]', '[REDACTED]']);
    });

    it('should handle deep nesting with maxDepth limit', () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              apiKey: 'secret',
            },
          },
        },
      };

      const scrubbed = scrubObjectApiKeys(obj, 2);

      // Should stop at maxDepth and not scrub deeper levels
      expect(scrubbed.level1.level2.level3).toBeDefined();
    });

    it('should handle null and undefined values', () => {
      const obj = {
        nullValue: null,
        undefinedValue: undefined,
        key: 'fc-abc123def456ghi789xyz012345',
      };

      const scrubbed = scrubObjectApiKeys(obj);

      expect(scrubbed.nullValue).toBeNull();
      expect(scrubbed.undefinedValue).toBeUndefined();
      expect(scrubbed.key).not.toContain('fc-abc123');
    });

    it('should scrub password and secret fields', () => {
      const obj = {
        password: 'mypassword123',
        secret: 'mysecret456',
        public: 'public data',
      };

      const scrubbed = scrubObjectApiKeys(obj);

      expect(scrubbed.password).toBe('[REDACTED]');
      expect(scrubbed.secret).toBe('[REDACTED]');
      expect(scrubbed.public).toBe('public data');
    });

    it('should not modify original object', () => {
      const obj = {
        apiKey: 'fc-abc123def456ghi789xyz012345',
      };

      scrubObjectApiKeys(obj);

      expect(obj.apiKey).toBe('fc-abc123def456ghi789xyz012345');
    });
  });

  describe('sanitizeUrlCredentials', () => {
    it('should sanitize password in Redis URL', () => {
      const url = 'redis://user:secret@localhost:6379';
      const sanitized = sanitizeUrlCredentials(url);
      expect(sanitized).toBe('redis://user:***@localhost:6379');
      expect(sanitized).toContain('user');
      expect(sanitized).not.toContain('secret');
    });

    it('should sanitize password in PostgreSQL URL', () => {
      const url = 'postgres://admin:password123@db.example.com:5432/mydb';
      const sanitized = sanitizeUrlCredentials(url);
      expect(sanitized).toBe('postgres://admin:***@db.example.com:5432/mydb');
      expect(sanitized).toContain('admin');
      expect(sanitized).not.toContain('password123');
    });

    it('should sanitize password in RabbitMQ URL', () => {
      const url = 'amqp://guest:guest@rabbitmq:5672';
      const sanitized = sanitizeUrlCredentials(url);
      expect(sanitized).toBe('amqp://guest:***@rabbitmq:5672');
      expect(sanitized).toContain('guest:***');
    });

    it('should handle URL without credentials unchanged', () => {
      const url = 'http://localhost:3000';
      const sanitized = sanitizeUrlCredentials(url);
      // URL class may add trailing slash
      expect(sanitized).toMatch(/^http:\/\/localhost:3000\/?$/);
      expect(sanitized).not.toContain('***');
    });

    it('should handle URL with username but no password', () => {
      const url = 'redis://user@localhost:6379';
      const sanitized = sanitizeUrlCredentials(url);
      expect(sanitized).toBe('redis://user@localhost:6379');
      expect(sanitized).not.toContain('***');
    });

    it('should handle invalid URLs gracefully with regex fallback', () => {
      const url = 'not-a-valid://url:format';
      const sanitized = sanitizeUrlCredentials(url);
      expect(sanitized).toBe('not-a-valid://url:format');
    });

    it('should handle empty or invalid input', () => {
      expect(sanitizeUrlCredentials('')).toBe('');
      expect(sanitizeUrlCredentials(null as unknown as string)).toBe(null);
      expect(sanitizeUrlCredentials(undefined as unknown as string)).toBe(
        undefined
      );
    });

    it('should use regex fallback for URLs with credentials', () => {
      // Test the regex fallback path by creating an intentionally malformed URL
      const url = 'scheme://user:pass@host:port';
      const sanitized = sanitizeUrlCredentials(url);
      // This will use regex fallback since URL parsing fails
      expect(sanitized).toContain('user:***');
      expect(sanitized).not.toContain(':pass');
    });
  });
});
