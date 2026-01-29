/**
 * Tests for authentication utilities
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthenticated } from '../../utils/auth';
import { initializeConfig, resetConfig } from '../../utils/config';
import * as credentials from '../../utils/credentials';

// Mock credentials module
vi.mock('../../utils/credentials', () => ({
  loadCredentials: vi.fn(),
  saveCredentials: vi.fn(),
  getConfigDirectoryPath: vi.fn().mockReturnValue('/mock/config/path'),
}));

describe('Authentication Utilities', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetConfig();
    vi.clearAllMocks();
    // Clear env vars
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_URL;
    // Mock loadCredentials to return null by default
    vi.mocked(credentials.loadCredentials).mockReturnValue(null);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isAuthenticated', () => {
    it('should return true when API key is set in config', () => {
      initializeConfig({
        apiKey: 'fc-test-api-key',
        apiUrl: 'https://api.firecrawl.dev',
      });

      expect(isAuthenticated()).toBe(true);
    });

    it('should return true when API key is set via environment variable', () => {
      process.env.FIRECRAWL_API_KEY = 'fc-env-api-key';
      initializeConfig({});

      expect(isAuthenticated()).toBe(true);
    });

    it('should return true when API key is in stored credentials', () => {
      vi.mocked(credentials.loadCredentials).mockReturnValue({
        apiKey: 'fc-stored-api-key',
      });
      initializeConfig({});

      expect(isAuthenticated()).toBe(true);
    });

    it('should return false when no API key is set', () => {
      initializeConfig({});

      expect(isAuthenticated()).toBe(false);
    });

    it('should return false when API key is empty string', () => {
      initializeConfig({
        apiKey: '',
      });

      expect(isAuthenticated()).toBe(false);
    });

    it('should return true when API key does not start with fc-', () => {
      initializeConfig({
        apiKey: 'local-dev',
        apiUrl: 'http://localhost:53002',
      });

      expect(isAuthenticated()).toBe(true);
    });
  });

  describe('Authentication priority', () => {
    it('should prioritize provided API key over env var', () => {
      process.env.FIRECRAWL_API_KEY = 'fc-env-key';
      initializeConfig({
        apiKey: 'fc-provided-key',
      });

      expect(isAuthenticated()).toBe(true);
    });

    it('should prioritize env var over stored credentials', () => {
      process.env.FIRECRAWL_API_KEY = 'fc-env-key';
      vi.mocked(credentials.loadCredentials).mockReturnValue({
        apiKey: 'fc-stored-key',
      });
      initializeConfig({});

      expect(isAuthenticated()).toBe(true);
    });

    it('should fall back to stored credentials when no other source', () => {
      vi.mocked(credentials.loadCredentials).mockReturnValue({
        apiKey: 'fc-stored-key',
      });
      initializeConfig({});

      expect(isAuthenticated()).toBe(true);
    });
  });
});
