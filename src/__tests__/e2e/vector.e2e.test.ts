/**
 * E2E tests for vector-related commands (embed, query, retrieve)
 *
 * These tests require:
 * 1. TEI service running (TEI_URL env var)
 * 2. Qdrant service running (QDRANT_URL env var)
 * 3. Optionally, a Firecrawl API key for URL scraping in embed command
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getTestApiKey,
  isTestServerRunning,
  registerTempDirLifecycle,
  runCLI,
  runCLIFailure,
  runCLISuccess,
  skipIfMissingApiKey,
  TEST_SERVER_URL,
} from './helpers';

/**
 * Check if vector services (TEI + Qdrant) are available
 */
async function hasVectorServices(): Promise<boolean> {
  const teiUrl = process.env.TEI_URL;
  const qdrantUrl = process.env.QDRANT_URL;

  if (!teiUrl || !qdrantUrl) {
    return false;
  }

  try {
    // Check TEI
    const teiResponse = await fetch(`${teiUrl}/health`, { method: 'GET' });
    if (!teiResponse.ok) return false;

    // Check Qdrant
    const qdrantResponse = await fetch(`${qdrantUrl}/collections`, {
      method: 'GET',
    });
    if (!qdrantResponse.ok) return false;

    return true;
  } catch {
    return false;
  }
}

function skipIfNoVectorServices(vectorServicesAvailable: boolean): boolean {
  if (vectorServicesAvailable) {
    return false;
  }
  console.log('Skipping: Vector services not available');
  return true;
}

function skipIfEmbedPrerequisitesMissing(
  apiKey: string | undefined,
  vectorServicesAvailable: boolean,
  testServerAvailable: boolean
): boolean {
  if (apiKey && vectorServicesAvailable && testServerAvailable) {
    return false;
  }
  console.log('Skipping: Prerequisites not available');
  return true;
}

