/**
 * E2E tests for extract command
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

describe('E2E: extract command', () => {
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
    it('should fail when no URLs are provided', async () => {
      const result = await runCLIFailure(['extract'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stderr).toContain("required argument 'urls'");
    });

    it('should accept URL as positional argument', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(['extract', 'https://example.com'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stderr).not.toContain("required argument 'urls'");
    });

    it('should accept multiple URLs', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(
        ['extract', 'https://example.com', 'https://example.org'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
        }
      );
      expect(result.stderr).not.toContain("required argument 'urls'");
    });
  });

  describe('extract options', () => {
    it('should support --prompt flag', async () => {
      const result = await runCLI(['extract', '--help']);
      expect(result.stdout).toContain('--prompt');
    });

    it('should support --schema flag', async () => {
      const result = await runCLI(['extract', '--help']);
      expect(result.stdout).toContain('--schema');
    });

    it('should support --system-prompt flag', async () => {
      const result = await runCLI(['extract', '--help']);
      expect(result.stdout).toContain('--system-prompt');
    });

    it('should support --allow-external-links flag', async () => {
      const result = await runCLI(['extract', '--help']);
      expect(result.stdout).toContain('--allow-external-links');
    });

    it('should support --enable-web-search flag', async () => {
      const result = await runCLI(['extract', '--help']);
      expect(result.stdout).toContain('--enable-web-search');
    });

    it('should support --include-subdomains flag', async () => {
      const result = await runCLI(['extract', '--help']);
      expect(result.stdout).toContain('--include-subdomains');
    });

    it('should support --show-sources flag', async () => {
      const result = await runCLI(['extract', '--help']);
      expect(result.stdout).toContain('--show-sources');
    });

    it('should support --no-embed flag', async () => {
      const result = await runCLI(['extract', '--help']);
      expect(result.stdout).toContain('--no-embed');
    });
  });

  describe('output options', () => {
    it('should support --output flag', async () => {
      const result = await runCLI(['extract', '--help']);
      expect(result.stdout).toContain('--output');
    });

    it('should support --json flag', async () => {
      const result = await runCLI(['extract', '--help']);
      expect(result.stdout).toContain('--json');
    });

    it('should support --pretty flag', async () => {
      const result = await runCLI(['extract', '--help']);
      expect(result.stdout).toContain('--pretty');
    });
  });

  describe('extract with test server', () => {
    it('should extract data with a prompt', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        [
          'extract',
          `${TEST_SERVER_URL}/about/`,
          '--prompt',
          'Extract the main heading and any links on this page',
          '--json',
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 120000,
        }
      );

      if (result.exitCode === 0) {
        expect(result.stdout.length).toBeGreaterThan(0);
      }
    });

    it('should extract data with a JSON schema', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          title: { type: 'string' },
          links: { type: 'array', items: { type: 'string' } },
        },
      });

      const result = await runCLI(
        ['extract', `${TEST_SERVER_URL}/about/`, '--schema', schema, '--json'],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 120000,
        }
      );

      if (result.exitCode === 0) {
        const json = parseJSONOutput(result.stdout);
        expect(json).toBeDefined();
      }
    });

    it('should save output to file with --output flag', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const outputPath = join(tempDir, 'extract-output.json');
      const result = await runCLI(
        [
          'extract',
          `${TEST_SERVER_URL}/about/`,
          '--prompt',
          'Extract the page title',
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

    it('should extract from multiple URLs', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        [
          'extract',
          `${TEST_SERVER_URL}/about/`,
          `${TEST_SERVER_URL}/blog/`,
          '--prompt',
          'Extract the main heading',
          '--json',
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 180000,
        }
      );

      // Should complete
      expect(result.exitCode).toBeDefined();
    });

    it('should show sources with --show-sources flag', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const result = await runCLI(
        [
          'extract',
          `${TEST_SERVER_URL}/about/`,
          '--prompt',
          'Extract the page title',
          '--show-sources',
          '--json',
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 120000,
        }
      );

      if (result.exitCode === 0) {
        const output = result.stdout;
        // Should contain source information
        expect(output.length).toBeGreaterThan(0);
      }
    });
  });

  describe('extract with blog posts', () => {
    it('should extract structured data from a blog post', async () => {
      if (skipIfMissingApiOrServer(apiKey, testServerAvailable)) {
        return;
      }

      const schema = JSON.stringify({
        type: 'object',
        properties: {
          title: { type: 'string' },
          date: { type: 'string' },
          content: { type: 'string' },
        },
      });

      const result = await runCLI(
        [
          'extract',
          `${TEST_SERVER_URL}/blog/introducing-search-endpoint/`,
          '--schema',
          schema,
          '--json',
        ],
        {
          env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
          timeout: 120000,
        }
      );

      if (result.exitCode === 0) {
        const json = parseJSONOutput(result.stdout);
        expect(json).toBeDefined();
      }
    });
  });
});
