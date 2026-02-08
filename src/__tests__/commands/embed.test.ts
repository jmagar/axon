/**
 * Tests for embed command
 */

import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeEmbed } from '../../commands/embed';
import type {
  IContainer,
  IQdrantService,
  ITeiService,
} from '../../container/types';
import type { MockFirecrawlClient } from '../utils/mock-client';
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
  let mockClient: Partial<MockFirecrawlClient>;
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
      apiUrl: 'https://api.firecrawl.dev',
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

  it('should require --url for file input', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const result = await executeEmbed(container, {
      input: '/tmp/test.md',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('--url');
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
    expect(result.data?.collection).toBe('firecrawl');
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
