/**
 * Tests for embed command
 */

import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeEmbed } from '../../commands/embed';
import type { IContainer } from '../../container/types';
import { resetConfig } from '../../utils/config';
import * as embeddings from '../../utils/embeddings';
import * as qdrant from '../../utils/qdrant';
import { setupTest, teardownTest } from '../utils/mock-client';
import { createTestContainer } from '../utils/test-container';

vi.mock('../../utils/embeddings');
vi.mock('../../utils/qdrant');

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
  let mockClient: { scrape: ReturnType<typeof vi.fn> };
  let container: IContainer;

  beforeEach(() => {
    setupTest();

    mockClient = {
      scrape: vi.fn(),
    };

    container = createTestContainer(mockClient as any, {
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: 'test_col',
    });

    vi.mocked(embeddings.getTeiInfo).mockResolvedValue({
      modelId: 'test',
      dimension: 1024,
      maxInput: 32768,
    });
    vi.mocked(embeddings.embedChunks).mockResolvedValue([[0.1, 0.2]]);
    vi.mocked(qdrant.ensureCollection).mockResolvedValue();
    vi.mocked(qdrant.deleteByUrl).mockResolvedValue();
    vi.mocked(qdrant.upsertPoints).mockResolvedValue();

    // Reset fs mocks to defaults
    vi.mocked(existsSync).mockReturnValue(false);
    mockReadFile('');
  });

  afterEach(() => {
    teardownTest();
    vi.clearAllMocks();
  });

  it('should scrape URL then embed when input is a URL', async () => {
    mockClient.scrape.mockResolvedValue({
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

    const points = vi.mocked(qdrant.upsertPoints).mock.calls[0][2];
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
    const badContainer = createTestContainer(mockClient as any, {
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
    const defaultContainer = createTestContainer(mockClient as any, {
      apiKey: 'test-api-key',
      teiUrl: 'http://localhost:52000',
      qdrantUrl: 'http://localhost:53333',
      qdrantCollection: undefined,
    });

    vi.mocked(existsSync).mockReturnValue(true);
    mockReadFile('Some content to embed.');

    const result = await executeEmbed(defaultContainer, {
      input: '/tmp/test.md',
      url: 'https://example.com',
    });

    expect(result.success).toBe(true);
    expect(result.data?.collection).toBe('firecrawl_collection');
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
    mockClient.scrape.mockRejectedValue(new Error('Network timeout'));

    const result = await executeEmbed(container, {
      input: 'https://example.com',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network timeout');
  });

  it('should delete old vectors before upserting new ones', async () => {
    mockClient.scrape.mockResolvedValue({
      markdown: '# Content\n\nSome text.',
    });

    await executeEmbed(container, {
      input: 'https://example.com',
    });

    // deleteByUrl should be called before upsertPoints
    const deleteOrder = vi.mocked(qdrant.deleteByUrl).mock
      .invocationCallOrder[0];
    const upsertOrder = vi.mocked(qdrant.upsertPoints).mock
      .invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(upsertOrder);
  });
});
