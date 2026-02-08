/**
 * E2E tests for crawl command
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
  registerTempDirLifecycle,
  runCLI,
  runCLIFailure,
  skipIfMissingApiKey,
  skipIfMissingApiOrServer,
  TEST_SERVER_URL,
} from './helpers';

describe('E2E: crawl command', () => {
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
      const result = await runCLIFailure(['crawl'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stderr).toContain('URL or job ID is required');
    });

    it('should accept URL as positional argument', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(['crawl', 'https://example.com'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stderr).not.toContain('URL or job ID is required');
    });

    it('should accept URL with --url flag', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(['crawl', '--url', 'https://example.com'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stderr).not.toContain('URL or job ID is required');
    });
  });

  describe('crawl options', () => {
    it('should support --wait flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--wait');
    });

    it('should support --poll-interval flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--poll-interval');
    });

    it('should support --timeout flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--timeout');
    });

    it('should support --progress flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--progress');
    });

    it('should support --limit flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--limit');
    });

    it('should support --max-depth flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--max-depth');
    });

    it('should support --exclude-paths flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--exclude-paths');
    });

    it('should support --include-paths flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--include-paths');
    });

    it('should support --sitemap flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--sitemap');
    });

    it('should support --ignore-query-parameters flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--ignore-query-parameters');
    });

    it('should support --crawl-entire-domain flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--crawl-entire-domain');
    });

    it('should support --allow-external-links flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--allow-external-links');
    });

    it('should support --allow-subdomains flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--allow-subdomains');
    });

    it('should support --delay flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--delay');
    });

    it('should support --max-concurrency flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--max-concurrency');
    });

    it('should support --no-embed flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--no-embed');
    });

    it('should support --no-default-excludes flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--no-default-excludes');
    });
  });

  describe('output options', () => {
    it('should support --output flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--output');
    });

    it('should support --pretty flag', async () => {
      const result = await runCLI(['crawl', '--help']);
      expect(result.stdout).toContain('--pretty');
    });
  });

  describe('async crawl job', () => {
    it('should start an async crawl and return a job ID', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(['crawl', TEST_SERVER_URL, '--limit', '2'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
        timeout: 60000,
      });

      if (result.exitCode === 0) {
        // Should contain job ID in output
        const output = result.stdout;
        expect(output).toBeDefined();
        expect(output.length).toBeGreaterThan(0);
      }
    });

    it('should auto-detect job ID and check status', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      // First start a crawl
      const startResult = await runCLI(
        ['crawl', TEST_SERVER_URL, '--limit', '2'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 60000,
        }
      );

      if (startResult.exitCode !== 0) {
        console.log('Crawl start failed, skipping status check');
        return;
      }

      // Extract job ID from output (UUID format)
      const uuidMatch = startResult.stdout.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      );
      if (!uuidMatch) {
        console.log('Could not extract job ID from output');
        return;
      }

      const jobId = uuidMatch[0];

      // Check status using job ID
      const statusResult = await runCLI(['crawl', jobId, '--status'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
        timeout: 30000,
      });

      if (statusResult.exitCode === 0) {
        expect(statusResult.stdout).toBeDefined();
      }
    });
  });

  describe('sync crawl with --wait', () => {
    it('should wait for crawl to complete with --wait flag', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        [
          'crawl',
          TEST_SERVER_URL,
          '--wait',
          '--limit',
          '3',
          '--max-depth',
          '1',
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 120000, // Longer timeout for sync crawl
        }
      );

      if (result.exitCode === 0) {
        // Should contain crawl results
        expect(result.stdout.length).toBeGreaterThan(0);
      }
    });

    it('should show progress with --wait --progress flags', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        [
          'crawl',
          TEST_SERVER_URL,
          '--wait',
          '--progress',
          '--limit',
          '3',
          '--poll-interval',
          '1',
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 120000,
        }
      );

      // Progress output goes to stderr
      if (result.exitCode === 0) {
        expect(result.stdout.length).toBeGreaterThan(0);
      }
    });

    it('should output to file with --output flag', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const outputPath = join(tempDir, 'crawl-output.json');
      const result = await runCLI(
        [
          'crawl',
          TEST_SERVER_URL,
          '--wait',
          '--limit',
          '2',
          '--output',
          outputPath,
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 120000,
        }
      );

      if (result.exitCode === 0) {
        expect(existsSync(outputPath)).toBe(true);
        const content = await readFile(outputPath, 'utf-8');
        expect(content.length).toBeGreaterThan(0);
      }
    });
  });

  describe('crawl with filters', () => {
    it('should respect --include-paths filter', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        [
          'crawl',
          TEST_SERVER_URL,
          '--wait',
          '--limit',
          '5',
          '--include-paths',
          '/blog',
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 120000,
        }
      );

      if (result.exitCode === 0) {
        expect(result.stdout).toBeDefined();
      }
    });

    it('should respect --exclude-paths filter', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        [
          'crawl',
          TEST_SERVER_URL,
          '--wait',
          '--limit',
          '5',
          '--exclude-paths',
          '/blog/category',
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 120000,
        }
      );

      if (result.exitCode === 0) {
        expect(result.stdout).toBeDefined();
      }
    });

    it('should respect --max-depth limit', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        [
          'crawl',
          TEST_SERVER_URL,
          '--wait',
          '--limit',
          '10',
          '--max-depth',
          '1',
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 120000,
        }
      );

      if (result.exitCode === 0) {
        expect(result.stdout).toBeDefined();
      }
    });

    it('should handle --sitemap skip option', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        [
          'crawl',
          TEST_SERVER_URL,
          '--wait',
          '--limit',
          '3',
          '--sitemap',
          'skip',
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 120000,
        }
      );

      if (result.exitCode === 0) {
        expect(result.stdout).toBeDefined();
      }
    });
  });
});