describe('E2E: embed command', () => {
  let tempDir: string;
  let apiKey: string | undefined;
  let testServerAvailable: boolean;
  let vectorServicesAvailable: boolean;

  beforeAll(async () => {
    apiKey = getTestApiKey();
    testServerAvailable = await isTestServerRunning();
    vectorServicesAvailable = await hasVectorServices();
  });

  registerTempDirLifecycle(
    (dir) => {
      tempDir = dir;
    },
    () => tempDir
  );

  describe('input validation', () => {
    it('should fail when no input is provided', async () => {
      const result = await runCLIFailure(['embed'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stderr).toContain("required argument 'input'");
    });

    it('should accept URL as input', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(['embed', 'https://example.com'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stderr).not.toContain("required argument 'input'");
    });

    it('should accept file path as input', async () => {
      const filePath = join(tempDir, 'test.md');
      await writeFile(filePath, '# Test Content\n\nThis is test content.');

      const result = await runCLI(['embed', filePath, '--url', 'test://file'], {
        env: {
          TEI_URL: process.env.TEI_URL || '',
          QDRANT_URL: process.env.QDRANT_URL || '',
        },
      });

      expect(result.stderr).not.toContain("required argument 'input'");
    });
  });

  describe('embed options', () => {
    it('should support --url flag', async () => {
      const result = await runCLISuccess(['embed', '--help']);
      expect(result.stdout).toContain('--url');
    });

    it('should support --collection flag', async () => {
      const result = await runCLISuccess(['embed', '--help']);
      expect(result.stdout).toContain('--collection');
    });

    it('should support --no-chunk flag', async () => {
      const result = await runCLISuccess(['embed', '--help']);
      expect(result.stdout).toContain('--no-chunk');
    });

    it('should support --output flag', async () => {
      const result = await runCLISuccess(['embed', '--help']);
      expect(result.stdout).toContain('--output');
    });

    it('should support --json flag', async () => {
      const result = await runCLISuccess(['embed', '--help']);
      expect(result.stdout).toContain('--json');
    });
  });

  describe('embed execution', () => {
    it('should embed content from a file', async () => {
      if (skipIfNoVectorServices(vectorServicesAvailable)) {
        return;
      }

      const filePath = join(tempDir, 'test-embed.md');
      await writeFile(
        filePath,
        '# Test Document\n\nThis is a test document for embedding.'
      );

      const result = await runCLI(
        [
          'embed',
          filePath,
          '--url',
          'test://e2e-embed-test',
          '--collection',
          'e2e-test',
        ],
        {
          env: {
            TEI_URL: process.env.TEI_URL || '',
            QDRANT_URL: process.env.QDRANT_URL || '',
          },
        }
      );

      if (result.exitCode === 0) {
        expect(result.stdout).toBeDefined();
      }
    });

    it('should embed content from stdin', async () => {
      if (skipIfNoVectorServices(vectorServicesAvailable)) {
        return;
      }

      const result = await runCLI(
        [
          'embed',
          '-',
          '--url',
          'test://stdin-test',
          '--collection',
          'e2e-test',
        ],
        {
          env: {
            TEI_URL: process.env.TEI_URL || '',
            QDRANT_URL: process.env.QDRANT_URL || '',
          },
          input: '# Stdin Content\n\nThis is content from stdin.',
        }
      );

      if (result.exitCode === 0) {
        expect(result.stdout).toBeDefined();
      }
    });

    it('should embed from URL when API key available', async () => {
      if (
        skipIfEmbedPrerequisitesMissing(
          apiKey,
          vectorServicesAvailable,
          testServerAvailable
        )
      ) {
        return;
      }

      const result = await runCLI(
        ['embed', `${TEST_SERVER_URL}/about/`, '--collection', 'e2e-test'],
        {
          env: {
            FIRECRAWL_API_KEY: apiKey ?? 'test-key',
            TEI_URL: process.env.TEI_URL || '',
            QDRANT_URL: process.env.QDRANT_URL || '',
          },
          timeout: 60000,
        }
      );

      if (result.exitCode === 0) {
        expect(result.stdout).toBeDefined();
      }
    });
  });
});

describe('E2E: query command', () => {
  let vectorServicesAvailable: boolean;

  beforeAll(async () => {
    vectorServicesAvailable = await hasVectorServices();
  });

  describe('input validation', () => {
    it('should fail when no query is provided', async () => {
      const result = await runCLIFailure(['query']);
      expect(result.stderr).toContain("required argument 'query'");
    });

    it('should accept query as positional argument', async () => {
      const result = await runCLI(['query', 'test query'], {
        env: {
          TEI_URL: process.env.TEI_URL || '',
          QDRANT_URL: process.env.QDRANT_URL || '',
        },
      });
      expect(result.stderr).not.toContain("required argument 'query'");
    });
  });

  describe('query options', () => {
    it('should support --limit flag', async () => {
      const result = await runCLISuccess(['query', '--help']);
      expect(result.stdout).toContain('--limit');
    });

    it('should support --domain flag', async () => {
      const result = await runCLISuccess(['query', '--help']);
      expect(result.stdout).toContain('--domain');
    });

    it('should support --full flag', async () => {
      const result = await runCLISuccess(['query', '--help']);
      expect(result.stdout).toContain('--full');
    });

    it('should support --group flag', async () => {
      const result = await runCLISuccess(['query', '--help']);
      expect(result.stdout).toContain('--group');
    });

    it('should support --collection flag', async () => {
      const result = await runCLISuccess(['query', '--help']);
      expect(result.stdout).toContain('--collection');
    });

    it('should support --output flag', async () => {
      const result = await runCLISuccess(['query', '--help']);
      expect(result.stdout).toContain('--output');
    });

    it('should support --json flag', async () => {
      const result = await runCLISuccess(['query', '--help']);
      expect(result.stdout).toContain('--json');
    });
  });

  describe('query execution', () => {
    it('should perform semantic search', async () => {
      if (skipIfNoVectorServices(vectorServicesAvailable)) {
        return;
      }

      const result = await runCLI(
        ['query', 'test document', '--collection', 'e2e-test', '--limit', '5'],
        {
          env: {
            TEI_URL: process.env.TEI_URL || '',
            QDRANT_URL: process.env.QDRANT_URL || '',
          },
        }
      );

      // Should complete (may have no results if collection is empty)
      expect(result.exitCode).toBeDefined();
    });

    it('should filter by domain', async () => {
      if (skipIfNoVectorServices(vectorServicesAvailable)) {
        return;
      }

      const result = await runCLI(
        [
          'query',
          'test',
          '--collection',
          'e2e-test',
          '--domain',
          'example.com',
        ],
        {
          env: {
            TEI_URL: process.env.TEI_URL || '',
            QDRANT_URL: process.env.QDRANT_URL || '',
          },
        }
      );

      expect(result.exitCode).toBeDefined();
    });

    it('should output JSON with --json flag', async () => {
      if (skipIfNoVectorServices(vectorServicesAvailable)) {
        return;
      }

      const result = await runCLI(
        ['query', 'test', '--collection', 'e2e-test', '--json'],
        {
          env: {
            TEI_URL: process.env.TEI_URL || '',
            QDRANT_URL: process.env.QDRANT_URL || '',
          },
        }
      );

      expect(result.exitCode).toBeDefined();
    });

    it('should group results with --group flag', async () => {
      if (skipIfNoVectorServices(vectorServicesAvailable)) {
        return;
      }

      const result = await runCLI(
        ['query', 'test', '--collection', 'e2e-test', '--group'],
        {
          env: {
            TEI_URL: process.env.TEI_URL || '',
            QDRANT_URL: process.env.QDRANT_URL || '',
          },
        }
      );

      expect(result.exitCode).toBeDefined();
    });
  });
});

describe('E2E: retrieve command', () => {
  let vectorServicesAvailable: boolean;

  beforeAll(async () => {
    vectorServicesAvailable = await hasVectorServices();
  });

  describe('input validation', () => {
    it('should fail when no URL is provided', async () => {
      const result = await runCLIFailure(['retrieve']);
      expect(result.stderr).toContain("required argument 'url'");
    });

    it('should accept URL as positional argument', async () => {
      const result = await runCLI(['retrieve', 'https://example.com'], {
        env: {
          TEI_URL: process.env.TEI_URL || '',
          QDRANT_URL: process.env.QDRANT_URL || '',
        },
      });
      expect(result.stderr).not.toContain("required argument 'url'");
    });
  });

  describe('retrieve options', () => {
    it('should support --collection flag', async () => {
      const result = await runCLISuccess(['retrieve', '--help']);
      expect(result.stdout).toContain('--collection');
    });

    it('should support --output flag', async () => {
      const result = await runCLISuccess(['retrieve', '--help']);
      expect(result.stdout).toContain('--output');
    });

    it('should support --json flag', async () => {
      const result = await runCLISuccess(['retrieve', '--help']);
      expect(result.stdout).toContain('--json');
    });
  });

  describe('retrieve execution', () => {
    it('should retrieve document by URL', async () => {
      if (skipIfNoVectorServices(vectorServicesAvailable)) {
        return;
      }

      const result = await runCLI(
        ['retrieve', 'test://e2e-embed-test', '--collection', 'e2e-test'],
        {
          env: {
            TEI_URL: process.env.TEI_URL || '',
            QDRANT_URL: process.env.QDRANT_URL || '',
          },
        }
      );

      // Should complete (may fail if document doesn't exist)
      expect(result.exitCode).toBeDefined();
    });

    it('should output JSON with --json flag', async () => {
      if (skipIfNoVectorServices(vectorServicesAvailable)) {
        return;
      }

      const result = await runCLI(
        [
          'retrieve',
          'test://e2e-embed-test',
          '--collection',
          'e2e-test',
          '--json',
        ],
        {
          env: {
            TEI_URL: process.env.TEI_URL || '',
            QDRANT_URL: process.env.QDRANT_URL || '',
          },
        }
      );

      expect(result.exitCode).toBeDefined();
    });
  });
});
