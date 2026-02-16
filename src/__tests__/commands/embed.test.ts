/**
 * Tests for embed command
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmbedCommand,
  deriveLocalSourceId,
  deriveStdinSourceId,
  executeEmbed,
  inferSourceType,
} from '../../commands/embed';
import type {
  IContainer,
  IQdrantService,
  ITeiService,
} from '../../container/types';
import type { MockAxonClient } from '../utils/mock-client';
import { createTestContainer } from '../utils/test-container';

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
  };
});

/**
 * Helper to mock readFileSync return value.
 * readFileSync has complex overloads; when called with encoding 'utf-8'
 * it returns string, but vi.mocked() sees all overloads.
 * This helper casts once to avoid repeated type gymnastics.
 */
function mockReadFile(content: string): void {
  (readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    content
  );
}

describe('executeEmbed', () => {
  let mockClient: Partial<MockAxonClient>;
  let container: IContainer;
  let mockTeiService: ITeiService;
  let mockQdrantService: IQdrantService;

  beforeEach(() => {
    mockClient = {
      scrape: vi.fn(),
    };

    // Create mock TEI service
    mockTeiService = {
      getTeiInfo: vi.fn().mockResolvedValue({
        modelId: 'test',
        dimension: 1024,
        maxInput: 32768,
      }),
      embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2]]),
      embedChunks: vi.fn().mockResolvedValue([[0.1, 0.2]]),
    };

    // Create mock Qdrant service
    mockQdrantService = {
      ensureCollection: vi.fn().mockResolvedValue(undefined),
      deleteByUrl: vi.fn().mockResolvedValue(undefined),
      deleteByUrlAndSourceCommand: vi.fn().mockResolvedValue(undefined),
      deleteByDomain: vi.fn().mockResolvedValue(undefined),
      countByDomain: vi.fn().mockResolvedValue(0),
      upsertPoints: vi.fn().mockResolvedValue(undefined),
      queryPoints: vi.fn().mockResolvedValue([]),
      scrollByUrl: vi.fn().mockResolvedValue([]),
      getCollectionInfo: vi.fn().mockResolvedValue({
        status: 'green',
        vectorsCount: 0,
        pointsCount: 0,
        segmentsCount: 1,
        config: { dimension: 1024, distance: 'Cosine' },
      }),
      scrollAll: vi.fn().mockResolvedValue([]),
      countPoints: vi.fn().mockResolvedValue(0),
      countByUrl: vi.fn().mockResolvedValue(0),
      deleteAll: vi.fn().mockResolvedValue(undefined),
    };

    container = createTestContainer(mockClient, {
      apiKey: 'test-api-key',
      apiUrl: 'https://api.axon.dev',
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });

    // Override service methods to return our mocks
    vi.spyOn(container, 'getTeiService').mockReturnValue(mockTeiService);
    vi.spyOn(container, 'getQdrantService').mockReturnValue(mockQdrantService);

    // Reset fs mocks to defaults
    vi.mocked(existsSync).mockReturnValue(false);
    mockReadFile('');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should scrape URL then embed when input is a URL', async () => {
    mockClient.scrape?.mockResolvedValue({
      markdown: '# Test Page\n\nContent here.',
      metadata: { title: 'Test Page' },
    });

    const result = await executeEmbed(container, {
      input: 'https://example.com',
    });

    expect(mockClient.scrape).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ formats: ['markdown'] })
    );
    expect(result.success).toBe(true);
    expect(result.data?.url).toBe('https://example.com');
    expect(result.data?.chunksEmbedded).toBeGreaterThan(0);

    const points = vi.mocked(mockQdrantService.upsertPoints).mock.calls[0][1];
    const payload = points[0].payload as Record<string, unknown>;
    expect(payload.title).toBe('Test Page');
    expect(payload.source_type).toBe('url');
  });

  it('should read file and embed when input is a file path', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    mockReadFile('# File content\n\nParagraph.');

    const result = await executeEmbed(container, {
      input: '/tmp/test.md',
      url: 'https://example.com/test',
    });

    expect(mockClient.scrape).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data?.url).toBe('https://example.com/test');

    const points = vi.mocked(mockQdrantService.upsertPoints).mock.calls[0][1];
    const payload = points[0].payload as Record<string, unknown>;
    expect(payload.source_path_rel).toBe('external/test.md');
    expect(payload.file_name).toBe('test.md');
    expect(payload.file_ext).toBe('md');
    expect(payload.file_size_bytes).toBeTypeOf('number');
    expect(payload.file_modified_at).toBeTypeOf('string');
    expect(payload.ingest_root).toBe('external/tmp');
    expect(payload.ingest_id).toBeTypeOf('string');
    expect(payload.title).toBe('external/test.md');
  });

  it('should derive source ID from repo path when file input omits --url', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    mockReadFile('# File content\n\nParagraph.');

    const result = await executeEmbed(container, {
      input: './docs/design/auth.md',
    });

    expect(result.success).toBe(true);
    expect(result.data?.url).toBe('axon/docs/design/auth.md');

    const points = vi.mocked(mockQdrantService.upsertPoints).mock.calls[0][1];
    const payload = points[0].payload as Record<string, unknown>;
    expect(payload.domain).toBe('axon');
    expect(payload.source_type).toBe('file');
    expect(payload.title).toBe('docs/design/auth.md');
  });

  it('should embed all files recursively when input is a directory', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'axon-embed-dir-'));
    const nestedDir = join(tempDir, 'nested');
    const rootFile = join(tempDir, 'root.md');
    const nestedFile = join(nestedDir, 'child.md');

    mkdirSync(nestedDir);
    writeFileSync(rootFile, '# Root file');
    writeFileSync(nestedFile, '# Child file');

    vi.mocked(existsSync).mockImplementation(() => true);
    mockReadFile('# Embedded file content');

    try {
      const result = await executeEmbed(container, {
        input: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.data?.filesEmbedded).toBe(2);
      expect(result.data?.chunksEmbedded).toBeGreaterThanOrEqual(2);
      expect(vi.mocked(mockQdrantService.upsertPoints)).toHaveBeenCalledTimes(
        2
      );
      expect(mockClient.scrape).not.toHaveBeenCalled();

      const firstPayload = vi.mocked(mockQdrantService.upsertPoints).mock
        .calls[0][1][0].payload as Record<string, unknown>;
      const secondPayload = vi.mocked(mockQdrantService.upsertPoints).mock
        .calls[1][1][0].payload as Record<string, unknown>;
      expect(firstPayload.ingest_id).toBe(secondPayload.ingest_id);
      expect(firstPayload.ingest_root).toBe(secondPayload.ingest_root);
      expect(firstPayload.file_name).not.toBe(secondPayload.file_name);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should reject --url/--source-id when input is a directory', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'axon-embed-dir-'));
    writeFileSync(join(tempDir, 'doc.md'), '# Doc');

    vi.mocked(existsSync).mockImplementation(() => true);

    try {
      const result = await executeEmbed(container, {
        input: tempDir,
        url: 'axon/custom-id',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'Directory input does not support --url/--source-id'
      );
      expect(vi.mocked(mockQdrantService.upsertPoints)).not.toHaveBeenCalled();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should fail if TEI_URL not configured', async () => {
    const badContainer = createTestContainer(mockClient, {
      apiKey: 'test-api-key',
      teiUrl: undefined,
      qdrantUrl: undefined,
    });

    const result = await executeEmbed(badContainer, {
      input: 'https://example.com',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('TEI_URL');
  });

  it('should use default collection when none specified', async () => {
    const defaultContainer = createTestContainer(mockClient, {
      apiKey: 'test-api-key',
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: undefined,
    });

    // Mock services for the new container
    vi.spyOn(defaultContainer, 'getTeiService').mockReturnValue(mockTeiService);
    vi.spyOn(defaultContainer, 'getQdrantService').mockReturnValue(
      mockQdrantService
    );

    vi.mocked(existsSync).mockReturnValue(true);
    mockReadFile('Some content to embed.');

    const result = await executeEmbed(defaultContainer, {
      input: '/tmp/test.md',
      url: 'https://example.com',
    });

    expect(result.success).toBe(true);
    expect(result.data?.collection).toBe('axon');
  });

  it('should use custom collection from options', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    mockReadFile('Some content to embed.');

    const result = await executeEmbed(container, {
      input: '/tmp/test.md',
      url: 'https://example.com',
      collection: 'my_custom_col',
    });

    expect(result.success).toBe(true);
    expect(result.data?.collection).toBe('my_custom_col');
  });

  it('should route local file embeds to repo collection when default is firecrawl', async () => {
    const firecrawlContainer = createTestContainer(mockClient, {
      apiKey: 'test-api-key',
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'firecrawl',
    });
    vi.spyOn(firecrawlContainer, 'getTeiService').mockReturnValue(
      mockTeiService
    );
    vi.spyOn(firecrawlContainer, 'getQdrantService').mockReturnValue(
      mockQdrantService
    );

    vi.mocked(existsSync).mockReturnValue(true);
    mockReadFile('Local doc content');

    const result = await executeEmbed(firecrawlContainer, {
      input: './docs/design/auth.md',
    });

    expect(result.success).toBe(true);
    expect(result.data?.collection).toBe('axon');
  });

  it('should route stdin embeds to repo collection when default is firecrawl', async () => {
    const firecrawlContainer = createTestContainer(mockClient, {
      apiKey: 'test-api-key',
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'firecrawl',
    });
    vi.spyOn(firecrawlContainer, 'getTeiService').mockReturnValue(
      mockTeiService
    );
    vi.spyOn(firecrawlContainer, 'getQdrantService').mockReturnValue(
      mockQdrantService
    );

    const result = await executeEmbed(firecrawlContainer, {
      input: '-',
      stdinContent: '# Session log\n\nDetails...',
    });

    expect(result.success).toBe(true);
    expect(result.data?.collection).toBe('axon');
  });

  it('should keep URL embeds in configured default collection', async () => {
    const firecrawlContainer = createTestContainer(mockClient, {
      apiKey: 'test-api-key',
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'firecrawl',
    });
    vi.spyOn(firecrawlContainer, 'getTeiService').mockReturnValue(
      mockTeiService
    );
    vi.spyOn(firecrawlContainer, 'getQdrantService').mockReturnValue(
      mockQdrantService
    );
    mockClient.scrape?.mockResolvedValue({
      markdown: '# URL content\n\nDoc',
      metadata: { title: 'URL Doc' },
    });

    const result = await executeEmbed(firecrawlContainer, {
      input: 'https://example.com/doc',
    });

    expect(result.success).toBe(true);
    expect(result.data?.collection).toBe('firecrawl');
  });

  it('should skip chunking when noChunk is true', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    mockReadFile('Short content.');

    const result = await executeEmbed(container, {
      input: '/tmp/test.md',
      url: 'https://example.com',
      noChunk: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.chunksEmbedded).toBe(1);
  });

  it('should fail for empty content', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    mockReadFile('   ');

    const result = await executeEmbed(container, {
      input: '/tmp/test.md',
      url: 'https://example.com',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No content');
  });

  it('should fail for invalid input', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await executeEmbed(container, {
      input: 'not-a-url-or-file',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not a valid URL');
  });

  it('should handle scrape errors gracefully', async () => {
    mockClient.scrape?.mockRejectedValue(new Error('Network timeout'));

    const result = await executeEmbed(container, {
      input: 'https://example.com',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network timeout');
  });

  it('should delete old vectors before upserting new ones', async () => {
    mockClient.scrape?.mockResolvedValue({
      markdown: '# Content\n\nSome text.',
    });

    await executeEmbed(container, {
      input: 'https://example.com',
    });

    // deleteByUrl should be called before upsertPoints
    const deleteOrder = vi.mocked(mockQdrantService.deleteByUrl).mock
      .invocationCallOrder[0];
    const upsertOrder = vi.mocked(mockQdrantService.upsertPoints).mock
      .invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(upsertOrder);
  });
});

describe('createEmbedCommand', () => {
  it('should include status subcommand', () => {
    const cmd = createEmbedCommand();
    expect(cmd.commands.find((sub) => sub.name() === 'status')).toBeDefined();
  });

  it('should include cancel subcommand', () => {
    const cmd = createEmbedCommand();
    expect(cmd.commands.find((sub) => sub.name() === 'cancel')).toBeDefined();
  });

  it('should include clear subcommand', () => {
    const cmd = createEmbedCommand();
    expect(cmd.commands.find((sub) => sub.name() === 'clear')).toBeDefined();
  });

  it('should include cleanup subcommand', () => {
    const cmd = createEmbedCommand();
    expect(cmd.commands.find((sub) => sub.name() === 'cleanup')).toBeDefined();
  });
});

describe('deriveLocalSourceId', () => {
  it('should generate repo-relative source IDs', () => {
    vi.mocked(existsSync).mockImplementation((p) => p === '/work/axon/.git');
    expect(deriveLocalSourceId('./docs/design/auth.md', '/work/axon')).toBe(
      'axon/docs/design/auth.md'
    );
  });

  it('should use git root namespace when run from subdirectory', () => {
    vi.mocked(existsSync).mockImplementation((p) => p === '/work/axon/.git');
    expect(
      deriveLocalSourceId('../docs/design/auth.md', '/work/axon/packages')
    ).toBe('axon/docs/design/auth.md');
  });

  it('should fallback to absolute path when input is outside cwd', () => {
    vi.mocked(existsSync).mockImplementation(() => false);
    expect(deriveLocalSourceId('../shared/note.md', '/work/axon')).toMatch(
      /^axon\/external\/note\.md-[a-f0-9]{12}$/
    );
  });
});

describe('deriveStdinSourceId', () => {
  it('should generate deterministic IDs for same content', () => {
    vi.mocked(existsSync).mockImplementation((p) => p === '/work/axon/.git');
    const a = deriveStdinSourceId('hello world', '/work/axon');
    const b = deriveStdinSourceId('hello world', '/work/axon');
    expect(a).toBe('axon/stdin/b94d27b9934d3e08');
    expect(b).toBe(a);
  });

  it('should generate different IDs for different content', () => {
    vi.mocked(existsSync).mockImplementation((p) => p === '/work/axon/.git');
    const a = deriveStdinSourceId('hello', '/work/axon');
    const b = deriveStdinSourceId('goodbye', '/work/axon');
    expect(a).not.toBe(b);
  });
});

describe('inferSourceType', () => {
  it('should detect URL source IDs', () => {
    expect(inferSourceType('https://example.com/a')).toBe('url');
    expect(inferSourceType('test://fixture/id')).toBe('url');
  });

  it('should detect stdin source IDs', () => {
    expect(inferSourceType('axon/stdin/abcd1234')).toBe('stdin');
  });

  it('should treat local paths as file source IDs', () => {
    expect(inferSourceType('axon/docs/design/auth.md')).toBe('file');
  });
});
