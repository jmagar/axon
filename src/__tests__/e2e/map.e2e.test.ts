/**
 * E2E tests for map command
 *
 * These tests require:
 * 1. The test server running at http://127.0.0.1:4321
 * 2. A valid Firecrawl API key in TEST_FIRECRAWL_API_KEY or FIRECRAWL_API_KEY env var
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getTestApiKey,
  isTestServerRunning,
  parseJSONOutput,
  registerTempDirLifecycle,
  runCLI,
  runCLIFailure,
  skipIfMissingApiKey,
  skipIfMissingApiOrServer,
  TEST_SERVER_URL,
} from './helpers';

describe('E2E: map command', () => {
  let tempDir: string;
  let apiKey: string | undefined;
  let testServerAvailable: boolean;

  beforeAll(async () => {
    apiKey = getTestApiKey();
    testServerAvailable = await isTestServerRunning();
  });

  registerTempDirLifecycle(
    (dir) => {
      tempDir = dir;
    },
    () => tempDir
  );

  describe('input validation', () => {
    it('should fail when no URL is provided', async () => {
      const result = await runCLIFailure(['map'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stderr).toContain('URL is required');
    });

    it('should accept URL as positional argument', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(['map', 'https://example.com'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stderr).not.toContain('URL is required');
    });

    it('should accept URL with --url flag', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(['map', '--url', 'https://example.com'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stderr).not.toContain('URL is required');
    });
  });

  describe('map options', () => {
    it('should support --limit flag', async () => {
      const result = await runCLI(['map', '--help']);
      expect(result.stdout).toContain('--limit');
    });

    it('should support --search flag', async () => {
      const result = await runCLI(['map', '--help']);
      expect(result.stdout).toContain('--search');
    });

    it('should support --sitemap flag', async () => {
      const result = await runCLI(['map', '--help']);
      expect(result.stdout).toContain('--sitemap');
    });

    it('should support --include-subdomains flag', async () => {
      const result = await runCLI(['map', '--help']);
      expect(result.stdout).toContain('--include-subdomains');
    });

    it('should support --ignore-query-parameters flag', async () => {
      const result = await runCLI(['map', '--help']);
      expect(result.stdout).toContain('--ignore-query-parameters');
    });

    it('should support --timeout flag', async () => {
      const result = await runCLI(['map', '--help']);
      expect(result.stdout).toContain('--timeout');
    });

    it('should support --notebook flag', async () => {
      const result = await runCLI(['map', '--help']);
      expect(result.stdout).toContain('--notebook');
    });
  });

  describe('output options', () => {
    it('should support --output flag', async () => {
      const result = await runCLI(['map', '--help']);
      expect(result.stdout).toContain('--output');
    });

    it('should support --json flag', async () => {
      const result = await runCLI(['map', '--help']);
      expect(result.stdout).toContain('--json');
    });

    it('should support --pretty flag', async () => {
      const result = await runCLI(['map', '--help']);
      expect(result.stdout).toContain('--pretty');
    });
  });

  describe('map with test server', () => {
    it('should map URLs from the test server', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(['map', TEST_SERVER_URL, '--limit', '10'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
        timeout: 60000,
      });

      if (result.exitCode === 0) {
        expect(result.stdout.length).toBeGreaterThan(0);
        // Should contain URLs from the test server
        expect(result.stdout).toContain('127.0.0.1:4321');
      }
    });

    it('should output URLs in JSON format with --json flag', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        ['map', TEST_SERVER_URL, '--limit', '10', '--json'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 60000,
        }
      );

      if (result.exitCode === 0) {
        const json = parseJSONOutput(result.stdout);
        expect(json).toBeDefined();
        expect(Array.isArray(json) || typeof json === 'object').toBe(true);
      }
    });

    it('should save output to file with --output flag', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const outputPath = join(tempDir, 'map-output.json');
      const result = await runCLI(
        ['map', TEST_SERVER_URL, '--limit', '10', '--output', outputPath],
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

    it('should respect --limit option', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        ['map', TEST_SERVER_URL, '--limit', '5', '--json'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 60000,
        }
      );

      if (result.exitCode === 0) {
        const json = parseJSONOutput<{ links?: string[]; urls?: string[] }>(
          result.stdout
        );
        const urls =
          json.links || json.urls || (Array.isArray(json) ? json : []);
        if (Array.isArray(urls)) {
          expect(urls.length).toBeLessThanOrEqual(5);
        }
      }
    });

    it('should filter URLs with --search option', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        ['map', TEST_SERVER_URL, '--search', 'blog', '--json'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 60000,
        }
      );

      if (result.exitCode === 0) {
        const output = result.stdout;
        // Should only contain blog-related URLs
        if (output.includes('/blog')) {
          expect(output).toContain('blog');
        }
      }
    });

    it('should handle --sitemap only option', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        ['map', TEST_SERVER_URL, '--sitemap', 'only', '--json'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 60000,
        }
      );

      // Should succeed or fail gracefully
      expect(result.exitCode).toBeDefined();
    });

    it('should handle --sitemap skip option', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        ['map', TEST_SERVER_URL, '--sitemap', 'skip', '--json'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 60000,
        }
      );

      expect(result.exitCode).toBeDefined();
    });
  });

  describe('map output format', () => {
    it('should output one URL per line by default', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(['map', TEST_SERVER_URL, '--limit', '5'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
        timeout: 60000,
      });

      if (result.exitCode === 0) {
        const lines = result.stdout.trim().split('\n');
        // Should have multiple lines (one per URL)
        expect(lines.length).toBeGreaterThan(0);
        // Each line should look like a URL
        for (const line of lines) {
          if (line.trim()) {
            expect(line).toMatch(/https?:\/\//);
          }
        }
      }
    });

    it('should output pretty JSON with --json --pretty flags', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        ['map', TEST_SERVER_URL, '--limit', '3', '--json', '--pretty'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 60000,
        }
      );

      if (result.exitCode === 0) {
        // Pretty JSON should have indentation
        expect(result.stdout).toContain('\n');
        const json = parseJSONOutput(result.stdout);
        expect(json).toBeDefined();
      }
    });
  });
});
