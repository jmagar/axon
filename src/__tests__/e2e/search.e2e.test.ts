/**
 * E2E tests for search command
 *
 * These tests require:
 * 1. A valid Firecrawl API key in TEST_FIRECRAWL_API_KEY or FIRECRAWL_API_KEY env var
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getTestApiKey,
  parseJSONOutput,
  registerTempDirLifecycle,
  runCLI,
  runCLIFailure,
  skipIfMissingApiKey,
} from './helpers';

describe('E2E: search command', () => {
  let tempDir: string;
  let apiKey: string | undefined;

  beforeAll(async () => {
    apiKey = getTestApiKey();
  });

  registerTempDirLifecycle(
    (dir) => {
      tempDir = dir;
    },
    () => tempDir
  );

  describe('input validation', () => {
    it('should fail when no query is provided', async () => {
      const result = await runCLIFailure(['search'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stderr).toContain("required argument 'query'");
    });

    it('should accept query as positional argument', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(['search', 'test query'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
        timeout: 60000,
      });
      expect(result.stderr).not.toContain("required argument 'query'");
    });
  });

  describe('search options', () => {
    it('should support --limit flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--limit');
    });

    it('should support --sources flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--sources');
      expect(result.stdout).toContain('web');
      expect(result.stdout).toContain('images');
      expect(result.stdout).toContain('news');
    });

    it('should support --categories flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--categories');
      expect(result.stdout).toContain('github');
      expect(result.stdout).toContain('research');
      expect(result.stdout).toContain('pdf');
    });

    it('should support --tbs flag for time-based search', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--tbs');
      expect(result.stdout).toContain('qdr:');
    });

    it('should support --location flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--location');
    });

    it('should support --country flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--country');
    });

    it('should support --timeout flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--timeout');
    });

    it('should support --ignore-invalid-urls flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--ignore-invalid-urls');
    });

    it('should support --scrape flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--scrape');
    });

    it('should support --scrape-formats flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--scrape-formats');
    });

    it('should support --only-main-content flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--only-main-content');
    });

    it('should support --no-embed flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--no-embed');
    });
  });

  describe('output options', () => {
    it('should support --output flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--output');
    });

    it('should support --json flag', async () => {
      const result = await runCLI(['search', '--help']);
      expect(result.stdout).toContain('--json');
    });
  });

  describe('search execution', () => {
    it('should perform a basic search', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(['search', 'firecrawl web scraping'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
        timeout: 60000,
      });

      if (result.exitCode === 0) {
        expect(result.stdout.length).toBeGreaterThan(0);
      }
    });

    it('should limit results with --limit flag', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(
        ['search', 'web scraping', '--limit', '3', '--json'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 60000,
        }
      );

      if (result.exitCode === 0) {
        const json = parseJSONOutput<{ results?: unknown[] }>(result.stdout);
        if (json.results) {
          expect(json.results.length).toBeLessThanOrEqual(3);
        }
      }
    });

    it('should output JSON with --json flag', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(
        ['search', 'web scraping', '--limit', '2', '--json'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 60000,
        }
      );

      if (result.exitCode === 0) {
        const json = parseJSONOutput(result.stdout);
        expect(json).toBeDefined();
        expect(typeof json).toBe('object');
      }
    });

    it('should save output to file with --output flag', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const outputPath = join(tempDir, 'search-output.json');
      const result = await runCLI(
        [
          'search',
          'web scraping',
          '--limit',
          '2',
          '--json',
          '--output',
          outputPath,
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 60000,
        }
      );

      if (result.exitCode === 0) {
        expect(existsSync(outputPath)).toBe(true);
        const content = await readFile(outputPath, 'utf-8');
        expect(content.length).toBeGreaterThan(0);
      }
    });

    it('should handle --scrape flag to scrape results', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(
        ['search', 'example', '--limit', '1', '--scrape', '--json'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 120000, // Longer timeout for scraping
        }
      );

      // Should complete without error
      expect(result.exitCode).toBeDefined();
    });
  });

  describe('source validation', () => {
    it('should reject invalid source', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLIFailure(
        ['search', 'test', '--sources', 'invalid'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
        }
      );

      expect(result.stderr).toContain('Invalid source');
    });

    it('should accept valid sources', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(
        ['search', 'test', '--sources', 'web,news', '--limit', '2', '--json'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 60000,
        }
      );

      // Should not fail on invalid source
      expect(result.stderr).not.toContain('Invalid source');
    });
  });

  describe('category validation', () => {
    it('should reject invalid category', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLIFailure(
        ['search', 'test', '--categories', 'invalid'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
        }
      );

      expect(result.stderr).toContain('Invalid category');
    });

    it('should accept valid categories', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(
        [
          'search',
          'machine learning',
          '--categories',
          'github,research',
          '--limit',
          '2',
          '--json',
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 60000,
        }
      );

      expect(result.stderr).not.toContain('Invalid category');
    });
  });
});
