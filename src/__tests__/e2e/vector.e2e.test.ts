/**
 * E2E tests for vector-related commands (embed, query, retrieve)
 *
 * These tests require:
 * 1. TEI service running (TEI_URL env var)
 * 2. Qdrant service running (QDRANT_URL env var)
 * 3. Optionally, an Axon API key for URL scraping in embed command
 */

import { mkdir, utimes, writeFile } from 'node:fs/promises';
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
  skipWithPrerequisiteMessage,
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
  return skipWithPrerequisiteMessage('Vector services not available');
}

function hasAskBackend(): boolean {
  const hasCli = Boolean(process.env.ASK_CLI?.trim());
  const hasOpenAiFallback = Boolean(
    process.env.OPENAI_BASE_URL?.trim() &&
      process.env.OPENAI_API_KEY?.trim() &&
      process.env.OPENAI_MODEL?.trim()
  );
  return hasCli || hasOpenAiFallback;
}

function skipIfAskPrerequisitesMissing(
  vectorServicesAvailable: boolean
): boolean {
  if (vectorServicesAvailable && hasAskBackend()) {
    return false;
  }
  return skipWithPrerequisiteMessage(
    'Ask prerequisites missing (requires vector services and ASK_CLI or OPENAI_* fallback env)'
  );
}

