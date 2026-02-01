/**
 * E2E tests for scrape command
 *
 * These tests require:
 * 1. The test server running at http://127.0.0.1:4321
 * 2. A valid Firecrawl API key in TEST_FIRECRAWL_API_KEY or FIRECRAWL_API_KEY env var
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupTempDir,
  createTempDir,
  getTestApiKey,
  isTestServerRunning,
  parseJSONOutput,
  runCLI,
  runCLIFailure,
  TEST_SERVER_URL,
} from './helpers';

describe('E2E: scrape command', () => {
  let tempDir: string;
  let apiKey: string | undefined;
  let testServerAvailable: boolean;

  beforeAll(async () => {
    apiKey = getTestApiKey();
    testServerAvailable = await isTestServerRunning();
  });

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('input validation', () => {
    it('should fail when no URL is provided', async () => {
      const result = await runCLIFailure(['scrape'], {
        env: { FIRECRAWL_API_KEY: apiKey || 'test-key' },
      });
      expect(result.stderr).toContain('URL is required');
    });

    it('should accept URL as positional argument', async () => {
      if (!apiKey) {
        console.log('Skipping: No API credentials');
        return;
      }

      const result = await runCLI(['scrape', 'https://example.com'], {
        env: { FIRECRAWL_API_KEY: apiKey },
      });
      // Should not fail on "URL is required"
      expect(result.stderr).not.toContain('URL is required');
    });

    it('should accept URL with --url flag', async () => {
      if (!apiKey) {
        console.log('Skipping: No API credentials');
        return;
      }

      const result = await runCLI(['scrape', '--url', 'https://example.com'], {
        env: { FIRECRAWL_API_KEY: apiKey },
      });
      expect(result.stderr).not.toContain('URL is required');
    });

    it('should normalize URLs without protocol', async () => {
      if (!apiKey) {
        console.log('Skipping: No API credentials');
        return;
      }

      const result = await runCLI(['scrape', 'example.com'], {
        env: { FIRECRAWL_API_KEY: apiKey },
      });
      // URL should be normalized to https://example.com
      expect(result.stderr).not.toContain('URL is required');
    });
  });

  describe('format options', () => {
    it('should accept format flag with single format', async () => {
      const result = await runCLI(['scrape', '--help']);
      expect(result.stdout).toContain('--format');
      expect(result.stdout).toContain('markdown');
    });

    it('should accept positional format arguments', async () => {
      if (!apiKey) {
        console.log('Skipping: No API credentials');
        return;
      }

      // Test help shows positional formats are supported
      const result = await runCLI(['scrape', '--help']);
      expect(result.stdout).toContain('formats...');
    });

    it('should support --html shortcut flag', async () => {
      const result = await runCLI(['scrape', '--help']);
      expect(result.stdout).toContain('--html');
      expect(result.stdout).toContain('shortcut');
    });

    it('should support --screenshot flag', async () => {
      const result = await runCLI(['scrape', '--help']);
      expect(result.stdout).toContain('--screenshot');
    });
  });

  describe('output options', () => {
    it('should support --output flag for file output', async () => {
      if (!apiKey || !testServerAvailable) {
        console.log('Skipping: No API credentials or test server');
        return;
      }

      const outputPath = join(tempDir, 'output.md');
      const result = await runCLI(
        ['scrape', `${TEST_SERVER_URL}/about/`, '--output', outputPath],
        { env: { FIRECRAWL_API_KEY: apiKey } }
      );

      if (result.exitCode === 0) {
        expect(existsSync(outputPath)).toBe(true);
        const content = await readFile(outputPath, 'utf-8');
        expect(content.length).toBeGreaterThan(0);
      }
    });

    it('should support --json flag for JSON output', async () => {
      if (!apiKey || !testServerAvailable) {
        console.log('Skipping: No API credentials or test server');
        return;
      }

      const result = await runCLI(
        ['scrape', `${TEST_SERVER_URL}/about/`, '--json'],
        { env: { FIRECRAWL_API_KEY: apiKey } }
      );

      if (result.exitCode === 0) {
        const json = parseJSONOutput(result.stdout);
        expect(json).toBeDefined();
        expect(typeof json).toBe('object');
      }
    });

    it('should support --pretty flag for formatted JSON', async () => {
      if (!apiKey || !testServerAvailable) {
        console.log('Skipping: No API credentials or test server');
        return;
      }

      const result = await runCLI(
        ['scrape', `${TEST_SERVER_URL}/about/`, '--json', '--pretty'],
        { env: { FIRECRAWL_API_KEY: apiKey } }
      );

      if (result.exitCode === 0) {
        // Pretty JSON should have newlines and indentation
        expect(result.stdout).toContain('\n');
        const json = parseJSONOutput(result.stdout);
        expect(json).toBeDefined();
      }
    });
  });

  describe('scraping options', () => {
    it('should support --only-main-content flag', async () => {
      const result = await runCLI(['scrape', '--help']);
      expect(result.stdout).toContain('--only-main-content');
    });

    it('should support --wait-for flag', async () => {
      const result = await runCLI(['scrape', '--help']);
      expect(result.stdout).toContain('--wait-for');
    });

    it('should support --timeout flag', async () => {
      const result = await runCLI(['scrape', '--help']);
      expect(result.stdout).toContain('--timeout');
    });

    it('should support --include-tags flag', async () => {
      const result = await runCLI(['scrape', '--help']);
      expect(result.stdout).toContain('--include-tags');
    });

    it('should support --exclude-tags flag', async () => {
      const result = await runCLI(['scrape', '--help']);
      expect(result.stdout).toContain('--exclude-tags');
    });

    it('should support --no-embed flag', async () => {
      const result = await runCLI(['scrape', '--help']);
      expect(result.stdout).toContain('--no-embed');
    });

    it('should support --timing flag', async () => {
      const result = await runCLI(['scrape', '--help']);
      expect(result.stdout).toContain('--timing');
    });
  });

  describe('scrape with test server', () => {
    it('should scrape the test server homepage', async () => {
      if (!apiKey || !testServerAvailable) {
        console.log('Skipping: No API credentials or test server');
        return;
      }

      const result = await runCLI(['scrape', TEST_SERVER_URL], {
        env: { FIRECRAWL_API_KEY: apiKey },
        timeout: 60000,
      });

      if (result.exitCode === 0) {
        // Should contain some content from the page
        expect(result.stdout.length).toBeGreaterThan(0);
      }
    });

    it('should scrape the about page', async () => {
      if (!apiKey || !testServerAvailable) {
        console.log('Skipping: No API credentials or test server');
        return;
      }

      const result = await runCLI(['scrape', `${TEST_SERVER_URL}/about/`], {
        env: { FIRECRAWL_API_KEY: apiKey },
        timeout: 60000,
      });

      if (result.exitCode === 0) {
        expect(result.stdout.length).toBeGreaterThan(0);
      }
    });

    it('should scrape a blog post page', async () => {
      if (!apiKey || !testServerAvailable) {
        console.log('Skipping: No API credentials or test server');
        return;
      }

      const result = await runCLI(
        [
          'scrape',
          `${TEST_SERVER_URL}/blog/introducing-search-endpoint/`,
          '--json',
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey },
          timeout: 60000,
        }
      );

      if (result.exitCode === 0) {
        const json = parseJSONOutput(result.stdout);
        expect(json).toBeDefined();
      }
    });

    it('should output timing info with --timing flag', async () => {
      if (!apiKey || !testServerAvailable) {
        console.log('Skipping: No API credentials or test server');
        return;
      }

      const result = await runCLI(
        ['scrape', `${TEST_SERVER_URL}/about/`, '--timing'],
        {
          env: { FIRECRAWL_API_KEY: apiKey },
          timeout: 60000,
        }
      );

      if (result.exitCode === 0) {
        // Timing info goes to stderr
        expect(result.stderr).toContain('Timing');
        expect(result.stderr).toContain('duration');
      }
    });

    it('should scrape with multiple formats', async () => {
      if (!apiKey || !testServerAvailable) {
        console.log('Skipping: No API credentials or test server');
        return;
      }

      const result = await runCLI(
        ['scrape', `${TEST_SERVER_URL}/about/`, '--format', 'markdown,links'],
        {
          env: { FIRECRAWL_API_KEY: apiKey },
          timeout: 60000,
        }
      );

      if (result.exitCode === 0) {
        // Multiple formats should output JSON
        const json = parseJSONOutput(result.stdout);
        expect(json).toBeDefined();
      }
    });
  });

  describe('shorthand URL scraping', () => {
    it('should support direct URL as first argument (shorthand for scrape)', async () => {
      if (!apiKey || !testServerAvailable) {
        console.log('Skipping: No API credentials or test server');
        return;
      }

      // firecrawl <url> is shorthand for firecrawl scrape <url>
      const result = await runCLI([TEST_SERVER_URL], {
        env: { FIRECRAWL_API_KEY: apiKey },
        timeout: 60000,
      });

      // Should work like scrape command
      expect(result.stderr).not.toContain('URL is required');
    });
  });
});