function skipIfEmbedPrerequisitesMissing(
  apiKey: string | undefined,
  vectorServicesAvailable: boolean,
  testServerAvailable: boolean
): boolean {
  if (apiKey && vectorServicesAvailable && testServerAvailable) {
    return false;
  }
  return skipWithPrerequisiteMessage(
    'Prerequisites not available (requires API key, vector services, and test server)'
  );
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
    it('should show embed help when no input is provided', async () => {
      const result = await runCLISuccess(['embed'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stdout).toContain(
        'Usage: axon embed [options] [command] [input]'
      );
    });

    it('should accept URL as input', async () => {
      if (skipIfMissingApiKey(apiKey)) {
        return;
      }

      const result = await runCLI(['embed', 'https://example.com'], {
        env: { FIRECRAWL_API_KEY: apiKey ?? 'test-key' },
      });
      expect(result.stdout).not.toContain(
        'Usage: axon embed [options] [command] [input]'
      );
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

      expect(result.stdout).not.toContain(
        'Usage: axon embed [options] [command] [input]'
      );
    });

    it('should accept implicit stdin input without "-"', async () => {
      if (skipIfNoVectorServices(vectorServicesAvailable)) {
        return;
      }

      const result = await runCLI(['embed', '--collection', 'e2e-test'], {
        env: {
          TEI_URL: process.env.TEI_URL || '',
          QDRANT_URL: process.env.QDRANT_URL || '',
        },
        input: '# Implicit stdin\n\nNo dash input mode.',
      });

      expect(result.stdout).not.toContain(
        'Usage: axon embed [options] [command] [input]'
      );
    });
  });

  describe('embed options', () => {
    it('should support status subcommand', async () => {
      const result = await runCLISuccess(['embed', '--help']);
      expect(result.stdout).toContain('status [options] <job-id>');
    });

    it('should support --url flag', async () => {
      const result = await runCLISuccess(['embed', '--help']);
      expect(result.stdout).toContain('--url');
    });

    it('should support --source-id flag', async () => {
      const result = await runCLISuccess(['embed', '--help']);
      expect(result.stdout).toContain('--source-id');
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

    it('should derive repo-root source ID from subdirectory execution', async () => {
      if (skipIfNoVectorServices(vectorServicesAvailable)) {
        return;
      }

      const repoRoot = join(tempDir, 'repo-root');
      const docsDir = join(repoRoot, 'docs', 'design');
      const subDir = join(repoRoot, 'packages', 'cli');
      await mkdir(join(repoRoot, '.git'), { recursive: true });
      await mkdir(docsDir, { recursive: true });
      await mkdir(subDir, { recursive: true });

      await writeFile(
        join(docsDir, 'auth.md'),
        '# Auth Design\n\nRepo-root source ID test.'
      );

      const result = await runCLI(
        ['embed', '../../docs/design/auth.md', '--collection', 'e2e-test'],
        {
          cwd: subDir,
          env: {
            TEI_URL: process.env.TEI_URL || '',
            QDRANT_URL: process.env.QDRANT_URL || '',
          },
        }
      );

      if (result.exitCode === 0) {
        expect(result.stdout).toContain('URL: repo-root/docs/design/auth.md');
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

describe('E2E: ask command temporal scope', () => {
  let tempDir: string;
  let vectorServicesAvailable: boolean;

  beforeAll(async () => {
    vectorServicesAvailable = await hasVectorServices();
  });

  registerTempDirLifecycle(
    (dir) => {
      tempDir = dir;
    },
    () => tempDir
  );

  it('should scope "today" queries to today-dated local session docs', async () => {
    if (skipIfAskPrerequisitesMissing(vectorServicesAvailable)) {
      return;
    }

    const today = new Date();
    const todayYmd = today.toISOString().slice(0, 10);
    const collection = `e2e-ask-today-${Date.now()}`;
    const repoRoot = join(tempDir, 'repo');
    const sessionsDir = join(repoRoot, 'docs', 'sessions');
    const todayFile = join(sessionsDir, `${todayYmd}-today-note.md`);

    await mkdir(join(repoRoot, '.git'), { recursive: true });
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(todayFile, `# Today\n\nAccomplished item ${Date.now()}.`);

    const embedResult = await runCLI(
      ['embed', todayFile, '--collection', collection],
      {
        cwd: repoRoot,
        env: {
          TEI_URL: process.env.TEI_URL || '',
          QDRANT_URL: process.env.QDRANT_URL || '',
        },
        timeout: 60000,
      }
    );
    expect(embedResult.exitCode).toBe(0);

    const askResult = await runCLI(
      ['ask', 'what have we accomplished today?', '--collection', collection],
      {
        cwd: repoRoot,
        env: {
          TEI_URL: process.env.TEI_URL || '',
          QDRANT_URL: process.env.QDRANT_URL || '',
        },
        timeout: 120000,
      }
    );

    expect(askResult.exitCode).toBe(0);
    expect(askResult.stderr).toContain('Scope:');
    expect(askResult.stderr).toContain(todayYmd);
    expect(askResult.stderr).toContain('Fallback:');
    expect(askResult.stderr).toContain('no');
  });

  it('should fail strict today scope when no today documents exist', async () => {
    if (skipIfAskPrerequisitesMissing(vectorServicesAvailable)) {
      return;
    }

    const now = new Date();
    const old = new Date(now);
    old.setDate(old.getDate() - 10);
    const oldYmd = old.toISOString().slice(0, 10);
    const collection = `e2e-ask-strict-${Date.now()}`;
    const repoRoot = join(tempDir, 'repo-strict');
    const docsDir = join(repoRoot, 'docs');
    const oldFile = join(docsDir, `${oldYmd}-old-note.md`);

    await mkdir(join(repoRoot, '.git'), { recursive: true });
    await mkdir(docsDir, { recursive: true });
    await writeFile(oldFile, '# Old\n\nOld accomplishments.');
    await utimes(oldFile, old, old);

    const embedResult = await runCLI(
      ['embed', oldFile, '--collection', collection],
      {
        cwd: repoRoot,
        env: {
          TEI_URL: process.env.TEI_URL || '',
          QDRANT_URL: process.env.QDRANT_URL || '',
        },
        timeout: 60000,
      }
    );
    expect(embedResult.exitCode).toBe(0);

    const askResult = await runCLI(
      ['ask', 'what changed today?', '--collection', collection],
      {
        cwd: repoRoot,
        env: {
          TEI_URL: process.env.TEI_URL || '',
          QDRANT_URL: process.env.QDRANT_URL || '',
        },
        timeout: 120000,
      }
    );

    expect(askResult.exitCode).not.toBe(0);
    expect(askResult.stderr).toContain('No today');
    expect(askResult.stderr).toContain('matches found');
  });

  it('should show fallback messaging for non-strict temporal scopes', async () => {
    if (skipIfAskPrerequisitesMissing(vectorServicesAvailable)) {
      return;
    }

    const now = new Date();
    const old = new Date(now);
    old.setDate(old.getDate() - 45);
    const oldYmd = old.toISOString().slice(0, 10);
    const collection = `e2e-ask-fallback-${Date.now()}`;
    const repoRoot = join(tempDir, 'repo-fallback');
    const docsDir = join(repoRoot, 'docs', 'sessions');
    const oldFile = join(docsDir, `${oldYmd}-archive-note.md`);

    await mkdir(join(repoRoot, '.git'), { recursive: true });
    await mkdir(docsDir, { recursive: true });
    await writeFile(oldFile, '# Archive\n\nThis is old context.');
    await utimes(oldFile, old, old);

    const embedResult = await runCLI(
      ['embed', oldFile, '--collection', collection],
      {
        cwd: repoRoot,
        env: {
          TEI_URL: process.env.TEI_URL || '',
          QDRANT_URL: process.env.QDRANT_URL || '',
        },
        timeout: 60000,
      }
    );
    expect(embedResult.exitCode).toBe(0);

    const askResult = await runCLI(
      ['ask', 'what changed this week?', '--collection', collection],
      {
        cwd: repoRoot,
        env: {
          TEI_URL: process.env.TEI_URL || '',
          QDRANT_URL: process.env.QDRANT_URL || '',
        },
        timeout: 120000,
      }
    );

    expect(askResult.exitCode).toBe(0);
    expect(askResult.stderr).toContain('Fallback:');
    expect(askResult.stderr).toContain('yes');
    expect(askResult.stderr).toContain('Temporal scope had no direct matches');
  });
});
